/**
 * The front door.
 *
 * This is what a browser actually talks to. It makes new rooms and hands back
 * the links for them, serves the app itself, answers with the games on offer
 * and everything in each one, and sends everyone who opens a room link through
 * to the room they are looking for.
 *
 * It is also the only part of the worker that looks a game up. A room is made
 * from the rules this hands it and never reads a pack itself.
 *
 * A room's name is taken straight from its link, so everybody holding links to
 * the same draft arrives at the same room — the one that holds the real draft
 * and runs its clock.
 */

import type { Game } from "../src/game.js";
import { allItemIds, presetOf, teamsFrom, usableFilters } from "../src/game.js";
import { GAMES, getGame } from "../src/games.js";
import { parseAutoFill, parseTimerRules } from "../src/room/options.js";
import type { CreateRoomOptions } from "../src/room/room.js";
import type { RateVerdict } from "./gatekeeper.js";
import { credentialsMatch, generateToken } from "../src/room/tokens.js";
import { formatScript, parseScript } from "../src/script.js";
import type { TeamDefinition, TurnScript } from "../src/types.js";

export { DraftRoom } from "./draft-room.js";
export { Gatekeeper } from "./gatekeeper.js";

export interface Env {
  readonly DRAFT_ROOM: DurableObjectNamespace;
  readonly GATEKEEPER: DurableObjectNamespace;
  readonly ASSETS: Fetcher;
  /**
   * A key for whoever is trusted to make a lot of rooms — a tournament's own
   * bot, say. Callers who send it as `x-api-key` are not held to the limit
   * everybody else is. Left unset, everybody is treated the same.
   */
  readonly ROOM_CREATE_SECRET?: string;
  /**
   * Set to "true" to shut room-making to everybody but the key above, for a
   * deployment that is nobody's business but its owner's. Left unset, anyone
   * who finds the site can start a draft, which is how it is meant to be used.
   */
  readonly ROOM_CREATE_PRIVATE?: string;
}

interface CreateRoomRequest {
  /** Which game's pack to draft from. */
  readonly game?: string;
  /** One of that game's formats. Its default if neither this nor a script is given. */
  readonly preset?: string;
  /** A format written out by hand, used in place of a named one if both are given. */
  readonly script?: string;
  /** The teams, when they should differ from the format's: other names, or more of them. */
  readonly teams?: unknown;
  /** What can be drafted, when it should be less than the whole of the game's catalog. */
  readonly pool?: unknown;
  /** Whether more than one team may take the same thing. */
  readonly mirror?: boolean;
  readonly autoFill?: "random" | "lowestIndex";
  readonly perTurnMs?: number;
  readonly bankMs?: number;
  /** Where to POST the finished draft, for a bot that wants telling. */
  readonly callbackUrl?: string;
  /**
   * How many players a side waits for before the ready check. Defaults to what
   * the format says — five for a 5v5 hero draft, one for a map veto — so a room
   * normally works this out for itself. Set it to 1 for a draft where only the
   * captains turn up.
   */
  readonly teamSize?: number;
  /** Seconds a finished draft is kept before the room clears itself out. */
  readonly retentionSeconds?: number;
  /** Seconds a room that never started is kept. */
  readonly abandonAfterSeconds?: number;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/api/games") {
      return json({ games: GAMES.map(summariseGame) });
    }

    const gameRoute = /^\/api\/games\/([a-z0-9-]+)$/.exec(url.pathname);
    if (gameRoute !== null) {
      const game = getGame(gameRoute[1]!);
      return game === undefined ? json({ error: "No such game." }, 404) : json(describeGame(game));
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      return createRoom(request, env, url);
    }

    const room = /^\/api\/rooms\/([A-Za-z0-9_-]+)\/(ws|state|record)$/.exec(url.pathname);
    if (room !== null) {
      const [, roomId, route] = room;
      const stub = env.DRAFT_ROOM.get(env.DRAFT_ROOM.idFromName(roomId!));
      const forwarded = new URL(request.url);
      forwarded.pathname = `/${route!}`;
      const response = await stub.fetch(new Request(forwarded, request));
      return route === "ws" ? response : withCors(response);
    }

    // A room link is a page, not an API call: send back the app, which reads
    // the room and the link token out of the address it was opened with.
    if (/^\/r\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
      // Ask for the site's front page. Asking for the file by name would earn a
      // redirect that drops the link token on the way.
      return env.ASSETS.fetch(new Request(new URL("/", url), request));
    }

    return json({ error: "Not found." }, 404);
  },
} satisfies ExportedHandler<Env>;

