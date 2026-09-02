/**
 * Turn script helpers: validation and *derived* totals.
 *
 * Nothing here may assume a format. "Each team ends with 5 picks" is not a rule,
 * it is an outcome of one particular script — hardcoding it breaks 3v3 and every
 * custom order.
 */

import type { Action, Team, Turn, TurnScript } from "./types.js";

export interface TeamTotals {
  readonly picks: number;
  readonly bans: number;
}

export interface ScriptTotals {
  readonly turns: number;
  /** Total hero selections across the whole script. */
  readonly selections: number;
  readonly byTeam: Readonly<Record<Team, TeamTotals>>;
  /**
   * Distinct heroes the pool must hold for the script to be completable.
   * With mirror picks the two teams may overlap, so only the larger pick load counts.
   */
  readonly minimumPool: { readonly mirrorOff: number; readonly mirrorOn: number };
}

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
 * Structural validation only. An asymmetric script is legal — some formats are
 * deliberately lopsided — so imbalance is not reported here.
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

/** True when the script is structurally sound and the pool is large enough. */
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

/**
 * Shorthand for authoring scripts by hand or from a preset table.
 * `t("A", "ban")`, `t("B", "pick", 2)`.
 */
export function t(team: Team, action: Action, count = 1): Turn {
  return { team, action, count };
}

/**
 * Compact notation for a script, handy in tests, logs and preset files:
 * "Aban, Bban, Apick x2" -> [{A,ban,1},{B,ban,1},{A,pick,2}]
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

export function formatScript(script: TurnScript): string {
  return script.map((turn) => `${turn.team}${turn.action}${turn.count > 1 ? ` x${turn.count}` : ""}`).join(", ");
}
