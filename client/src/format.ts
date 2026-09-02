import type { Turn } from "../../src/types.js";

export function clock(ms: number): string {
  const safe = Math.max(0, ms);
  const seconds = Math.floor(safe / 1000);
  if (seconds < 10) return (safe / 1000).toFixed(1);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function describeTurn(turn: Turn): string {
  const verb = turn.action === "ban" ? "bans" : "picks";
  return `Team ${turn.team} ${verb}${turn.count > 1 ? ` ${turn.count}` : ""}`;
}

export function verbFor(turn: Turn): string {
  return turn.action === "ban" ? "Ban" : "Pick";
}
