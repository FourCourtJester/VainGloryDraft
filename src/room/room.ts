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
import type { DraftProjection, Presence, TurnClock, Viewer } from "../projection.js";
import { project } from "../projection.js";
import type { DraftRecord } from "../record.js";
import { draftRecord } from "../record.js";
import { nextAlarmAt, read, settleTurn, startTimer } from "../timer.js";
import type { TimerRules, TimerState } from "../timer.js";
import type { AutoFillStrategy, DraftState, Team, TurnScript } from "../types.js";
import type { ClientMessage, RoomError, RoomPhase } from "./protocol.js";
import type { RoomCredentials } from "./tokens.js";
import { credentialsMatch, generateCredentials, generateToken, normaliseCode } from "./tokens.js";

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
  authenticate(credential: string, now: number = Date.now()): Viewer | null {
    const { credentials } = this.#snapshot;
    if (credentialsMatch(credential, credentials.spectator)) return { role: "spectator" };

    if (this.lockedOut(now)) return null;

    const code = normaliseCode(credential);
    if (credentialsMatch(code, credentials.A)) return this.#accept({ role: "captain", team: "A" }, now);
    if (credentialsMatch(code, credentials.B)) return this.#accept({ role: "captain", team: "B" }, now);

    this.#recordFailure(now);
    return null;
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

  #accept(viewer: Viewer, now: number): Viewer {
    // A captain who gets in clears the slate: the failures were their typing.
    if (this.#snapshot.failures.count > 0) {
      this.#snapshot = { ...this.#snapshot, failures: { count: 0, since: now } };
    }
    return viewer;
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
    return this.#maybeStart(now);
  }

  detach(connectionId: string, now: number): RoomOutcome {
    if (!this.#connections.delete(connectionId)) return NOTHING;
    // Losing someone changes nothing about the draft itself. The room shows that
    // they have gone and carries on; deciding what to do about it belongs to the
    // people running the tournament, not to the app.
    const overdue = this.tick(now);
    return { events: overdue.events, error: null, changed: true };
  }

  presence(): Presence {
    const teams = new Set<Team>();
    for (const viewer of this.#connections.values()) {
      if (viewer.role === "captain") teams.add(viewer.team);
    }
    return { A: teams.has("A") ? "connected" : "disconnected", B: teams.has("B") ? "connected" : "disconnected" };
  }

  /**
   * Starts the draft once both captains are actually there.
   *
   * Nobody's time should tick away while they are still finding their link, so a
   * room waits, however long that takes, and starts the clock only when both
   * captains are present to play against it.
   */
  #maybeStart(now: number): RoomOutcome {
    if (this.#snapshot.phase !== "lobby") return { events: [], error: null, changed: true };
    const presence = this.presence();
    if (presence.A !== "connected" || presence.B !== "connected") {
      return { events: [], error: null, changed: true };
    }
    this.#snapshot = { ...this.#snapshot, phase: "drafting", timer: startTimer(this.#snapshot.rules, now) };
    return { events: [], error: null, changed: true };
  }

  /** Handles a request from somebody in the room, and decides what it changes. */
  command(viewer: Viewer, message: ClientMessage, now: number): RoomOutcome {
    if (message.t === "resync") return { events: [], error: null, changed: true };

    // Settle any turn whose time ran out before this arrived. A click that lands
    // a moment too late must not be allowed to beat the clock.
    const overdue = this.tick(now);

    if (viewer.role !== "captain") {
      return refuse("not_a_captain", "Spectators cannot act in the draft.", overdue);
    }
    if (this.#snapshot.phase === "lobby") {
      return refuse("not_started", "The draft has not started: both captains must connect.", overdue);
    }
    if (this.#snapshot.phase === "complete") {
      return refuse("draft_complete", "The draft is over.", overdue);
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

  projection(viewer: Viewer, now: number): DraftProjection {
    return project({
      state: this.#snapshot.draft,
      viewer,
      presence: this.presence(),
      clock: this.clock(now),
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