/** Creates a draft and hands back the three links to share. */
async function createRoom(request: Request, env: Env, url: URL): Promise<Response> {
  // Anyone may start a draft. Whoever holds the key — a tournament's bot — is
  // trusted to make as many as it likes; everybody else gets an allowance, so
  // that one script cannot spend the whole site's day in a few seconds.
  const secret = env.ROOM_CREATE_SECRET;
  const trusted =
    typeof secret === "string" && secret !== "" && credentialsMatch(request.headers.get("x-api-key") ?? "", secret);

  if (!trusted) {
    if (env.ROOM_CREATE_PRIVATE === "true") {
      return json({ error: "Rooms can only be made by the tournament's own bot." }, 401);
    }
    const refusal = await checkAllowance(request, env);
    if (refusal !== null) return refusal;
  }

  let body: CreateRoomRequest = {};
  try {
    if (request.headers.get("content-type")?.includes("application/json") === true) {
      const parsed: unknown = await request.json();
      // "null" is valid JSON but has no settings on it to read, so treat it the
      // same as sending nothing at all.
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as CreateRoomRequest;
      }
    }
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  if (typeof body.game !== "string") {
    return json({ error: `Say which game: one of ${GAMES.map((game) => game.id).join(", ")}.` }, 400);
  }
  const game = getGame(body.game);
  if (game === undefined) {
    return json({ error: `No game called "${body.game}". Known: ${GAMES.map((g) => g.id).join(", ")}.` }, 400);
  }

  const { rules, problems } = parseTimerRules(body.perTurnMs, body.bankMs, game.defaults.clock);
  if (problems.length > 0) {
    return json({ error: problems.map((problem) => problem.message).join(" ") }, 400);
  }

  const teamSize = body.teamSize;
  if (teamSize !== undefined && (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > 10)) {
    return json({ error: "teamSize must be a whole number between 1 and 10." }, 400);
  }

  const callbackUrl = body.callbackUrl ?? undefined;
  if (callbackUrl !== undefined && !/^https:\/\//.test(callbackUrl)) {
    return json({ error: "callbackUrl must be an https address." }, 400);
  }

  const seconds = (value: unknown, max: number): number | undefined => {
    if (value === undefined) return undefined;
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max
      ? Math.round(value) * 1000
      : Number.NaN;
  };
  const retentionMs = seconds(body.retentionSeconds, 400 * 24 * 60 * 60);
  const abandonAfterMs = seconds(body.abandonAfterSeconds, 30 * 24 * 60 * 60);
  if (Number.isNaN(retentionMs) || Number.isNaN(abandonAfterMs)) {
    return json({ error: "retentionSeconds and abandonAfterSeconds must be positive, and not absurd." }, 400);
  }

  const format = chooseFormat(game, body);
  if ("error" in format) return json({ error: format.error }, 400);

  const pool = choosePool(game, body.pool);
  if ("error" in pool) return json({ error: pool.error }, 400);

  const options: CreateRoomOptions = {
    roomId: generateToken(8),
    game: game.id,
    teams: format.teams,
    actions: game.actions,
    script: format.script,
    pool: pool.items,
    mirror: typeof body.mirror === "boolean" ? body.mirror : game.defaults.mirror,
    autoFill: parseAutoFill(body.autoFill) ?? "random",
    rules,
    callbackUrl: callbackUrl ?? null,
    ...(teamSize === undefined ? (format.teamSize === undefined ? {} : { teamSize: format.teamSize }) : { teamSize }),
    ...(retentionMs === undefined ? {} : { retentionMs }),
    ...(abandonAfterMs === undefined ? {} : { abandonAfterMs }),
  };

  const stub = env.DRAFT_ROOM.get(env.DRAFT_ROOM.idFromName(options.roomId!));
  const created = await stub.fetch(new Request("https://draft/create", { method: "POST", body: JSON.stringify(options) }));
  if (!created.ok) return withCors(created);

  const { roomId, credentials } = (await created.json()) as {
    roomId: string;
    credentials: { codes: Record<string, string>; spectator: string };
  };

  // A team's link carries its code so that tapping it is enough, and the code
  // is handed back on its own for a bot that would rather read it out.
  return json({
    roomId,
    game: game.id,
    teams: format.teams,
    format: formatScript(format.script),
    codes: credentials.codes,
    links: {
      teams: Object.fromEntries(
        Object.entries(credentials.codes).map(([team, code]) => [team, `${url.origin}/r/${roomId}?code=${code}`]),
      ),
      spectator: `${url.origin}/r/${roomId}?token=${credentials.spectator}`,
      join: `${url.origin}/r/${roomId}`,
    },
  });
}

