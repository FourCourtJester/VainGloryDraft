/**
 * What a draft does when nobody says otherwise.
 *
 * Every room is created through here, so the answer to "what happens if the
 * organiser just clicks create" is written down once in this file rather than
 * assumed separately everywhere a room is made.
 */

import type { AutoFillStrategy, DraftConfig, TurnScript } from "./types.js";

export interface DraftDefaults {
  readonly mirrorPicks: boolean;
  readonly autoFill: AutoFillStrategy;
}

/**
 * Both teams may not take the same hero, which is the usual tournament rule; a
 * room can allow it if it wants to.
 *
 * When a captain runs out of time the app picks for them at random. Always
 * taking the first hero on the list would be easy to plan around — a captain
 * who wanted it could simply let the clock run — whereas a random choice is
 * nothing worth waiting for.
 */
export const DRAFT_DEFAULTS: DraftDefaults = {
  mirrorPicks: false,
  autoFill: "random",
};

export interface RoomOptions {
  /** The draft format itself, rather than the name of one. */
  readonly script: TurnScript;
  readonly heroPool: readonly string[];
  /**
   * This room's own private number. It has to be different for every room and
   * kept with it, because it is what lets the choices made on a captain's behalf
   * be checked afterwards.
   */
  readonly seed: string;
  readonly mirrorPicks?: boolean | undefined;
  readonly autoFill?: AutoFillStrategy | undefined;
}

/** Fills in whatever the organiser did not choose, and hands back a full set of rules. */
export function draftConfig(options: RoomOptions): DraftConfig {
  return {
    script: options.script,
    heroPool: options.heroPool,
    seed: options.seed,
    mirrorPicks: options.mirrorPicks ?? DRAFT_DEFAULTS.mirrorPicks,
    autoFill: options.autoFill ?? DRAFT_DEFAULTS.autoFill,
  };
}
