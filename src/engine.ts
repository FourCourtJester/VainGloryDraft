/**
 * The rules of a draft.
 *
 * This is the part that knows whose turn it is, what the teams on the clock may
 * still choose, what happens when they confirm, and when the draft is finished.
 * It is the single place those questions are answered, so the server and the
 * screen can never disagree about what is allowed.
 *
 * Nothing here talks to the network, watches a clock, or knows that anyone is
 * looking — and nothing here knows which game is being drafted. It is handed a
 * draft and a request, and hands back either the draft as it now stands or a
 * plain explanation of why the request was refused.
 */

import { drawDistinct, seededRandom } from "./random.js";
import { canRun } from "./script.js";
import type {
  ActionDefinition,
  ActionId,
  Availability,
  DraftConfig,
  DraftError,
  DraftState,
  LockedChoice,
  Result,
  Selection,
  Team,
  Turn,
} from "./types.js";
import { err, ok } from "./types.js";

export function createDraft(config: DraftConfig): Result<DraftState> {
  const problems = [...configProblems(config)];
  if (problems.length === 0) {
    const vocabulary = { teams: config.teams.map((team) => team.id), actions: config.actions };
    for (const problem of canRun(config.script, vocabulary, config.pool.length, config.mirror)) {
      problems.push(problem.turnIndex === null ? problem.message : `turn ${problem.turnIndex + 1}: ${problem.message}`);
    }
  }
  if (problems.length > 0) return err("invalid_script", problems.join(" "));

  // A format could open on a turn nobody plays. There is nothing to wait for,
  // so it is settled before anybody arrives.
  return ok(settleUnplayed({ config, committed: [], turnIndex: 0, staged: {}, locked: {} }, null));
}

/** The things about teams and actions that would make any format unplayable. */
function configProblems(config: DraftConfig): readonly string[] {
  const problems: string[] = [];
  const teamIds = config.teams.map((team) => team.id);
  if (teamIds.length === 0) problems.push("A draft needs at least one team.");
  if (new Set(teamIds).size !== teamIds.length) problems.push("Two teams share an id.");
  const actionIds = config.actions.map((action) => action.id);
  if (new Set(actionIds).size !== actionIds.length) problems.push("Two actions share an id.");
  for (const action of config.actions) {
    if (action.effect !== "remove" && action.effect !== "take") {
      problems.push(`Action "${action.id}" must either remove or take.`);
    }
  }
  if (new Set(config.pool).size !== config.pool.length) problems.push("The pool lists something twice.");
  return problems;
}

/** How far through the format the draft has got, counted in finished turns. */
export function currentTurnIndex(state: DraftState): number {
  return state.turnIndex;
}

export function currentTurn(state: DraftState): Turn | null {
  return state.config.script[state.turnIndex] ?? null;
}

export function isComplete(state: DraftState): boolean {
  return state.turnIndex >= state.config.script.length;
}

export function actionOf(state: DraftState, id: ActionId): ActionDefinition | undefined {
  return state.config.actions.find((action) => action.id === id);
}

/** The teams the draft is still waiting on this turn: those playing it who have not confirmed. */
export function waitingOn(state: DraftState): readonly Team[] {
  const turn = currentTurn(state);
  if (turn === null) return [];
  return turn.teams.filter((team) => state.locked[team] === undefined);
}

export function stagedBy(state: DraftState, team: Team): readonly string[] {
  return state.staged[team] ?? [];
}

/** What a team has chosen with one action, in the order they chose it. */
export function chosenBy(state: DraftState, team: Team, action: ActionId): readonly string[] {
  return state.committed.filter((c) => c.team === team && c.action === action).flatMap((c) => [...c.items]);
}

/**
 * Looks up what has already happened to one thing: whether it has been removed,
 * and which teams have taken it.
 */
export function availability(state: DraftState, itemId: string): Availability {
  const by: Team[] = [];
  let takenWith: ActionId | null = null;
  for (const selection of state.committed) {
    if (!selection.items.includes(itemId)) continue;
    if (actionOf(state, selection.action)?.effect === "remove") {
      return { state: "removed", by: selection.team, action: selection.action };
    }
    takenWith ??= selection.action;
    if (selection.team !== null && !by.includes(selection.team)) by.push(selection.team);
  }
  return takenWith === null ? { state: "available" } : { state: "taken", by, action: takenWith };
}

/**
 * Checks one thing against the rules of the draft and explains, in words meant
 * for the team who tried it, why they cannot have it. Returns nothing at all
 * when it is a legal choice.
 *
 * The rules are: something removed is gone for everybody; something already
 * taken cannot then be removed; a team can never take the same thing twice; and
 * another team's picks are off limits unless the room allows mirrors. Asking on
 * behalf of nobody — a turn the draft plays itself — treats everything already
 * taken as gone.
 */
