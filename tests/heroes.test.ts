import { describe, expect, it } from "vitest";
import { ALL_HERO_IDS, HEROES, HERO_DATA_VERIFIED, allRoles, getHero, heroesMissingRoles } from "../src/heroes.js";

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

  it("claims verified only when every hero has a role", () => {
    // Roles are never guessed at. This flag is what lets captains filter by
    // role, so it must never claim more than the roster actually knows.
    if (HERO_DATA_VERIFIED) {
      expect(heroesMissingRoles()).toEqual([]);
      expect(allRoles().length).toBeGreaterThan(0);
    } else {
      expect(heroesMissingRoles().length).toBeGreaterThan(0);
    }
  });

  it("derives the role list from the roster rather than a hardcoded set", () => {
    expect(allRoles()).toEqual([...new Set(HEROES.flatMap((hero) => hero.roles))].sort());
  });
});
