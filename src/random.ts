/**
 * Deterministic RNG for auto-actions.
 *
 * A timeout auto-pick has to be defensible after the fact — "the app rolled a
 * dice you cannot inspect" loses arguments. Seeding from the room seed plus the
 * turn index means anyone holding the room log can replay the same draw.
 *
 * Determinism is not the same as predictability, and the difference matters
 * here: the room seed never leaves the server, so replaying a draw needs the
 * log *and* the seed. That only holds if the seed cannot be recovered from the
 * draws themselves, which is why the generator carries a 128-bit state seeded
 * by four independent passes rather than one 32-bit digest. A single 32-bit
 * hash would be brute-forceable from a handful of observed auto-picks, and —
 * because the turn index is appended to the seed — recovering one turn's state
 * would have given up every other turn's too.
 */

/** FNV-1a, 32-bit, salted so each pass over the same string is independent. */
function hash(input: string, salt: number): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // A final avalanche, so a one-character change does not leave a visible trail.
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * sfc32 — small, fast, 128 bits of state, and identical across every JS runtime,
 * which is what keeps a draw replayable on a machine that is not the one that
 * made it.
 */
export function seededRandom(seed: string): () => number {
  let a = hash(seed, 0x9e3779b9);
  let b = hash(seed, 0x85ebca6b);
  let c = hash(seed, 0xc2b2ae35);
  let d = hash(seed, 0x27d4eb2f);

  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };

  // Discard the first draws so the output does not expose the raw seed words.
  for (let i = 0; i < 12; i++) next();
  return next;
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
