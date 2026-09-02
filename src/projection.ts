/**
 * Per-connection views of the room.
 *
 * The room holds one authoritative state and every connection receives a
 * projection filtered by its token — never one payload broadcast to everyone.
 * The staging rule needs this anyway, so it is built in from the start.
 *
 * Staging visibility: the captain on the clock sees their own staging, and
 * spectators see the active team's staging. The opposing captain does not.
 * (A captain opening the spectator link sees only what is seconds from being
 * public, so that is not treated as a leak.)
 */

import { availability, currentTurn, currentTurnIndex, isComplete, legalHeroes, summarise } from "./engine.js";
import type { DraftState, HeroAvailability, Team, Turn } from "./types.js";

export type Viewer =
  | { readonly role: "captain"; readonly team: Team }
  | { readonly role: "spectator" };

export type ConnectionStatus = "connected" | "disconnected";

/**
 * Shown so the room can see what happened and decide for itself. The app never
 * acts on it: no pause, no forfeit. Show the state, don't act on it.
 */
export interface Presence {
  readonly A: ConnectionStatus;
  readonly B: ConnectionStatus;
}

export interface TurnClock {
  /** Epoch ms the current turn started. Clients derive the countdown themselves. */
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
  /** Heroes this viewer may select right now. Empty unless it is their turn. */
  readonly selectable: readonly string[];
  /** Staged heroes, if this viewer is allowed to see them. */
  readonly staged: readonly string[] | null;
  /** Always visible: how many of the turn's slots are filled. */
  readonly stagedCount: number;
  readonly presence: Presence;
  readonly clock: TurnClock | null;
}

export function canSeeStaging(state: DraftState, viewer: Viewer): boolean {
  const turn = currentTurn(state);
  if (turn === null) return false;
  if (viewer.role === "spectator") return true;
  return viewer.team === turn.team;
}

export function project({ state, viewer, presence, clock }: ProjectionInput): DraftProjection {
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
  };
}
