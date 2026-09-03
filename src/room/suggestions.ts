/**
 * What a team is telling its own captain.
 *
 * Most of these players are not in voice chat. Without something like this the
 * person picking is guessing at what four other people want to play, and the
 * first anybody hears about it is after the draft.
 *
 * A player marks a hero they want to play, or one they would rather see banned.
 * The captain sees both, decides, and still does the picking. Nobody's mark
 * takes a turn or spends the clock.
 *
 * Marks are visible to that team only. Unlike a staged hero — which is seconds
 * from being public anyway — a suggestion says what a side intends several turns
 * ahead, so the other team and the spectators never see them.
 */

import type { Team } from "../types.js";

export type Intent = "want" | "ban";

export interface Suggestion {
  readonly memberId: string;
  readonly team: Team;
  readonly heroId: string;
  readonly intent: Intent;
}

/**
 * Turns a mark on or off.
 *
 * One player can want one hero and ask to ban another, but not both about the
 * same hero — marking it the other way replaces the first, since that is
 * plainly what they meant.
 */
export function toggle(
  suggestions: readonly Suggestion[],
  suggestion: Suggestion,
): readonly Suggestion[] {
  const same = (s: Suggestion): boolean => s.memberId === suggestion.memberId && s.heroId === suggestion.heroId;
  const existing = suggestions.find(same);
  const without = suggestions.filter((s) => !same(s));
  // Marking it the same way again means "never mind".
  return existing?.intent === suggestion.intent ? without : [...without, suggestion];
}

/** Everything one player has marked, so their own view can show it back to them. */
export function byMember(suggestions: readonly Suggestion[], memberId: string): readonly Suggestion[] {
  return suggestions.filter((s) => s.memberId === memberId);
}

export interface HeroSuggestions {
  readonly heroId: string;
  /** Who wants to play it. */
  readonly want: readonly string[];
  /** Who would rather it were banned. */
  readonly ban: readonly string[];
}

/**
 * One side's marks, gathered per hero and ordered by how many people agree —
 * which is the order the captain wants to read them in.
 *
 * Heroes nobody can have any more drop out: a suggestion about a hero that is
 * already gone is noise at exactly the moment there is no time for it.
 */
export function forTeam(
  suggestions: readonly Suggestion[],
  team: Team,
  nameOf: (memberId: string) => string,
  stillAvailable: (heroId: string) => boolean,
): readonly HeroSuggestions[] {
  const byHero = new Map<string, { want: string[]; ban: string[] }>();

  for (const suggestion of suggestions) {
    if (suggestion.team !== team || !stillAvailable(suggestion.heroId)) continue;
    const entry = byHero.get(suggestion.heroId) ?? { want: [], ban: [] };
    entry[suggestion.intent].push(nameOf(suggestion.memberId));
    byHero.set(suggestion.heroId, entry);
  }

  return [...byHero.entries()]
    .map(([heroId, entry]) => ({ heroId, want: entry.want, ban: entry.ban }))
    .sort((a, b) => b.want.length + b.ban.length - (a.want.length + a.ban.length));
}

/** Drops everything a player marked, for when they leave for good. */
export function forget(suggestions: readonly Suggestion[], memberId: string): readonly Suggestion[] {
  return suggestions.filter((s) => s.memberId !== memberId);
}
