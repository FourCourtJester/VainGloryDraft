/**
 * What a team is telling its own captain.
 *
 * Plenty of teams are not in voice chat. Without something like this the
 * person picking is guessing at what everybody else wants, and the first
 * anybody hears about it is after the draft.
 *
 * A player marks something with one of the draft's actions — "I want to pick
 * this", "I'd ban that". The captain sees the marks, decides, and still does
 * the choosing. Nobody's mark takes a turn or spends the clock.
 *
 * Marks are visible to that team only. Unlike a staged choice — which is
 * seconds from being public anyway — a suggestion says what a side intends
 * several turns ahead, so other teams and the spectators never see them.
 */

import type { ActionId, Team } from "../types.js";

export interface Suggestion {
  readonly memberId: string;
  readonly team: Team;
  readonly itemId: string;
  /** Which action they are suggesting. */
  readonly intent: ActionId;
}

/**
 * Turns a mark on or off.
 *
 * One player can mark as many things as they like, but each only one way —
 * marking it the other way replaces the first, since that is plainly what they
 * meant.
 */
export function toggle(suggestions: readonly Suggestion[], suggestion: Suggestion): readonly Suggestion[] {
  const same = (s: Suggestion): boolean => s.memberId === suggestion.memberId && s.itemId === suggestion.itemId;
  const existing = suggestions.find(same);
  const without = suggestions.filter((s) => !same(s));
  // Marking it the same way again means "never mind".
  return existing?.intent === suggestion.intent ? without : [...without, suggestion];
}

/** Everything one player has marked, so their own view can show it back to them. */
export function byMember(suggestions: readonly Suggestion[], memberId: string): readonly Suggestion[] {
  return suggestions.filter((s) => s.memberId === memberId);
}

export interface ItemSuggestions {
  readonly itemId: string;
  /** Who asked for what, by action: everybody who wants it picked, everybody who would ban it. */
  readonly by: Readonly<Record<ActionId, readonly string[]>>;
  /** How many marks it has in all, which is the order a captain reads them in. */
  readonly total: number;
}

/**
 * One side's marks, gathered per item and ordered by how many people agree —
 * which is the order the captain wants to read them in.
 *
 * Anything nobody can have any more drops out: a suggestion about something
 * already gone is noise at exactly the moment there is no time for it.
 */
export function forTeam(
  suggestions: readonly Suggestion[],
  team: Team,
  nameOf: (memberId: string) => string,
  stillAvailable: (itemId: string) => boolean,
): readonly ItemSuggestions[] {
  const byItem = new Map<string, Record<ActionId, string[]>>();

  for (const suggestion of suggestions) {
    if (suggestion.team !== team || !stillAvailable(suggestion.itemId)) continue;
    const entry = byItem.get(suggestion.itemId) ?? {};
    (entry[suggestion.intent] ??= []).push(nameOf(suggestion.memberId));
    byItem.set(suggestion.itemId, entry);
  }

  return [...byItem.entries()]
    .map(([itemId, by]) => ({ itemId, by, total: Object.values(by).reduce((sum, names) => sum + names.length, 0) }))
    .sort((a, b) => b.total - a.total);
}

/** Drops everything a player marked, for when they leave for good. */
export function forget(suggestions: readonly Suggestion[], memberId: string): readonly Suggestion[] {
  return suggestions.filter((s) => s.memberId !== memberId);
}
