import { describe, expect, it } from "vitest";
import { DRAFT_DEFAULTS, draftConfig } from "../src/config.js";
import { createDraft, resolveTimeout } from "../src/engine.js";
import { parseScript } from "../src/script.js";

const BASE = { script: parseScript("Aban, Bpick"), heroPool: ["a", "b", "c"], seed: "room-1" };

describe("draftConfig", () => {
  it("defaults mirror picks off and auto-fill to random", () => {
    expect(draftConfig(BASE)).toMatchObject({ mirrorPicks: false, autoFill: "random" });
    expect(DRAFT_DEFAULTS.autoFill).toBe("random");
  });

  it("lets a room override either default", () => {
    expect(draftConfig({ ...BASE, mirrorPicks: true, autoFill: "lowestIndex" })).toMatchObject({
      mirrorPicks: true,
      autoFill: "lowestIndex",
    });
  });

  it("produces a config the engine accepts", () => {
    const draft = createDraft(draftConfig(BASE));
    expect(draft.ok).toBe(true);
    if (draft.ok) expect(resolveTimeout(draft.value).ok).toBe(true);
  });
});
