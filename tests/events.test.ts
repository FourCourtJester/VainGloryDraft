import { describe, expect, it } from "vitest";
import { commit, createDraft, currentTurn, isComplete, resolveTimeout, stage } from "../src/engine.js";
import { diffEvents } from "../src/events.js";
import type { DraftConfig, DraftState } from "../src/types.js";
import { ACTIONS, TEAMS, must, script } from "./helpers.js";

const CONFIG: DraftConfig = {
  teams: TEAMS,
  actions: ACTIONS,
  script: script("Aban, Bpick x2, Apick"),
  pool: ["a", "b", "c", "d", "e"],
  mirror: false,
  seed: "s",
};

function play(state: DraftState, ...heroes: string[]): DraftState {
  const team = currentTurn(state)!.teams[0]!;
  let next = state;
  for (const hero of heroes) next = must(stage(next, team, hero));
  return must(commit(next, team));
}

describe("diffEvents", () => {
  it("emits a ban and the turn change that follows it", () => {
    const before = must(createDraft(CONFIG));
    const after = play(before, "a");
    expect(diffEvents(before, after)).toEqual([
      { type: "choice", team: "A", action: "ban", items: ["a"], turnIndex: 0, auto: false },
      { type: "turnChange", turnIndex: 1, turn: { teams: ["B"], action: "pick", count: 2 } },
    ]);
  });

  it("emits one event for a multi-pick turn, not two", () => {
    let state = must(createDraft(CONFIG));
    state = play(state, "a");
    const after = play(state, "b", "c");
    const choices = diffEvents(state, after).filter((e) => e.type === "choice");
    expect(choices).toEqual([
      { type: "choice", team: "B", action: "pick", items: ["b", "c"], turnIndex: 1, auto: false },
    ]);
  });

  it("says nothing about a blind turn until every team has chosen, then says it all", () => {
    const blind = { ...CONFIG, script: script("A+B ban, Apick") };
    const before = must(createDraft(blind));
    const halfway = must(commit(must(stage(before, "B", "a")), "B"));
    expect(diffEvents(before, halfway)).toEqual([]);
    const after = must(commit(must(stage(halfway, "A", "b")), "A"));
    expect(diffEvents(halfway, after).map((e) => (e.type === "choice" ? `${e.team}:${e.items.join()}` : e.type))).toEqual([
      "A:b",
      "B:a",
      "turnChange",
    ]);
  });

  it("announces what the draft takes itself, with nobody's name on it", () => {
    const veto = { ...CONFIG, script: script("Aban, remaining pick"), pool: ["a", "b"] };
    const before = must(createDraft(veto));
    const after = play(before, "a");
    expect(diffEvents(before, after)).toEqual([
      { type: "choice", team: "A", action: "ban", items: ["a"], turnIndex: 0, auto: false },
      { type: "choice", team: null, action: "pick", items: ["b"], turnIndex: 1, auto: true },
      { type: "draftComplete", byTeam: { A: { ban: ["a"], pick: [] }, B: { ban: [], pick: [] } } },
    ]);
  });

  it("marks a timer-resolved turn as auto", () => {
    const before = must(createDraft(CONFIG));
    const after = must(resolveTimeout(before));
    expect(diffEvents(before, after)[0]).toMatchObject({ type: "choice", action: "ban", auto: true });
  });

  it("emits draftComplete instead of turnChange on the final turn", () => {
    let state = must(createDraft(CONFIG));
    state = play(state, "a");
    state = play(state, "b", "c");
    const after = play(state, "d");
    const events = diffEvents(state, after);
    expect(events.map((e) => e.type)).toEqual(["choice", "draftComplete"]);
    expect(events.at(-1)).toEqual({
      type: "draftComplete",
      byTeam: { A: { ban: ["a"], pick: ["d"] }, B: { ban: [], pick: ["b", "c"] } },
    });
  });

  it("emits nothing for a staging-only change, so staging never leaks through events", () => {
    const before = must(createDraft(CONFIG));
    const after = must(stage(before, "A", "a"));
    expect(diffEvents(before, after)).toEqual([]);
  });

  it("replays the same stream from a stored state as from a live one", () => {
    let live = must(createDraft(CONFIG));
    const start = live;
    live = play(live, "a");
    live = play(live, "b", "c");
    const restored: DraftState = JSON.parse(JSON.stringify(live)) as DraftState;
    expect(diffEvents(start, restored)).toEqual(diffEvents(start, live));
  });

  it("covers multiple turns at once when catching up", () => {
    const start = must(createDraft(CONFIG));
    let state = start;
    while (!isComplete(state)) state = must(resolveTimeout(state));
    const types = diffEvents(start, state).map((e) => e.type);
    expect(types).toEqual(["choice", "choice", "choice", "draftComplete"]);
  });
});
