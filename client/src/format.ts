import type { Turn } from "../../src/types.js";

export function clock(ms: number): string {
  const safe = Math.max(0, ms);
  // Round to tenths *before* choosing the format: picking the sub-10s branch on
  // the floored seconds and then rounding up renders 9999ms as "10.0".
  const tenths = Math.floor(safe / 100);
  if (tenths < 100) return (tenths / 10).toFixed(1);
  const seconds = Math.floor(tenths / 10);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function describeTurn(turn: Turn): string {
  const verb = turn.action === "ban" ? "bans" : "picks";
  return `Team ${turn.team} ${verb}${turn.count > 1 ? ` ${turn.count}` : ""}`;
}

export function verbFor(turn: Turn): string {
  return turn.action === "ban" ? "Ban" : "Pick";
}
