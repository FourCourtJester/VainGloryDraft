import { describe, expect, it } from "vitest";
import { nextAlarmAt, read, settleTurn, startTimer, startTurn } from "../src/timer.js";

const RULES = { perTurnMs: 30_000, bankMs: 60_000 };
const T0 = 1_700_000_000_000;

describe("read", () => {
  const timer = startTimer(RULES, T0);

  it("burns the per-turn time before touching the bank", () => {
    const r = read(RULES, timer, "A", T0 + 10_000);
    expect(r.turnRemainingMs).toBe(20_000);
    expect(r.bankRemainingMs).toBe(60_000);
    expect(r.onBank).toBe(false);
    expect(r.expired).toBe(false);
  });

  it("drains the bank once the per-turn time is gone", () => {
    const r = read(RULES, timer, "A", T0 + 45_000);
    expect(r.turnRemainingMs).toBe(0);
    expect(r.bankRemainingMs).toBe(45_000);
    expect(r.totalRemainingMs).toBe(45_000);
    expect(r.onBank).toBe(true);
  });

  it("expires exactly at per-turn plus bank", () => {
    expect(read(RULES, timer, "A", T0 + 89_999).expired).toBe(false);
    expect(read(RULES, timer, "A", T0 + 90_000).expired).toBe(true);
    expect(read(RULES, timer, "A", T0 + 90_000).totalRemainingMs).toBe(0);
  });

  it("keeps burning while a captain is disconnected — there is no pause", () => {
    const away = read(RULES, timer, "A", T0 + 120_000);
    expect(away.expired).toBe(true);
    expect(away.bankRemainingMs).toBe(0);
  });

  it("is a pure function of turnStartedAt and bank, so reconnects cannot drift", () => {
    const now = T0 + 12_345;
    expect(read(RULES, timer, "A", now)).toEqual(read(RULES, timer, "A", now));
  });

  it("ignores a clock that appears to run backwards", () => {
    expect(read(RULES, timer, "A", T0 - 5_000).elapsedMs).toBe(0);
  });
});

describe("settleTurn", () => {
  it("leaves the bank alone when the turn finished inside its own time", () => {
    const timer = startTimer(RULES, T0);
    const settled = settleTurn(RULES, timer, "A", T0 + 20_000);
    expect(settled.bank).toEqual({ A: 60_000, B: 60_000 });
    expect(settled.turnStartedAt).toBe(T0 + 20_000);
  });

  it("charges only the overrun to the acting team", () => {
    const timer = startTimer(RULES, T0);
    const settled = settleTurn(RULES, timer, "A", T0 + 50_000);
    expect(settled.bank).toEqual({ A: 40_000, B: 60_000 });
  });

  it("cannot drive a bank negative", () => {
    const timer = startTimer(RULES, T0);
    expect(settleTurn(RULES, timer, "B", T0 + 500_000).bank.B).toBe(0);
  });

  it("gives the next turn its full per-turn time again", () => {
    let timer = startTimer(RULES, T0);
    timer = settleTurn(RULES, timer, "A", T0 + 50_000);
    expect(read(RULES, timer, "B", T0 + 50_000).turnRemainingMs).toBe(30_000);
  });
});

describe("nextAlarmAt", () => {
  it("is the moment the auto-action must fire", () => {
    const timer = startTurn(startTimer(RULES, T0), T0 + 1_000);
    expect(nextAlarmAt(RULES, timer, "A")).toBe(T0 + 1_000 + 90_000);
    expect(read(RULES, timer, "A", nextAlarmAt(RULES, timer, "A")).expired).toBe(true);
  });

  it("shortens as a team spends its bank", () => {
    let timer = startTimer(RULES, T0);
    timer = settleTurn(RULES, timer, "A", T0 + 60_000); // A overran by 30s
    timer = settleTurn(RULES, timer, "B", T0 + 70_000);
    expect(nextAlarmAt(RULES, timer, "A") - timer.turnStartedAt).toBe(60_000);
  });
});
