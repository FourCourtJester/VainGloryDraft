/**
 * Announcements about what just happened in a draft: something chosen, a new
 * turn on the clock, a finished draft.
 *
 * These go out to everybody in the room with each update, which is how a
 * screen — or anything else connected to the room, such as an overlay for a
 * stream — hears what just happened without needing to understand how
 * drafting works or compare two states itself.
 *
 * Only confirmed actions are announced. A captain hovering over something, or
 * choosing it and changing their mind, is nobody else's business — and neither
 * is a team having confirmed a blind turn, until the whole turn is revealed.
 */

import { currentTurn, isComplete, summarise } from "./engine.js";
import type { DraftSummary } from "./engine.js";
import type { ActionId, DraftState, Team, Turn } from "./types.js";

export type DraftEvent =
  | {
      readonly type: "choice";
      /** Who chose. Null when the draft took what was left. */
      readonly team: Team | null;
      readonly action: ActionId;
      readonly items: readonly string[];
      readonly turnIndex: number;
      readonly auto: boolean;
    }
  | { readonly type: "turnChange"; readonly turnIndex: number; readonly turn: Turn }
  | { readonly type: "draftComplete"; readonly byTeam: DraftSummary["byTeam"] };

export type DraftEventType = DraftEvent["type"];

/**
 * Says what happened between one moment of a draft and the next, by comparing
 * the two.
 *
 * Working it out by comparison means a draft picked back up from storage
 * announces exactly what a draft running without interruption would have, so
 * anything listening cannot tell the difference and never misses an event.
 */
export function diffEvents(prev: DraftState, next: DraftState): readonly DraftEvent[] {
  const events: DraftEvent[] = [];

  for (let i = prev.committed.length; i < next.committed.length; i++) {
    const selection = next.committed[i]!;
    events.push({
      type: "choice",
      team: selection.team,
      action: selection.action,
      items: selection.items,
      turnIndex: selection.index,
      auto: selection.auto,
    });
  }

  if (next.turnIndex !== prev.turnIndex) {
    const turn = currentTurn(next);
    if (turn !== null) {
      events.push({ type: "turnChange", turnIndex: next.turnIndex, turn });
    } else if (isComplete(next) && !isComplete(prev)) {
      events.push({ type: "draftComplete", byTeam: summarise(next).byTeam });
    }
  }

  return events;
}
