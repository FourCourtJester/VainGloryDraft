/**
 * The Durable Object: one per draft room.
 *
 * It owns sockets, storage and the alarm, and nothing else. Every decision —
 * whose turn it is, what a timeout resolves to, who may see staging — belongs to
 * `Room`, which is why this file has no draft logic to test.
 *
 * The alarm is the point of the whole design: it fires whether or not anyone is
 * connected, so a draft cannot be frozen by closing a laptop.
 */

import type { DraftEvent } from "../src/events.js";
import type { Viewer } from "../src/projection.js";
import type { ServerMessage } from "../src/room/protocol.js";
import { parseClientMessage } from "../src/room/protocol.js";
import type { CreateRoomOptions, RoomSnapshot } from "../src/room/room.js";
import { Room } from "../src/room/room.js";

const SNAPSHOT_KEY = "snapshot";

/** Stored on each socket so a hibernated room can rebuild its audience on wake. */
interface SocketAttachment {
  readonly connectionId: string;
  readonly viewer: Viewer;
}

export interface Env {
  readonly DRAFT_ROOM: DurableObjectNamespace;
}

export class DraftRoom implements DurableObject {
  #ctx: DurableObjectState;
  #room: Room | null = null;
  /** The snapshot last written to storage, by identity: `Room` replaces the object on every mutation. */
  #persisted: RoomSnapshot | null = null;

  constructor(ctx: DurableObjectState, _env: Env) {
    this.#ctx = ctx;
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<RoomSnapshot>(SNAPSHOT_KEY);
      if (stored === undefined) return;
      this.#room = new Room(stored);
      this.#persisted = stored;
      // Sockets survive hibernation; the room's view of who is present does not.
      for (const socket of ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null;
        if (attachment !== null) this.#room.attach(attachment.connectionId, attachment.viewer, Date.now());
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/create" && request.method === "POST") {
      return this.#create(request);
    }
    if (this.#room === null) {
      return json({ error: "No such room." }, 404);
    }
    if (url.pathname === "/ws") {
      return this.#connect(request, url);
    }
    if (url.pathname === "/state") {
      return this.#state(url);
    }
    return json({ error: "Not found." }, 404);
  }

  async #create(request: Request): Promise<Response> {
    if (this.#room !== null) return json({ error: "Room already exists." }, 409);

    const options = (await request.json()) as CreateRoomOptions;
    let snapshot: RoomSnapshot;
    try {
      snapshot = Room.create(options, Date.now());
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Invalid room options." }, 400);
    }

    this.#room = new Room(snapshot);
    await this.#ctx.storage.put(SNAPSHOT_KEY, snapshot);
    this.#persisted = snapshot;
    return json({ roomId: snapshot.roomId, tokens: snapshot.tokens });
  }

  #connect(request: Request, url: URL): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ error: "Expected a WebSocket upgrade." }, 426);
    }
    const room = this.#room!;
    const viewer = room.authenticate(url.searchParams.get("token") ?? "");
    if (viewer === null) return json({ error: "Invalid link." }, 403);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const connectionId = crypto.randomUUID();

    // Hibernation: the socket carries its own identity, so the room can be
    // evicted between messages without losing track of who is on it.
    server.serializeAttachment({ connectionId, viewer } satisfies SocketAttachment);
    this.#ctx.acceptWebSocket(server);

    const now = Date.now();
    const outcome = room.attach(connectionId, viewer, now);
    send(server, { t: "welcome", roomId: room.snapshot.roomId, viewer });
    void this.#settle(outcome.events, now);

    return new Response(null, { status: 101, webSocket: client });
  }

  #state(url: URL): Response {
    const room = this.#room!;
    const viewer = room.authenticate(url.searchParams.get("token") ?? "");
    if (viewer === null) return json({ error: "Invalid link." }, 403);

    const now = Date.now();
    const outcome = room.tick(now);
    if (outcome.changed) void this.#settle(outcome.events, now);
    return json({ t: "state", phase: room.phase, serverTime: now, projection: room.projection(viewer, now), events: [] });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const room = this.#room;
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (room === null || attachment === null) return;

    const message = parseClientMessage(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    if (message === null) {
      send(socket, { t: "error", error: { code: "bad_message", message: "Unrecognised message." } });
      return;
    }

    const now = Date.now();
    const outcome = room.command(attachment.viewer, message, now);
    if (outcome.error !== null) send(socket, { t: "error", error: outcome.error });
    // A rejected click changes nothing, so it earns no write and no broadcast:
    // the captain who sent it gets the error, and the room carries on.
    if (outcome.changed) await this.#settle(outcome.events, now);
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const room = this.#room;
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (room === null || attachment === null) return;
    const now = Date.now();
    const outcome = room.detach(attachment.connectionId, now);
    if (outcome.changed) await this.#settle(outcome.events, now);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  /** The turn clock. Fires with nobody watching, which is the point. */
  async alarm(): Promise<void> {
    const room = this.#room;
    if (room === null) return;
    const now = Date.now();
    const outcome = room.tick(now);
    if (outcome.changed) await this.#settle(outcome.events, now);
  }

  /** Persist, re-arm the alarm, and give every connection its own filtered view. */
  async #settle(events: readonly DraftEvent[], now: number): Promise<void> {
    const room = this.#room!;
    // Presence is not persisted, so a connect or disconnect alone needs no write.
    if (room.snapshot !== this.#persisted) {
      await this.#ctx.storage.put(SNAPSHOT_KEY, room.snapshot);
      this.#persisted = room.snapshot;

      const alarmAt = room.alarmAt();
      if (alarmAt !== null) await this.#ctx.storage.setAlarm(alarmAt);
      else await this.#ctx.storage.deleteAlarm();
    }

    const sockets = new Map<string, WebSocket>();
    for (const socket of this.#ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment !== null) sockets.set(attachment.connectionId, socket);
    }

    for (const { connectionId, projection } of room.audience(now)) {
      const socket = sockets.get(connectionId);
      if (socket !== undefined) send(socket, { t: "state", phase: room.phase, serverTime: now, projection, events });
    }
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // A socket that died between the broadcast and this send is not an error:
    // its close event will clean it up.
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
