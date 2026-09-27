/**
 * A game, as the engine sees one: a pack of data and nothing else.
 *
 * Everything that makes one game's draft different from another's lives in its
 * pack — what the teams are called, what the things being drafted are, what
 * each kind of turn does, the formats people actually play, and how long the
 * clock gives. The engine itself is never told which game it is running; a room
 * is handed the rules out of a pack when it is made, and keeps its own copy.
 *
 * A pack is two files in `games/<id>/`:
 *
 * - `game.json`, written by hand: teams, actions, formats, defaults.
 * - `catalog.json`, usually written by an import script: everything that can be
 *   drafted, with names, pictures and tags.
 *
 * Both are checked here, all at once, and a pack with anything wrong in it is
 * refused with every problem listed. A pack that loads is one the engine can
 * run; that is the whole contract. See docs/GAMES.md for how to write one.
 */

import { REMAINING, canRun, parseScript, playersPerTeam } from "./script.js";
import type { TimerRules } from "./timer.js";
import type { ActionDefinition, TeamDefinition, TurnScript } from "./types.js";

/** What a game calls the things being drafted: "hero" and "heroes", "map" and "maps". */
export interface Terms {
  readonly item: string;
  readonly items: string;
}

export interface Preset {
  readonly id: string;
  readonly name: string;
  /**
   * Whether this order has been confirmed as the one really played. Anything
   * unconfirmed must never be offered to a tournament as standard.
   */
  readonly official: boolean;
  readonly script: TurnScript;
  /** The same order in shorthand, as it was written. */
  readonly notation: string;
  /** The teams this format is played by: its own, or the game's. */
  readonly teams: readonly TeamDefinition[];
  /** How many players a side waits for before the ready check. */
  readonly teamSize: number;
  readonly notes: string | null;
}

export interface CatalogItem {
  readonly id: string;
  readonly name: string;
  /** Where its picture is served from. Null draws it as its name. */
  readonly image: string | null;
  /** Anything a screen can filter by, such as roles. Each tag may hold several values. */
  readonly tags: Readonly<Record<string, readonly string[]>>;
}

/**
 * A way of narrowing the pool on screen, such as by role.
 *
 * A filter is only offered once its data is known to be right. Captains filter
 * constantly with a clock running, and a filter that quietly hides the thing
 * somebody was looking for is worse than no filter at all.
 */
export interface CatalogFilter {
  /** Which tag it reads. */
  readonly key: string;
  readonly label: string;
  /** Every value the tag may take, in the order they are offered. */
  readonly values: readonly string[];
  readonly verified: boolean;
}

export interface Catalog {
  readonly note: string | null;
  readonly filters: readonly CatalogFilter[];
  readonly items: readonly CatalogItem[];
}

export interface Game {
  readonly id: string;
  readonly name: string;
  readonly terms: Terms;
  /** The teams a format plays with unless it names its own. */
  readonly teams: readonly TeamDefinition[];
  readonly actions: readonly ActionDefinition[];
  readonly defaults: {
    readonly preset: string;
    readonly mirror: boolean;
    readonly clock: TimerRules;
  };
  readonly presets: readonly Preset[];
  readonly catalog: Catalog;
}

const ID = /^[a-z0-9][a-z0-9-]*$/;
const MAX_TEAMS = 16;
const TEAM_ID = /^[A-Za-z][A-Za-z0-9]{0,11}$/;
const ACTION_ID = /^[a-z][a-z0-9-]*$/;

/**
 * Checks a pack and hands back the game it describes, or refuses it with every
 * problem found.
 */
export function loadGame(definition: unknown, catalog: unknown): Game {
  const problems: string[] = [];
  const game = readGame(definition, catalog, problems);
  if (problems.length > 0 || game === null) {
    const name = isRecord(definition) && typeof definition.id === "string" ? definition.id : "a game";
    throw new Error(`The pack for ${name} is not usable:\n  ${problems.join("\n  ")}`);
  }
  return game;
}

