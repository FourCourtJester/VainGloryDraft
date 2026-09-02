import { describe, expect, it } from "vitest";
import { drawDistinct, seededRandom } from "../src/random.js";

const POOL = Array.from({ length: 58 }, (_, i) => `hero-${i}`);

describe("seededRandom", () => {
  it("replays exactly for the same seed", () => {
    const a = seededRandom("room-1:3");
    const b = seededRandom("room-1:3");
    expect(Array.from({ length: 20 }, a)).toEqual(Array.from({ length: 20 }, b));
  });

  it("gives every seed its own stream", () => {
    const streams = new Set(
      Array.from({ length: 200 }, (_, i) => seededRandom(`seed-${i}`)().toFixed(12)),
    );
    expect(streams.size).toBe(200);
  });

  it("does not correlate neighbouring turn indices of the same room", () => {
    // Turn index is appended to the seed, so adjacent turns differ by one
    // character. Their first draws must not track each other.
    const draws = Array.from({ length: 40 }, (_, turn) => seededRandom(`room-secret:${turn}`)());
    const gaps = draws.slice(1).map((value, i) => Math.abs(value - draws[i]!));
    const meanGap = gaps.reduce((total, gap) => total + gap, 0) / gaps.length;
    expect(meanGap).toBeGreaterThan(0.2); // ~0.33 for independent uniforms
  });

  it("stays inside [0, 1)", () => {
    const random = seededRandom("bounds");
    for (let i = 0; i < 5_000; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("spreads across the range rather than clustering", () => {
    const random = seededRandom("distribution");
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 10_000; i++) buckets[Math.floor(random() * 10)]! += 1;
    for (const count of buckets) expect(count).toBeGreaterThan(700);
  });
});

describe("drawDistinct", () => {
  it("draws without repeats and without mutating the pool", () => {
    const random = seededRandom("draw");
    const drawn = drawDistinct(POOL, 5, random);
    expect(new Set(drawn).size).toBe(5);
    expect(POOL).toHaveLength(58);
  });

  it("cannot draw more than the pool holds", () => {
    expect(drawDistinct(["a", "b"], 5, seededRandom("x"))).toHaveLength(2);
  });

  it("reaches every hero over many rooms, so no hero is unreachable", () => {
    const seen = new Set<string>();
    for (let room = 0; room < 400; room++) {
      for (const hero of drawDistinct(POOL, 1, seededRandom(`room-${room}:0`))) seen.add(hero);
    }
    expect(seen.size).toBe(POOL.length);
  });
});
