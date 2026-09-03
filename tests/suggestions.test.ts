import { describe, expect, it } from "vitest";
import { byMember, forTeam, forget, toggle } from "../src/room/suggestions.js";
import type { Suggestion } from "../src/room/suggestions.js";

const side = (memberId: string): "A" | "B" => (memberId.startsWith("b") ? "B" : "A");
const want = (memberId: string, heroId: string): Suggestion => ({ memberId, team: side(memberId), heroId, intent: "want" });
const ban = (memberId: string, heroId: string): Suggestion => ({ memberId, team: side(memberId), heroId, intent: "ban" });
const names: Record<string, string> = { a1: "Ana", a2: "Ali", a3: "Ash", b1: "Ben" };
const nameOf = (id: string): string => names[id] ?? id;
const always = (): boolean => true;

describe("marking a hero", () => {
  it("adds a mark", () => {
    expect(toggle([], want("a1", "ozo"))).toEqual([want("a1", "ozo")]);
  });

  it("takes it back when marked the same way again", () => {
    expect(toggle([want("a1", "ozo")], want("a1", "ozo"))).toEqual([]);
  });

  it("replaces it when they change their mind about the same hero", () => {
    expect(toggle([want("a1", "ozo")], ban("a1", "ozo"))).toEqual([ban("a1", "ozo")]);
  });

  it("lets one player mark several heroes", () => {
    const marks = toggle(toggle([], want("a1", "ozo")), ban("a1", "krul"));
    expect(byMember(marks, "a1")).toHaveLength(2);
  });

  it("keeps one player's marks clear of another's", () => {
    const marks = toggle(toggle([], want("a1", "ozo")), want("a2", "ozo"));
    expect(marks).toHaveLength(2);
    expect(byMember(marks, "a1")).toHaveLength(1);
  });
});

describe("what a captain reads", () => {
  const marks = [
    want("a1", "ozo"), want("a2", "ozo"), want("a3", "ozo"),
    want("a1", "krul"),
    ban("a2", "saw"), ban("a3", "saw"),
    want("b1", "lyra"),
  ];

  it("gathers a side's marks per hero", () => {
    const forA = forTeam(marks, "A", nameOf, always);
    expect(forA.find((h) => h.heroId === "ozo")?.want).toEqual(["Ana", "Ali", "Ash"]);
    expect(forA.find((h) => h.heroId === "saw")?.ban).toEqual(["Ali", "Ash"]);
  });

  it("puts what most of them agree on first", () => {
    expect(forTeam(marks, "A", nameOf, always).map((h) => h.heroId)).toEqual(["ozo", "saw", "krul"]);
  });

  it("never mixes in the other side's", () => {
    const forA = forTeam(marks, "A", nameOf, always);
    expect(forA.some((h) => h.heroId === "lyra")).toBe(false);
    expect(forTeam(marks, "B", nameOf, always).map((h) => h.heroId)).toEqual(["lyra"]);
  });

  it("drops heroes nobody can have any more", () => {
    const available = (heroId: string): boolean => heroId !== "ozo";
    expect(forTeam(marks, "A", nameOf, available).some((h) => h.heroId === "ozo")).toBe(false);
  });

  it("names the people, since a bare number tells a captain nothing", () => {
    expect(forTeam([want("a1", "ozo")], "A", nameOf, always)[0]?.want).toEqual(["Ana"]);
  });
});

describe("somebody leaving", () => {
  it("takes their marks with them", () => {
    const marks = [want("a1", "ozo"), want("a2", "ozo")];
    expect(forget(marks, "a1")).toEqual([want("a2", "ozo")]);
  });
});
