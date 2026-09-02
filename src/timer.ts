/**
 * Turn clock: per-turn time plus a reserve bank per team.
 *
 * Compute, never count down. State is `turnStartedAt` and the bank; everything
 * else is a pure function of those and `now`. Reconnect replays the same
 * computation, so drift cannot accumulate.
 *
 * There is no pause. A disconnect burns the clock like any other silence — that
 * is a deliberate product decision, and it is why no pause state exists here to
 * reconcile.
 */

import type { Team } from "./types.js";

export interface TimerRules {
  /** Fresh time granted at the start of every turn. */
  readonly perTurnMs: number;
  /** Reserve each team starts with, drawn on only after the per-turn time runs out. */
  readonly bankMs: number;
}

export interface TimerState {
  /** Epoch ms at which the current turn's clock started. */
  readonly turnStartedAt: number;
  readonly bank: Readonly<Record<Team, number>>;
}

export interface TimerReading {
  readonly elapsedMs: number;
  /** Per-turn time left. Hits 0 before the bank is touched. */
  readonly turnRemainingMs: number;
  /** What the bank would hold if the turn ended now. */
  readonly bankRemainingMs: number;
  /** turnRemainingMs + bankRemainingMs — what a captain actually has left. */
  readonly totalRemainingMs: number;
  /** Epoch ms at which the auto-action fires. */
  readonly expiresAt: number;
  readonly expired: boolean;
  /** True once the per-turn time is gone and the bank is draining. */
  readonly onBank: boolean;
}

export function startTimer(rules: TimerRules, now: number): TimerState {
  return { turnStartedAt: now, bank: { A: rules.bankMs, B: rules.bankMs } };
}

export function startTurn(timer: TimerState, now: number): TimerState {
  return { ...timer, turnStartedAt: now };
}

export function read(rules: TimerRules, timer: TimerState, team: Team, now: number): TimerReading {
  const bank = timer.bank[team];
  const elapsedMs = Math.max(0, now - timer.turnStartedAt);
  const turnRemainingMs = Math.max(0, rules.perTurnMs - elapsedMs);
  const bankUsedMs = Math.max(0, elapsedMs - rules.perTurnMs);
  const bankRemainingMs = Math.max(0, bank - bankUsedMs);
  const expiresAt = timer.turnStartedAt + rules.perTurnMs + bank;

  return {
    elapsedMs,
    turnRemainingMs,
    bankRemainingMs,
    totalRemainingMs: turnRemainingMs + bankRemainingMs,
    expiresAt,
    expired: now >= expiresAt,
    onBank: turnRemainingMs === 0 && bankRemainingMs > 0,
  };
}

/** Charge the acting team for the turn that just ended and start the next one. */
export function settleTurn(
  rules: TimerRules,
  timer: TimerState,
  team: Team,
  now: number,
): TimerState {
  const { bankRemainingMs } = read(rules, timer, team, now);
  return { turnStartedAt: now, bank: { ...timer.bank, [team]: bankRemainingMs } };
}

/** When the host should set its next alarm. */
export function nextAlarmAt(rules: TimerRules, timer: TimerState, team: Team): number {
  return timer.turnStartedAt + rules.perTurnMs + timer.bank[team];
}