function readGame(definition: unknown, rawCatalog: unknown, problems: string[]): Game | null {
  if (!isRecord(definition)) {
    problems.push("game.json must hold an object.");
    return null;
  }
  const id = text(definition.id, "id", problems);
  if (id !== null && !ID.test(id)) problems.push(`id "${id}" must be lower-case letters, digits and hyphens.`);
  const name = text(definition.name, "name", problems);

  const terms = isRecord(definition.terms) ? definition.terms : {};
  const item = text(terms.item, "terms.item", problems);
  const items = text(terms.items, "terms.items", problems);

  const teams = readTeams(definition.teams, "teams", problems);
  const actions = readActions(definition.actions, problems);
  const catalog = readCatalog(rawCatalog, problems);

  const defaults = isRecord(definition.defaults) ? definition.defaults : {};
  const perTurnMs = positive(defaults.perTurnMs, "defaults.perTurnMs", problems);
  const bankMs = typeof defaults.bankMs === "number" && defaults.bankMs >= 0 ? defaults.bankMs : null;
  if (bankMs === null) problems.push("defaults.bankMs must be a number of milliseconds, zero or more.");
  const mirror = defaults.mirror === undefined ? false : defaults.mirror;
  if (typeof mirror !== "boolean") problems.push("defaults.mirror must be true or false.");

  const presets: Preset[] = [];
  if (!Array.isArray(definition.presets) || definition.presets.length === 0) {
    problems.push("presets must list at least one format.");
  } else if (teams !== null && actions !== null) {
    for (const [index, raw] of definition.presets.entries()) {
      const preset = readPreset(raw, index, teams, actions, catalog?.items.length ?? 0, mirror === true, problems);
      if (preset !== null) presets.push(preset);
    }
    const ids = presets.map((preset) => preset.id);
    if (new Set(ids).size !== ids.length) problems.push("Two presets share an id.");
  }

  const preset = text(defaults.preset, "defaults.preset", problems);
  if (preset !== null && presets.length > 0 && !presets.some((p) => p.id === preset)) {
    problems.push(`defaults.preset "${preset}" is not one of the presets.`);
  }

  if (
    problems.length > 0 ||
    id === null ||
    name === null ||
    item === null ||
    items === null ||
    teams === null ||
    actions === null ||
    catalog === null ||
    perTurnMs === null ||
    bankMs === null ||
    preset === null
  ) {
    return null;
  }

  return {
    id,
    name,
    terms: { item, items },
    teams,
    actions,
    defaults: { preset, mirror: mirror === true, clock: { perTurnMs, bankMs } },
    presets,
    catalog,
  };
}

function readTeams(raw: unknown, where: string, problems: string[]): readonly TeamDefinition[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push(`${where} must list at least one team.`);
    return null;
  }
  const teams: TeamDefinition[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!isRecord(entry)) {
      problems.push(`${where}[${index}] must be an object.`);
      continue;
    }
    const id = text(entry.id, `${where}[${index}].id`, problems);
    const name = text(entry.name, `${where}[${index}].name`, problems);
    if (id === null || name === null) continue;
    if (!TEAM_ID.test(id)) problems.push(`team id "${id}" must be a letter followed by up to eleven letters or digits.`);
    if (id.toLowerCase() === REMAINING) problems.push(`"${REMAINING}" is a word formats use, so no team can be called it.`);
    // A room tells a player from a watcher by that word, so a team cannot have it.
    if (id.toLowerCase() === "spectator") problems.push('"spectator" is taken by the people watching, so no team can be called it.');
    teams.push({ id, name });
  }
  const ids = teams.map((team) => team.id.toLowerCase());
  if (new Set(ids).size !== ids.length) problems.push(`Two of ${where} share an id.`);
  return teams;
}

