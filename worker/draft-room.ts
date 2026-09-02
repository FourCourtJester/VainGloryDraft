/**
 * The living copy of one draft room, kept by Cloudflare.
 *
 * There is exactly one of these per room, and everybody who opens a link is
 * connected to that same one. It looks after the practical business of being a
 * room on the internet: holding the connections open, saving the draft so it
 * survives being put away, sending everyone their own view when something
 * changes, and setting an alarm clock for the current turn.
 *
 * That alarm is the reason this app is built this way. It goes off whether or
 * not anybody is connected, which means a captain cannot freeze a draft by
 * shutting their laptop, and a room left alone overnight finishes rather than
 * hanging half-done.
 *
 * The rules of drafting are not here. Every genuine decision is asked of the
 * room itself, which is why this file has nothing much to get wrong.
 */

import type { DraftEvent } from "../src/events.js";
import type { Viewer } from "../src/projection.js";
import { formatScript } from "../src/script.js";
import type { ServerMessage } from "../src/room/protocol.js";
import { parseClientMessage } from "../src/room/protocol.js";
import type { CreateRoomOptions, RoomOutcome, RoomSnapshot } from "../src/room/room.js";
import { Room } from "../src/room/room.js";

const SNAPSHOT_KEY = "snapshot";

/**
 * Kept alongside each open connection, so that a room which has been put away
 * and later woken still knows who is on the other end of it.
 */
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
  /** What was last saved, so the room is only written down when it has actually moved on. */
  #persisted: RoomSnapshot | null = null;
  /** The time the alarm is currently set for, so it is not set again to the same moment. */
  #armed: number | null = null;

  constructor(ctx: DurableObjectState, _env: Env) {
    this.#ctx = ctx;
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<RoomSnapshot>(SNAPSHOT_KEY);
      if (stored === undefined) return;
      this.#room = new Room(stored);
      this.#persisted = stored;
      // Connections outlive being put away, but the room's memory of who holds
      // them does not, so it is rebuilt here.
      for (const socket of ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null;
        if (attachment !== null) this.#room.attach(attachment.connectionId, attachment.viewer, Date.now());
      }
      // A room that woke up mid-turn with no alarm set would sit there forever,
      // so make certain there is one before carrying on.
      const due = this.#room.alarmAt();
      if (due !== null && (await ctx.storage.getAlarm()) === null) {
        await ctx.storage.setAlarm(due);
      }
      this.#armed = due;
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
    if (url.pathname === "/record") {
      return this.#record(url);
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

  async #connect(request: Request, url: URL): Promise<Response> {
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

    // Remember who this connection belongs to on the connection itself, so the
    // room can be put away between messages and still know them on waking.
    server.serializeAttachment({ connectionId, viewer } satisfies SocketAttachment);
    this.#ctx.acceptWebSocket(server);

    const now = Date.now();
    const outcome = room.attach(connectionId, viewer, now);
    send(server, { t: "welcome", roomId: room.snapshot.roomId, viewer });
    // Save before letting the connection loose: if this is the arrival that
    // starts the draft, the draft must be safely recorded as started.
    await this.#settleIfNeeded(outcome, now);

    return new Response(null, { status: 101, webSocket: client });
  }

  async #state(url: URL): Promise<Response> {
    const room = this.#room!;
    const viewer = room.authenticate(url.searchParams.get("token") ?? "");
    if (viewer === null) return json({ error: "Invalid link." }, 403);

    const now = Date.now();
    const outcome = room.tick(now);
    await this.#settleIfNeeded(outcome, now);
    return json({ t: "state", phase: room.phase, serverTime: now, projection: room.projection(viewer, now), events: [] });
  }

  /**
   * The finished draft as a plain record: every turn in order, who took what,
   * what the clock had to choose, and how long each side took over it.
   *
   * A room keeps its draft indefinitely, so this answers just as well two days
   * later as it does the moment the last hero is picked.
   */
  async #record(url: URL): Promise<Response> {
    const room = this.#room!;
    if (room.authenticate(url.searchParams.get("token") ?? "") === null) {
      return json({ error: "Invalid link." }, 403);
    }
    const now = Date.now();
    const outcome = room.tick(now);
    await this.#settleIfNeeded(outcome, now);

    const snapshot = room.snapshot;
    return json({
      roomId: snapshot.roomId,
      createdAt: snapshot.createdAt,
      phase: room.phase,
      format: formatScript(snapshot.draft.config.script),
      mirrorPicks: snapshot.draft.config.mirrorPicks,
      ...room.record(),
    });
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
    // A refused click tells only the person who made it. There is nothing for
    // anyone else to see and nothing new to save.
    await this.#settleIfNeeded(outcome, now);
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const room = this.#room;
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (room === null || attachment === null) return;
    const now = Date.now();
    const outcome = room.detach(attachment.connectionId, now);
    await this.#settleIfNeeded(outcome, now);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  /**
   * The turn's time running out. This is the alarm going off, and it does so
   * whether or not a single person is connected.
   */
  async alarm(): Promise<void> {
    const room = this.#room;
    if (room === null) return;
    // An alarm is spent once it goes off, so there is nothing set at this point.
    this.#armed = null;
    const now = Date.now();
    const outcome = room.tick(now);
    await this.#settleIfNeeded(outcome, now);
    // Always set the next alarm, even if nothing turned out to be due. An alarm
    // that goes off a moment early would otherwise leave the room running with
    // no clock at all, which is the one thing it must never do.
    await this.#armAlarm();
  }

  /** Sets the alarm for whenever the room next needs waking. Safe to call at any time. */
  async #armAlarm(): Promise<void> {
    const due = this.#room?.alarmAt() ?? null;
    if (due === this.#armed) return;
    if (due === null) await this.#ctx.storage.deleteAlarm();
    else await this.#ctx.storage.setAlarm(due);
    this.#armed = due;
  }

  /**
   * Saves, sets the alarm and updates everyone, whenever there is anything to
   * save or show.
   *
   * It also checks for itself whether the room has moved on, rather than relying
   * only on being told. Finishing up with a change unsaved and no alarm set is
   * the one state this must never be left in, because nothing would ever come
   * along to put it right.
   */
  async #settleIfNeeded(outcome: RoomOutcome, now: number): Promise<void> {
    if (outcome.changed || this.#room?.snapshot !== this.#persisted) {
      await this.#settle(outcome.events, now);
    }
  }

  /** Writes the room down, sets its alarm, and sends everyone their own view. */
  async #settle(events: readonly DraftEvent[], now: number): Promise<void> {
    const room = this.#room!;
    // Somebody arriving or leaving does not change the draft, so there is
    // nothing new to write down for that alone.
    if (room.snapshot !== this.#persisted) {
      await this.#ctx.storage.put(SNAPSHOT_KEY, room.snapshot);
      this.#persisted = room.snapshot;
    }
    await this.#armAlarm();

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
    // A connection that died a moment ago is not a problem worth reporting; it
    // will be tidied up when its departure is noticed.
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
