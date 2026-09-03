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
import type { RateVerdict } from "./gatekeeper.js";
import { credentialsMatch, generateToken } from "../src/room/tokens.js";
import { deriveTotals, parseScript } from "../src/script.js";
import { resolveScript } from "../src/presets.js";

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
  readonly presetId?: string;
  /** A format written out by hand, used in place of a named one if both are given. */
  readonly script?: string;
  readonly mirrorPicks?: boolean;
  readonly autoFill?: "random" | "lowestIndex";
  readonly perTurnMs?: number;
  readonly bankMs?: number;
  /** Where to POST the finished draft, for a bot that wants telling. */
  readonly callbackUrl?: string;
  /**
   * How many players a side waits for before the ready check. Defaults to the
   * number of heroes the format has that side pick — five for a 5v5 — so a room
   * normally works this out for itself. Set it to 1 for a draft where only the
   * two captains turn up.
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
          // How many players a side has, if the format is played as intended.
          teamSize: Math.max(1, deriveTotals(preset.script).byTeam.A.picks, deriveTotals(preset.script).byTeam.B.picks),
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

  const { rules, problems } = parseTimerRules(body.perTurnMs, body.bankMs);
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

  let options: CreateRoomOptions;
  try {
    options = {
      roomId: generateToken(8),
      script: body.script !== undefined ? parseScript(body.script) : resolveScript(body.presetId ?? "vg-5v5-standard"),
      mirrorPicks: body.mirrorPicks === true,
      autoFill: parseAutoFill(body.autoFill) ?? "random",
      rules,
      callbackUrl: callbackUrl ?? null,
      ...(teamSize === undefined ? {} : { teamSize }),
      ...(retentionMs === undefined ? {} : { retentionMs }),
      ...(abandonAfterMs === undefined ? {} : { abandonAfterMs }),
    };
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid room options." }, 400);
  }

  const stub = env.DRAFT_ROOM.get(env.DRAFT_ROOM.idFromName(options.roomId!));
  const created = await stub.fetch(new Request("https://draft/create", { method: "POST", body: JSON.stringify(options) }));
  if (!created.ok) return withCors(created);

  const { roomId, credentials } = (await created.json()) as {
    roomId: string;
    credentials: { A: string; B: string; spectator: string };
  };

  // A team's link carries its code so that tapping it is enough, and the code
  // is handed back on its own for a bot that would rather read it out.
  return json({
    roomId,
    codes: { A: credentials.A, B: credentials.B },
    links: {
      teamA: `${url.origin}/r/${roomId}?code=${credentials.A}`,
      teamB: `${url.origin}/r/${roomId}?code=${credentials.B}`,
      spectator: `${url.origin}/r/${roomId}?token=${credentials.spectator}`,
      join: `${url.origin}/r/${roomId}`,
    },
  });
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
