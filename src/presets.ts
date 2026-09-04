/**
 * The draft formats an organiser can choose from when creating a room.
 *
 * A room keeps a copy of the format it was created with, rather than a
 * reference to the entry in this file. A draft already under way therefore keeps
 * the order both captains agreed to, even if somebody edits the format here
 * while it is being played.
 *
 * See docs/PRESETS.md for how to add another one.
 */

import { parseScript } from "./script.js";
import type { TurnScript } from "./types.js";

export type DraftFormat = "5v5" | "3v3" | "custom";

export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly format: DraftFormat;
  /**
   * Whether this order has been confirmed as the one really used in game.
   * Anything unconfirmed must never be offered to a tournament as standard.
   */
  readonly official: boolean;
  readonly script: TurnScript;
  readonly notes?: string;
}

/**
 * Formats we know are wanted but do not yet know the running order for.
 *
 * They are listed rather than guessed at. A draft tool that quietly runs the
 * wrong order is worse than one that admits it does not know.
 */
export const PENDING: readonly { readonly id: string; readonly format: DraftFormat; readonly blockedOn: string }[] = [];

function preset(
  id: string,
  name: string,
  format: DraftFormat,
  official: boolean,
  notation: string,
  notes?: string,
): Preset {
  const base = { id, name, format, official, script: parseScript(notation) };
  return notes === undefined ? base : { ...base, notes };
}

export const PRESETS: readonly Preset[] = [
  preset(
    "vg-5v5-standard",
    "Vainglory 5v5 Standard",
    "5v5",
    true,
    "Aban, Bban, Aban, Bban, Apick, Bpick x2, Apick x2, Bpick x2, Apick x2, Bpick",
    "Two bans each, then a snake pick order: 1-2-2-2-2-1. Five picks a side. " +
      "A team picking twice in a row does both in one turn: they choose two " +
      "heroes and lock them in together, on a single clock.",
  ),
  preset(
    "vg-3v3-standard",
    "Vainglory 3v3 Standard",
    "3v3",
    true,
    "Aban, Bban, Aban, Bban, Apick, Bpick x2, Apick x2, Bpick",
    "The 5v5 order with the pick snake cut short at three a side: two bans each, " +
      "then 1-2-2-1. Team A picks first, team B picks last. A team picking twice " +
      "in a row does both in one turn, on a single clock.",
  ),
];

/** What a room gets when the organiser does not choose a format. */
export const DEFAULT_PRESET_ID = "vg-5v5-standard";

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/**
 * Hands back a copy of a format for a room to keep.
 *
 * Asking for a format whose order is not yet known fails outright, and says why,
 * rather than quietly substituting a different one.
 */
export function resolveScript(id: string): TurnScript {
  const found = getPreset(id);
  if (found !== undefined) return [...found.script];

  const pending = PENDING.find((p) => p.id === id);
  if (pending !== undefined) {
    throw new Error(`Preset "${id}" is not available yet: ${pending.blockedOn}`);
  }
  throw new Error(`Unknown preset "${id}". Known: ${PRESETS.map((p) => p.id).join(", ")}.`);
}

/** The format used when the organiser expresses no preference. */
export function defaultScript(): TurnScript {
  return resolveScript(DEFAULT_PRESET_ID);
}

