import { describe, expect, it } from "vitest";
import { createDraft, isComplete, resolveTimeout } from "../src/engine.js";
import { ALL_HERO_IDS } from "../src/heroes.js";
import { DEFAULT_PRESET_ID, PENDING, PRESETS, defaultScript, getPreset, resolveScript } from "../src/presets.js";
import { deriveTotals, formatScript, validateScript } from "../src/script.js";
import type { Result } from "../src/types.js";

function must<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

describe("presets", () => {
  it("every shipped preset is a runnable script", () => {
    for (const preset of PRESETS) {
      expect(validateScript(preset.script)).toEqual([]);
      let state = must(
        createDraft({
          script: preset.script,
          heroPool: ALL_HERO_IDS,
          mirrorPicks: false,
          autoFill: "random",
          seed: preset.id,
        }),
      );
      while (!isComplete(state)) state = must(resolveTimeout(state));
      expect(state.committed).toHaveLength(preset.script.length);
    }
  });

  it("resolves to a copy, so a room cannot be changed by editing a preset", () => {
    const first = resolveScript("vg-3v3-standard") as unknown[];
    first.push({ team: "A", action: "ban", count: 1 });
    expect(resolveScript("vg-3v3-standard")).toHaveLength(getPreset("vg-3v3-standard")!.script.length);
  });

  it("ships the 3v3 order as the 5v5 shape cut short at three a side", () => {
    expect(formatScript(resolveScript("vg-3v3-standard"))).toBe(
      "Aban, Bban, Aban, Bban, Apick, Bpick x2, Apick x2, Bpick",
    );
    const totals = deriveTotals(resolveScript("vg-3v3-standard"));
    expect(totals.turns).toBe(8);
    expect(totals.byTeam.A).toEqual({ picks: 3, bans: 2 });
    expect(totals.byTeam.B).toEqual({ picks: 3, bans: 2 });
  });

  it("gives team A the first pick and team B the last, in both formats", () => {
    for (const id of ["vg-5v5-standard", "vg-3v3-standard"]) {
      const picks = resolveScript(id).filter((turn) => turn.action === "pick");
      expect(picks.at(0)?.team).toBe("A");
      expect(picks.at(-1)?.team).toBe("B");
    }
  });

  it("shares its opening with the 5v5 order, which is what makes it the same format", () => {
    // Compared one selection at a time rather than one turn at a time: the
    // threes stop partway through what the fives run as a double pick, so the
    // orders agree on who chooses when without agreeing on where turns end.
    const selections = (id: string): string[] =>
      resolveScript(id).flatMap((turn) => Array.from({ length: turn.count }, () => `${turn.team}${turn.action}`));
    const threes = selections("vg-3v3-standard");
    expect(selections("vg-5v5-standard").slice(0, threes.length)).toEqual(threes);
  });

  it("has nothing left blocked", () => {
    expect(PENDING).toEqual([]);
  });

  it("refuses a preset id that does not exist, rather than falling back", () => {
    expect(getPreset("vg-2v2-standard")).toBeUndefined();
    expect(() => resolveScript("vg-2v2-standard")).toThrow(/Unknown preset/);
  });

  it("ships the supplied 5v5 order", () => {
    expect(formatScript(resolveScript("vg-5v5-standard"))).toBe(
      "Aban, Bban, Aban, Bban, Apick, Bpick x2, Apick x2, Bpick x2, Apick x2, Bpick",
    );
  });

  it("gives the 5v5 standard two bans and five picks a side", () => {
    const totals = deriveTotals(resolveScript("vg-5v5-standard"));
    expect(totals.turns).toBe(10);
    expect(totals.byTeam.A).toEqual({ picks: 5, bans: 2 });
    expect(totals.byTeam.B).toEqual({ picks: 5, bans: 2 });
  });

  it("takes a double pick as one turn, so both heroes are locked in together", () => {
    // The order snakes, so a team sometimes picks twice in a row. Those two go
    // on one clock and one confirm: the captain chooses both, and may change
    // either until they lock the pair in. Giving each its own turn would hand a
    // double pick twice the thinking time of a single one.
    const doubles = resolveScript("vg-5v5-standard").filter((turn) => turn.count === 2);
    expect(doubles).toHaveLength(4);
    expect(doubles.every((turn) => turn.action === "pick")).toBe(true);
    expect(resolveScript("vg-5v5-standard").every((turn) => turn.action === "ban" || turn.count <= 2)).toBe(true);
  });

  it("defaults a room to the 5v5 standard", () => {
    expect(DEFAULT_PRESET_ID).toBe("vg-5v5-standard");
    expect(defaultScript()).toEqual(getPreset("vg-5v5-standard")!.script);
  });

  it("ships only confirmed formats", () => {
    // A format nobody has confirmed must never be offered to a tournament as
    // the standard one.
    expect(PRESETS.every((preset) => preset.official)).toBe(true);
  });

  it("reports an unknown preset clearly", () => {
    expect(() => resolveScript("nope")).toThrow(/Unknown preset/);
  });
});
