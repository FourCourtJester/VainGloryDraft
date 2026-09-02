/**
 * The extensibility hook.
 *
 * The engine does not know this file exists. State goes in, events come out, and
 * consumers — a stats panel, a broadcast overlay, an outbound webhook — subscribe
 * here. Adding one is never surgery on the engine.
 */

import { currentTurn, currentTurnIndex, isComplete, picksOf, bansOf } from "./engine.js";
import type { DraftState, Team, Turn } from "./types.js";

export type DraftEvent =
  | {
      readonly type: "pick";
      readonly team: Team;
      readonly heroes: readonly string[];
      readonly turnIndex: number;
      readonly auto: boolean;
    }
  | {
      readonly type: "ban";
      readonly team: Team;
      readonly heroes: readonly string[];
      readonly turnIndex: number;
      readonly auto: boolean;
    }
  | { readonly type: "turnChange"; readonly turnIndex: number; readonly turn: Turn }
  | {
      readonly type: "draftComplete";
      readonly picks: Readonly<Record<Team, readonly string[]>>;
      readonly bans: Readonly<Record<Team, readonly string[]>>;
    };

export type DraftEventType = DraftEvent["type"];

/**
 * Events implied by moving from `prev` to `next`. Derived by comparison rather
 * than emitted from inside the engine, so a state restored from storage produces
 * the same stream as one built live.
 */
export function diffEvents(prev: DraftState, next: DraftState): readonly DraftEvent[] {
  const events: DraftEvent[] = [];

  for (let i = prev.committed.length; i < next.committed.length; i++) {
    const committed = next.committed[i]!;
    events.push({
      type: committed.action,
      team: committed.team,
      heroes: committed.heroes,
      turnIndex: committed.index,
      auto: committed.auto,
    });
  }

  if (next.committed.length !== prev.committed.length) {
    const turn = currentTurn(next);
    if (turn !== null) {
      events.push({ type: "turnChange", turnIndex: currentTurnIndex(next), turn });
    } else if (isComplete(next) && !isComplete(prev)) {
      events.push({
        type: "draftComplete",
        picks: { A: picksOf(next, "A"), B: picksOf(next, "B") },
        bans: { A: bansOf(next, "A"), B: bansOf(next, "B") },
      });
    }
  }

  return events;
}

export type DraftEventHandler = (event: DraftEvent) => void;

/** Minimal pub/sub. A throwing subscriber must not take down the draft. */
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

  /** Subscribe to one kind of event only. */
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
          this.#onError(error, event);
        }
      }
    }
  }

  get size(): number {
    return this.#handlers.size;
  }
}
