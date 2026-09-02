import { describe, expect, it } from "vitest";
import { ALL_HERO_IDS, HEROES, HERO_DATA_VERIFIED, getHero, heroesMissingMetadata } from "../src/heroes.js";

describe("hero data", () => {
  it("has a unique, slug-shaped id for every hero", () => {
    expect(new Set(ALL_HERO_IDS).size).toBe(ALL_HERO_IDS.length);
    for (const id of ALL_HERO_IDS) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("has a non-empty name for every hero", () => {
    for (const hero of HEROES) expect(hero.name.trim().length).toBeGreaterThan(0);
  });

  it("looks heroes up by id", () => {
    expect(getHero("blackfeather")?.name).toBe("Blackfeather");
    expect(getHero("san-feng")?.name).toBe("San Feng");
    expect(getHero("nobody")).toBeUndefined();
  });

  it("carries a roster large enough for a 5v5 draft several times over", () => {
    expect(HEROES.length).toBeGreaterThanOrEqual(30);
  });

  it("declares itself unverified while roles are unfilled", () => {
    // Guards the handoff rule: never invent role data. When roles are scraped
    // properly this test is the reminder to flip the flag.
    if (!HERO_DATA_VERIFIED) {
      expect(heroesMissingMetadata().length).toBeGreaterThan(0);
    } else {
      expect(heroesMissingMetadata()).toEqual([]);
    }
  });
});
