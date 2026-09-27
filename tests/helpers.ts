/**
 * The vocabulary most tests draft with: two teams, a ban that removes and a
 * pick that takes. It is written out here rather than read from a game's pack,
 * because the engine is meant to work from whatever it is handed — and a test
 * that leaned on a pack could not tell a generic engine from one that only
 * happens to fit the pack.
 */

import { parseScript } from "../src/script.js";
import type { ActionDefinition, Result, TeamDefinition, TurnScript } from "../src/types.js";

export const TEAMS: readonly TeamDefinition[] = [
  { id: "A", name: "Team A" },
  { id: "B", name: "Team B" },
];

export const ACTIONS: readonly ActionDefinition[] = [
  { id: "ban", label: "Ban", past: "banned", effect: "remove" },
  { id: "pick", label: "Pick", past: "picked", effect: "take" },
];

export const VOCAB = { teams: TEAMS.map((team) => team.id), actions: ACTIONS };

/** A format in shorthand, read with the two-team vocabulary above. */
export function script(notation: string): TurnScript {
  return parseScript(notation, VOCAB);
}

export function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
