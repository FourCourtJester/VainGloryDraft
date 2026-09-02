/**
 * Static hero data.
 *
 * Vainglory is no longer in development, so the roster is fixed and there is
 * nothing to keep in sync. The file is checked into the repo and read at build
 * time — never fetched at runtime from a site that may disappear.
 */

import heroData from "../data/heroes.json" with { type: "json" };
import type { Hero } from "./types.js";

interface HeroFile {
  readonly verified: boolean;
  readonly note: string;
  readonly roster: { readonly count: number; readonly source: string };
  readonly heroes: readonly {
    readonly id: string;
    readonly name: string;
    readonly roles: readonly string[];
    readonly attackType: string | null;
    readonly image: string | null;
  }[];
}

const file = heroData as HeroFile;

export const HEROES: readonly Hero[] = file.heroes.map((hero) => ({
  id: hero.id,
  name: hero.name,
  roles: hero.roles,
  attackType: hero.attackType === "melee" || hero.attackType === "ranged" ? hero.attackType : null,
  image: hero.image,
}));

const BY_ID = new Map(HEROES.map((hero) => [hero.id, hero]));

export function getHero(id: string): Hero | undefined {
  return BY_ID.get(id);
}

/** Every hero id, in roster order. The default pool for a room. */
export const ALL_HERO_IDS: readonly string[] = HEROES.map((hero) => hero.id);

/**
 * True when role/attackType data has been verified against a real source.
 * The UI should not offer role filtering while this is false — a filter over
 * invented data is worse than no filter.
 */
export const HERO_DATA_VERIFIED = file.verified;

export function heroesMissingMetadata(): readonly Hero[] {
  return HEROES.filter((hero) => hero.roles.length === 0 || hero.attackType === null);
}
