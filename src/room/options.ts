/**
 * Validation for room options that arrive over the wire.
 *
 * The engine trusts its `DraftConfig`, so something has to stop a hand-written
 * request reaching it. A negative turn length or a NaN would otherwise be stored
 * on the room and handed to the alarm, where it is no longer recoverable.
 */

import type { AutoFillStrategy } from "../types.js";
import type { TimerRules } from "../timer.js";
import { DEFAULT_TIMER_RULES } from "./room.js";

/** A turn shorter than this cannot be played; longer than a day is not a draft. */
export const TURN_BOUNDS = { minMs: 1_000, maxMs: 60 * 60_000 };
export const BANK_BOUNDS = { minMs: 0, maxMs: 24 * 60 * 60_000 };

export interface OptionProblem {
  readonly field: string;
  readonly message: string;
}

export function parseAutoFill(value: unknown): AutoFillStrategy | undefined {
  return value === "random" || value === "lowestIndex" ? value : undefined;
}

export function parseTimerRules(
  perTurnMs: unknown,
  bankMs: unknown,
): { rules: TimerRules; problems: readonly OptionProblem[] } {
  const problems: OptionProblem[] = [];

  const turn = bounded("perTurnMs", perTurnMs, TURN_BOUNDS, DEFAULT_TIMER_RULES.perTurnMs, problems);
  const bank = bounded("bankMs", bankMs, BANK_BOUNDS, DEFAULT_TIMER_RULES.bankMs, problems);

  return { rules: { perTurnMs: turn, bankMs: bank }, problems };
}

function bounded(
  field: string,
  value: unknown,
  bounds: { minMs: number; maxMs: number },
  fallback: number,
  problems: OptionProblem[],
): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    problems.push({ field, message: `${field} must be a number of milliseconds.` });
    return fallback;
  }
  if (value < bounds.minMs || value > bounds.maxMs) {
    problems.push({ field, message: `${field} must be between ${bounds.minMs} and ${bounds.maxMs} ms.` });
    return fallback;
  }
  return Math.round(value);
}
