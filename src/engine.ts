/**
 * The draft engine.
 *
 * Pure functions over `DraftState`. No I/O, no clock, no sockets, no knowledge
 * of who is watching. Every mutation returns a new state; every failure returns
 * a `Result` rather than throwing, so the transport layer can answer a bad
 * client without a try/catch around the room.
 */

import { drawDistinct, seededRandom } from "./random.js";
import { canRun } from "./script.js";
import type {
  CommittedTurn,
  DraftConfig,
  DraftError,
  DraftState,
  HeroAvailability,
  Result,
  Team,
  Turn,
} from "./types.js";
import { err, ok } from "./types.js";

const OTHER: Record<Team, Team> = { A: "B", B: "A" };

export function createDraft(config: DraftConfig): Result<DraftState> {
  const problems = canRun(config.script, config.heroPool.length, config.mirrorPicks);
  if (problems.length > 0) {
    const detail = problems
      .map((p) => (p.turnIndex === null ? p.message : `turn ${p.turnIndex}: ${p.message}`))
      .join(" ");
    return err("invalid_script", detail);
  }
  return ok({ config, committed: [], staged: [] });
}

/** Index of the turn on the clock. Equals `committed.length` — turns are append-only. */
export function currentTurnIndex(state: DraftState): number {
  return state.committed.length;
}

export function currentTurn(state: DraftState): Turn | null {
  return state.config.script[currentTurnIndex(state)] ?? null;
}

export function isComplete(state: DraftState): boolean {
  return state.committed.length >= state.config.script.length;
}

/** Heroes locked by each team, in commit order. */
export function picksOf(state: DraftState, team: Team): readonly string[] {
  return state.committed
    .filter((c) => c.team === team && c.action === "pick")
    .flatMap((c) => [...c.heroes]);
}

export function bansOf(state: DraftState, team: Team): readonly string[] {
  return state.committed
    .filter((c) => c.team === team && c.action === "ban")
    .flatMap((c) => [...c.heroes]);
}

export function allBans(state: DraftState): readonly string[] {
  return state.committed.filter((c) => c.action === "ban").flatMap((c) => [...c.heroes]);
}

export function availability(state: DraftState, heroId: string): HeroAvailability {
  for (const committed of state.committed) {
    if (!committed.heroes.includes(heroId)) continue;
    if (committed.action === "ban") return { state: "banned" };
    return { state: "picked", by: committed.team };
  }
  return { state: "available" };
}

/**
 * Why `heroId` may not be selected for the current turn, or `null` if it may.
 * Staging is not considered here — that is `stage`'s business, since staging a
 * staged hero is an unstage, not an error.
 */
export function selectionProblem(state: DraftState, heroId: string): DraftError | null {
  const turn = currentTurn(state);
  if (turn === null) return { code: "draft_complete", message: "The draft is over." };
  if (!state.config.heroPool.includes(heroId)) {
    return { code: "unknown_hero", message: `${heroId} is not in this draft's hero pool.` };
  }

  const status = availability(state, heroId);
  if (status.state === "banned") return { code: "hero_banned", message: `${heroId} is banned.` };

  if (status.state === "picked") {
    // A picked hero can never be banned afterwards, and can never be picked twice
    // by the same team. The other team may re-pick only under mirror rules.
    if (turn.action === "ban") return { code: "hero_picked", message: `${heroId} has already been picked.` };
    if (status.by === turn.team) return { code: "hero_picked", message: `Your team already picked ${heroId}.` };
    if (!state.config.mirrorPicks) {
      return {
        code: "hero_picked_by_opponent",
        message: `${heroId} is picked by the other team and mirror picks are off.`,
      };
    }
  }

  return null;
}

export function isLegalSelection(state: DraftState, heroId: string): boolean {
  return selectionProblem(state, heroId) === null;
}

/** Every hero the team on the clock could legally select right now, in pool order. */
export function legalHeroes(state: DraftState): readonly string[] {
  if (currentTurn(state) === null) return [];
  return state.config.heroPool.filter((heroId) => isLegalSelection(state, heroId));
}

/**
 * Toggle a hero in the staging area. Click once to stage, click again to unstage.
 * Nothing is committed until `commit`.
 */
