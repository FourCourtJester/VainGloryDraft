/**
 * Named turn scripts.
 *
 * A room stores the *resolved array*, never the preset id: a draft in progress
 * must not change because someone edited a preset afterwards.
 *
 * `vg-5v5-standard` is the default. `vg-3v3-standard` is the same shape with the
 * pick snake cut short at three a side. See docs/PRESETS.md.
 */

import { formatScript, parseScript } from "./script.js";
import type { TurnScript } from "./types.js";

export type DraftFormat = "5v5" | "3v3" | "custom";

export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly format: DraftFormat;
  /**
   * True only for a script confirmed against the real in-game order. Anything
   * false is a placeholder for development and must not be offered to a
   * tournament as "standard".
   */
  readonly official: boolean;
  readonly script: TurnScript;
  readonly notes?: string;
}

/** Preset ids that are known to be needed but cannot be written yet. */
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
    "Aban, Bban, Aban, Bban, Apick, Bpick, Bpick, Apick, Apick, Bpick, Bpick, Apick, Apick, Bpick",
    "Two bans each, then a snake pick order: 1-2-2-2-2-1. Five picks a side. " +
      "Each pick is its own turn, so a team picking twice in a row gets two " +
      "clocks and two confirms rather than staging both together.",
  ),
  preset(
    "vg-3v3-standard",
    "Vainglory 3v3 Standard",
    "3v3",
    true,
    "Aban, Bban, Aban, Bban, Apick, Bpick, Bpick, Apick, Apick, Bpick",
    "The 5v5 order with the pick snake cut short at three a side: two bans each, " +
      "then 1-2-2-1. Team A picks first, team B picks last. Each pick is its own turn.",
  ),
];

/** Offered when a room is created without a choice. */
export const DEFAULT_PRESET_ID = "vg-5v5-standard";

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/**
 * Resolve a preset to the array a room should store. Throws on an id that is
 * merely pending, with the reason, rather than silently falling back.
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

/** The script a room gets if the organiser picks nothing. */
export function defaultScript(): TurnScript {
  return resolveScript(DEFAULT_PRESET_ID);
}

export function describePreset(p: Preset): string {
  return `${p.name} [${p.format}${p.official ? "" : ", placeholder"}]: ${formatScript(p.script)}`;
}
