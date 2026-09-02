/**
 * Named turn scripts.
 *
 * A room stores the *resolved array*, never the preset id: a draft in progress
 * must not change because someone edited a preset afterwards.
 *
 * ── Blocker ───────────────────────────────────────────────────────────────────
 * The real in-game Vainglory ban/pick orders have not been supplied yet, and
 * they are not guessable. `vg-5v5-standard` and `vg-3v3-standard` are therefore
 * declared in `PENDING` rather than filled in with something that looks right.
 * Adding them is a one-line data change once the order is known — see
 * docs/PRESETS.md.
 * ─────────────────────────────────────────────────────────────────────────────
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
export const PENDING: readonly { readonly id: string; readonly format: DraftFormat; readonly blockedOn: string }[] = [
  { id: "vg-5v5-standard", format: "5v5", blockedOn: "Real in-game 5v5 ban/pick order not supplied." },
  { id: "vg-3v3-standard", format: "3v3", blockedOn: "Real in-game 3v3 ban/pick order not supplied." },
];

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

/**
 * Development and demo scripts only. Named `example-*` deliberately so nothing
 * here can be mistaken for a competitive format.
 */
export const PRESETS: readonly Preset[] = [
  preset(
    "example-3v3-snake",
    "Example 3v3 (placeholder)",
    "3v3",
    false,
    "Aban, Bban, Apick, Bpick x2, Apick x2, Bpick",
    "Invented for development. Replace with vg-3v3-standard once the real order is known.",
  ),
  preset(
    "example-5v5-snake",
    "Example 5v5 (placeholder)",
    "5v5",
    false,
    "Aban, Bban, Aban, Bban, Apick, Bpick x2, Apick x2, Bpick x2, Apick x2, Bpick",
    "Invented for development. Replace with vg-5v5-standard once the real order is known.",
  ),
];

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

export function describePreset(p: Preset): string {
  return `${p.name} [${p.format}${p.official ? "" : ", placeholder"}]: ${formatScript(p.script)}`;
}
