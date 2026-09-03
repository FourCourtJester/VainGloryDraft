/**
 * A draft room: the draft itself, the clock, the three links, and whoever is
 * currently connected.
 *
 * This is the version of a draft that counts. Screens show what a room tells
 * them and ask it for things; if a screen and this room ever disagree, the room
 * is right. Every question with an answer — whose turn it is, what happens when
 * the clock runs out, when the draft may begin, who is allowed to see what — is
 * settled here.
 *
 * A room is told what time it is rather than looking it up, which is what allows
 * a whole tournament's worth of drafts, including clocks running out, to be
 * played through in a fraction of a second when testing.
 */

import { draftConfig } from "../config.js";
import { commit, createDraft, currentTurn, isComplete, resolveTimeout, stage, unstage } from "../engine.js";
import type { DraftEvent } from "../events.js";
import { diffEvents } from "../events.js";
import { ALL_HERO_IDS } from "../heroes.js";
import { defaultScript } from "../presets.js";
import { deriveTotals } from "../script.js";
import type { DraftProjection, LobbyView, MemberView, Presence, TurnClock, Viewer } from "../projection.js";
import { project } from "../projection.js";
import type { DraftRecord } from "../record.js";
import { draftRecord } from "../record.js";
import { nextAlarmAt, read, settleTurn, startTimer } from "../timer.js";
import type { TimerRules, TimerState } from "../timer.js";
import type { AutoFillStrategy, DraftState, Team, TurnScript } from "../types.js";
import type { ClientMessage, RoomError, RoomPhase } from "./protocol.js";
import type { Roster } from "./roster.js";
import {
  claimLead,
  emptyRoster,
  everyoneHere,
  everyoneReady,
  findMember,
  handOver,
  join as joinRoster,
  passOnAbandonedLead,
  setReady,
  teamMembers,
  touch,
} from "./roster.js";
import type { RoomCredentials } from "./tokens.js";
import { cleanName } from "./names.js";
import { credentialsMatch, generateCredentials, generateToken, normaliseCode } from "./tokens.js";

/**
 * How many players a side has, taken from the format itself: a draft where each
 * team picks five heroes is played by five people. A room can say otherwise if
 * some format ever breaks that rule.
 */
function playersPerTeam(script: DraftState["config"]["script"]): number {
  const totals = deriveTotals(script);
  return Math.max(1, totals.byTeam.A.picks, totals.byTeam.B.picks);
}

/**
 * How long a side's leader can be gone before the job passes to a teammate.
 *
 * Long enough that a tunnel or a dropped signal does not cost somebody the job,
 * short enough that a team is not stuck waiting on a phone that is not coming
 * back. A teammate can always take over sooner by asking.
 */
const LEAD_GRACE_MS = 45_000;

/** Wrong codes tolerated before the room stops answering, and for how long. */
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MS = 5 * 60_000;

/** Thirty seconds a turn, with a minute of reserve each for the whole draft. */
export const DEFAULT_TIMER_RULES: TimerRules = { perTurnMs: 30_000, bankMs: 60_000 };

export interface CreateRoomOptions {
  readonly script?: TurnScript;
  readonly heroPool?: readonly string[];
  readonly mirrorPicks?: boolean;
  readonly autoFill?: AutoFillStrategy;
  readonly rules?: TimerRules;
  readonly roomId?: string;
  readonly seed?: string;
  readonly callbackUrl?: string | null;
  /** How many players a side has. Taken from the format unless given. */
  readonly teamSize?: number;
  readonly credentials?: RoomCredentials;
}

/**
 * Everything about a room worth keeping, so that one interrupted half-way
 * through can be picked up again exactly where it was.
 */
export interface RoomSnapshot {
  readonly version: 1;
  readonly roomId: string;
  readonly createdAt: number;
  readonly phase: RoomPhase;
  readonly draft: DraftState;
  readonly timer: TimerState;
  readonly rules: TimerRules;
  readonly credentials: RoomCredentials;
  /**
   * Wrong codes seen lately. A captain's code is short enough to guess if you
   * are allowed to keep trying, so the room stops answering for a while once
   * somebody clearly is.
   */
  readonly failures: { readonly count: number; readonly since: number };
  /** Who is in the room, who leads each side, and how many each side waits for. */
  readonly roster: Roster;
  /**
   * Which sides' leaders have agreed to begin without a full room. A no-show
   * should not be able to cancel a tournament match, but one side should not be
   * able to start on the other either, so it takes both.
   */
  readonly startAnyway: Readonly<Record<Team, boolean>>;
  /** Where to report the finished draft, if whoever made the room asked for that. */
  readonly callbackUrl: string | null;
  /** Set once the finished draft has been reported, so it is not sent twice. */
  readonly reported: boolean;
}

