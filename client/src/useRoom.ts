import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, RoomError, RoomPhase, ServerMessage } from "../../src/room/protocol.js";
import type { DraftProjection, Viewer } from "../../src/projection.js";

/** Whether this screen is currently in touch with the room. */
export type Link = "live" | "connecting" | "offline";

export interface RoomView {
  readonly link: Link;
  readonly viewer: Viewer | null;
  readonly phase: RoomPhase | null;
  readonly projection: DraftProjection | null;
  /**
   * How far this device's clock is from the room's. Countdowns are drawn
   * against the room's time so that everyone watching sees the same number.
   */
  readonly skewMs: number;
  readonly error: RoomError | null;
  readonly send: (message: ClientMessage) => void;
  readonly dismissError: () => void;
}

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

/**
 * Keeps this screen connected to its draft room and holds whatever the room
 * last said.
 *
 * If the connection drops it keeps trying to get back, waiting a little longer
 * between attempts. Losing the connection does not pause anything: the draft
 * carries on without this screen, so coming back is simply a matter of asking
 * the room where things have got to and drawing that.
 */
export function useRoom(roomId: string, token: string): RoomView {
  const [link, setLink] = useState<Link>("connecting");
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [phase, setPhase] = useState<RoomPhase | null>(null);
  const [projection, setProjection] = useState<DraftProjection | null>(null);
  const [skewMs, setSkewMs] = useState(0);
  const [error, setError] = useState<RoomError | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    // Belongs to this connection attempt alone, so that an older connection
    // closing can never be mistaken for the current one dropping.
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const open = (): void => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${scheme}://${window.location.host}/api/rooms/${roomId}/ws?token=${encodeURIComponent(token)}`;
      const socket = new WebSocket(url);
      socketRef.current = socket;
      setLink("connecting");

      socket.onopen = () => {
        if (cancelled) {
          socket.close();
          return;
        }
        attemptRef.current = 0;
        setLink("live");
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        if (cancelled || socketRef.current !== socket) return;
        const message = JSON.parse(event.data) as ServerMessage;
        switch (message.t) {
          case "welcome":
            setViewer(message.viewer);
            break;
          case "state":
            setPhase(message.phase);
            setProjection(message.projection);
            setSkewMs(message.serverTime - Date.now());
            break;
          case "error":
            setError(message.error);
            break;
        }
      };

      socket.onclose = () => {
        // Only the connection actually in use may report the room as lost. An
        // older one finally closing is not news.
        if (socketRef.current === socket) socketRef.current = null;
        if (cancelled) return;
        setLink("offline");
        const wait = BACKOFF_MS[Math.min(attemptRef.current, BACKOFF_MS.length - 1)]!;
        attemptRef.current += 1;
        retry = setTimeout(open, wait);
      };
    };

    open();
    return () => {
      cancelled = true;
      if (retry !== undefined) clearTimeout(retry);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [roomId, token]);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket !== null && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return { link, viewer, phase, projection, skewMs, error, send, dismissError };
}

/** Nudges the screen a few times a second so a countdown appears to tick. */
export function useNow(active: boolean, intervalMs = 100): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
