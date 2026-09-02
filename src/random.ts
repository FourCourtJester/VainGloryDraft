/**
 * Deterministic RNG for auto-actions.
 *
 * A timeout auto-pick has to be defensible after the fact — "the app rolled a
 * dice you cannot inspect" loses arguments. Seeding from the room seed plus the
 * turn index means anyone holding the room log can replay the same draw.
 */

function hash(input: string): number {
  // FNV-1a, 32-bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, and identical across every JS runtime. */
export function seededRandom(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draws `count` distinct items from `items` without mutating it. */
export function drawDistinct<T>(items: readonly T[], count: number, random: () => number): T[] {
  const pool = [...items];
  const drawn: T[] = [];
  const take = Math.min(count, pool.length);
  for (let i = 0; i < take; i++) {
    const index = Math.floor(random() * pool.length);
    drawn.push(pool[index]!);
    pool.splice(index, 1);
  }
  return drawn;
}