export interface RoomOutcome {
  /** What happened, for telling the room and anything else that is listening. */
  readonly events: readonly DraftEvent[];
  /**
   * Why this particular request was refused. Only the person who made it is
   * told; nobody else in the room needs to see somebody's misclick.
   */
  readonly error: RoomError | null;
  /** Whether anything changed that people should be shown. */
  readonly changed: boolean;
}

const NOTHING: RoomOutcome = { events: [], error: null, changed: false };

/**
 * Turns a request down, while still reporting anything the clock did in the
 * meantime.
 *
 * Checking the clock is the first thing a room does with any request, so a
 * request that is about to be refused may still have carried a turn over the
 * time limit on its way in. That turn genuinely happened and the room has to
 * hear about it, even though the request that revealed it goes no further.
 */
function refuse(code: RoomError["code"], message: string, ticked: RoomOutcome): RoomOutcome {
  return { events: ticked.events, error: { code, message }, changed: ticked.changed };
}

export class Room {
  #snapshot: RoomSnapshot;
  /** Who is connected right now. Forgotten when a room is put away and rebuilt on waking. */
  #connections = new Map<string, Viewer>();

  constructor(snapshot: RoomSnapshot) {
    this.#snapshot = snapshot;
  }

  /** Sets up a new room: a format to play, a roster to draft from, and three links. */
  static create(options: CreateRoomOptions, now: number): RoomSnapshot {
    const draft = createDraft(
      draftConfig({
        script: options.script ?? defaultScript(),
        heroPool: options.heroPool ?? ALL_HERO_IDS,
        seed: options.seed ?? generateToken(12),
        mirrorPicks: options.mirrorPicks,
        autoFill: options.autoFill,
      }),
    );
    if (!draft.ok) throw new Error(`Cannot create room: ${draft.error.message}`);

    const rules = options.rules ?? DEFAULT_TIMER_RULES;
    return {
      version: 1,
      roomId: options.roomId ?? generateToken(8),
      createdAt: now,
      phase: "lobby",
      draft: draft.value,
      timer: startTimer(rules, now),
      rules,
      credentials: options.credentials ?? generateCredentials(),
      failures: { count: 0, since: now },
      roster: emptyRoster(options.teamSize ?? playersPerTeam(draft.value.config.script)),
      startAnyway: { A: false, B: false },
      callbackUrl: options.callbackUrl ?? null,
      reported: false,
    };
  }

  get snapshot(): RoomSnapshot {
    return this.#snapshot;
  }

  get phase(): RoomPhase {
    return this.#snapshot.phase;
  }

  /**
   * Works out who somebody is from whatever they arrived with — a spectator
   * link, or a captain's code typed in or carried by their link.
   *
   * Wrong codes are counted. Six characters is comfortable to type and short
   * enough to guess if you are allowed to sit there trying, so after a handful
   * of failures the room stops answering for a few minutes. A spectator link is
   * long enough that it needs no such protection, and is checked first so that
   * watchers are never caught by a lockout somebody else caused.
   */
  authenticate(credential: string, now: number = Date.now()): Team | "spectator" | null {
    const { credentials } = this.#snapshot;
    if (credentialsMatch(credential, credentials.spectator)) return "spectator";

    if (this.lockedOut(now)) return null;

    const code = normaliseCode(credential);
    if (credentialsMatch(code, credentials.A)) return this.#accept("A", now);
    if (credentialsMatch(code, credentials.B)) return this.#accept("B", now);

    this.#recordFailure(now);
    return null;
  }

  /**
   * Whether the draft may begin: either everybody is here and ready, or both
   * sides' leaders have agreed to start without them. Either way both sides
   * need somebody to do the picking.
   */
  canBegin(): boolean {
    const { roster, startAnyway } = this.#snapshot;
    const bothLed = roster.leaders.A !== null && roster.leaders.B !== null;
    if (!bothLed) return false;
    if (everyoneReady(roster)) return true;
    return startAnyway.A && startAnyway.B;
  }

