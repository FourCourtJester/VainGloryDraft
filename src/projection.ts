/**
 * Deciding what each person watching a draft is allowed to see.
 *
 * Everyone in a room is looking at the same draft, but not at the same view of
 * it. A captain part-way through choosing has not committed to anything yet,
 * and the opposing captain must not be able to see them deliberating — that
 * would turn a draft into a guessing game about hesitation.
 *
 * So: the captain choosing sees their own selection, and spectators see the
 * selection of whichever team is on the clock, because that team is seconds
 * away from making it public anyway. The opposing captain sees only how many
 * heroes have been chosen, never which.
 *
 * Everyone is sent their own view, worked out here, rather than one view being
 * sent to the whole room and trimmed on arrival.
 */

import { availability, currentTurn, currentTurnIndex, isComplete, legalHeroes, summarise } from "./engine.js";
import type { DraftRecord } from "./record.js";
import { draftRecord } from "./record.js";
import type { DraftState, HeroAvailability, Team, Turn } from "./types.js";

export type Viewer =
  | { readonly role: "captain"; readonly team: Team }
  | { readonly role: "spectator" };

export type ConnectionStatus = "connected" | "disconnected";

/**
 * Whether each captain is currently connected.
 *
 * This is shown so the room can see for itself when someone has dropped out and
 * decide what to do about it — replay the draft, carry on, or something else
 * the organiser judges fair. The app itself never acts on it: it does not pause,
 * and it does not award anything to anyone.
 */
export interface Presence {
  readonly A: ConnectionStatus;
  readonly B: ConnectionStatus;
}

export interface TurnClock {
  /** When the current turn began; each screen counts down from this itself. */
  readonly turnStartedAt: number;
  readonly perTurnMs: number;
  readonly bank: Readonly<Record<Team, number>>;
  readonly expiresAt: number;
}

export interface ProjectionInput {
  readonly state: DraftState;
  readonly viewer: Viewer;
  readonly presence: Presence;
  readonly clock: TurnClock | null;
  /** When the room was made, used to time the first turn. */
  readonly startedAt?: number | undefined;
}

export interface DraftProjection {
  readonly viewer: Viewer;
  readonly complete: boolean;
  readonly turnIndex: number;
  readonly turn: Turn | null;
  readonly script: readonly Turn[];
  readonly committed: DraftState["committed"];
  readonly picks: Readonly<Record<Team, readonly string[]>>;
  readonly bans: Readonly<Record<Team, readonly string[]>>;
  readonly heroes: readonly { readonly id: string; readonly availability: HeroAvailability }[];
  /** What this person can click right now, which is nothing unless it is their turn. */
  readonly selectable: readonly string[];
  /** The heroes being considered, when this person is allowed to see them. */
  readonly staged: readonly string[] | null;
  /** How many heroes have been chosen so far this turn. Everyone can see this much. */
  readonly stagedCount: number;
  readonly presence: Presence;
  readonly clock: TurnClock | null;
  /**
   * How the draft went, turn by turn, once it is over. Anyone opening the room
   * later is shown the same account, which is the point of keeping it.
   */
  readonly record: DraftRecord | null;
}

/** Whether this person may see what the team on the clock is considering. */
export function canSeeStaging(state: DraftState, viewer: Viewer): boolean {
  const turn = currentTurn(state);
  if (turn === null) return false;
  if (viewer.role === "spectator") return true;
  return viewer.team === turn.team;
}

/** Builds one person's view of the draft as it stands. */
export function project({ state, viewer, presence, clock, startedAt }: ProjectionInput): DraftProjection {
  const turn = currentTurn(state);
  const summary = summarise(state);
  const isActiveCaptain = viewer.role === "captain" && turn !== null && turn.team === viewer.team;

  return {
    viewer,
    complete: isComplete(state),
    turnIndex: currentTurnIndex(state),
    turn,
    script: [...state.config.script],
    committed: state.committed,
    picks: summary.picks,
    bans: summary.bans,
    heroes: state.config.heroPool.map((id) => ({ id, availability: availability(state, id) })),
    selectable: isActiveCaptain ? legalHeroes(state) : [],
    staged: canSeeStaging(state, viewer) ? [...state.staged] : null,
    stagedCount: state.staged.length,
    presence,
    clock,
    record: isComplete(state) ? draftRecord(state, startedAt ?? null) : null,
  };
}
