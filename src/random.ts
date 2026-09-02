/**
 * The dice the app rolls when it has to choose a hero for a captain who ran out
 * of time.
 *
 * Two things are being balanced here. A team who loses a hero to the clock will
 * want to know the app did not simply invent something, so every roll can be
 * repeated later by whoever runs the tournament and shown to have been fair.
 * At the same time, no captain should be able to sit and work out what the next
 * timeout will hand their opponent, so the rolls cannot be predicted in advance
 * by anyone watching the draft.
 *
 * Both hold because the number a room rolls from is kept on the server and
 * never shown to anyone: a roll can be checked afterwards by someone who has
 * that number, and guessed by nobody who does not.
 */

/** Turns text into a number, differently each time the salt changes. */
function hash(input: string, salt: number): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Scramble the result thoroughly, so two rooms with near-identical names do
  // not end up with near-identical dice.
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Builds the dice for one particular roll. Feeding in the same text always gives
 * back the same sequence of numbers, on any machine, which is what allows a
 * draft to be replayed and checked long after it finished.
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

  // Throw away the first few rolls, which sit too close to the starting number.
  for (let i = 0; i < 12; i++) next();
  return next;
}

/**
 * Picks a number of different heroes at random from those still available,
 * never the same one twice, and leaves the list it was given untouched.
 */
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
