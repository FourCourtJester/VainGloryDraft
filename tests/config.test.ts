import { describe, expect, it } from "vitest";
import { DRAFT_DEFAULTS, draftConfig } from "../src/config.js";
import { createDraft, resolveTimeout } from "../src/engine.js";
import { ACTIONS, TEAMS, script } from "./helpers.js";

const BASE = { teams: TEAMS, actions: ACTIONS, script: script("Aban, Bpick"), pool: ["a", "b", "c"], seed: "room-1" };

describe("draftConfig", () => {
  it("defaults mirrors off", () => {
    expect(draftConfig(BASE)).toMatchObject({ mirror: false });
    expect(DRAFT_DEFAULTS.mirror).toBe(false);
  });

  it("lets a room allow mirrors", () => {
    expect(draftConfig({ ...BASE, mirror: true })).toMatchObject({ mirror: true });
  });

  it("produces a config the engine accepts", () => {
    const draft = createDraft(draftConfig(BASE));
    expect(draft.ok).toBe(true);
    if (draft.ok) expect(resolveTimeout(draft.value).ok).toBe(true);
  });
});
