/**
 * What a screen and a room say to each other.
 *
 * Who somebody is gets settled once, when they open their link, and is then
 * remembered for as long as they stay connected. Nothing they send afterwards
 * says who they are, so nobody can claim to be the other captain by asking
 * nicely.
 *
 * A screen only ever asks for things — choose this hero, confirm, tell me where
 * we are. It is the room that decides what actually happens.
 */

import type { DraftEvent } from "../events.js";
import type { DraftProjection, Viewer } from "../projection.js";
import type { DraftErrorCode } from "../types.js";

export type RoomPhase = "lobby" | "drafting" | "complete";

export type ClientMessage =
  | { readonly t: "stage"; readonly heroId: string }
  | { readonly t: "unstage"; readonly heroId: string }
  | { readonly t: "confirm" }
  | { readonly t: "resync" }
  /** "I am ready for the draft to begin", or taking that back. */
  | { readonly t: "ready"; readonly ready: boolean }
  /** The leader giving the job to a teammate. */
  | { readonly t: "handOver"; readonly memberId: string }
  /** A teammate stepping in when the leader is not connected. */
  | { readonly t: "claimLead" }
  /**
   * A side's leader agreeing to begin without a full room. Both sides' leaders
   * have to say so, which is how a tournament gets past a no-show.
   */
  | { readonly t: "startAnyway"; readonly agreed: boolean };

export type RoomErrorCode =
  | DraftErrorCode
  | "not_started"
  | "not_a_player"
  | "bad_message"
  | "not_your_call"
  | "leader_present";

export interface RoomError {
  readonly code: RoomErrorCode;
  readonly message: string;
}

export type ServerMessage =
  | { readonly t: "welcome"; readonly roomId: string; readonly viewer: Viewer }
  | {
      readonly t: "state";
      readonly phase: RoomPhase;
      /**
       * What time the room makes it. Screens compare this against their own
       * clock and correct for the difference, so somebody whose laptop is a
       * minute fast does not see a minute less time than the person next to
       * them.
       */
      readonly serverTime: number;
      readonly projection: DraftProjection;
      /** What has actually happened since the last update. */
      readonly events: readonly DraftEvent[];
    }
  | { readonly t: "error"; readonly error: RoomError };

/**
 * Reads a message from a screen, keeping only the parts a screen is allowed to
 * decide. Anything unfamiliar is turned away rather than acted on.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const message = parsed as {
    t?: unknown;
    heroId?: unknown;
    ready?: unknown;
    memberId?: unknown;
    agreed?: unknown;
  };
  switch (message.t) {
    case "confirm":
    case "resync":
      return { t: message.t };
    case "claimLead":
      return { t: "claimLead" };
    case "startAnyway":
      return typeof message.agreed === "boolean" ? { t: "startAnyway", agreed: message.agreed } : null;
    case "stage":
    case "unstage":
      return typeof message.heroId === "string" ? { t: message.t, heroId: message.heroId } : null;
    case "ready":
      return typeof message.ready === "boolean" ? { t: "ready", ready: message.ready } : null;
    case "handOver":
      return typeof message.memberId === "string" ? { t: "handOver", memberId: message.memberId } : null;
    default:
      return null;
  }
}
