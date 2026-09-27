/**
 * Deciding what each person watching a draft is allowed to see.
 *
 * Everyone in a room is looking at the same draft, but not at the same view of
 * it. A captain part-way through choosing has not committed to anything yet,
 * and the other side must not be able to see them deliberating — that would
 * turn a draft into a guessing game about hesitation.
 *
 * So: a captain choosing sees their own selection. On a turn one team plays,
 * spectators see that team's selection too, because it is seconds away from
 * being public anyway. On a turn several teams play blind, nobody outside a
 * team sees anything of it — not even spectators, since a spectator link is
 * one anybody can open — until the whole turn is revealed. Everyone else sees
 * only how many things have been chosen, never which.
 *
 * Everyone is sent their own view, worked out here, rather than one view being
 * sent to the whole room and trimmed on arrival.
 */

import { availability, currentTurn, isComplete, legalItems, stagedBy, summarise, waitingOn } from "./engine.js";
import type { DraftSummary } from "./engine.js";
import type { DraftRecord } from "./record.js";
import type { ItemSuggestions } from "./room/suggestions.js";
import { draftRecord } from "./record.js";
import type { ActionDefinition, ActionId, Availability, DraftState, Team, TeamDefinition, Turn } from "./types.js";

export type Viewer =
  | { readonly role: "player"; readonly team: Team; readonly memberId: string }
  | { readonly role: "spectator" };

export type ConnectionStatus = "connected" | "disconnected";

/**
 * Whether each team's captain is currently connected.
 *
 * This is shown so the room can see for itself when someone has dropped out and
 * decide what to do about it — replay the draft, carry on, or something else
 * the organiser judges fair. The app itself never acts on it: it does not pause,
 * and it does not award anything to anyone.
 */
export type Presence = Readonly<Record<Team, ConnectionStatus>>;

export interface TurnClock {
  /** When the current turn began; each screen counts down from this itself. */
  readonly turnStartedAt: number;
  /** This turn's own time, before anybody touches their reserve. */
  readonly allowanceMs: number;
  readonly bank: Readonly<Record<Team, number>>;
  /** When each team still choosing runs out, reserve and all. */
  readonly deadlines: Readonly<Record<Team, number>>;
}

/** One person in the room, as everybody else sees them. */
export interface MemberView {
  readonly id: string;
  readonly name: string;
  readonly team: Team;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly leader: boolean;
  /** True for the person this view is being built for. */
  readonly you: boolean;
}

export interface LobbyView {
  readonly teamSize: number;
  readonly members: readonly MemberView[];
  readonly everyoneHere: boolean;
  readonly everyoneReady: boolean;
  /** Which teams' leaders have agreed to begin without a full room. */
  readonly startAnyway: Readonly<Record<Team, boolean>>;
}

export interface ProjectionInput {
  readonly state: DraftState;
  /** Which game's pack the screen should draw the pool from. */
  readonly game: string;
  readonly viewer: Viewer;
  readonly presence: Presence;
  readonly clock: TurnClock | null;
  readonly lobby: LobbyView;
  /** What this viewer's own side has asked for. Never anybody else's. */
  readonly suggestions: readonly ItemSuggestions[];
  /** What this viewer marked, so their own marks read back to them. */
  readonly yourSuggestions: Readonly<Record<string, ActionId>>;
  /** When the room was made, used to time the first turn. */
  readonly startedAt?: number | undefined;
}

export interface DraftProjection {
  readonly viewer: Viewer;
  readonly game: string;
  readonly teams: readonly TeamDefinition[];
  readonly actions: readonly ActionDefinition[];
  readonly complete: boolean;
  readonly turnIndex: number;
  readonly turn: Turn | null;
  readonly script: readonly Turn[];
  readonly committed: DraftState["committed"];
  /** Everything each team has chosen, by action. */
  readonly byTeam: DraftSummary["byTeam"];
  readonly pool: readonly { readonly id: string; readonly availability: Availability }[];
  /** What this person can click right now, which is nothing unless it is their turn. */
  readonly selectable: readonly string[];
  /** What is being considered, when this person is allowed to see it. */
  readonly staged: readonly string[] | null;
  /** How many things each team on the clock has chosen so far this turn. Everyone can see this much. */
  readonly stagedCount: Readonly<Record<Team, number>>;
  /** Teams that have already confirmed this turn, on a turn several play at once. */
  readonly locked: readonly Team[];
  /** What this viewer's own team confirmed this turn, while it waits for the others. */
  readonly yourLock: readonly string[] | null;
  readonly presence: Presence;
  readonly clock: TurnClock | null;
  /** Everybody in the room, whether they are ready, and who is leading each side. */
  readonly lobby: LobbyView;
  /** True when this viewer is the one who chooses for their side. */
  readonly leading: boolean;
  /**
   * What this viewer's own side wants, most-agreed first. Empty for spectators
   * and for other teams: a suggestion says what a side intends several turns
   * ahead, so unlike a staged choice it is never shown outside the team.
   */
  readonly suggestions: readonly ItemSuggestions[];
  /** This viewer's own marks, by item. */
  readonly yourSuggestions: Readonly<Record<string, ActionId>>;
  /**
   * How the draft went, turn by turn, once it is over. Anyone opening the room
   * later is shown the same account, which is the point of keeping it.
   */
  readonly record: DraftRecord | null;
}

/** Whose deliberation this person may watch right now, if anybody's. */
export function visibleStaging(state: DraftState, viewer: Viewer): Team | null {
  const turn = currentTurn(state);
  if (turn === null) return null;
  // Your own side may watch you deliberate; nobody else on another side may.
  if (viewer.role === "player") return turn.teams.includes(viewer.team) ? viewer.team : null;
  // A spectator may watch a team choosing alone, but never a blind turn.
  return turn.teams.length === 1 ? turn.teams[0]! : null;
}

/** Whether this person may see what a team on the clock is considering. */
export function canSeeStaging(state: DraftState, viewer: Viewer): boolean {
  return visibleStaging(state, viewer) !== null;
}

/** Builds one person's view of the draft as it stands. */
export function project({
  state,
  game,
  viewer,
  presence,
  clock,
  lobby,
  suggestions,
  yourSuggestions,
  startedAt,
}: ProjectionInput): DraftProjection {
  const turn = currentTurn(state);
  const leading = viewer.role === "player" && lobby.members.some((m) => m.you && m.leader);
  // Only the person leading a side the turn is still waiting on may choose.
  const canAct = leading && viewer.role === "player" && waitingOn(state).includes(viewer.team);
  const watching = visibleStaging(state, viewer);
  const yourLock = viewer.role === "player" ? (state.locked[viewer.team]?.items ?? null) : null;

  return {
    viewer,
    game,
    teams: state.config.teams,
    actions: state.config.actions,
    complete: isComplete(state),
    turnIndex: state.turnIndex,
    turn,
    script: [...state.config.script],
    committed: state.committed,
    byTeam: summarise(state).byTeam,
    pool: state.config.pool.map((id) => ({ id, availability: availability(state, id) })),
    selectable: canAct && viewer.role === "player" ? legalItems(state, viewer.team) : [],
    staged: watching === null ? null : [...stagedBy(state, watching)],
    stagedCount: Object.fromEntries((turn?.teams ?? []).map((team) => [team, stagedBy(state, team).length])),
    locked: (turn?.teams ?? []).filter((team) => state.locked[team] !== undefined),
    yourLock: yourLock === null ? null : [...yourLock],
    presence,
    clock,
    lobby,
    leading,
    suggestions,
    yourSuggestions,
    record: isComplete(state) ? draftRecord(state, startedAt ?? null) : null,
  };
}
