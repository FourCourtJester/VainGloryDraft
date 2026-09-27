/**
 * The games this deployment offers.
 *
 * This is the one place that knows which packs exist. The engine and the rooms
 * never read a pack themselves; the front door looks a game up here when a
 * room is made and hands the room its rules. Adding a game is adding its folder
 * under `games/` and two lines below.
 *
 * Every pack is checked as it loads, so a broken one stops the worker from
 * starting at all rather than failing half-way through somebody's draft.
 */

import cs2Catalog from "../games/cs2/catalog.json" with { type: "json" };
import cs2 from "../games/cs2/game.json" with { type: "json" };
import vaingloryCatalog from "../games/vainglory/catalog.json" with { type: "json" };
import vainglory from "../games/vainglory/game.json" with { type: "json" };
import type { Game } from "./game.js";
import { loadGame } from "./game.js";

export const GAMES: readonly Game[] = [loadGame(vainglory, vaingloryCatalog), loadGame(cs2, cs2Catalog)];

export function getGame(id: string): Game | undefined {
  return GAMES.find((game) => game.id === id);
}
