import { describe, expect, it } from "vitest";
import { canRun, deriveTotals, formatScript, parseScript, t, validateScript } from "../src/script.js";

describe("parseScript", () => {
  it("parses single and multi-count turns", () => {
    expect(parseScript("Aban, Bban, Apick x2, Bpick")).toEqual([
      { team: "A", action: "ban", count: 1 },
      { team: "B", action: "ban", count: 1 },
      { team: "A", action: "pick", count: 2 },
      { team: "B", action: "pick", count: 1 },
    ]);
  });

  it("round-trips through formatScript", () => {
    const notation = "Aban, Bpick x2, Bban";
    expect(formatScript(parseScript(notation))).toBe(notation);
  });

  it("rejects nonsense", () => {
    expect(() => parseScript("Cpick")).toThrow(/Cannot parse turn 1/);
  });
});

describe("deriveTotals", () => {
  it("derives per-team totals rather than assuming a format", () => {
    const totals = deriveTotals(parseScript("Aban, Bban, Apick x2, Bpick x3"));
    expect(totals.turns).toBe(4);
    expect(totals.selections).toBe(7);
    expect(totals.byTeam.A).toEqual({ picks: 2, bans: 1 });
    expect(totals.byTeam.B).toEqual({ picks: 3, bans: 1 });
  });

  it("counts a smaller minimum pool when mirror picks are allowed", () => {
    const totals = deriveTotals(parseScript("Aban, Bban, Apick x3, Bpick x3"));
    expect(totals.minimumPool.mirrorOff).toBe(8);
    expect(totals.minimumPool.mirrorOn).toBe(5);
  });

  it("handles a 3v3-shaped script and a 5v5-shaped script with the same code", () => {
    const threes = deriveTotals(parseScript("Apick x3, Bpick x3"));
    const fives = deriveTotals(parseScript("Apick x5, Bpick x5"));
    expect(threes.byTeam.A.picks).toBe(3);
    expect(fives.byTeam.A.picks).toBe(5);
  });
});

describe("validateScript", () => {
  it("accepts an asymmetric script", () => {
    expect(validateScript(parseScript("Aban x2, Bpick"))).toEqual([]);
  });

  it("rejects an empty script", () => {
    expect(validateScript([])).toHaveLength(1);
  });

  it("rejects a zero or fractional count", () => {
    expect(validateScript([t("A", "pick", 0)])[0]?.turnIndex).toBe(0);
    expect(validateScript([{ team: "A", action: "pick", count: 1.5 }])).toHaveLength(1);
  });
});

describe("canRun", () => {
  it("flags a pool too small for the script", () => {
    const script = parseScript("Aban, Bban, Apick x3, Bpick x3");
    expect(canRun(script, 8, false)).toEqual([]);
    expect(canRun(script, 7, false)[0]?.message).toMatch(/at least 8 heroes/);
    expect(canRun(script, 5, true)).toEqual([]);
  });
});
