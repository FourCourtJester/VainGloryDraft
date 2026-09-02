/**
 * The rules of a draft.
 *
 * This is the part that knows whose turn it is, which heroes that team may still
 * take, what happens when they confirm, and when the draft is finished. It is
 * the single place those questions are answered, so the server and the screen
 * can never disagree about what is allowed.
 *
 * Nothing here talks to the network, watches a clock, or knows that anyone is
 * looking. It is handed a draft and a request, and hands back either the draft
 * as it now stands or a plain explanation of why the request was refused.
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

/** How far through the format the draft has got, counted in finished turns. */
export function currentTurnIndex(state: DraftState): number {
  return state.committed.length;
}

export function currentTurn(state: DraftState): Turn | null {
  return state.config.script[currentTurnIndex(state)] ?? null;
}

export function isComplete(state: DraftState): boolean {
  return state.committed.length >= state.config.script.length;
}

/** The heroes a team has picked, in the order they took them. */
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

/**
 * Looks up what has already happened to a hero: whether it has been banned, and
 * which teams have picked it.
 */
export function availability(state: DraftState, heroId: string): HeroAvailability {
  const by: Team[] = [];
  for (const committed of state.committed) {
    if (!committed.heroes.includes(heroId)) continue;
    if (committed.action === "ban") return { state: "banned" };
    if (!by.includes(committed.team)) by.push(committed.team);
  }
  return by.length === 0 ? { state: "available" } : { state: "picked", by };
}

/**
 * Checks one hero against the rules of the draft and explains, in words meant
 * for the captain who tried it, why they cannot have it. Returns nothing at all
 * when the hero is a legal choice.
 *
 * The rules are: a banned hero is gone for everybody; a hero already picked
 * cannot then be banned; a team can never take the same hero twice; and the
 * opposing team's picks are off limits unless the room allows mirror picks.
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
    if (turn.action === "ban") return { code: "hero_picked", message: `${heroId} has already been picked.` };
    if (status.by.includes(turn.team)) {
      return { code: "hero_picked", message: `Your team already picked ${heroId}.` };
    }
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

/**
 * Everything the team on the clock is allowed to choose at this moment, which is
 * what the hero pool on screen makes clickable.
 */
export function legalHeroes(state: DraftState): readonly string[] {
  if (currentTurn(state) === null) return [];
  return state.config.heroPool.filter((heroId) => isLegalSelection(state, heroId));
}

/**
 * Selects a hero for the turn in progress, or takes it back if it was already
 * selected — the captain clicking a hero on and off again.
 *
 * A selection is only a proposal. Nothing enters the draft until the captain
 * confirms, and they can change their mind as often as they like before then.
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

/**
 * Locks in what the captain has chosen and moves the draft on to the next turn.
 *
 * The whole turn is confirmed in one go, so a turn that takes two heroes needs
 * both of them chosen first and then commits the pair together.
 */
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
 * Works out what the draft would take on a captain's behalf if their time ran
 * out this instant.
 *
 * Anything they had already chosen is kept — running out of time should not
 * throw away a decision they had clearly made — and only the empty slots are
 * filled in. The same room will always produce the same answer, so a team who
 * disputes a hero they were given can be shown exactly how it was arrived at.
 */
export function autoFillSelection(state: DraftState): readonly string[] {
  const turn = currentTurn(state);
  if (turn === null) return [];

  // Keep what the captain had already chosen, as long as it is still allowed.
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
 * Ends the current turn because time ran out, taking whatever
 * `autoFillSelection` decided on the captain's behalf.
 *
 * This always moves the draft forward while a turn remains. A captain who has
 * chosen nothing at all cannot hold the draft up by doing nothing.
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

/** A plain readout of where the draft has got to, for showing on a screen. */
export function summarise(state: DraftState): DraftSummary {
  return {
    complete: isComplete(state),
    turnIndex: currentTurnIndex(state),
    turn: currentTurn(state),
    picks: { A: picksOf(state, "A"), B: picksOf(state, "B") },
    bans: { A: bansOf(state, "A"), B: bansOf(state, "B") },
  };
}
