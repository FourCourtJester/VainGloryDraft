/**
 * The account of a draft, in the order it happened.
 *
 * A room keeps its draft after the draft is over, so a captain, an organiser or
 * anyone with a link can open it again days later and read back exactly how it
 * went: who removed what, in what order, what the clock chose because somebody
 * ran out of time, and how long each side sat on a decision.
 *
 * Nothing extra is stored to make this work. It is all read back out of the
 * choices the draft already recorded as it played, so a room that was
 * interrupted and picked up again reads the same as one nobody ever touched.
 */

import { isComplete } from "./engine.js";
import type { ActionId, DraftState, Team } from "./types.js";

export interface RecordedTurn {
  /** Which turn of the draft this was, counting from one. Teams on a blind turn share it. */
  readonly number: number;
  /** Who chose. Null when the draft took what was left. */
  readonly team: Team | null;
  readonly action: ActionId;
  readonly items: readonly string[];
  /** True when the engine chose, because the team ran out of time or nobody plays the turn. */
  readonly auto: boolean;
  /** When it was settled, where the room recorded it. */
  readonly at: number | null;
  /** How long the team took over it, from the moment the turn began. */
  readonly tookMs: number | null;
}

export interface DraftRecord {
  readonly complete: boolean;
  readonly turns: readonly RecordedTurn[];
  /** How long the whole draft ran, first turn to last. */
  readonly durationMs: number | null;
  /** How many things each team lost to the clock rather than choosing. */
  readonly autoCounts: Readonly<Record<Team, number>>;
}

export function draftRecord(state: DraftState, startedAt: number | null = null): DraftRecord {
  const turns: RecordedTurn[] = [];
  // Every team on a turn starts from the same moment: when the one before it
  // was revealed.
  let turnBegan = startedAt;
  let index = -1;
  let endedAt: number | null = null;

  for (const selection of state.committed) {
    if (selection.index !== index) {
      if (endedAt !== null) turnBegan = endedAt;
      index = selection.index;
      endedAt = null;
    }
    const tookMs =
      selection.at !== null && turnBegan !== null && selection.team !== null
        ? Math.max(0, selection.at - turnBegan)
        : null;
    if (selection.at !== null && (endedAt === null || selection.at > endedAt)) endedAt = selection.at;
    turns.push({
      number: selection.index + 1,
      team: selection.team,
      action: selection.action,
      items: selection.items,
      auto: selection.auto,
      at: selection.at,
      tookMs,
    });
  }

  // Earliest and latest rather than first and last in the list: on a blind
  // turn the team listed first is not necessarily the one that chose first.
  const times = turns.flatMap((turn) => (turn.at === null ? [] : [turn.at]));
  const first = times.length === 0 ? null : Math.min(...times);
  const last = times.length === 0 ? null : Math.max(...times);

  const autoCounts: Record<Team, number> = Object.fromEntries(state.config.teams.map((team) => [team.id, 0]));
  for (const turn of turns) {
    if (turn.auto && turn.team !== null) autoCounts[turn.team] = (autoCounts[turn.team] ?? 0) + turn.items.length;
  }

  return {
    complete: isComplete(state),
    turns,
    durationMs: first !== null && last !== null ? last - first : null,
    autoCounts,
  };
}