export function selectionProblem(state: DraftState, team: Team | null, itemId: string): DraftError | null {
  const turn = currentTurn(state);
  if (turn === null) return { code: "draft_complete", message: "The draft is over." };
  if (!state.config.pool.includes(itemId)) {
    return { code: "unknown_item", message: `${itemId} is not in this draft's pool.` };
  }

  const status = availability(state, itemId);
  if (status.state === "removed") {
    return { code: "item_removed", message: `${itemId} is ${actionOf(state, status.action)?.past ?? "gone"}.` };
  }

  if (status.state === "taken") {
    if (actionOf(state, turn.action)?.effect === "remove") {
      return { code: "item_taken", message: `${itemId} has already been taken.` };
    }
    if (team === null || status.by.length === 0) {
      return { code: "item_taken", message: `${itemId} has already been taken.` };
    }
    if (status.by.includes(team)) {
      return { code: "item_taken", message: `Your team already has ${itemId}.` };
    }
    if (!state.config.mirror) {
      return {
        code: "item_taken_by_opponent",
        message: `${itemId} is taken by another team and mirrors are off.`,
      };
    }
  }

  return null;
}

export function isLegalSelection(state: DraftState, team: Team | null, itemId: string): boolean {
  return selectionProblem(state, team, itemId) === null;
}

/**
 * Everything a team is allowed to choose at this moment, which is what the pool
 * on their screen makes clickable. Nothing, for a team not playing this turn or
 * one that has already confirmed.
 */
export function legalItems(state: DraftState, team: Team | null): readonly string[] {
  const turn = currentTurn(state);
  if (turn === null) return [];
  if (team !== null && !waitingOn(state).includes(team)) return [];
  return state.config.pool.filter((itemId) => isLegalSelection(state, team, itemId));
}

/** Why a team cannot act on the turn in progress at all, or nothing if it can. */
function turnProblem(state: DraftState, team: Team): DraftError | null {
  const turn = currentTurn(state);
  if (turn === null) return { code: "draft_complete", message: "The draft is over." };
  if (!turn.teams.includes(team)) {
    const who = turn.teams.length === 0 ? "nobody's" : `${turn.teams.join(" and ")}'s`;
    return { code: "wrong_team", message: `It is ${who} turn.` };
  }
  if (state.locked[team] !== undefined) {
    return { code: "already_locked", message: "Your team has already confirmed this turn." };
  }
  return null;
}

/**
 * Selects something for the turn in progress, or takes it back if it was
 * already selected — the captain clicking it on and off again.
 *
 * A selection is only a proposal. Nothing enters the draft until the captain
 * confirms, and they can change their mind as often as they like before then.
 */
export function stage(state: DraftState, team: Team, itemId: string): Result<DraftState> {
  const problem = turnProblem(state, team);
  if (problem !== null) return err(problem.code, problem.message);
  const turn = currentTurn(state)!;
  const staged = stagedBy(state, team);

  if (staged.includes(itemId)) {
    return ok(withStaged(state, team, staged.filter((id) => id !== itemId)));
  }

  const illegal = selectionProblem(state, team, itemId);
  if (illegal !== null) return err(illegal.code, illegal.message);

  if (staged.length >= turn.count) {
    return err("turn_full", `This turn takes ${turn.count}; unstage one first.`);
  }

  return ok(withStaged(state, team, [...staged, itemId]));
}

export function unstage(state: DraftState, team: Team, itemId: string): Result<DraftState> {
  const problem = turnProblem(state, team);
  if (problem !== null) return err(problem.code, problem.message);
  const staged = stagedBy(state, team);
  if (!staged.includes(itemId)) return err("not_staged", `${itemId} is not staged.`);
  return ok(withStaged(state, team, staged.filter((id) => id !== itemId)));
}

function withStaged(state: DraftState, team: Team, items: readonly string[]): DraftState {
  return { ...state, staged: { ...state.staged, [team]: items } };
}

/**
 * Locks in what a team has chosen.
 *
 * The whole turn is confirmed in one go, so a turn that takes two needs both of
 * them chosen first and then commits the pair together. On a turn one team
 * plays, the draft moves straight on. On a turn several play blind, it waits:
 * the choice is held out of sight until every one of them has made theirs. The
 * moment it happened is recorded with it, so the finished draft can be read
 * back later.
 */
export function commit(state: DraftState, team: Team, at: number | null = null): Result<DraftState> {
  const problem = turnProblem(state, team);
  if (problem !== null) return err(problem.code, problem.message);
  const turn = currentTurn(state)!;
  const staged = stagedBy(state, team);
  if (staged.length !== turn.count) {
    return err("turn_incomplete", `Choose ${turn.count} before confirming; ${staged.length} chosen.`);
  }
  return ok(lock(state, team, { items: [...staged], auto: false, at }));
}

