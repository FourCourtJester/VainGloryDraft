import { describe, expect, it } from "vitest";
import {
  autoFillSelection,
  availability,
  commit,
  createDraft,
  currentTurn,
  isComplete,
  legalItems,
  resolveTimeout,
  stage,
  stagedBy,
  summarise,
  unstage,
  waitingOn,
} from "../src/engine.js";
import { parseScript } from "../src/script.js";
import type { ActionDefinition, DraftConfig, DraftState, Team } from "../src/types.js";
import { ACTIONS, TEAMS, must, script } from "./helpers.js";

const POOL = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

function config(overrides: Partial<DraftConfig> = {}): DraftConfig {
  return {
    teams: TEAMS,
    actions: ACTIONS,
    script: script("Aban, Bban, Apick, Bpick x2, Apick"),
    pool: POOL,
    mirror: false,
    autoFill: "random",
    seed: "seed-1",
    ...overrides,
  };
}

function start(overrides: Partial<DraftConfig> = {}): DraftState {
  return must(createDraft(config(overrides)));
}

/** Stage the given items for the one team on the clock and confirm. */
function play(state: DraftState, ...items: string[]): DraftState {
  const team = currentTurn(state)!.teams[0]!;
  return playAs(state, team, ...items);
}

function playAs(state: DraftState, team: Team, ...items: string[]): DraftState {
  let next = state;
  for (const item of items) next = must(stage(next, team, item));
  return must(commit(next, team));
}

