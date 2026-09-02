/**
 * A draft room: engine + clock + tokens + connections.
 *
 * This is where the authoritative state lives. It is deliberately free of any
 * Cloudflare import — the Durable Object is a thin adapter that supplies
 * sockets, storage and alarms, and everything decidable is decided here, against
 * an injected `now` so it can be tested at any speed.
 */

import { commit, createDraft, currentTurn, isComplete, resolveTimeout, stage, unstage } from "../engine.js";
import type { DraftEvent } from "../events.js";
import { diffEvents } from "../events.js";
import { ALL_HERO_IDS } from "../heroes.js";
import { defaultScript } from "../presets.js";
import type { DraftProjection, Presence, TurnClock, Viewer } from "../projection.js";
import { project } from "../projection.js";
import { nextAlarmAt, read, settleTurn, startTimer } from "../timer.js";
import type { TimerRules, TimerState } from "../timer.js";
import type { AutoFillStrategy, DraftState, Team, TurnScript } from "../types.js";
import type { ClientMessage, RoomError, RoomPhase } from "./protocol.js";
import type { RoomTokens } from "./tokens.js";
import { generateRoomTokens, generateToken, tokensMatch } from "./tokens.js";

export const DEFAULT_TIMER_RULES: TimerRules = { perTurnMs: 30_000, bankMs: 60_000 };

export interface CreateRoomOptions {
  readonly script?: TurnScript;
  readonly heroPool?: readonly string[];
  readonly mirrorPicks?: boolean;
  readonly autoFill?: AutoFillStrategy;
  readonly rules?: TimerRules;
  readonly roomId?: string;
  readonly seed?: string;
  readonly tokens?: RoomTokens;
}

/** Everything the room needs to be rebuilt from storage. */
export interface RoomSnapshot {
  readonly version: 1;
  readonly roomId: string;
  readonly createdAt: number;
  readonly phase: RoomPhase;
  readonly draft: DraftState;
  readonly timer: TimerState;
  readonly rules: TimerRules;
  readonly tokens: RoomTokens;
}

export interface RoomOutcome {
  /** Committed actions this call produced. Safe to broadcast: staging never appears. */
  readonly events: readonly DraftEvent[];
  /** Set when the caller's own command was rejected. Goes back to that caller only. */
  readonly error: RoomError | null;
  /** True when anything a viewer can see changed, so the room should re-broadcast. */
  readonly changed: boolean;
}

const NOTHING: RoomOutcome = { events: [], error: null, changed: false };

/**
 * A refusal, carrying whatever the clock did on the way in.
 *
 * `command` runs the clock before it checks permissions, so a rejected message
 * can still arrive holding a turn the clock has just resolved. Reporting
 * `changed: false` there would tell the host there is nothing to persist,
 * broadcast or re-arm — and the room would stall with its alarm already spent.
 */
function refuse(code: RoomError["code"], message: string, ticked: RoomOutcome): RoomOutcome {
  return { events: ticked.events, error: { code, message }, changed: ticked.changed };
}

export class Room {
  #snapshot: RoomSnapshot;
  /** Live connections. Not persisted: a hibernated room has no opinion about sockets. */
  #connections = new Map<string, Viewer>();

  constructor(snapshot: RoomSnapshot) {
    this.#snapshot = snapshot;
  }

  static create(options: CreateRoomOptions, now: number): RoomSnapshot {
    const script = options.script ?? defaultScript();
    const draft = createDraft({
      script,
      heroPool: options.heroPool ?? ALL_HERO_IDS,
      mirrorPicks: options.mirrorPicks ?? false,
      autoFill: options.autoFill ?? "random",
      seed: options.seed ?? generateToken(12),
    });
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
      tokens: options.tokens ?? generateRoomTokens(),
    };
  }

  get snapshot(): RoomSnapshot {
    return this.#snapshot;
  }

  get phase(): RoomPhase {
    return this.#snapshot.phase;
  }

  /** Which viewer a link token belongs to, or `null` if it belongs to none. */
  authenticate(token: string): Viewer | null {
    const { tokens } = this.#snapshot;
    if (tokensMatch(token, tokens.A)) return { role: "captain", team: "A" };
    if (tokensMatch(token, tokens.B)) return { role: "captain", team: "B" };
    if (tokensMatch(token, tokens.spectator)) return { role: "spectator" };
    return null;
  }

  /**
   * Register a connection. Tokens are reusable, so the same captain may hold
   * several — a laptop and a phone both count as present.
   */
  attach(connectionId: string, viewer: Viewer, now: number): RoomOutcome {
    this.#connections.set(connectionId, viewer);
    return this.#maybeStart(now);
  }

  detach(connectionId: string, now: number): RoomOutcome {
    if (!this.#connections.delete(connectionId)) return NOTHING;
    // The clock does not care that someone left. Presence changed, so the room
    // re-broadcasts — showing the state is the whole of its response to a
    // disconnect. No pause, by decision.
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

  connectionCount(): number {
    return this.#connections.size;
  }

  /** The draft starts once both captains have arrived, and never before. */
  #maybeStart(now: number): RoomOutcome {
    if (this.#snapshot.phase !== "lobby") return { events: [], error: null, changed: true };
    const presence = this.presence();
    if (presence.A !== "connected" || presence.B !== "connected") {
      return { events: [], error: null, changed: true };
    }
    this.#snapshot = { ...this.#snapshot, phase: "drafting", timer: startTimer(this.#snapshot.rules, now) };
    return { events: [], error: null, changed: true };
  }

  command(viewer: Viewer, message: ClientMessage, now: number): RoomOutcome {
    if (message.t === "resync") return { events: [], error: null, changed: true };

    // Resolve any turn whose clock ran out before this command landed, so a late
    // click can never beat an expiry that already happened.
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
          : commit(before, viewer.team);

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
   * Resolve every turn whose deadline has passed. Loops because an alarm can
   * fire late — an evicted room waking up two turns behind must resolve both,
   * each at its own deadline rather than all at `now`, or the timeline lies.
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

      const auto = resolveTimeout(this.#snapshot.draft);
      if (!auto.ok) break;
      this.#advance(auto.value, deadline);
      resolved = true;
    }

    if (!resolved) return NOTHING;
    return { events: diffEvents(before, this.#snapshot.draft), error: null, changed: true };
  }

  /** Apply a new draft state, charging the clock when a turn actually ended. */
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

  /** When the host should wake the room next, or `null` if no clock is running. */
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

  projection(viewer: Viewer, now: number): DraftProjection {
    return project({
      state: this.#snapshot.draft,
      viewer,
      presence: this.presence(),
      clock: this.clock(now),
    });
  }

  /** Every live connection with the view it should receive. */
  *audience(now: number): Generator<{ connectionId: string; viewer: Viewer; projection: DraftProjection }> {
    for (const [connectionId, viewer] of this.#connections) {
      yield { connectionId, viewer, projection: this.projection(viewer, now) };
    }
  }
}
