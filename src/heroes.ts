/**
 * The heroes that can be drafted.
 *
 * Vainglory is no longer being developed, so the roster will not change again
 * and the list simply lives in this project as a file. Nothing is fetched from
 * anywhere while a draft is running, which means no tournament is ever held up
 * by somebody else's website being down.
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

/** The whole roster, which is what a room drafts from unless told otherwise. */
export const ALL_HERO_IDS: readonly string[] = HEROES.map((hero) => hero.id);

/**
 * Whether every hero's role has come from a source worth trusting.
 *
 * Captains filter a wall of nearly sixty portraits by role constantly, so the
 * filter has to be right. Until this is true the app does not offer one at all,
 * because a filter that quietly hides the hero someone was looking for is worse
 * than no filter.
 */
export const HERO_DATA_VERIFIED = file.verified;

export function heroesMissingRoles(): readonly Hero[] {
  return HEROES.filter((hero) => hero.roles.length === 0);
}

/** The roles captains can filter by, taken from the roster itself. */
export function allRoles(): readonly string[] {
  return [...new Set(HEROES.flatMap((hero) => hero.roles))].sort();
}