/**
 * Settles the teams and the turn order a room is made with: a format written
 * out by hand if there is one, otherwise one of the game's own. Either can be
 * played by teams other than the game's usual ones, if the request names them.
 */
function chooseFormat(
  game: Game,
  body: CreateRoomRequest,
): { teams: readonly TeamDefinition[]; script: TurnScript; teamSize: number | undefined } | { error: string } {
  let teams: readonly TeamDefinition[] | null = null;
  if (body.teams !== undefined) {
    const read = teamsFrom(body.teams);
    if (read.teams === null) return { error: read.problems.join(" ") };
    teams = read.teams;
  }

  if (body.script !== undefined) {
    if (typeof body.script !== "string") return { error: "script must be written out as text." };
    const playing = teams ?? game.teams;
    try {
      const script = parseScript(body.script, { teams: playing.map((team) => team.id), actions: game.actions });
      return { teams: playing, script, teamSize: undefined };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "That format could not be read." };
    }
  }

  const presetId = body.preset ?? game.defaults.preset;
  const preset = typeof presetId === "string" ? presetOf(game, presetId) : undefined;
  if (preset === undefined) {
    return { error: `${game.name} has no format "${String(presetId)}". Known: ${game.presets.map((p) => p.id).join(", ")}.` };
  }
  // Keep the format's own player count only while its own teams are playing it.
  return { teams: teams ?? preset.teams, script: [...preset.script], teamSize: teams === null ? preset.teamSize : undefined };
}

/** What a room drafts from: all of the game's catalog, or a part of it the request names. */
function choosePool(game: Game, raw: unknown): { items: readonly string[] } | { error: string } {
  const everything = allItemIds(game);
  if (raw === undefined) return { items: everything };
  if (!Array.isArray(raw) || !raw.every((id) => typeof id === "string")) {
    return { error: `pool must be a list of ${game.terms.item} ids.` };
  }
  const unknown = raw.filter((id) => !everything.includes(id));
  if (unknown.length > 0) return { error: `Not ${game.terms.items} in ${game.name}: ${unknown.join(", ")}.` };
  return { items: [...new Set(raw as string[])] };
}

/** A game in a line or two, for choosing between them. */
function summariseGame(game: Game): object {
  return {
    id: game.id,
    name: game.name,
    terms: game.terms,
    defaults: game.defaults,
    presets: game.presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      official: preset.official,
      format: formatScript(preset.script),
      turns: preset.script.length,
      teams: preset.teams,
      teamSize: preset.teamSize,
      notes: preset.notes,
    })),
  };
}

/**
 * Everything a screen needs to draw a game's draft: what the things are
 * called, what each looks like, and which filters can be trusted.
 */
function describeGame(game: Game): object {
  return {
    ...summariseGame(game),
    teams: game.teams,
    actions: game.actions,
    items: game.catalog.items,
    note: game.catalog.note,
    filters: usableFilters(game),
    // Named so a screen can say a filter exists but is not ready yet, rather
    // than leaving somebody hunting for one.
    unverifiedFilters: game.catalog.filters.filter((filter) => !filter.verified).map((filter) => filter.label),
  };
}

/**
 * Asks whether the address this request came from has any room-making left in
 * it, and hands back the refusal to send if it does not.
 *
 * Cloudflare tells us who is asking; behind nothing at all — a request made
 * straight to the worker in testing, say — there is nobody to charge, so the
 * request goes through.
 */
async function checkAllowance(request: Request, env: Env): Promise<Response | null> {
  const address = request.headers.get("cf-connecting-ip");
  if (address === null || address === "") return null;

  const stub = env.GATEKEEPER.get(env.GATEKEEPER.idFromName(address));
  const verdict = (await (await stub.fetch("https://gatekeeper/")).json()) as RateVerdict;
  if (verdict.allowed) return null;

  const response = json(
    {
      error: "That is a lot of drafts at once. Give it a moment and try again.",
      retryAfter: verdict.retryAfter,
    },
    429,
  );
  response.headers.set("retry-after", String(verdict.retryAfter));
  return response;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}
