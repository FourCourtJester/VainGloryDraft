/**
 * Announcements about what just happened in a draft: something chosen, a new
 * turn on the clock, a finished draft.
 *
 * This is how anything else in the world finds out about a draft without
 * needing to understand how drafting works. A panel showing statistics for a
 * hero the moment it is picked, a scoreboard for a stream, a message posted to
 * a tournament's chat — each of those listens here, and none of them requires
 * the draft rules to be touched.
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

export type DraftEventHandler = (event: DraftEvent) => void;

/**
 * Keeps the list of things listening for draft announcements and passes each one
 * along.
 *
 * A listener that breaks is not allowed to disturb the draft — an outside site
 * being slow or down should never be the reason a tournament stops.
 */
export class DraftEventBus {
  #handlers = new Set<DraftEventHandler>();
  #onError: (error: unknown, event: DraftEvent) => void;

  constructor(onError: (error: unknown, event: DraftEvent) => void = () => {}) {
    this.#onError = onError;
  }

  subscribe(handler: DraftEventHandler): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  /** Listen for just one kind of announcement, such as choices but not turn changes. */
  on<T extends DraftEventType>(type: T, handler: (event: Extract<DraftEvent, { type: T }>) => void): () => void {
    return this.subscribe((event) => {
      if (event.type === type) handler(event as Extract<DraftEvent, { type: T }>);
    });
  }

  publish(events: readonly DraftEvent[]): void {
    for (const event of events) {
      for (const handler of [...this.#handlers]) {
        try {
          handler(event);
        } catch (error) {
          // A broken listener is reported and then ignored; the draft carries on.
          this.#onError(error, event);
        }
      }
    }
  }

  get size(): number {
    return this.#handlers.size;
  }
}
