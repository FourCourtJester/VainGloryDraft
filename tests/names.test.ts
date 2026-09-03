import { describe, expect, it } from "vitest";
import { autoName, cleanName } from "../src/room/names.js";

describe("autoName", () => {
  it("gives the same player the same name every time", () => {
    expect(autoName("player-abc")).toBe(autoName("player-abc"));
  });

  it("gives different players different names, mostly", () => {
    const names = new Set(Array.from({ length: 300 }, (_, i) => autoName(`player-${i}`)));
    // 24 x 24 pairs, so some collisions are expected; a name should still
    // usually distinguish one person in a room of ten.
    expect(names.size).toBeGreaterThan(200);
  });

  it("reads like a name a person would not mind", () => {
    for (let i = 0; i < 50; i++) expect(autoName(`p${i}`)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });
});

describe("cleanName", () => {
  it("keeps what somebody typed", () => {
    expect(cleanName("Shaun", "p1")).toBe("Shaun");
  });

  it("tidies stray whitespace", () => {
    expect(cleanName("  Shaun   D  ", "p1")).toBe("Shaun D");
  });

  it("falls back to their own auto name rather than something blank", () => {
    expect(cleanName("   ", "p1")).toBe(autoName("p1"));
    expect(cleanName("", "p1")).toBe(autoName("p1"));
  });

  it("keeps a name short enough for a roster row", () => {
    expect(cleanName("x".repeat(80), "p1")).toHaveLength(24);
  });
});
