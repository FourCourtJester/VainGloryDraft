/**
 * Working with a draft format: reading one, writing one down, checking it makes
 * sense, and counting up what it asks of each team.
 *
 * Everything here is worked out from the format itself. How many heroes a team
 * ends up with is simply however many its turns add up to, so a 3v3, a 5v5 and
 * a format a tournament invents next month are all handled without the code
 * needing to know which is which.
 */

import type { Action, Team, Turn, TurnScript } from "./types.js";

export interface TeamTotals {
  readonly picks: number;
  readonly bans: number;
}

export interface ScriptTotals {
  readonly turns: number;
  /** How many heroes get chosen across the whole draft, by both teams together. */
  readonly selections: number;
  readonly byTeam: Readonly<Record<Team, TeamTotals>>;
  /**
   * The smallest roster this format could be run with.
   *
   * When both teams are allowed the same hero, fewer heroes are needed overall,
   * because the two sides' picks can overlap.
   */
  readonly minimumPool: { readonly mirrorOff: number; readonly mirrorOn: number };
}

/** Adds up what a format asks of each team: how many picks, how many bans. */
export function deriveTotals(script: TurnScript): ScriptTotals {
  const byTeam: Record<Team, { picks: number; bans: number }> = {
    A: { picks: 0, bans: 0 },
    B: { picks: 0, bans: 0 },
  };
  let selections = 0;

  for (const turn of script) {
    selections += turn.count;
    if (turn.action === "pick") byTeam[turn.team].picks += turn.count;
    else byTeam[turn.team].bans += turn.count;
  }

  const bans = byTeam.A.bans + byTeam.B.bans;
  const picks = byTeam.A.picks + byTeam.B.picks;

  return {
    turns: script.length,
    selections,
    byTeam: { A: { ...byTeam.A }, B: { ...byTeam.B } },
    minimumPool: {
      mirrorOff: bans + picks,
      mirrorOn: bans + Math.max(byTeam.A.picks, byTeam.B.picks),
    },
  };
}

export interface ScriptProblem {
  readonly turnIndex: number | null;
  readonly message: string;
}

/**
 * Checks a format is something that could actually be played: it has turns, each
 * belongs to a real team, and each asks for at least one hero.
 *
 * A format that treats the two teams differently is perfectly allowed, since
 * some deliberately do, so nothing here complains about that.
 */
export function validateScript(script: TurnScript): readonly ScriptProblem[] {
  const problems: ScriptProblem[] = [];

  if (script.length === 0) {
    problems.push({ turnIndex: null, message: "Script has no turns." });
  }

  script.forEach((turn, index) => {
    if (!Number.isInteger(turn.count) || turn.count < 1) {
      problems.push({ turnIndex: index, message: `count must be a positive integer, got ${String(turn.count)}.` });
    }
    if (turn.team !== "A" && turn.team !== "B") {
      problems.push({ turnIndex: index, message: `team must be "A" or "B", got ${String(turn.team)}.` });
    }
    if (turn.action !== "pick" && turn.action !== "ban") {
      problems.push({ turnIndex: index, message: `action must be "pick" or "ban", got ${String(turn.action)}.` });
    }
  });

  return problems;
}

/**
 * Checks a format can be played with a particular set of heroes — that it makes
 * sense, and that there are enough heroes to go round before anyone runs out.
 */
export function canRun(script: TurnScript, poolSize: number, mirrorPicks: boolean): readonly ScriptProblem[] {
  const problems = [...validateScript(script)];
  if (problems.length > 0) return problems;

  const totals = deriveTotals(script);
  const needed = mirrorPicks ? totals.minimumPool.mirrorOn : totals.minimumPool.mirrorOff;
  if (poolSize < needed) {
    problems.push({
      turnIndex: null,
      message: `Script needs at least ${needed} heroes in the pool, pool has ${poolSize}.`,
    });
  }
  return problems;
}

/** Shorthand for writing a single turn out by hand. */
export function t(team: Team, action: Action, count = 1): Turn {
  return { team, action, count };
}

/**
 * Reads a format written in shorthand, so a whole draft order can be set down on
 * one line instead of as a page of objects:
 *
 *     "Aban, Bban, Apick x2"
 *
 * means team A bans, then team B bans, then team A picks two heroes together.
 */
export function parseScript(notation: string): TurnScript {
  return notation
    .split(",")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk, index) => {
      const match = /^([AB])\s*(pick|ban)(?:\s*x\s*(\d+))?$/i.exec(chunk);
      if (!match) throw new Error(`Cannot parse turn ${index + 1}: "${chunk}"`);
      const team = match[1]!.toUpperCase() as Team;
      const action = match[2]!.toLowerCase() as Action;
      const count = match[3] === undefined ? 1 : Number.parseInt(match[3], 10);
      return { team, action, count };
    });
}

/** Writes a format back out in that same shorthand, for logs and preset lists. */
export function formatScript(script: TurnScript): string {
  return script.map((turn) => `${turn.team}${turn.action}${turn.count > 1 ? ` x${turn.count}` : ""}`).join(", ");
}
