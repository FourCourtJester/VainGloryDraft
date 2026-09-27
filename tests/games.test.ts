/**
 * Every pack that ships, checked the same way, plus the checks a pack has to
 * pass to load at all.
 *
 * Nothing here knows which games exist beyond the registry. A new pack is
 * covered by these tests the moment it is added.
 */

import { describe, expect, it } from "vitest";
import { createDraft, isComplete, resolveTimeout } from "../src/engine.js";
import { allItemIds, loadGame, presetOf, teamsFrom, usableFilters } from "../src/game.js";
import { GAMES, getGame } from "../src/games.js";
import { validateScript } from "../src/script.js";
import { must } from "./helpers.js";

describe("the packs that ship", () => {
  it("all load, and each is found by its own id", () => {
    expect(GAMES.length).toBeGreaterThanOrEqual(2);
    for (const game of GAMES) expect(getGame(game.id)).toBe(game);
    expect(new Set(GAMES.map((game) => game.id)).size).toBe(GAMES.length);
  });

  it.each(GAMES.map((game) => [game.id, game] as const))("%s: every format plays out to the end", (_id, game) => {
    for (const preset of game.presets) {
      const vocab = { teams: preset.teams.map((team) => team.id), actions: game.actions };
      expect(validateScript(preset.script, vocab)).toEqual([]);
      let state = must(
        createDraft({
          teams: preset.teams,
          actions: game.actions,
          script: preset.script,
          pool: allItemIds(game),
          mirror: game.defaults.mirror,
          seed: preset.id,
        }),
      );
      while (!isComplete(state)) state = must(resolveTimeout(state));
      const all = state.committed.flatMap((selection) => selection.items);
      if (!game.defaults.mirror) expect(new Set(all).size).toBe(all.length);
    }
  });

  it.each(GAMES.map((game) => [game.id, game] as const))("%s: defaults to one of its own formats", (_id, game) => {
    expect(presetOf(game, game.defaults.preset)).toBeDefined();
  });

  it.each(GAMES.map((game) => [game.id, game] as const))("%s: only points at pictures that exist", async (_id, game) => {
    // Checked from the folder the app serves, since a path to nothing is a
    // broken tile rather than a missing one.
    const { existsSync } = await import(/* @vite-ignore */ "node:fs" as string);
    for (const item of game.catalog.items) {
      if (item.image !== null) expect(existsSync(`client/public${item.image}`), item.image).toBe(true);
    }
  });
});

describe("a Counter-Strike map veto", () => {
  const cs2 = getGame("cs2")!;

  it("ends with the map nobody banned or picked", () => {
    const preset = presetOf(cs2, "cs2-bo3")!;
    let state = must(
      createDraft({
        teams: preset.teams,
        actions: cs2.actions,
        script: preset.script,
        pool: allItemIds(cs2),
        mirror: false,
        seed: "veto",
      }),
    );
    while (!isComplete(state)) state = must(resolveTimeout(state));
    const decider = state.committed.at(-1)!;
    expect(decider.team).toBeNull();
    const before = state.committed.slice(0, -1).flatMap((selection) => selection.items);
    expect(allItemIds(cs2).filter((id) => !before.includes(id))).toEqual(decider.items);
  });

  it("is run by the two captains, not two full teams", () => {
    for (const preset of cs2.presets) expect(preset.teamSize).toBe(1);
  });
});

describe("loading a pack", () => {
  const game = {
    id: "demo",
    name: "Demo",
    terms: { item: "card", items: "cards" },
    teams: [
      { id: "A", name: "Left" },
      { id: "B", name: "Right" },
    ],
    actions: [
      { id: "ban", label: "Ban", past: "banned", effect: "remove" },
      { id: "pick", label: "Pick", past: "picked", effect: "take" },
    ],
    defaults: { preset: "one", perTurnMs: 20_000, bankMs: 0 },
    presets: [{ id: "one", name: "One", official: true, script: "A ban, B ban, A pick, B pick" }],
  };
  const catalog = {
    filters: [{ key: "colour", label: "Colour", values: ["red", "blue", "green"], verified: true }],
    items: ["a", "b", "c", "d"].map((id, index) => ({
      id,
      name: id.toUpperCase(),
      image: null,
      tags: { colour: [index % 2 === 0 ? "red" : "blue"] },
    })),
  };

  it("reads a well-formed pack", () => {
    const loaded = loadGame(game, catalog);
    expect(loaded.presets[0]?.teamSize).toBe(1);
    expect(loaded.defaults).toEqual({ preset: "one", mirror: false, clock: { perTurnMs: 20_000, bankMs: 0 } });
  });

  it("offers only verified filters, and only the values something carries", () => {
    expect(usableFilters(loadGame(game, catalog))).toEqual([
      { key: "colour", label: "Colour", values: ["red", "blue"], verified: true },
    ]);
    const unverified = { ...catalog, filters: [{ ...catalog.filters[0]!, verified: false }] };
    expect(usableFilters(loadGame(game, unverified))).toEqual([]);
  });

  it("refuses a format the pool cannot run", () => {
    const small = { ...catalog, items: catalog.items.slice(0, 3) };
    expect(() => loadGame(game, small)).toThrow(/at least 4/);
  });

  it("refuses a format using a team or an action the game does not have", () => {
    const bad = { ...game, presets: [{ ...game.presets[0]!, script: "C ban" }] };
    expect(() => loadGame(bad, catalog)).toThrow(/Cannot parse turn 1/);
  });

  it("refuses a tag value the filter does not allow, rather than inventing a category", () => {
    const stray = { ...catalog, items: [...catalog.items, { id: "e", name: "E", image: null, tags: { colour: ["mauve"] } }] };
    expect(() => loadGame(game, stray)).toThrow(/"mauve" is not one of the colour values/);
  });

  it("lists every problem at once, not just the first", () => {
    const broken = { ...game, id: "Bad Id", teams: [{ id: "remaining", name: "X" }], actions: [] };
    let message = "";
    try {
      loadGame(broken, { items: [] });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/id "Bad Id"/);
    expect(message).toMatch(/no team can be called it/);
    expect(message).toMatch(/actions must list/);
    expect(message).toMatch(/catalog items/);
  });

  it("keeps a team from taking a word the room already uses", () => {
    expect(() => loadGame({ ...game, teams: [{ id: "Spectator", name: "S" }, game.teams[1]!] }, catalog)).toThrow(
      /taken by the people watching/,
    );
  });

  it("reads a room's own teams by the same rules, and caps how many", () => {
    expect(teamsFrom([{ id: "Red", name: "Red" }]).teams).toEqual([{ id: "Red", name: "Red" }]);
    expect(teamsFrom([{ id: "1bad", name: "x" }]).teams).toBeNull();
    const many = Array.from({ length: 17 }, (_, i) => ({ id: `T${i}`, name: `T${i}` }));
    expect(teamsFrom(many).problems.join(" ")).toMatch(/at most 16/);
  });

  it("lets a format bring its own teams", () => {
    const threeWay = {
      ...game,
      presets: [
        ...game.presets,
        {
          id: "three",
          name: "Three",
          official: false,
          script: "X pick, Y pick, Z pick",
          teams: [
            { id: "X", name: "X" },
            { id: "Y", name: "Y" },
            { id: "Z", name: "Z" },
          ],
        },
      ],
    };
    expect(presetOf(loadGame(threeWay, catalog), "three")?.teams.map((team) => team.id)).toEqual(["X", "Y", "Z"]);
  });
});
