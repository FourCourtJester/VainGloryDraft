import { describe, expect, it } from "vitest";
import {
  autoFillSelection,
  availability,
  commit,
  createDraft,
  currentTurn,
  isComplete,
  legalHeroes,
  resolveTimeout,
  stage,
  summarise,
  unstage,
} from "../src/engine.js";
import { parseScript } from "../src/script.js";
import type { DraftConfig, DraftState, Result, Team } from "../src/types.js";

const POOL = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

function config(overrides: Partial<DraftConfig> = {}): DraftConfig {
  return {
    script: parseScript("Aban, Bban, Apick, Bpick x2, Apick"),
    heroPool: POOL,
    mirrorPicks: false,
    autoFill: "random",
    seed: "seed-1",
    ...overrides,
  };
}

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function start(overrides: Partial<DraftConfig> = {}): DraftState {
  return must(createDraft(config(overrides)));
}

/** Stage the given heroes for the team on the clock and confirm. */
function play(state: DraftState, ...heroes: string[]): DraftState {
  const team = currentTurn(state)!.team;
  let next = state;
  for (const hero of heroes) next = must(stage(next, team, hero));
  return must(commit(next, team));
}

describe("createDraft", () => {
  it("refuses a script the pool cannot satisfy", () => {
    const result = createDraft(config({ heroPool: ["a", "b"] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_script");
  });

  it("refuses an empty script", () => {
    expect(createDraft(config({ script: [] })).ok).toBe(false);
  });
});

describe("turn order", () => {
  it("walks the script in order and reports completion", () => {
    let state = start();
    expect(currentTurn(state)).toEqual({ team: "A", action: "ban", count: 1 });
    state = play(state, "a");
    expect(currentTurn(state)).toEqual({ team: "B", action: "ban", count: 1 });
    state = play(state, "b");
    state = play(state, "c");
    state = play(state, "d", "e");
    expect(isComplete(state)).toBe(false);
    state = play(state, "f");
    expect(isComplete(state)).toBe(true);
    expect(currentTurn(state)).toBeNull();
    expect(summarise(state).picks).toEqual({ A: ["c", "f"], B: ["d", "e"] });
    expect(summarise(state).bans).toEqual({ A: ["a"], B: ["b"] });
  });

  it("rejects an action from the team not on the clock", () => {
    const state = start();
    const result = stage(state, "B", "a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("wrong_team");
  });

  it("rejects anything once the draft is over", () => {
    let state = start();
    state = play(state, "a");
    state = play(state, "b");
    state = play(state, "c");
    state = play(state, "d", "e");
    state = play(state, "f");
    expect(stage(state, "A", "g").ok).toBe(false);
    expect(commit(state, "A").ok).toBe(false);
    expect(resolveTimeout(state).ok).toBe(false);
    expect(legalHeroes(state)).toEqual([]);
  });
});

describe("staging", () => {
  it("toggles on repeat selection", () => {
    let state = start();
    state = must(stage(state, "A", "a"));
    expect(state.staged).toEqual(["a"]);
    state = must(stage(state, "A", "a"));
    expect(state.staged).toEqual([]);
  });

  it("caps staging at the turn's count", () => {
    let state = start();
    state = play(state, "a");
    state = play(state, "b");
    state = play(state, "c");
    // B picks two.
    state = must(stage(state, "B", "d"));
    state = must(stage(state, "B", "e"));
    const overflow = stage(state, "B", "f");
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.error.code).toBe("turn_full");
  });

  it("will not confirm a partially staged turn", () => {
    let state = start();
    state = play(state, "a");
    state = play(state, "b");
    state = play(state, "c");
    state = must(stage(state, "B", "d"));
    const result = commit(state, "B");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("turn_incomplete");
  });

  it("commits a multi-pick turn with a single confirm", () => {
    let state = start();
    state = play(state, "a");
    state = play(state, "b");
    state = play(state, "c");
    state = play(state, "d", "e");
    expect(state.committed.at(-1)).toMatchObject({ team: "B", action: "pick", heroes: ["d", "e"] });
  });

  it("clears staging when a turn commits", () => {
    let state = start();
    state = play(state, "a");
    expect(state.staged).toEqual([]);
  });

  it("rejects unstaging a hero that is not staged", () => {
    const state = start();
    const result = unstage(state, "A", "a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_staged");
  });
});

describe("legality", () => {
  it("removes banned heroes from both teams' options", () => {
    let state = start();
    state = play(state, "a");
    expect(legalHeroes(state)).not.toContain("a");
    expect(availability(state, "a")).toEqual({ state: "banned" });
  });

  it("refuses to ban a hero that is already picked", () => {
    let state = start({ script: parseScript("Apick, Bban") });
    state = play(state, "a");
    const result = stage(state, "B", "a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("hero_picked");
  });

  it("refuses a mirror pick by default", () => {
    let state = start({ script: parseScript("Apick, Bpick") });
    state = play(state, "a");
    const result = stage(state, "B", "a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("hero_picked_by_opponent");
    expect(availability(state, "a")).toEqual({ state: "picked", by: ["A"] });
  });

  it("allows a mirror pick when the room enables it", () => {
    let state = start({ script: parseScript("Apick, Bpick"), mirrorPicks: true });
    state = play(state, "a");
    expect(legalHeroes(state)).toContain("a");
    state = play(state, "a");
    expect(summarise(state).picks).toEqual({ A: ["a"], B: ["a"] });
  });

  it("never lets one team pick the same hero twice, even with mirror on", () => {
    const state = play(start({ script: parseScript("Apick, Apick"), mirrorPicks: true }), "a");
    const result = stage(state, "A", "a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("hero_picked");
  });

  it("still refuses a repeat after the other team has mirrored it", () => {
    // When both teams are allowed the same hero, each team's own claim on it has
    // to be remembered separately, or a team could end up with it twice.
    let state = start({ script: parseScript("Apick, Bpick, Apick, Bpick"), mirrorPicks: true });
    state = play(state, "a"); // A picks a
    state = play(state, "a"); // B mirrors a
    state = play(state, "b"); // A picks b
    const result = stage(state, "B", "a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("hero_picked");
  });

  it("reports both teams once a hero is mirrored", () => {
    let state = start({ script: parseScript("Apick, Bpick"), mirrorPicks: true });
    state = play(state, "a");
    expect(availability(state, "a")).toEqual({ state: "picked", by: ["A"] });
    state = play(state, "a");
    expect(availability(state, "a")).toEqual({ state: "picked", by: ["A", "B"] });
  });

  it("never auto-fills a hero the team already holds under mirror rules", () => {
    let state = start({
      script: parseScript("Apick, Bpick, Apick, Bpick"),
      mirrorPicks: true,
      autoFill: "lowestIndex",
      heroPool: ["a", "b", "c"],
    });
    state = play(state, "a");
    state = play(state, "a");
    state = play(state, "b");
    expect(autoFillSelection(state)).toEqual(["b"]);
  });

  it("rejects a hero outside the pool", () => {
    const result = stage(start(), "A", "not-a-hero");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown_hero");
  });
});

describe("timeout", () => {
  it("keeps what was staged and fills only the remainder", () => {
    let state = start();
    state = play(state, "a");
    state = play(state, "b");
    state = play(state, "c");
    state = must(stage(state, "B", "d"));
    const filled = autoFillSelection(state);
    expect(filled).toHaveLength(2);
    expect(filled[0]).toBe("d");
    state = must(resolveTimeout(state));
    expect(state.committed.at(-1)).toMatchObject({ auto: true, heroes: filled });
  });

  it("fills both slots when a double pick was left untouched", () => {
    // The other half of the same rule: a captain who staged nothing at all on a
    // two-hero turn is given two, not one, and the draft still moves on.
    let state = start();
    state = play(state, "a");
    state = play(state, "b");
    state = play(state, "c");
    const filled = autoFillSelection(state);
    expect(filled).toHaveLength(2);
    expect(new Set(filled).size).toBe(2);
    state = must(resolveTimeout(state));
    expect(state.committed.at(-1)).toMatchObject({ auto: true, heroes: filled, team: "B" });
    expect(currentTurn(state)).toMatchObject({ team: "A", action: "pick" });
  });

  it("is deterministic for a given seed and turn", () => {
    const first = autoFillSelection(start({ seed: "room-42" }));
    const second = autoFillSelection(start({ seed: "room-42" }));
    expect(first).toEqual(second);
  });

  it("differs between seeds, so a room cannot be predicted from another's log", () => {
    const draws = new Set(
      ["s1", "s2", "s3", "s4", "s5", "s6"].map((seed) => autoFillSelection(start({ seed })).join()),
    );
    expect(draws.size).toBeGreaterThan(1);
  });

  it("takes the lowest-index legal hero under the lowestIndex strategy", () => {
    let state = start({ autoFill: "lowestIndex" });
    state = must(resolveTimeout(state)); // A bans "a"
    expect(state.committed[0]?.heroes).toEqual(["a"]);
    state = must(resolveTimeout(state)); // B bans the next available
    expect(state.committed[1]?.heroes).toEqual(["b"]);
  });

  it("never auto-fills an illegal hero", () => {
    let state = start({ script: parseScript("Aban, Bpick, Apick"), autoFill: "lowestIndex" });
    state = play(state, "a");
    state = play(state, "b");
    state = must(resolveTimeout(state));
    expect(state.committed.at(-1)?.heroes).toEqual(["c"]);
  });

  it("drops staged heroes that became illegal before resolving", () => {
    // Contrived but possible if legality changes under a captain: staged entries
    // are filtered, not trusted.
    let state = start({ script: parseScript("Apick, Bpick"), autoFill: "lowestIndex" });
    state = play(state, "a");
    const tampered: DraftState = { ...state, staged: ["a"] };
    const filled = autoFillSelection(tampered);
    expect(filled).toEqual(["b"]);
  });

  it("can resolve every turn of a draft nobody plays", () => {
    let state = start();
    while (!isComplete(state)) state = must(resolveTimeout(state));
    const summary = summarise(state);
    expect(summary.picks.A).toHaveLength(2);
    expect(summary.picks.B).toHaveLength(2);
    const all = [...summary.picks.A, ...summary.picks.B, ...summary.bans.A, ...summary.bans.B];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("format independence", () => {
  const formats: Record<string, { notation: string; picksPerTeam: number }> = {
    "3v3": { notation: "Aban, Bban, Apick, Bpick x2, Apick x2, Bpick", picksPerTeam: 3 },
    "5v5": { notation: "Aban x2, Bban x2, Apick, Bpick x2, Apick x2, Bpick x2, Apick x2, Bpick", picksPerTeam: 5 },
    lopsided: { notation: "Apick x4, Bpick x2", picksPerTeam: 0 },
  };

  const BIG_POOL = Array.from({ length: 24 }, (_, i) => `hero-${i}`);

  it.each(Object.entries(formats))("plays out %s with the same engine", (_name, { notation }) => {
    let state = must(createDraft(config({ script: parseScript(notation), heroPool: BIG_POOL })));
    while (!isComplete(state)) state = must(resolveTimeout(state));
    expect(state.committed).toHaveLength(parseScript(notation).length);
  });

  it("does not assume five picks per team", () => {
    let state = must(createDraft(config({ script: parseScript("Apick x3, Bpick x3") })));
    while (!isComplete(state)) state = must(resolveTimeout(state));
    const summary = summarise(state);
    expect(summary.picks.A).toHaveLength(3);
    expect(summary.picks.B).toHaveLength(3);
  });
});

describe("immutability", () => {
  it("never mutates the state handed in", () => {
    const state = start();
    const before = JSON.stringify(state);
    must(stage(state, "A", "a"));
    must(resolveTimeout(state));
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("teams", () => {
  it("tracks each team's own picks and bans separately", () => {
    let state = start({ script: parseScript("Aban, Bban, Apick, Bpick") });
    const order: Team[] = [];
    while (!isComplete(state)) {
      order.push(currentTurn(state)!.team);
      state = must(resolveTimeout(state));
    }
    expect(order).toEqual(["A", "B", "A", "B"]);
  });
});
