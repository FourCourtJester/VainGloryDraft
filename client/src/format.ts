import type { Turn } from "../../src/types.js";

/**
 * Writes a length of time the way a countdown should read: minutes and seconds
 * normally, and tenths once it is down to the last few seconds and every moment
 * counts.
 */
export function clock(ms: number): string {
  const safe = Math.max(0, ms);
  // Settle on tenths before deciding which way to write it, or the last moment
  // before ten seconds rounds up and reads as "10.0".
  const tenths = Math.floor(safe / 100);
  if (tenths < 100) return (tenths / 10).toFixed(1);
  const seconds = Math.floor(tenths / 10);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Writes how long something took, for reading back a finished draft: seconds
 * while that is still readable, and minutes and seconds once it is not.
 */
export function duration(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 60_000) return `${(Math.round(safe / 100) / 10).toFixed(1)}s`;
  const seconds = Math.round(safe / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Says whose turn it is in words, such as "Team B picks 2". */
export function describeTurn(turn: Turn): string {
  const verb = turn.action === "ban" ? "bans" : "picks";
  return `Team ${turn.team} ${verb}${turn.count > 1 ? ` ${turn.count}` : ""}`;
}

/** The word for the confirm button: Ban or Pick. */
export function verbFor(turn: Turn): string {
  return turn.action === "ban" ? "Ban" : "Pick";
}
