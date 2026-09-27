/**
 * The clock a team plays against.
 *
 * Each turn comes with its own allowance of time. A team that needs longer than
 * that starts eating into a reserve that belongs to them for the whole draft,
 * so thinking hard about one difficult choice costs them later rather than
 * stopping the game.
 *
 * The clock is never counted down. All that is remembered is when the turn
 * began and how much reserve each team has left, and the time remaining is
 * worked out from those whenever anyone asks. A captain who drops out and comes
 * back sees exactly the same clock as everyone else, because it was never
 * running separately on their screen in the first place.
 *
 * On a turn several teams play at once, they share the turn's allowance and
 * each spends from their own reserve, so each has a deadline of their own.
 *
 * There is no pause. If a captain disappears their time keeps running, which is
 * a decision about how tournaments should work rather than a limitation.
 */

import type { Team, Turn } from "./types.js";

export interface TimerRules {
  /** How long a turn gets before the team starts spending its reserve, unless the turn says otherwise. */
  readonly perTurnMs: number;
  /** How much extra time each team has for the whole draft, to spend as they like. */
  readonly bankMs: number;
}

export interface TimerState {
  /** When the current turn began. */
  readonly turnStartedAt: number;
  readonly bank: Readonly<Record<Team, number>>;
}

export interface TimerReading {
  readonly elapsedMs: number;
  /** Time left in this turn's own allowance, before the reserve is touched. */
  readonly turnRemainingMs: number;
  /** Reserve the team would have left if they finished the turn now. */
  readonly bankRemainingMs: number;
  /** Everything the captain still has, this turn's time and reserve together. */
  readonly totalRemainingMs: number;
  /** The moment the app will choose for them if they have not confirmed. */
  readonly expiresAt: number;
  readonly expired: boolean;
  /** True once this turn's own time is gone and the team is into its reserve. */
  readonly onBank: boolean;
}

/** How long this turn gets before anybody touches their reserve. */
export function allowanceFor(rules: TimerRules, turn: Turn): number {
  return turn.timeMs ?? rules.perTurnMs;
}

/** Starts the clock for a new draft, with every team's reserve untouched. */
export function startTimer(rules: TimerRules, teams: readonly Team[], now: number): TimerState {
  return { turnStartedAt: now, bank: Object.fromEntries(teams.map((team) => [team, rules.bankMs])) };
}

export function startTurn(timer: TimerState, now: number): TimerState {
  return { ...timer, turnStartedAt: now };
}

/**
 * Works out where a team's clock stands at a given moment: what is left of this
 * turn, what is left of their reserve, and whether their time is up.
 */
export function read(allowanceMs: number, timer: TimerState, team: Team, now: number): TimerReading {
  const bank = timer.bank[team] ?? 0;
  const elapsedMs = Math.max(0, now - timer.turnStartedAt);
  const turnRemainingMs = Math.max(0, allowanceMs - elapsedMs);
  const bankUsedMs = Math.max(0, elapsedMs - allowanceMs);
  const bankRemainingMs = Math.max(0, bank - bankUsedMs);
  const expiresAt = timer.turnStartedAt + allowanceMs + bank;

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

/**
 * Takes whatever a team overran by out of their reserve, at the moment they
 * settled their part of the turn. The turn itself carries on until everybody
 * playing it has.
 */
export function charge(allowanceMs: number, timer: TimerState, team: Team, now: number): TimerState {
  const { bankRemainingMs } = read(allowanceMs, timer, team, now);
  return { ...timer, bank: { ...timer.bank, [team]: bankRemainingMs } };
}

/**
 * The moment a team's time runs out this turn, so the room can arrange to wake
 * itself up and choose on their behalf even if nobody is watching.
 */
export function deadline(allowanceMs: number, timer: TimerState, team: Team): number {
  return timer.turnStartedAt + allowanceMs + (timer.bank[team] ?? 0);
}
