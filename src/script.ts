/**
 * Working with a draft format: reading one, writing one down, checking it makes
 * sense, and counting up what it asks of each team.
 *
 * Everything here is worked out from the format and the few definitions it
 * names. How many things a team ends up with is simply however many its turns
 * add up to, so a 3v3 hero draft, a best-of-three map veto and a format a
 * tournament invents next month are all handled without the code needing to
 * know which is which.
 */

import type { ActionDefinition, ActionId, Team, Turn, TurnScript } from "./types.js";

/**
 * The words a format is allowed to use: which teams exist, and what each
 * action does. A format is only checked against these, never against any
 * particular game.
 */
export interface Vocabulary {
  readonly teams: readonly Team[];
  readonly actions: readonly ActionDefinition[];
}

/** The word a format uses for a turn nobody plays: the draft takes what is left. */
export const REMAINING = "remaining";

/** Nobody can play a turn shorter than a second, and an hour is already generous. */
export const TURN_TIME_BOUNDS = { minMs: 1_000, maxMs: 60 * 60_000 };

export interface ScriptTotals {
  readonly turns: number;
  /** How many things get chosen across the whole draft, by everybody together. */
  readonly selections: number;
  /** How many of each action every team makes. */
  readonly byTeam: Readonly<Record<Team, Readonly<Record<ActionId, number>>>>;
  /** How many the draft takes itself, on turns nobody plays. */
  readonly unplayed: number;
  /**
   * The smallest pool this format could be run with.
   *
   * When teams are allowed the same thing, fewer are needed overall, because
   * what they take can overlap.
   */
  readonly minimumPool: { readonly mirrorOff: number; readonly mirrorOn: number };
}

/** Adds up what a format asks of each team, and how big a pool it needs. */
export function deriveTotals(script: TurnScript, actions: readonly ActionDefinition[]): ScriptTotals {
  const effect = new Map(actions.map((action) => [action.id, action.effect]));
  const byTeam: Record<Team, Record<ActionId, number>> = {};
  const takesByTeam = new Map<Team, number>();
  let selections = 0;
  let removed = 0;
  let unplayed = 0;

  for (const turn of script) {
    const takes = effect.get(turn.action) === "take";
    if (turn.teams.length === 0) {
      unplayed += turn.count;
      selections += turn.count;
      removed += turn.count;
      continue;
    }
    for (const team of turn.teams) {
      selections += turn.count;
      const counts = (byTeam[team] ??= {});
      counts[turn.action] = (counts[turn.action] ?? 0) + turn.count;
      if (takes) takesByTeam.set(team, (takesByTeam.get(team) ?? 0) + turn.count);
      else removed += turn.count;
    }
  }

  const mostTaken = Math.max(0, ...takesByTeam.values());
  return {
    turns: script.length,
    selections,
    byTeam,
    unplayed,
    minimumPool: { mirrorOff: selections, mirrorOn: removed + mostTaken },
  };
}

/**
 * How many players a team has, taken from the format itself: a draft where each
 * team picks five heroes is played by five people. Anything that plays by
 * different numbers — a map veto run by two captains — says so outright.
 */
export function playersPerTeam(script: TurnScript, actions: readonly ActionDefinition[]): number {
  const takes = new Set(actions.filter((action) => action.effect === "take").map((action) => action.id));
  const perTeam = new Map<Team, number>();
  for (const turn of script) {
    if (!takes.has(turn.action)) continue;
    for (const team of turn.teams) perTeam.set(team, (perTeam.get(team) ?? 0) + turn.count);
  }
  return Math.max(1, ...perTeam.values());
}

export interface ScriptProblem {
  readonly turnIndex: number | null;
  readonly message: string;
}

/**
 * Checks a format is something that could actually be played: it has turns,
 * every turn belongs to teams and an action that exist, and each asks for at
 * least one thing.
 *
 * A format that treats the teams differently is perfectly allowed, since some
 * deliberately do, so nothing here complains about that.
 */
export function validateScript(script: TurnScript, vocabulary: Vocabulary): readonly ScriptProblem[] {
  const problems: ScriptProblem[] = [];
  const actions = new Set(vocabulary.actions.map((action) => action.id));

  if (script.length === 0) {
    problems.push({ turnIndex: null, message: "Script has no turns." });
  }

  script.forEach((turn, index) => {
    const problem = (message: string): void => {
      problems.push({ turnIndex: index, message });
    };
    if (!Number.isInteger(turn.count) || turn.count < 1) {
      problem(`count must be a positive integer, got ${String(turn.count)}.`);
    }
    if (!Array.isArray(turn.teams)) {
      problem("teams must be a list.");
      return;
    }
    for (const team of turn.teams) {
      if (!vocabulary.teams.includes(team)) problem(`there is no team "${String(team)}".`);
    }
    if (new Set(turn.teams).size !== turn.teams.length) problem("a team is named twice.");
    if (!actions.has(turn.action)) problem(`there is no action "${String(turn.action)}".`);
    if (turn.timeMs !== undefined) {
      const { minMs, maxMs } = TURN_TIME_BOUNDS;
      if (typeof turn.timeMs !== "number" || !(turn.timeMs >= minMs && turn.timeMs <= maxMs)) {
        problem(`a turn's time must be between ${minMs / 1000} and ${maxMs / 1000} seconds.`);
      }
    }
  });

  return problems;
}