describe("createDraft", () => {
  it("refuses a script the pool cannot satisfy", () => {
    const result = createDraft(config({ pool: ["a", "b"] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_script");
  });

  it("refuses an empty script", () => {
    expect(createDraft(config({ script: [] })).ok).toBe(false);
  });

  it("refuses a turn for a team or an action the draft does not have", () => {
    expect(createDraft(config({ script: [{ teams: ["C"], action: "pick", count: 1 }] })).ok).toBe(false);
    expect(createDraft(config({ script: [{ teams: ["A"], action: "protect", count: 1 }] })).ok).toBe(false);
  });

  it("refuses teams or actions that share an id, and a pool that lists something twice", () => {
    expect(createDraft(config({ teams: [TEAMS[0]!, TEAMS[0]!] })).ok).toBe(false);
    expect(createDraft(config({ actions: [ACTIONS[0]!, { ...ACTIONS[1]!, id: "ban" }] })).ok).toBe(false);
    expect(createDraft(config({ pool: [...POOL, "a"] })).ok).toBe(false);
  });
});

describe("turn order", () => {
  it("walks the script in order and reports completion", () => {
    let state = start();
    expect(currentTurn(state)).toEqual({ teams: ["A"], action: "ban", count: 1 });
    state = play(state, "a");
    expect(currentTurn(state)).toEqual({ teams: ["B"], action: "ban", count: 1 });
    state = play(state, "b");
    state = play(state, "c");
    state = play(state, "d", "e");
    expect(isComplete(state)).toBe(false);
    state = play(state, "f");
    expect(isComplete(state)).toBe(true);
    expect(currentTurn(state)).toBeNull();
    expect(summarise(state).byTeam).toEqual({
      A: { ban: ["a"], pick: ["c", "f"] },
      B: { ban: ["b"], pick: ["d", "e"] },
    });
  });

  it("rejects an action from the team not on the clock", () => {
    const result = stage(start(), "B", "a");
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
    expect(legalItems(state, "A")).toEqual([]);
  });
});

describe("staging", () => {
  it("toggles on repeat selection", () => {
    let state = start();
    state = must(stage(state, "A", "a"));
    expect(stagedBy(state, "A")).toEqual(["a"]);
    state = must(stage(state, "A", "a"));
    expect(stagedBy(state, "A")).toEqual([]);
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
    expect(state.committed.at(-1)).toMatchObject({ team: "B", action: "pick", items: ["d", "e"] });
  });

  it("clears staging when a turn commits", () => {
    const state = play(start(), "a");
    expect(stagedBy(state, "A")).toEqual([]);
  });

  it("rejects unstaging something that is not staged", () => {
    const result = unstage(start(), "A", "a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_staged");
  });
});

describe("legality", () => {
  it("removes banned items from every team's options", () => {
    const state = play(start(), "a");
    expect(legalItems(state, "B")).not.toContain("a");
    expect(availability(state, "a")).toEqual({ state: "removed", by: "A", action: "ban" });
  });

  it("refuses to ban something that is already picked", () => {
    const state = play(start({ script: script("Apick, Bban") }), "a");
    const result = stage(state, "B", "a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("item_taken");
  });

  it("refuses a mirror pick by default", () => {
    const state = play(start({ script: script("Apick, Bpick") }), "a");
    const result = stage(state, "B", "a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("item_taken_by_opponent");
    expect(availability(state, "a")).toEqual({ state: "taken", by: ["A"], action: "pick" });
  });

  it("allows a mirror pick when the room enables it", () => {
    let state = play(start({ script: script("Apick, Bpick"), mirror: true }), "a");
    expect(legalItems(state, "B")).toContain("a");
    state = play(state, "a");
    expect(summarise(state).byTeam).toEqual({ A: { ban: [], pick: ["a"] }, B: { ban: [], pick: ["a"] } });
  });

  it("never lets one team pick the same thing twice, even with mirror on", () => {
    const state = play(start({ script: script("Apick, Apick"), mirror: true }), "a");
    const result = stage(state, "A", "a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("item_taken");
  });

  it("still refuses a repeat after the other team has mirrored it", () => {
    // When teams are allowed the same thing, each team's own claim on it has to
    // be remembered separately, or a team could end up with it twice.
    let state = start({ script: script("Apick, Bpick, Apick, Bpick"), mirror: true });
    state = play(state, "a"); // A picks a
    state = play(state, "a"); // B mirrors a
    state = play(state, "b"); // A picks b
    const result = stage(state, "B", "a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("item_taken");
  });

  it("reports every team once something is mirrored", () => {
    let state = play(start({ script: script("Apick, Bpick"), mirror: true }), "a");
    expect(availability(state, "a")).toEqual({ state: "taken", by: ["A"], action: "pick" });
    state = play(state, "a");
    expect(availability(state, "a")).toEqual({ state: "taken", by: ["A", "B"], action: "pick" });
  });

  it("never auto-fills something the team already holds under mirror rules", () => {
    let state = start({
      script: script("Apick, Bpick, Apick, Bpick"),
      mirror: true,
      autoFill: "lowestIndex",
      pool: ["a", "b", "c"],
    });
    state = play(state, "a");
    state = play(state, "a");
    state = play(state, "b");
    expect(autoFillSelection(state, "B")).toEqual(["b"]);
  });

  it("rejects something outside the pool", () => {
    const result = stage(start(), "A", "not-in-the-pool");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown_item");
  });
});

describe("timeout", () => {
  it("keeps what was staged and fills only the remainder", () => {
    let state = start();
    state = play(state, "a");
    state = play(state, "b");
    state = play(state, "c");
    state = must(stage(state, "B", "d"));
    const filled = autoFillSelection(state, "B");
    expect(filled).toHaveLength(2);
    expect(filled[0]).toBe("d");
    state = must(resolveTimeout(state));
    expect(state.committed.at(-1)).toMatchObject({ auto: true, items: filled });
  });

  it("fills both slots when a double pick was left untouched", () => {
    // The other half of the same rule: a captain who staged nothing at all on a
    // two-item turn is given two, not one, and the draft still moves on.
    let state = start();
    state = play(state, "a");
    state = play(state, "b");
    state = play(state, "c");
    const filled = autoFillSelection(state, "B");
    expect(filled).toHaveLength(2);
    expect(new Set(filled).size).toBe(2);
    state = must(resolveTimeout(state));
    expect(state.committed.at(-1)).toMatchObject({ auto: true, items: filled, team: "B" });
    expect(currentTurn(state)).toMatchObject({ teams: ["A"], action: "pick" });
  });

  it("is deterministic for a given seed and turn", () => {
    const first = autoFillSelection(start({ seed: "room-42" }), "A");
    const second = autoFillSelection(start({ seed: "room-42" }), "A");
    expect(first).toEqual(second);
  });

  it("differs between seeds, so a room cannot be predicted from another's log", () => {
    const draws = new Set(
      ["s1", "s2", "s3", "s4", "s5", "s6"].map((seed) => autoFillSelection(start({ seed }), "A").join()),
    );
    expect(draws.size).toBeGreaterThan(1);
  });

  it("takes the lowest-index legal item under the lowestIndex strategy", () => {
    let state = start({ autoFill: "lowestIndex" });
    state = must(resolveTimeout(state)); // A bans "a"
    expect(state.committed[0]?.items).toEqual(["a"]);
    state = must(resolveTimeout(state)); // B bans the next available
    expect(state.committed[1]?.items).toEqual(["b"]);
  });

  it("never auto-fills something illegal", () => {
    let state = start({ script: script("Aban, Bpick, Apick"), autoFill: "lowestIndex" });
    state = play(state, "a");
    state = play(state, "b");
    state = must(resolveTimeout(state));
    expect(state.committed.at(-1)?.items).toEqual(["c"]);
  });

  it("drops staged items that became illegal before resolving", () => {
    // Contrived but possible if legality changes under a captain: staged entries
    // are filtered, not trusted.
    let state = start({ script: script("Apick, Bpick"), autoFill: "lowestIndex" });
    state = play(state, "a");
    const tampered: DraftState = { ...state, staged: { B: ["a"] } };
    expect(autoFillSelection(tampered, "B")).toEqual(["b"]);
  });

  it("can resolve every turn of a draft nobody plays", () => {
    let state = start();
    while (!isComplete(state)) state = must(resolveTimeout(state));
    const { byTeam } = summarise(state);
    expect(byTeam.A?.pick).toHaveLength(2);
    expect(byTeam.B?.pick).toHaveLength(2);
    const all = Object.values(byTeam).flatMap((actions) => Object.values(actions).flat());
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("turns several teams play at once", () => {
  const blind = (): DraftState => start({ script: script("A+B ban, Apick, Bpick"), autoFill: "lowestIndex" });

  it("waits for every team before revealing anything", () => {
    let state = blind();
    expect(waitingOn(state)).toEqual(["A", "B"]);
    state = playAs(state, "B", "c");
    // B has confirmed, but nothing is settled and A is still choosing.
    expect(state.committed).toEqual([]);
    expect(waitingOn(state)).toEqual(["A"]);
    expect(availability(state, "c")).toEqual({ state: "available" });
    state = playAs(state, "A", "d");
    expect(state.committed.map((s) => [s.team, s.items])).toEqual([
      ["A", ["d"]],
      ["B", ["c"]],
    ]);
    expect(state.committed.every((s) => s.index === 0)).toBe(true);
    expect(currentTurn(state)).toEqual({ teams: ["A"], action: "pick", count: 1 });
  });

  it("lets each team stage separately, and refuses a second confirm", () => {
    let state = blind();
    state = must(stage(state, "A", "a"));
    state = must(stage(state, "B", "b"));
    expect(stagedBy(state, "A")).toEqual(["a"]);
    expect(stagedBy(state, "B")).toEqual(["b"]);
    state = must(commit(state, "A"));
    const again = stage(state, "A", "c");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("already_locked");
  });

  it("lets two teams land on the same thing, since neither could see the other", () => {
    let state = blind();
    state = playAs(state, "A", "a");
    state = playAs(state, "B", "a");
    expect(state.committed.map((s) => s.items)).toEqual([["a"], ["a"]]);
    expect(availability(state, "a")).toMatchObject({ state: "removed" });
  });

  it("times out only the team whose clock ran out", () => {
    let state = blind();
    state = playAs(state, "A", "e");
    state = must(resolveTimeout(state, 5, ["B"]));
    expect(state.committed).toEqual([
      { index: 0, team: "A", action: "ban", items: ["e"], auto: false, at: null },
      { index: 0, team: "B", action: "ban", items: ["a"], auto: true, at: 5 },
    ]);
  });

  it("gives each team its own dice, so one side's timeout says nothing about the other's", () => {
    const state = start({ script: script("A+B pick x3, A ban"), seed: "blind" });
    expect(autoFillSelection(state, "A")).not.toEqual(autoFillSelection(state, "B"));
  });
});

describe("turns nobody plays", () => {
  const veto = (): DraftState =>
    start({ script: script("Aban, Bban, Apick, Bpick, remaining pick"), pool: ["a", "b", "c", "d", "e"] });

  it("takes whatever is left the moment the draft reaches it", () => {
    let state = veto();
    state = play(state, "a");
    state = play(state, "b");
    state = play(state, "c");
    state = play(state, "d");
    expect(isComplete(state)).toBe(true);
    expect(state.committed.at(-1)).toEqual({ index: 4, team: null, action: "pick", items: ["e"], auto: true, at: null });
    expect(availability(state, "e")).toEqual({ state: "taken", by: [], action: "pick" });
  });

  it("takes it at the moment the turn before it was settled", () => {
    let state = veto();
    for (const item of ["a", "b", "c"]) state = play(state, item);
    state = must(commit(must(stage(state, "B", "d")), "B", 1234));
    expect(state.committed.at(-1)?.at).toBe(1234);
  });

  it("draws from what is left when more than one thing is", () => {
    let state = start({ script: script("Aban, remaining pick"), pool: ["a", "b", "c"], seed: "draw" });
    state = play(state, "a");
    expect(state.committed.at(-1)?.items).toHaveLength(1);
    expect(["b", "c"]).toContain(state.committed.at(-1)?.items[0]);
  });

  it("is settled before anybody arrives when a format opens with one", () => {
    const state = start({ script: script("remaining ban, Apick"), autoFill: "lowestIndex" });
    expect(state.committed).toEqual([{ index: 0, team: null, action: "ban", items: ["a"], auto: true, at: null }]);
    expect(currentTurn(state)).toEqual({ teams: ["A"], action: "pick", count: 1 });
  });
});

describe("any number of teams", () => {
  const three = [...TEAMS, { id: "C", name: "Team C" }];
  const vocab = { teams: ["A", "B", "C"], actions: ACTIONS };

  it("plays a three-team draft with the same rules", () => {
    let state = start({ teams: three, script: parseScript("Aban, Bban, Cban, Apick, Bpick, Cpick", vocab) });
    for (const item of ["a", "b", "c", "d", "e", "f"]) state = play(state, item);
    expect(isComplete(state)).toBe(true);
    expect(summarise(state).byTeam.C).toEqual({ ban: ["c"], pick: ["f"] });
    const result = createDraft(config({ teams: three, script: parseScript("A+B+C pick x2", vocab) }));
    expect(result.ok).toBe(true);
  });

  it("works with actions of any name that do the same two things", () => {
    const veto: readonly ActionDefinition[] = [
      { id: "strike", label: "Strike", past: "struck", effect: "remove" },
      { id: "choose", label: "Choose", past: "chosen", effect: "take" },
    ];
    const order = parseScript("A strike, B strike, A choose", { teams: ["A", "B"], actions: veto });
    let state = start({ actions: veto, script: order });
    state = play(state, "a");
    expect(availability(state, "a")).toEqual({ state: "removed", by: "A", action: "strike" });
    const refused = stage(state, "B", "a");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toMatch(/struck/);
  });
});

describe("format independence", () => {
  const formats: Record<string, string> = {
    "3v3": "Aban, Bban, Apick, Bpick x2, Apick x2, Bpick",
    "5v5": "Aban x2, Bban x2, Apick, Bpick x2, Apick x2, Bpick x2, Apick x2, Bpick",
    lopsided: "Apick x4, Bpick x2",
  };

  const BIG_POOL = Array.from({ length: 24 }, (_, i) => `item-${i}`);

  it.each(Object.entries(formats))("plays out %s with the same engine", (_name, notation) => {
    let state = must(createDraft(config({ script: script(notation), pool: BIG_POOL })));
    while (!isComplete(state)) state = must(resolveTimeout(state));
    expect(state.committed).toHaveLength(script(notation).length);
  });

  it("does not assume five picks per team", () => {
    let state = must(createDraft(config({ script: script("Apick x3, Bpick x3") })));
    while (!isComplete(state)) state = must(resolveTimeout(state));
    const { byTeam } = summarise(state);
    expect(byTeam.A?.pick).toHaveLength(3);
    expect(byTeam.B?.pick).toHaveLength(3);
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
    let state = start({ script: script("Aban, Bban, Apick, Bpick") });
    const order: Team[] = [];
    while (!isComplete(state)) {
      order.push(...currentTurn(state)!.teams);
      state = must(resolveTimeout(state));
    }
    expect(order).toEqual(["A", "B", "A", "B"]);
  });
});
