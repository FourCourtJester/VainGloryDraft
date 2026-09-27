/**
 * What a draft does when nobody says otherwise.
 *
 * Every room is created through here, so the answer to "what happens if the
 * organiser just clicks create" is written down once in this file rather than
 * assumed separately everywhere a room is made.
 */

import type { ActionDefinition, AutoFillStrategy, DraftConfig, TeamDefinition, TurnScript } from "./types.js";

export interface DraftDefaults {
  readonly mirror: boolean;
  readonly autoFill: AutoFillStrategy;
}

/**
 * Teams may not take the same thing, which is the usual tournament rule; a room
 * can allow it if it wants to.
 *
 * When a team runs out of time the engine chooses for them at random. Always
 * taking the first thing on the list would be easy to plan around — a captain
 * who wanted it could simply let the clock run — whereas a random choice is
 * nothing worth waiting for.
 */
export const DRAFT_DEFAULTS: DraftDefaults = {
  mirror: false,
  autoFill: "random",
};

export interface RoomOptions {
  readonly teams: readonly TeamDefinition[];
  readonly actions: readonly ActionDefinition[];
  /** The draft format itself, rather than the name of one. */
  readonly script: TurnScript;
  readonly pool: readonly string[];
  /**
   * This room's own private number. It has to be different for every room and
   * kept with it, because it is what lets the choices made on a team's behalf
   * be checked afterwards.
   */
  readonly seed: string;
  readonly mirror?: boolean | undefined;
  readonly autoFill?: AutoFillStrategy | undefined;
}

/** Fills in whatever the organiser did not choose, and hands back a full set of rules. */
export function draftConfig(options: RoomOptions): DraftConfig {
  return {
    teams: options.teams,
    actions: options.actions,
    script: options.script,
    pool: options.pool,
    seed: options.seed,
    mirror: options.mirror ?? DRAFT_DEFAULTS.mirror,
    autoFill: options.autoFill ?? DRAFT_DEFAULTS.autoFill,
  };
}
