import { describe, expect, it } from "vitest";
import { canRun, deriveTotals, formatScript, parseScript, playersPerTeam, t, validateScript } from "../src/script.js";
import type { ActionDefinition } from "../src/types.js";
import { ACTIONS, VOCAB, script } from "./helpers.js";

describe("parseScript", () => {
  it("parses single and multi-count turns", () => {
    expect(script("Aban, Bban, Apick x2, Bpick")).toEqual([
      { teams: ["A"], action: "ban", count: 1 },
      { teams: ["B"], action: "ban", count: 1 },
      { teams: ["A"], action: "pick", count: 2 },
      { teams: ["B"], action: "pick", count: 1 },
    ]);
  });

  it("reads a team and its action with or without a space, in any case", () => {
    expect(script("A ban, b PICK x2")).toEqual(script("Aban, Bpick x2"));
  });

  it("reads a turn several teams play at once, and one nobody plays", () => {
    expect(script("A+B ban x2, remaining pick")).toEqual([
      { teams: ["A", "B"], action: "ban", count: 2 },
      { teams: [], action: "pick", count: 1 },
    ]);
  });

  it("reads a turn's own time", () => {
    expect(script("B pick x2 @45s, A pick @7.5")).toEqual([
      { teams: ["B"], action: "pick", count: 2, timeMs: 45_000 },
      { teams: ["A"], action: "pick", count: 1, timeMs: 7_500 },
    ]);
  });

  it("reads teams and actions of any name the vocabulary gives it", () => {
    const actions: ActionDefinition[] = [
      { id: "veto", label: "Veto", past: "vetoed", effect: "remove" },
      { id: "pick", label: "Pick", past: "picked", effect: "take" },
    ];
    expect(parseScript("Radiant veto, Dire pick", { teams: ["Radiant", "Dire"], actions })).toEqual([
      { teams: ["Radiant"], action: "veto", count: 1 },
      { teams: ["Dire"], action: "pick", count: 1 },
    ]);
  });

  it("round-trips through formatScript", () => {
    const notation = "A ban, B pick x2, A+B ban @45s, remaining pick";
    expect(formatScript(script(notation))).toBe(notation);
  });

  it("rejects nonsense, saying which turn", () => {
    expect(() => script("Cpick")).toThrow(/Cannot parse turn 1/);
    expect(() => script("Aban, Aprotect")).toThrow(/Cannot parse turn 2/);
    expect(() => script("Apicks")).toThrow(/Cannot parse turn 1/);
    expect(() => script("Apick x2 please")).toThrow(/Cannot parse turn 1/);
  });
});

describe("deriveTotals", () => {
  it("derives per-team totals rather than assuming a format", () => {
    const totals = deriveTotals(script("Aban, Bban, Apick x2, Bpick x3"), ACTIONS);
    expect(totals.turns).toBe(4);
    expect(totals.selections).toBe(7);
    expect(totals.byTeam.A).toEqual({ ban: 1, pick: 2 });
    expect(totals.byTeam.B).toEqual({ ban: 1, pick: 3 });
  });

  it("counts a smaller minimum pool when mirrors are allowed", () => {
    const totals = deriveTotals(script("Aban, Bban, Apick x3, Bpick x3"), ACTIONS);
    expect(totals.minimumPool.mirrorOff).toBe(8);
    expect(totals.minimumPool.mirrorOn).toBe(5);
  });

  it("counts every team on a turn they play together, and what the draft takes itself", () => {
    const totals = deriveTotals(script("A+B ban x2, Apick, remaining pick"), ACTIONS);
    expect(totals.selections).toBe(6);
    expect(totals.unplayed).toBe(1);
    expect(totals.byTeam.B).toEqual({ ban: 2 });
  });
});

describe("playersPerTeam", () => {
  it("is however many things a team takes", () => {
    expect(playersPerTeam(script("Aban, Bban, Apick x3, Bpick x3"), ACTIONS)).toBe(3);
    expect(playersPerTeam(script("Aban, Bban"), ACTIONS)).toBe(1);
  });
});

describe("validateScript", () => {
  it("accepts an asymmetric script", () => {
    expect(validateScript(script("Aban x2, Bpick"), VOCAB)).toEqual([]);
  });

  it("rejects an empty script", () => {
    expect(validateScript([], VOCAB)).toHaveLength(1);
  });

  it("rejects a zero or fractional count", () => {
    expect(validateScript([t("A", "pick", 0)], VOCAB)[0]?.turnIndex).toBe(0);
    expect(validateScript([{ teams: ["A"], action: "pick", count: 1.5 }], VOCAB)).toHaveLength(1);
  });

  it("rejects a team named twice on one turn, and an absurd turn time", () => {
    expect(validateScript([t(["A", "A"], "pick")], VOCAB)).toHaveLength(1);
    expect(validateScript([t("A", "pick", 1, 10)], VOCAB)).toHaveLength(1);
    expect(validateScript([t("A", "pick", 1, 2 * 60 * 60_000)], VOCAB)).toHaveLength(1);
  });
});

describe("canRun", () => {
  it("flags a pool too small for the script", () => {
    const order = script("Aban, Bban, Apick x3, Bpick x3");
    expect(canRun(order, VOCAB, 8, false)).toEqual([]);
    expect(canRun(order, VOCAB, 7, false)[0]?.message).toMatch(/at least 8/);
    expect(canRun(order, VOCAB, 5, true)).toEqual([]);
  });
});
