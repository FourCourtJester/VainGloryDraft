import { useEffect, useState } from "react";
import type { CatalogFilter, CatalogItem, Terms } from "../../src/game.js";
import type { ActionDefinition, TeamDefinition } from "../../src/types.js";

/** A format, as the front door describes it. */
export interface PresetSummary {
  readonly id: string;
  readonly name: string;
  readonly official: boolean;
  /** The order in shorthand, such as "A ban, B ban, A pick". */
  readonly format: string;
  readonly turns: number;
  readonly teams: readonly TeamDefinition[];
  readonly teamSize: number;
  readonly notes: string | null;
}

/** A game in a line or two, for choosing between them. */
export interface GameSummary {
  readonly id: string;
  readonly name: string;
  readonly terms: Terms;
  readonly defaults: {
    readonly preset: string;
    readonly mirror: boolean;
    readonly clock: { readonly perTurnMs: number; readonly bankMs: number };
  };
  readonly presets: readonly PresetSummary[];
}

/**
 * Everything a screen needs to draw a game's draft: what the things are
 * called, what each looks like, and which filters can be trusted.
 *
 * The rules themselves are not here. The room sends those with every update,
 * so a screen never holds a second copy of them to fall out of step.
 */
export interface GameView extends GameSummary {
  readonly teams: readonly TeamDefinition[];
  readonly actions: readonly ActionDefinition[];
  readonly items: readonly CatalogItem[];
  readonly note: string | null;
  readonly filters: readonly CatalogFilter[];
  /** Filters the game has but whose data is not trusted yet. */
  readonly unverifiedFilters: readonly string[];
}

/**
 * Fetches one game's catalog, once. Null while it is on its way; a game with
 * nothing in it if it cannot be had, so the draft still draws, by id.
 */
export function useGame(id: string | null): GameView | null {
  const [game, setGame] = useState<GameView | null>(null);
  useEffect(() => {
    if (id === null) return;
    let cancelled = false;
    void fetch(`/api/games/${encodeURIComponent(id)}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<GameView>;
      })
      .then((found) => {
        if (!cancelled) setGame(found);
      })
      .catch(() => {
        if (!cancelled) setGame(emptyGame(id));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return game;
}

function emptyGame(id: string): GameView {
  return {
    id,
    name: id,
    terms: { item: "item", items: "items" },
    defaults: { preset: "", mirror: false, clock: { perTurnMs: 30_000, bankMs: 60_000 } },
    presets: [],
    teams: [],
    actions: [],
    items: [],
    note: null,
    filters: [],
    unverifiedFilters: [],
  };
}
