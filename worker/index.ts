/**
 * The front door.
 *
 * This is what a browser actually talks to. It makes new rooms and hands back
 * the three links for them, serves the app itself, answers with the hero
 * roster and the list of formats, and sends everyone who opens a room link
 * through to the room they are looking for.
 *
 * A room's name is taken straight from its link, so everybody holding links to
 * the same draft arrives at the same room — the one that holds the real draft
 * and runs its clock.
 */

import { HEROES, HERO_DATA_VERIFIED } from "../src/heroes.js";
import { PENDING, PRESETS } from "../src/presets.js";
import { parseAutoFill, parseTimerRules } from "../src/room/options.js";
import type { CreateRoomOptions } from "../src/room/room.js";
import { generateToken } from "../src/room/tokens.js";
import { parseScript } from "../src/script.js";
import { resolveScript } from "../src/presets.js";

export { DraftRoom } from "./draft-room.js";

export interface Env {
  readonly DRAFT_ROOM: DurableObjectNamespace;
  readonly ASSETS: Fetcher;
}

interface CreateRoomRequest {
  readonly presetId?: string;
  /** A format written out by hand, used in place of a named one if both are given. */
  readonly script?: string;
  readonly mirrorPicks?: boolean;
  readonly autoFill?: "random" | "lowestIndex";
  readonly perTurnMs?: number;
  readonly bankMs?: number;
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

    if (url.pathname === "/api/heroes") {
      return json({ verified: HERO_DATA_VERIFIED, heroes: HEROES });
    }

    if (url.pathname === "/api/presets") {
      return json({
        presets: PRESETS.map((preset) => ({
          id: preset.id,
          name: preset.name,
          format: preset.format,
          official: preset.official,
          turns: preset.script.length,
          notes: preset.notes ?? null,
        })),
        pending: PENDING,
      });
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

  const { rules, problems } = parseTimerRules(body.perTurnMs, body.bankMs);
  if (problems.length > 0) {
    return json({ error: problems.map((problem) => problem.message).join(" ") }, 400);
  }

  let options: CreateRoomOptions;
  try {
    options = {
      roomId: generateToken(8),
      script: body.script !== undefined ? parseScript(body.script) : resolveScript(body.presetId ?? "vg-5v5-standard"),
      mirrorPicks: body.mirrorPicks === true,
      autoFill: parseAutoFill(body.autoFill) ?? "random",
      rules,
    };
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid room options." }, 400);
  }

  const stub = env.DRAFT_ROOM.get(env.DRAFT_ROOM.idFromName(options.roomId!));
  const created = await stub.fetch(new Request("https://draft/create", { method: "POST", body: JSON.stringify(options) }));
  if (!created.ok) return withCors(created);

  const { roomId, tokens } = (await created.json()) as { roomId: string; tokens: Record<string, string> };
  const link = (token: string): string => `${url.origin}/r/${roomId}?token=${token}`;

  return json({
    roomId,
    links: { captainA: link(tokens.A!), captainB: link(tokens.B!), spectator: link(tokens.spectator!) },
  });
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
