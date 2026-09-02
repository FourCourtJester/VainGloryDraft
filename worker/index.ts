/**
 * Worker entry: creates rooms and routes connections into their Durable Object.
 *
 * A room's id is also its DO name, so every connection with the same link lands
 * in the same object — the one holding the authoritative state and clock.
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
  /** Compact notation, e.g. "Aban, Bban, Apick x2". Wins over presetId if both are given. */
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

    const room = /^\/api\/rooms\/([A-Za-z0-9_-]+)\/(ws|state)$/.exec(url.pathname);
    if (room !== null) {
      const [, roomId, route] = room;
      const stub = env.DRAFT_ROOM.get(env.DRAFT_ROOM.idFromName(roomId!));
      const forwarded = new URL(request.url);
      forwarded.pathname = `/${route!}`;
      const response = await stub.fetch(new Request(forwarded, request));
      return route === "ws" ? response : withCors(response);
    }

    // Room links are client routes: hand them the SPA, which reads the room id
    // and token from the URL itself.
    if (/^\/r\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
      // Ask for "/", not "/index.html": the asset router canonicalises the
      // latter with a redirect, which would throw the link token away.
      return env.ASSETS.fetch(new Request(new URL("/", url), request));
    }

    return json({ error: "Not found." }, 404);
  },
} satisfies ExportedHandler<Env>;

async function createRoom(request: Request, env: Env, url: URL): Promise<Response> {
  let body: CreateRoomRequest = {};
  try {
    if (request.headers.get("content-type")?.includes("application/json") === true) {
      const parsed: unknown = await request.json();
      // A body of literal `null` parses fine and is not an object: reading a
      // field off it would throw past this handler and answer 500.
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
