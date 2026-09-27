import { describe, expect, it } from "vitest";
import { allowanceFor, charge, deadline, read, startTimer, startTurn } from "../src/timer.js";

const RULES = { perTurnMs: 30_000, bankMs: 60_000 };
const ALLOWANCE = RULES.perTurnMs;
const T0 = 1_700_000_000_000;
const TEAMS = ["A", "B"];

describe("read", () => {
  const timer = startTimer(RULES, TEAMS, T0);

  it("gives every team the same reserve to start with", () => {
    expect(timer.bank).toEqual({ A: 60_000, B: 60_000 });
    expect(startTimer(RULES, ["A", "B", "C"], T0).bank).toEqual({ A: 60_000, B: 60_000, C: 60_000 });
  });

  it("burns the per-turn time before touching the bank", () => {
    const r = read(ALLOWANCE, timer, "A", T0 + 10_000);
    expect(r.turnRemainingMs).toBe(20_000);
    expect(r.bankRemainingMs).toBe(60_000);
    expect(r.onBank).toBe(false);
    expect(r.expired).toBe(false);
  });

  it("drains the bank once the per-turn time is gone", () => {
    const r = read(ALLOWANCE, timer, "A", T0 + 45_000);
    expect(r.turnRemainingMs).toBe(0);
    expect(r.bankRemainingMs).toBe(45_000);
    expect(r.totalRemainingMs).toBe(45_000);
    expect(r.onBank).toBe(true);
  });

  it("expires exactly at per-turn plus bank", () => {
    expect(read(ALLOWANCE, timer, "A", T0 + 89_999).expired).toBe(false);
    expect(read(ALLOWANCE, timer, "A", T0 + 90_000).expired).toBe(true);
    expect(read(ALLOWANCE, timer, "A", T0 + 90_000).totalRemainingMs).toBe(0);
  });

  it("keeps burning while a captain is disconnected — there is no pause", () => {
    const away = read(ALLOWANCE, timer, "A", T0 + 120_000);
    expect(away.expired).toBe(true);
    expect(away.bankRemainingMs).toBe(0);
  });

  it("is a pure function of turnStartedAt and bank, so reconnects cannot drift", () => {
    const now = T0 + 12_345;
    expect(read(ALLOWANCE, timer, "A", now)).toEqual(read(ALLOWANCE, timer, "A", now));
  });

  it("ignores a clock that appears to run backwards", () => {
    expect(read(ALLOWANCE, timer, "A", T0 - 5_000).elapsedMs).toBe(0);
  });
});

describe("allowanceFor", () => {
  it("is the room's usual allowance unless the turn has its own", () => {
    expect(allowanceFor(RULES, { teams: ["A"], action: "pick", count: 1 })).toBe(30_000);
    expect(allowanceFor(RULES, { teams: ["A"], action: "pick", count: 2, timeMs: 45_000 })).toBe(45_000);
  });
});

describe("charge", () => {
  it("leaves the bank alone when the team finished inside the turn's own time", () => {
    const timer = charge(ALLOWANCE, startTimer(RULES, TEAMS, T0), "A", T0 + 20_000);
    expect(timer.bank).toEqual({ A: 60_000, B: 60_000 });
    // Charging a team is not the end of the turn: that is the room's call.
    expect(timer.turnStartedAt).toBe(T0);
  });

  it("charges only the overrun, and only to the team that overran", () => {
    const timer = charge(ALLOWANCE, startTimer(RULES, TEAMS, T0), "A", T0 + 50_000);
    expect(timer.bank).toEqual({ A: 40_000, B: 60_000 });
  });

  it("cannot drive a bank negative", () => {
    expect(charge(ALLOWANCE, startTimer(RULES, TEAMS, T0), "B", T0 + 500_000).bank.B).toBe(0);
  });

  it("charges each team on a shared turn at its own moment", () => {
    let timer = startTimer(RULES, TEAMS, T0);
    timer = charge(ALLOWANCE, timer, "A", T0 + 40_000);
    timer = charge(ALLOWANCE, timer, "B", T0 + 70_000);
    expect(timer.bank).toEqual({ A: 50_000, B: 20_000 });
  });

  it("gives the next turn its full time again once it starts", () => {
    let timer = charge(ALLOWANCE, startTimer(RULES, TEAMS, T0), "A", T0 + 50_000);
    timer = startTurn(timer, T0 + 50_000);
    expect(read(ALLOWANCE, timer, "B", T0 + 50_000).turnRemainingMs).toBe(30_000);
  });
});

describe("deadline", () => {
  it("is the moment the auto-action must fire", () => {
    const timer = startTurn(startTimer(RULES, TEAMS, T0), T0 + 1_000);
    expect(deadline(ALLOWANCE, timer, "A")).toBe(T0 + 1_000 + 90_000);
    expect(read(ALLOWANCE, timer, "A", deadline(ALLOWANCE, timer, "A")).expired).toBe(true);
  });

  it("shortens as a team spends its bank", () => {
    let timer = startTimer(RULES, TEAMS, T0);
    timer = startTurn(charge(ALLOWANCE, timer, "A", T0 + 60_000), T0 + 60_000); // A overran by 30s
    timer = startTurn(charge(ALLOWANCE, timer, "B", T0 + 70_000), T0 + 70_000);
    expect(deadline(ALLOWANCE, timer, "A") - timer.turnStartedAt).toBe(60_000);
  });

  it("follows a turn's own, longer allowance", () => {
    const timer = startTimer(RULES, TEAMS, T0);
    expect(deadline(45_000, timer, "A")).toBe(T0 + 45_000 + 60_000);
  });
});
