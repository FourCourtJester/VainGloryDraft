/**
 * The account of a draft, in the order it happened.
 *
 * A room keeps its draft after the draft is over, so a captain, an organiser or
 * anyone with a link can open it again days later and read back exactly how it
 * went: who banned what, in what order, which heroes the clock chose because
 * somebody ran out of time, and how long each side sat on a decision.
 *
 * Nothing extra is stored to make this work. It is all read back out of the
 * turns the draft already recorded as it played, so a room that was interrupted
 * and picked up again reads the same as one nobody ever touched.
 */

import { isComplete } from "./engine.js";
import type { CommittedTurn, DraftState, Team } from "./types.js";

export interface RecordedTurn {
  /** Which turn of the draft this was, counting from one. */
  readonly number: number;
  readonly team: Team;
  readonly action: "pick" | "ban";
  readonly heroes: readonly string[];
  /** True when the clock chose, because the captain ran out of time. */
  readonly auto: boolean;
  /** When it was settled, where the room recorded it. */
  readonly at: number | null;
  /** How long this turn took, from the previous turn landing to this one. */
  readonly tookMs: number | null;
}

export interface DraftRecord {
  readonly complete: boolean;
  readonly turns: readonly RecordedTurn[];
  /** How long the whole draft ran, first turn to last. */
  readonly durationMs: number | null;
  /** How many heroes each side lost to the clock rather than choosing. */
  readonly autoCounts: Readonly<Record<Team, number>>;
}

export function draftRecord(state: DraftState, startedAt: number | null = null): DraftRecord {
  let previous = startedAt;
  const turns = state.committed.map((committed: CommittedTurn, index) => {
    const tookMs = committed.at !== null && previous !== null ? Math.max(0, committed.at - previous) : null;
    if (committed.at !== null) previous = committed.at;
    return {
      number: index + 1,
      team: committed.team,
      action: committed.action,
      heroes: committed.heroes,
      auto: committed.auto,
      at: committed.at,
      tookMs,
    };
  });

  const first = turns.find((turn) => turn.at !== null)?.at ?? null;
  const last = [...turns].reverse().find((turn) => turn.at !== null)?.at ?? null;

  const autoCounts = { A: 0, B: 0 };
  for (const turn of turns) {
    if (turn.auto) autoCounts[turn.team] += turn.heroes.length;
  }

  return {
    complete: isComplete(state),
    turns,
    durationMs: first !== null && last !== null ? last - first : null,
    autoCounts,
  };
}
