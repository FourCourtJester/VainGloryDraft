/**
 * What is particular to the Vainglory pack: its formats and its roster.
 *
 * These are facts about one game's data, checked where that data lives. The
 * engine is tested elsewhere without it.
 */

import { describe, expect, it } from "vitest";
import { presetOf } from "../src/game.js";
import { getGame } from "../src/games.js";
import { deriveTotals, formatScript } from "../src/script.js";

const game = getGame("vainglory")!;
const script = (id: string) => presetOf(game, id)!.script;

describe("Vainglory formats", () => {
  it("ships the supplied 5v5 order", () => {
    expect(formatScript(script("vg-5v5-standard"))).toBe(
      "A ban, B ban, A ban, B ban, A pick, B pick x2, A pick x2, B pick x2, A pick x2, B pick",
    );
  });

  it("gives the 5v5 standard two bans and five picks a side", () => {
    const totals = deriveTotals(script("vg-5v5-standard"), game.actions);
    expect(totals.turns).toBe(10);
    expect(totals.byTeam.A).toEqual({ ban: 2, pick: 5 });
    expect(totals.byTeam.B).toEqual({ ban: 2, pick: 5 });
    expect(presetOf(game, "vg-5v5-standard")!.teamSize).toBe(5);
  });

  it("ships the 3v3 order as the 5v5 shape cut short at three a side", () => {
    expect(formatScript(script("vg-3v3-standard"))).toBe(
      "A ban, B ban, A ban, B ban, A pick, B pick x2, A pick x2, B pick",
    );
    const totals = deriveTotals(script("vg-3v3-standard"), game.actions);
    expect(totals.turns).toBe(8);
    expect(totals.byTeam.A).toEqual({ ban: 2, pick: 3 });
    expect(totals.byTeam.B).toEqual({ ban: 2, pick: 3 });
  });

  it("gives team A the first pick and team B the last, in both formats", () => {
    for (const id of ["vg-5v5-standard", "vg-3v3-standard"]) {
      const picks = script(id).filter((turn) => turn.action === "pick");
      expect(picks.at(0)?.teams).toEqual(["A"]);
      expect(picks.at(-1)?.teams).toEqual(["B"]);
    }
  });

  it("shares its opening with the 5v5 order, which is what makes it the same format", () => {
    // Compared one selection at a time rather than one turn at a time: the
    // threes stop partway through what the fives run as a double pick, so the
    // orders agree on who chooses when without agreeing on where turns end.
    const selections = (id: string): string[] =>
      script(id).flatMap((turn) => Array.from({ length: turn.count }, () => `${turn.teams.join("+")}${turn.action}`));
    const threes = selections("vg-3v3-standard");
    expect(selections("vg-5v5-standard").slice(0, threes.length)).toEqual(threes);
  });

  it("takes a double pick as one turn, so both heroes are locked in together", () => {
    // The order snakes, so a team sometimes picks twice in a row. Those two go
    // on one clock and one confirm: the captain chooses both, and may change
    // either until they lock the pair in. Giving each its own turn would hand a
    // double pick twice the thinking time of a single one.
    const doubles = script("vg-5v5-standard").filter((turn) => turn.count === 2);
    expect(doubles).toHaveLength(4);
    expect(doubles.every((turn) => turn.action === "pick")).toBe(true);
  });

  it("defaults a room to the 5v5 standard, on thirty seconds and a minute's reserve", () => {
    expect(game.defaults.preset).toBe("vg-5v5-standard");
    expect(game.defaults.clock).toEqual({ perTurnMs: 30_000, bankMs: 60_000 });
    expect(game.defaults.mirror).toBe(false);
  });

  it("ships only confirmed formats", () => {
    // A format nobody has confirmed must never be offered to a tournament as
    // the standard one.
    expect(game.presets.every((preset) => preset.official)).toBe(true);
  });
});

describe("Vainglory roster", () => {
  const heroes = game.catalog.items;
  const roles = game.catalog.filters.find((filter) => filter.key === "role")!;

  it("carries every hero, with a unique id and a name", () => {
    expect(heroes).toHaveLength(58);
    for (const hero of heroes) expect(hero.name.trim().length).toBeGreaterThan(0);
    expect(heroes.find((hero) => hero.id === "san-feng")?.name).toBe("San Feng");
  });

  it("knows the three roles a hero is drafted for", () => {
    // Confirmed by VGNA: a side fields one captain, one jungler and three
    // lanes, so "lane" is one role covering three seats.
    expect(roles.values).toEqual(["Captain", "Jungle", "Lane"]);
  });

  it("claims the role filter is verified only when every hero has a role", () => {
    // Roles are never guessed at. The flag is what lets captains filter by
    // role, so it must never claim more than the roster actually knows.
    const missing = heroes.filter((hero) => (hero.tags.role ?? []).length === 0);
    if (roles.verified) expect(missing).toEqual([]);
    else expect(missing.length).toBeGreaterThan(0);
  });

  it("has a portrait for every hero but Corpus", () => {
    expect(heroes.filter((hero) => hero.image === null).map((hero) => hero.id)).toEqual(["corpus"]);
  });
});
