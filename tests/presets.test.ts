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
    const first = resolveScript("example-3v3-snake") as unknown[];
    first.push({ team: "A", action: "ban", count: 1 });
    expect(resolveScript("example-3v3-snake")).toHaveLength(getPreset("example-3v3-snake")!.script.length);
  });

  it("refuses a preset that is still blocked on the real in-game order", () => {
    for (const pending of PENDING) {
      expect(getPreset(pending.id)).toBeUndefined();
      expect(() => resolveScript(pending.id)).toThrow(/not available yet/);
    }
  });

  it("ships the supplied 5v5 order verbatim", () => {
    expect(formatScript(resolveScript("vg-5v5-standard"))).toBe(
      "Aban, Bban, Aban, Bban, Apick, Bpick, Bpick, Apick, Apick, Bpick, Bpick, Apick, Apick, Bpick",
    );
  });

  it("gives the 5v5 standard two bans and five picks a side across fourteen turns", () => {
    const totals = deriveTotals(resolveScript("vg-5v5-standard"));
    expect(totals.turns).toBe(14);
    expect(totals.byTeam.A).toEqual({ picks: 5, bans: 2 });
    expect(totals.byTeam.B).toEqual({ picks: 5, bans: 2 });
  });

  it("keeps each pick as its own turn, so a double pick is two confirms", () => {
    // The supplied order snakes (…B, B…). Written as separate turns of one, a
    // team picking twice in a row gets two clocks. Collapsing them into a
    // `count: 2` turn would be one clock and one confirm — a different game.
    expect(resolveScript("vg-5v5-standard").every((turn) => turn.count === 1)).toBe(true);
  });

  it("defaults a room to the 5v5 standard", () => {
    expect(DEFAULT_PRESET_ID).toBe("vg-5v5-standard");
    expect(defaultScript()).toEqual(getPreset("vg-5v5-standard")!.script);
  });

  it("marks a placeholder script as unofficial", () => {
    // A placeholder must never be offered to a tournament as "standard".
    expect(getPreset("example-3v3-snake")!.official).toBe(false);
  });

  it("reports an unknown preset clearly", () => {
    expect(() => resolveScript("nope")).toThrow(/Unknown preset/);
  });
});
