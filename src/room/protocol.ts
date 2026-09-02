/**
 * Wire protocol between a room and its connections.
 *
 * Authentication happens once, at connect, from the link token: the server
 * knows which viewer a socket belongs to, so no message ever carries a claim
 * about who sent it.
 */

import type { DraftEvent } from "../events.js";
import type { DraftProjection, Viewer } from "../projection.js";
import type { DraftErrorCode } from "../types.js";

export type RoomPhase = "lobby" | "drafting" | "complete";

export type ClientMessage =
  | { readonly t: "stage"; readonly heroId: string }
  | { readonly t: "unstage"; readonly heroId: string }
  | { readonly t: "confirm" }
  | { readonly t: "resync" };

export type RoomErrorCode = DraftErrorCode | "not_started" | "not_a_captain" | "bad_message";

export interface RoomError {
  readonly code: RoomErrorCode;
  readonly message: string;
}

export type ServerMessage =
  | { readonly t: "welcome"; readonly roomId: string; readonly viewer: Viewer }
  | {
      readonly t: "state";
      readonly phase: RoomPhase;
      readonly projection: DraftProjection;
      /** Committed actions since the last state message. Staging never appears here. */
      readonly events: readonly DraftEvent[];
    }
  | { readonly t: "error"; readonly error: RoomError };

/** Parses untrusted client input. Anything unrecognised is a `bad_message`, never a throw. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const message = parsed as { t?: unknown; heroId?: unknown };
  switch (message.t) {
    case "confirm":
    case "resync":
      return { t: message.t };
    case "stage":
    case "unstage":
      return typeof message.heroId === "string" ? { t: message.t, heroId: message.heroId } : null;
    default:
      return null;
  }
}