function readActions(raw: unknown, problems: string[]): readonly ActionDefinition[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push("actions must list at least one action.");
    return null;
  }
  const actions: ActionDefinition[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!isRecord(entry)) {
      problems.push(`actions[${index}] must be an object.`);
      continue;
    }
    const id = text(entry.id, `actions[${index}].id`, problems);
    const label = text(entry.label, `actions[${index}].label`, problems);
    const past = text(entry.past, `actions[${index}].past`, problems);
    const effect = entry.effect;
    if (effect !== "remove" && effect !== "take") {
      problems.push(`actions[${index}].effect must be "remove" or "take".`);
      continue;
    }
    if (id === null || label === null || past === null) continue;
    if (!ACTION_ID.test(id)) problems.push(`action id "${id}" must be lower-case letters, digits and hyphens.`);
    if (id === REMAINING) problems.push(`"${REMAINING}" is a word formats use, so no action can be called it.`);
    actions.push({ id, label, past, effect });
  }
  const ids = actions.map((action) => action.id);
  if (new Set(ids).size !== ids.length) problems.push("Two actions share an id.");
  return actions;
}

function readPreset(
  raw: unknown,
  index: number,
  gameTeams: readonly TeamDefinition[],
  actions: readonly ActionDefinition[],
  poolSize: number,
  mirror: boolean,
  problems: string[],
): Preset | null {
  const where = `presets[${index}]`;
  if (!isRecord(raw)) {
    problems.push(`${where} must be an object.`);
    return null;
  }
  const id = text(raw.id, `${where}.id`, problems);
  const name = text(raw.name, `${where}.name`, problems);
  const notation = text(raw.script, `${where}.script`, problems);
  if (typeof raw.official !== "boolean") problems.push(`${where}.official must be true or false.`);
  if (raw.notes !== undefined && typeof raw.notes !== "string") problems.push(`${where}.notes must be text.`);
  const teams = raw.teams === undefined ? gameTeams : readTeams(raw.teams, `${where}.teams`, problems);
  if (id === null || name === null || notation === null || teams === null) return null;
  if (!ID.test(id)) problems.push(`preset id "${id}" must be lower-case letters, digits and hyphens.`);

  let script: TurnScript;
  try {
    script = parseScript(notation, { teams: teams.map((team) => team.id), actions });
  } catch (error) {
    problems.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  for (const problem of canRun(script, { teams: teams.map((team) => team.id), actions }, poolSize, mirror)) {
    problems.push(`${id}: ${problem.turnIndex === null ? "" : `turn ${problem.turnIndex + 1}: `}${problem.message}`);
  }

  let teamSize = playersPerTeam(script, actions);
  if (raw.teamSize !== undefined) {
    if (typeof raw.teamSize === "number" && Number.isInteger(raw.teamSize) && raw.teamSize >= 1 && raw.teamSize <= 10) {
      teamSize = raw.teamSize;
    } else {
      problems.push(`${id}: teamSize must be a whole number from 1 to 10.`);
    }
  }

  return {
    id,
    name,
    official: raw.official === true,
    script,
    notation,
    teams,
    teamSize,
    notes: typeof raw.notes === "string" ? raw.notes : null,
  };
}

function readCatalog(raw: unknown, problems: string[]): Catalog | null {
  if (!isRecord(raw)) {
    problems.push("catalog.json must hold an object.");
    return null;
  }

  const filters: CatalogFilter[] = [];
  if (raw.filters !== undefined && !Array.isArray(raw.filters)) problems.push("catalog filters must be a list.");
  for (const [index, entry] of (Array.isArray(raw.filters) ? raw.filters : []).entries()) {
    const where = `catalog filters[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${where} must be an object.`);
      continue;
    }
    const key = text(entry.key, `${where}.key`, problems);
    const label = text(entry.label, `${where}.label`, problems);
    const values = Array.isArray(entry.values) && entry.values.every((v) => typeof v === "string") ? entry.values : null;
    if (values === null) problems.push(`${where}.values must be a list of words.`);
    if (typeof entry.verified !== "boolean") problems.push(`${where}.verified must be true or false.`);
    if (key === null || label === null || values === null) continue;
    // `aliases` is only for the import script, which finds the tag in an
    // export under other names; the app has no use for it.
    if (entry.aliases !== undefined && !Array.isArray(entry.aliases)) problems.push(`${where}.aliases must be a list.`);
    filters.push({ key, label, values: values as string[], verified: entry.verified === true });
  }

  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    problems.push("catalog items must list at least one thing to draft.");
    return null;
  }
  const items: CatalogItem[] = [];
  for (const [index, entry] of raw.items.entries()) {
    const where = `catalog items[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${where} must be an object.`);
      continue;
    }
    const id = text(entry.id, `${where}.id`, problems);
    const name = text(entry.name, `${where}.name`, problems);
    if (id === null || name === null) continue;
    if (!ID.test(id)) problems.push(`item id "${id}" must be lower-case letters, digits and hyphens.`);
    const image = entry.image ?? null;
    if (image !== null && typeof image !== "string") problems.push(`${id}: image must be a path or null.`);

    const tags: Record<string, readonly string[]> = {};
    if (entry.tags !== undefined && !isRecord(entry.tags)) problems.push(`${id}: tags must be an object.`);
    for (const [key, value] of Object.entries(isRecord(entry.tags) ? entry.tags : {})) {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        problems.push(`${id}: tag "${key}" must be a list of words.`);
        continue;
      }
      // A value no filter allows is a mistake in whatever wrote the catalog,
      // not a new category, and would only be a filter option finding nothing.
      const filter = filters.find((f) => f.key === key);
      for (const v of value) {
        if (filter !== undefined && !filter.values.includes(v)) {
          problems.push(`${id}: "${v}" is not one of the ${filter.label.toLowerCase()} values (${filter.values.join(", ")}).`);
        }
      }
      tags[key] = value as string[];
    }
    items.push({ id, name, image: image as string | null, tags });
  }
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) problems.push("Two catalog items share an id.");

  return { note: typeof raw.note === "string" ? raw.note : null, filters, items };
}

