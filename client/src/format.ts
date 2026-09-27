import type { ActionDefinition, Team, TeamDefinition, Turn } from "../../src/types.js";

/**
 * Writes a length of time the way a countdown should read: minutes and seconds
 * normally, and tenths once it is down to the last few seconds and every moment
 * counts.
 */
export function clock(ms: number): string {
  const safe = Math.max(0, ms);
  // Settle on tenths before deciding which way to write it, or the last moment
  // before ten seconds rounds up and reads as "10.0".
  const tenths = Math.floor(safe / 100);
  if (tenths < 100) return (tenths / 10).toFixed(1);
  const seconds = Math.floor(tenths / 10);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Writes how long something took, for reading back a finished draft: seconds
 * while that is still readable, and minutes and seconds once it is not.
 */
export function duration(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 60_000) return `${(Math.round(safe / 100) / 10).toFixed(1)}s`;
  const seconds = Math.round(safe / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function teamName(teams: readonly TeamDefinition[], id: Team): string {
  return teams.find((team) => team.id === id)?.name ?? id;
}

export function actionOf(actions: readonly ActionDefinition[], id: string): ActionDefinition | undefined {
  return actions.find((action) => action.id === id);
}

/**
 * Which colour a team wears: its place in the draft, not its name, so any game's
 * teams are coloured the same way. The stylesheet has four; a fifth team would
 * share the first's.
 */
export function slotOf(teams: readonly TeamDefinition[], id: Team): string {
  return `t${Math.max(0, teams.findIndex((team) => team.id === id)) % 4}`;
}

/**
 * Says whose turn it is in words, such as "Team B · Pick 2".
 *
 * Written as who and what rather than as a sentence, because the actions are
 * whatever a game calls them and not every word turns into a verb neatly.
 */
export function describeTurn(turn: Turn, teams: readonly TeamDefinition[], actions: readonly ActionDefinition[]): string {
  const who = turn.teams.length === 0 ? "Remaining" : turn.teams.map((team) => teamName(teams, team)).join(" + ");
  const count = turn.count > 1 ? ` ${turn.count}` : "";
  return `${who} · ${verbFor(turn, actions)}${count}`;
}

/** The word for the confirm button, which is whatever the game calls this action. */
export function verbFor(turn: Turn, actions: readonly ActionDefinition[]): string {
  return actionOf(actions, turn.action)?.label ?? turn.action;
}

/** "3 picks", "1 ban" — counting a whole draft's worth of one action, for a footer. */
export function tally(count: number, action: ActionDefinition): string {
  const word = action.label.toLowerCase();
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
