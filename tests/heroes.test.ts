import { describe, expect, it } from "vitest";
import {
  ALL_HERO_IDS,
  HEROES,
  HERO_DATA_VERIFIED,
  HERO_ROLES,
  allRoles,
  getHero,
  heroesMissingRoles,
  isHeroRole,
} from "../src/heroes.js";

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

  it("offers only roles some hero actually has", () => {
    // A role nobody has been given is a filter that finds nothing, so the
    // filter list comes from the roster even though the vocabulary is fixed.
    const onRoster = new Set(HEROES.flatMap((hero) => hero.roles));
    expect(allRoles().every((role) => onRoster.has(role))).toBe(true);
    expect([...onRoster].every((role) => allRoles().includes(role))).toBe(true);
  });

  it("keeps the role list beside the roster, so nothing holds a second copy", () => {
    // The import script reads this same list out of data/heroes.json. Drop it
    // from the file and the script quietly falls back to its own idea of what
    // a role is, which is exactly the drift this avoids.
    expect(HERO_ROLES.length).toBeGreaterThan(0);
  });

  it("knows the three roles a hero is drafted for", () => {
    // Confirmed by VGNA: a side fields one captain, one jungler and three
    // lanes, so "lane" is one role covering three seats.
    expect(HERO_ROLES).toEqual(["Captain", "Jungle", "Lane"]);
    expect(isHeroRole("Captain")).toBe(true);
    expect(isHeroRole("Support")).toBe(false);
    expect(isHeroRole("captain")).toBe(false);
  });

  it("orders roles the way a captain thinks about them, not alphabetically", () => {
    // Every hero given every role, so ordering is the only thing under test.
    expect(allRoles()).toEqual(HERO_ROLES.filter((role) => new Set(HEROES.flatMap((h) => h.roles)).has(role)));
  });

  it("never invents a role that is not one of the three", () => {
    const strays = HEROES.flatMap((hero) => hero.roles).filter((role) => !isHeroRole(role));
    expect(strays).toEqual([]);
  });

});