  /** True while the room is refusing code attempts after too many wrong ones. */
  lockedOut(now: number = Date.now()): boolean {
    const { count, since } = this.#snapshot.failures;
    if (now - since > FAILURE_WINDOW_MS) return false;
    return count >= MAX_FAILURES;
  }

  /** When the room will start accepting codes again, or `null` if it already does. */
  lockedUntil(now: number = Date.now()): number | null {
    return this.lockedOut(now) ? this.#snapshot.failures.since + FAILURE_WINDOW_MS : null;
  }

  #accept<T>(seat: T, now: number): T {
    // Somebody getting in clears the slate: the failures were their typing.
    if (this.#snapshot.failures.count > 0) {
      this.#snapshot = { ...this.#snapshot, failures: { count: 0, since: now } };
    }
    return seat;
  }

  /**
   * Seats a player on their side, or recognises one coming back.
   *
   * The first to arrive on a team leads it. Anybody returning keeps what they
   * had — their place, and the lead if it was theirs — so a dropped phone never
   * costs somebody the job mid-draft.
   */
  seat(team: Team, playerId: string, rawName: string, now: number): Viewer {
    const name = cleanName(rawName, playerId);
    // Scope the id to the side. A browser remembers one id, so without this an
    // organiser with both team links open would join as one person twice, and
    // the second side would never fill up.
    const memberId = `${team}:${playerId}`;
    this.#snapshot = {
      ...this.#snapshot,
      roster: joinRoster(this.#snapshot.roster, { id: memberId, name, team }, now),
    };
    return { role: "player", team, memberId };
  }

  #recordFailure(now: number): void {
    const { count, since } = this.#snapshot.failures;
    const fresh = now - since > FAILURE_WINDOW_MS;
    this.#snapshot = {
      ...this.#snapshot,
      failures: fresh ? { count: 1, since: now } : { count: count + 1, since },
    };
  }

  /** The finished draft still needs reporting to whoever asked for it. */
  get pendingReport(): string | null {
    const { callbackUrl, reported, phase } = this.#snapshot;
    return phase === "complete" && !reported && callbackUrl !== null ? callbackUrl : null;
  }

  markReported(): void {
    this.#snapshot = { ...this.#snapshot, reported: true };
  }

  /**
   * Notes that somebody has joined.
   *
   * The same person may be connected more than once — a captain with the draft
   * open on a laptop and a phone is still one captain, and still counts as
   * present until the last of their screens goes away.
   */
  attach(connectionId: string, viewer: Viewer, now: number): RoomOutcome {
    this.#connections.set(connectionId, viewer);
    this.#noteWhoIsHere(now);
    return this.#maybeStart(now);
  }

  detach(connectionId: string, now: number): RoomOutcome {
    if (!this.#connections.delete(connectionId)) return NOTHING;
    // Losing someone changes nothing about the draft itself. The room shows that
    // they have gone and carries on; deciding what to do about it belongs to the
    // people running the tournament, not to the app.
    const overdue = this.tick(now);
    this.#noteWhoIsHere(now);
    return { events: overdue.events, error: null, changed: true };
  }

  /**
   * Records who is connected, and moves a lead off anybody who has been gone
   * long enough that their side should not still be waiting on them.
   */
  #noteWhoIsHere(now: number): void {
    const connected = this.#connectedIds();
    let roster = touch(this.#snapshot.roster, connected, now);
    const passed = passOnAbandonedLead(roster, connected, now, LEAD_GRACE_MS);
    if (passed !== null) roster = passed;
    if (roster !== this.#snapshot.roster) this.#snapshot = { ...this.#snapshot, roster };
  }

  /** Which member ids currently have a live connection. */
  #connectedIds(): Set<string> {
    const ids = new Set<string>();
    for (const viewer of this.#connections.values()) {
      if (viewer.role === "player") ids.add(viewer.memberId);
    }
    return ids;
  }

  /**
   * Whether each side's leader is connected — the indicator the room watches
   * when somebody goes quiet mid-draft.
   */
  presence(): Presence {
    const connected = this.#connectedIds();
    const here = (team: Team): boolean => {
      const leader = this.#snapshot.roster.leaders[team];
      return leader !== null && connected.has(leader);
    };
    return { A: here("A") ? "connected" : "disconnected", B: here("B") ? "connected" : "disconnected" };
  }

  /** The room as everybody in it should see it: who is here, ready, and leading. */
  lobby(forMemberId: string | null): LobbyView {
    const { roster } = this.#snapshot;
    const connected = this.#connectedIds();
    const members: MemberView[] = roster.members.map((member) => ({
      id: member.id,
      name: member.name,
      team: member.team,
      ready: member.ready,
      connected: connected.has(member.id),
      leader: roster.leaders[member.team] === member.id,
      you: member.id === forMemberId,
    }));
    return {
      teamSize: roster.teamSize,
      members,
      everyoneHere: everyoneHere(roster),
      everyoneReady: everyoneReady(roster),
      startAnyway: this.#snapshot.startAnyway,
    };
  }

  /**
   * Starts the draft once every player is in the room and has said they are
   * ready.
   *
   * Nobody's time should tick away while their team is still arriving, so the
   * room waits however long that takes. Both sides being full is not enough on
   * its own: ten people staring at a loading screen is exactly when somebody is
   * still finding their headset.
   */
  #maybeStart(now: number): RoomOutcome {
    if (this.#snapshot.phase !== "lobby") return { events: [], error: null, changed: true };
    if (!this.canBegin()) return { events: [], error: null, changed: true };
    this.#snapshot = { ...this.#snapshot, phase: "drafting", timer: startTimer(this.#snapshot.rules, now) };
    return { events: [], error: null, changed: true };
  }

  /** Handles a request from somebody in the room, and decides what it changes. */
  command(viewer: Viewer, message: ClientMessage, now: number): RoomOutcome {
    if (message.t === "resync") return { events: [], error: null, changed: true };

    // Settle any turn whose time ran out before this arrived. A click that lands
    // a moment too late must not be allowed to beat the clock.
    const overdue = this.tick(now);

    // Anyone in the room may ready up or move the lead around, whether or not a
    // draft is under way; only players, though — watching is watching.
    if (viewer.role !== "player") {
      return refuse("not_a_player", "Spectators cannot take part in the draft.", overdue);
    }

    if (message.t === "ready") {
      this.#snapshot = { ...this.#snapshot, roster: setReady(this.#snapshot.roster, viewer.memberId, message.ready) };
      const started = this.#maybeStart(now);
      return { events: [...overdue.events, ...started.events], error: null, changed: true };
    }

    if (message.t === "handOver") {
      const moved = handOver(this.#snapshot.roster, viewer.memberId, message.memberId);
      if (moved === null) {
        return refuse("not_your_call", "Only your side's leader can hand the job on, and only to a teammate.", overdue);
      }
      this.#snapshot = { ...this.#snapshot, roster: moved };
      return { events: overdue.events, error: null, changed: true };
    }

    if (message.t === "startAnyway") {
      if (this.#snapshot.roster.leaders[viewer.team] !== viewer.memberId) {
        return refuse("not_your_call", "Only your side's leader can agree to begin early.", overdue);
      }
      this.#snapshot = {
        ...this.#snapshot,
        startAnyway: { ...this.#snapshot.startAnyway, [viewer.team]: message.agreed },
      };
      const started = this.#maybeStart(now);
      return { events: [...overdue.events, ...started.events], error: null, changed: true };
    }

    if (message.t === "claimLead") {
      const claimed = claimLead(this.#snapshot.roster, viewer.memberId, this.#connectedIds());
      if (claimed === null) {
        return refuse("leader_present", "Your side already has a leader who is connected.", overdue);
      }
      this.#snapshot = { ...this.#snapshot, roster: claimed };
      return { events: overdue.events, error: null, changed: true };
    }

    if (this.#snapshot.phase === "lobby") {
      return refuse("not_started", "The draft has not started: both captains must connect.", overdue);
    }
    if (this.#snapshot.phase === "complete") {
      return refuse("draft_complete", "The draft is over.", overdue);
    }

    if (this.#snapshot.roster.leaders[viewer.team] !== viewer.memberId) {
      return refuse("not_your_call", "Your side's leader makes the picks.", overdue);
    }

    const before = this.#snapshot.draft;
    const result =
      message.t === "stage"
        ? stage(before, viewer.team, message.heroId)
        : message.t === "unstage"
          ? unstage(before, viewer.team, message.heroId)
          : commit(before, viewer.team, now);

    if (!result.ok) return refuse(result.error.code, result.error.message, overdue);

    const committed = message.t === "confirm";
    this.#advance(result.value, committed ? now : null);
    return {
      events: [...overdue.events, ...diffEvents(before, this.#snapshot.draft)],
      error: null,
      changed: true,
    };
  }

  /**
   * Brings the draft up to date with the clock, settling every turn whose time
   * has run out.
   *
   * Usually that is one turn, or none at all. But a room that was asleep or
   * unreachable for a while can wake to find several turns' worth of time gone,
   * and each of those turns is settled at the moment it actually expired rather
   * than all at once on waking. The finished draft then reads the same as it
   * would have if somebody had been watching the whole way through.
   */
  tick(now: number): RoomOutcome {
    this.#noteWhoIsHere(now);
    if (this.#snapshot.phase !== "drafting") return NOTHING;

    const before = this.#snapshot.draft;
    let resolved = false;

    for (;;) {
      const turn = currentTurn(this.#snapshot.draft);
      if (turn === null) break;
      const deadline = nextAlarmAt(this.#snapshot.rules, this.#snapshot.timer, turn.team);
      if (now < deadline) break;

      const auto = resolveTimeout(this.#snapshot.draft, deadline);
      if (!auto.ok) break;
      this.#advance(auto.value, deadline);
      resolved = true;
    }

    if (!resolved) return NOTHING;
    return { events: diffEvents(before, this.#snapshot.draft), error: null, changed: true };
  }

  /** Takes the draft forward, charging the clock when a turn has genuinely ended. */
  #advance(draft: DraftState, turnEndedAt: number | null): void {
    let timer = this.#snapshot.timer;
    if (turnEndedAt !== null) {
      const ended = draft.committed.at(-1);
      if (ended !== undefined) timer = settleTurn(this.#snapshot.rules, timer, ended.team, turnEndedAt);
    }
    this.#snapshot = {
      ...this.#snapshot,
      draft,
      timer,
      phase: isComplete(draft) ? "complete" : this.#snapshot.phase,
    };
  }

  /**
   * When this room next needs waking, so that a turn can run out even with
   * nobody watching. Nothing to wake for when no clock is running.
   */
  alarmAt(): number | null {
    if (this.#snapshot.phase !== "drafting") return null;
    const turn = currentTurn(this.#snapshot.draft);
    if (turn === null) return null;
    return nextAlarmAt(this.#snapshot.rules, this.#snapshot.timer, turn.team);
  }

  clock(now: number): TurnClock | null {
    if (this.#snapshot.phase !== "drafting") return null;
    const turn = currentTurn(this.#snapshot.draft);
    if (turn === null) return null;
    const reading = read(this.#snapshot.rules, this.#snapshot.timer, turn.team, now);
    return {
      turnStartedAt: this.#snapshot.timer.turnStartedAt,
      perTurnMs: this.#snapshot.rules.perTurnMs,
      bank: this.#snapshot.timer.bank,
      expiresAt: reading.expiresAt,
    };
  }

  /**
   * The account of this draft in the order it happened, for reading back after
   * the fact.
   */
  record(): DraftRecord {
    return draftRecord(this.#snapshot.draft, this.#snapshot.createdAt);
  }

  /**
   * Who played, for whoever is keeping a record of the tournament.
   *
   * The ids are whatever each player arrived with, so a bot that hands out
   * personalised links gets its own identifiers back and can tell that the same
   * person played five drafts today.
   */
  players(): readonly { id: string; name: string; team: Team; led: boolean }[] {
    const { roster } = this.#snapshot;
    return roster.members.map((member) => ({
      id: member.id,
      name: member.name,
      team: member.team,
      led: roster.leaders[member.team] === member.id,
    }));
  }

  projection(viewer: Viewer, now: number): DraftProjection {
    return project({
      state: this.#snapshot.draft,
      viewer,
      presence: this.presence(),
      clock: this.clock(now),
      lobby: this.lobby(viewer.role === "player" ? viewer.memberId : null),
      startedAt: this.#snapshot.createdAt,
    });
  }

  /** Everyone currently connected, each with the view of the draft they are allowed. */
  *audience(now: number): Generator<{ connectionId: string; viewer: Viewer; projection: DraftProjection }> {
    for (const [connectionId, viewer] of this.#connections) {
      yield { connectionId, viewer, projection: this.projection(viewer, now) };
    }
  }
}