export function stage(state: DraftState, team: Team, heroId: string): Result<DraftState> {
  const turn = currentTurn(state);
  if (turn === null) return err("draft_complete", "The draft is over.");
  if (turn.team !== team) return err("wrong_team", `It is team ${turn.team}'s turn.`);

  if (state.staged.includes(heroId)) {
    return ok({ ...state, staged: state.staged.filter((id) => id !== heroId) });
  }

  const problem = selectionProblem(state, heroId);
  if (problem !== null) return err(problem.code, problem.message);

  if (state.staged.length >= turn.count) {
    return err("turn_full", `This turn takes ${turn.count} hero(es); unstage one first.`);
  }

  return ok({ ...state, staged: [...state.staged, heroId] });
}

export function unstage(state: DraftState, team: Team, heroId: string): Result<DraftState> {
  const turn = currentTurn(state);
  if (turn === null) return err("draft_complete", "The draft is over.");
  if (turn.team !== team) return err("wrong_team", `It is team ${turn.team}'s turn.`);
  if (!state.staged.includes(heroId)) return err("not_staged", `${heroId} is not staged.`);
  return ok({ ...state, staged: state.staged.filter((id) => id !== heroId) });
}

export function clearStaged(state: DraftState): DraftState {
  return state.staged.length === 0 ? state : { ...state, staged: [] };
}

/** Confirm the staged selection. A multi-pick turn is one confirm, not two. */
export function commit(state: DraftState, team: Team): Result<DraftState> {
  const turn = currentTurn(state);
  if (turn === null) return err("draft_complete", "The draft is over.");
  if (turn.team !== team) return err("wrong_team", `It is team ${turn.team}'s turn.`);
  if (state.staged.length !== turn.count) {
    return err("turn_incomplete", `Stage ${turn.count} hero(es) before confirming; ${state.staged.length} staged.`);
  }
  return ok(applyTurn(state, [...state.staged], false));
}

/**
 * What the timer would lock in if it expired right now.
 *
 * Deterministic and visible, so nobody can argue it: staged heroes are kept, and
 * only the remainder is filled. Exported so a client can show the pending
 * auto-action before it happens.
 */
export function autoFillSelection(state: DraftState): readonly string[] {
  const turn = currentTurn(state);
  if (turn === null) return [];

  const kept = state.staged.filter((heroId) => isLegalSelection(state, heroId)).slice(0, turn.count);
  const shortfall = turn.count - kept.length;
  if (shortfall <= 0) return kept;

  const candidates = legalHeroes(state).filter((heroId) => !kept.includes(heroId));
  if (state.config.autoFill === "lowestIndex") {
    return [...kept, ...candidates.slice(0, shortfall)];
  }

  const random = seededRandom(`${state.config.seed}:${currentTurnIndex(state)}`);
  return [...kept, ...drawDistinct(candidates, shortfall, random)];
}

/**
 * Resolve the current turn on timeout. Always succeeds while a turn remains:
 * the timer cannot be blocked by a captain who staged nothing.
 */
export function resolveTimeout(state: DraftState): Result<DraftState> {
  const turn = currentTurn(state);
  if (turn === null) return err("draft_complete", "The draft is over.");
  return ok(applyTurn(state, [...autoFillSelection(state)], true));
}

function applyTurn(state: DraftState, heroes: string[], auto: boolean): DraftState {
  const index = currentTurnIndex(state);
  const turn = state.config.script[index]!;
  const committed: CommittedTurn = { index, team: turn.team, action: turn.action, heroes, auto };
  return { ...state, committed: [...state.committed, committed], staged: [] };
}

export interface DraftSummary {
  readonly complete: boolean;
  readonly turnIndex: number;
  readonly turn: Turn | null;
  readonly picks: Readonly<Record<Team, readonly string[]>>;
  readonly bans: Readonly<Record<Team, readonly string[]>>;
}

export function summarise(state: DraftState): DraftSummary {
  return {
    complete: isComplete(state),
    turnIndex: currentTurnIndex(state),
    turn: currentTurn(state),
    picks: { A: picksOf(state, "A"), B: picksOf(state, "B") },
    bans: { A: bansOf(state, "A"), B: bansOf(state, "B") },
  };
}

export { OTHER as opposingTeam };