/**
 * Checks a format can be played with a particular pool — that it makes sense,
 * and that there is enough to go round before anyone runs out.
 */
export function canRun(
  script: TurnScript,
  vocabulary: Vocabulary,
  poolSize: number,
  mirror: boolean,
): readonly ScriptProblem[] {
  const problems = [...validateScript(script, vocabulary)];
  if (problems.length > 0) return problems;

  const totals = deriveTotals(script, vocabulary.actions);
  const needed = mirror ? totals.minimumPool.mirrorOn : totals.minimumPool.mirrorOff;
  if (poolSize < needed) {
    problems.push({
      turnIndex: null,
      message: `Script needs at least ${needed} in the pool, pool has ${poolSize}.`,
    });
  }
  return problems;
}

/** Shorthand for writing a single turn out by hand. */
export function t(teams: Team | readonly Team[], action: ActionId, count = 1, timeMs?: number): Turn {
  const list = typeof teams === "string" ? [teams] : [...teams];
  return timeMs === undefined ? { teams: list, action, count } : { teams: list, action, count, timeMs };
}

/**
 * Reads a format written in shorthand, so a whole draft order can be set down on
 * one line instead of as a page of objects:
 *
 *     "A ban, B ban, A pick, B pick x2 @45s, A+B ban, remaining pick"
 *
 * Team A bans, team B bans, team A picks one, team B picks two together with
 * forty-five seconds to do it, both teams ban blind at the same time, and
 * whatever is left over is taken.
 *
 * The space between a team and its action can be left out where that is
 * unambiguous, so "Aban" reads the same as "A ban". Case does not matter.
 */
export function parseScript(notation: string, vocabulary: Vocabulary): TurnScript {
  const teams = [...vocabulary.teams].sort((a, b) => b.length - a.length);
  const actions = vocabulary.actions.map((action) => action.id).sort((a, b) => b.length - a.length);

  return notation
    .split(",")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk, index) => {
      const fail = (why: string): never => {
        throw new Error(`Cannot parse turn ${index + 1}: "${chunk}" — ${why}`);
      };
      let rest = chunk;
      const playing: Team[] = [];

      if (startsWithWord(rest, REMAINING)) {
        rest = rest.slice(REMAINING.length).trimStart();
      } else {
        for (;;) {
          const team = teams.find((id) => rest.toLowerCase().startsWith(id.toLowerCase()));
          if (team === undefined) fail(`expected one of ${vocabulary.teams.join(", ")} or "${REMAINING}".`);
          playing.push(team!);
          rest = rest.slice(team!.length).trimStart();
          if (!rest.startsWith("+")) break;
          rest = rest.slice(1).trimStart();
        }
      }

      const action = actions.find((id) => startsWithWord(rest, id, true));
      if (action === undefined) fail(`expected one of ${actions.join(", ")}.`);
      rest = rest.slice(action!.length);

      const tail = /^\s*(?:x\s*(\d+))?\s*(?:@\s*(\d+(?:\.\d+)?)\s*s?)?\s*$/i.exec(rest);
      if (tail === null) fail(`could not read "${rest.trim()}".`);
      const count = tail![1] === undefined ? 1 : Number.parseInt(tail![1], 10);
      const seconds = tail![2] === undefined ? undefined : Number.parseFloat(tail![2]);

      const turn: Turn = { teams: playing, action: action!, count };
      return seconds === undefined ? turn : { ...turn, timeMs: Math.round(seconds * 1000) };
    });
}

/**
 * Whether text begins with a word, ignoring case. The word must end there —
 * "picks" is not "pick" — except that a count may follow straight on, as in
 * "pickx2", when `countMayFollow` is set.
 */
function startsWithWord(text: string, word: string, countMayFollow = false): boolean {
  if (!text.toLowerCase().startsWith(word.toLowerCase())) return false;
  const next = text.charAt(word.length);
  return next === "" || /\s|@/.test(next) || (countMayFollow && /x/i.test(next));
}

/** Writes a format back out in that same shorthand, for logs and preset lists. */
export function formatScript(script: TurnScript): string {
  return script
    .map((turn) => {
      const who = turn.teams.length === 0 ? REMAINING : turn.teams.join("+");
      const count = turn.count > 1 ? ` x${turn.count}` : "";
      const time = turn.timeMs === undefined ? "" : ` @${turn.timeMs / 1000}s`;
      return `${who} ${turn.action}${count}${time}`;
    })
    .join(", ");
}
