import { describe, expect, it } from "vitest";
import { createDraft, isComplete, resolveTimeout } from "../src/engine.js";
import { ALL_HERO_IDS } from "../src/heroes.js";
import { PENDING, PRESETS, getPreset, resolveScript } from "../src/presets.js";
import { validateScript } from "../src/script.js";
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

  it("ships no preset claiming to be an official format yet", () => {
    // Flip this when a real order lands: a placeholder must never be offered to
    // a tournament as "standard".
    expect(PRESETS.filter((p) => p.official)).toEqual([]);
  });

  it("reports an unknown preset clearly", () => {
    expect(() => resolveScript("nope")).toThrow(/Unknown preset/);
  });
});
