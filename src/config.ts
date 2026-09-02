/**
 * Room defaults.
 *
 * Kept in one place so a decision lives in code rather than in whatever the
 * caller happened to pass. `DraftConfig` itself stays fully explicit — the
 * engine never guesses — and this is the single door rooms are created through.
 */

import type { AutoFillStrategy, DraftConfig, TurnScript } from "./types.js";

export interface DraftDefaults {
  readonly mirrorPicks: boolean;
  readonly autoFill: AutoFillStrategy;
}

/**
 * Mirror picks off: the common tournament rule, and a room can turn it on.
 *
 * Auto-fill random: confirmed as the rule for *every* timeout, not just a
 * partially staged multi-pick turn. Lowest-index would let a captain who wants
 * the first legal hero simply stall for it; seeded random cannot be played for,
 * and is still replayable from the room log.
 */
export const DRAFT_DEFAULTS: DraftDefaults = {
  mirrorPicks: false,
  autoFill: "random",
};

export interface RoomOptions {
  /** The resolved script array, never a preset id. */
  readonly script: TurnScript;
  readonly heroPool: readonly string[];
  /** Room seed. Must be unique per room, and stored: it is what makes auto-actions replayable. */
  readonly seed: string;
  readonly mirrorPicks?: boolean;
  readonly autoFill?: AutoFillStrategy;
}

export function draftConfig(options: RoomOptions): DraftConfig {
  return {
    script: options.script,
    heroPool: options.heroPool,
    seed: options.seed,
    mirrorPicks: options.mirrorPicks ?? DRAFT_DEFAULTS.mirrorPicks,
    autoFill: options.autoFill ?? DRAFT_DEFAULTS.autoFill,
  };
}