/**
 * Reads a list of teams sent from outside — a room made with its own team
 * names, say — by the same rules a pack's teams are held to.
 */
export function teamsFrom(raw: unknown): { teams: readonly TeamDefinition[] | null; problems: readonly string[] } {
  const problems: string[] = [];
  // Every team is handed a code and a seat in the lobby, so a room asking for
  // hundreds of them is a mistake or worse.
  if (Array.isArray(raw) && raw.length > MAX_TEAMS) problems.push(`A room can have at most ${MAX_TEAMS} teams.`);
  const teams = readTeams(raw, "teams", problems);
  return { teams: problems.length === 0 ? teams : null, problems };
}

/** A game's format by id. */
export function presetOf(game: Game, id: string): Preset | undefined {
  return game.presets.find((preset) => preset.id === id);
}

/** Everything in a game that can be drafted, which is what a room drafts from unless told otherwise. */
export function allItemIds(game: Game): readonly string[] {
  return game.catalog.items.map((item) => item.id);
}

/**
 * The filters a screen can actually offer: those whose data is known to be
 * right, narrowed to the values something in the catalog carries. A value
 * nothing has yet would only be an option that finds nothing.
 */
export function usableFilters(game: Game): readonly CatalogFilter[] {
  return game.catalog.filters
    .filter((filter) => filter.verified)
    .map((filter) => {
      const used = new Set(game.catalog.items.flatMap((item) => item.tags[filter.key] ?? []));
      return { ...filter, values: filter.values.filter((value) => used.has(value)) };
    })
    .filter((filter) => filter.values.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, where: string, problems: string[]): string | null {
  if (typeof value === "string" && value.trim() !== "") return value;
  problems.push(`${where} must be some text.`);
  return null;
}

function positive(value: unknown, where: string, problems: string[]): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  problems.push(`${where} must be a number of milliseconds above zero.`);
  return null;
}