/**
 * Works out what the draft would take on a team's behalf if their time ran out
 * this instant — or, with no team, what it takes on a turn nobody plays.
 *
 * Anything they had already chosen is kept — running out of time should not
 * throw away a decision they had clearly made — and only the empty slots are
 * filled in. The same room will always produce the same answer, so a team who
 * disputes something they were given can be shown exactly how it was arrived at.
 */
export function autoFillSelection(state: DraftState, team: Team | null): readonly string[] {
  const turn = currentTurn(state);
  if (turn === null) return [];

  // Keep what the captain had already chosen, as long as it is still allowed.
  const staged = team === null ? [] : stagedBy(state, team);
  const kept = staged.filter((itemId) => isLegalSelection(state, team, itemId)).slice(0, turn.count);
  const shortfall = turn.count - kept.length;
  if (shortfall <= 0) return kept;

  const candidates = legalItems(state, team).filter((itemId) => !kept.includes(itemId));
  // Each team on a blind turn gets dice of its own, so one side running out of
  // time tells nobody anything about what the other will be given.
  const salt = turn.teams.length > 1 && team !== null ? `:${team}` : "";
  const random = seededRandom(`${state.config.seed}:${state.turnIndex}${salt}`);
  return [...kept, ...drawDistinct(candidates, shortfall, random)];
}

/**
 * Ends the current turn for the teams whose time ran out, taking whatever
 * `autoFillSelection` decided on their behalf. With no teams named, that is
 * everybody the turn is still waiting on.
 *
 * This always moves the draft forward while a turn remains. A team that has
 * chosen nothing at all cannot hold the draft up by doing nothing.
 */
export function resolveTimeout(
  state: DraftState,
  at: number | null = null,
  teams: readonly Team[] = waitingOn(state),
): Result<DraftState> {
  const turn = currentTurn(state);
  if (turn === null) return err("draft_complete", "The draft is over.");
  let next = state;
  for (const team of teams) {
    if (!waitingOn(next).includes(team) || next.turnIndex !== state.turnIndex) continue;
    next = lock(next, team, { items: [...autoFillSelection(next, team)], auto: true, at });
  }
  return ok(next);
}

/**
 * Records a team's confirmed choice, and reveals the turn once nobody playing it
 * is left to choose.
 */
function lock(state: DraftState, team: Team, choice: LockedChoice): DraftState {
  const locked = { ...state.locked, [team]: choice };
  const turn = currentTurn(state)!;
  if (turn.teams.some((t) => locked[t] === undefined)) {
    return { ...state, locked, staged: { ...state.staged, [team]: [] } };
  }

  // Everybody has chosen: show the lot, in the order the turn names them.
  const revealed: Selection[] = turn.teams.map((t) => ({
    index: state.turnIndex,
    team: t,
    action: turn.action,
    items: locked[t]!.items,
    auto: locked[t]!.auto,
    at: locked[t]!.at,
  }));
  // The turn ended when its last team settled it.
  const endedAt = latest(revealed.map((selection) => selection.at));
  return settleUnplayed(
    { ...state, committed: [...state.committed, ...revealed], turnIndex: state.turnIndex + 1, staged: {}, locked: {} },
    endedAt,
  );
}

/**
 * Plays any turns nobody plays, from wherever the draft has got to: the draft
 * takes what is left and moves on, with nobody to wait for.
 */
function settleUnplayed(state: DraftState, at: number | null): DraftState {
  let next = state;
  for (let turn = currentTurn(next); turn !== null && turn.teams.length === 0; turn = currentTurn(next)) {
    const selection: Selection = {
      index: next.turnIndex,
      team: null,
      action: turn.action,
      items: [...autoFillSelection(next, null)],
      auto: true,
      at,
    };
    next = { ...next, committed: [...next.committed, selection], turnIndex: next.turnIndex + 1 };
  }
  return next;
}

function latest(times: readonly (number | null)[]): number | null {
  let found: number | null = null;
  for (const time of times) if (time !== null && (found === null || time > found)) found = time;
  return found;
}

export interface DraftSummary {
  readonly complete: boolean;
  readonly turnIndex: number;
  readonly turn: Turn | null;
  /** Everything each team has chosen, by action. */
  readonly byTeam: Readonly<Record<Team, Readonly<Record<ActionId, readonly string[]>>>>;
}

/** A plain readout of where the draft has got to, for showing on a screen. */
export function summarise(state: DraftState): DraftSummary {
  const byTeam: Record<Team, Record<ActionId, readonly string[]>> = {};
  for (const team of state.config.teams) {
    byTeam[team.id] = Object.fromEntries(state.config.actions.map((action) => [action.id, chosenBy(state, team.id, action.id)]));
  }
  return {
    complete: isComplete(state),
    turnIndex: state.turnIndex,
    turn: currentTurn(state),
    byTeam,
  };
}
