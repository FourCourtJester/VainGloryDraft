import { describe, expect, it, vi } from "vitest";
import { commit, createDraft, currentTurn, isComplete, resolveTimeout, stage } from "../src/engine.js";
import { DraftEventBus, diffEvents } from "../src/events.js";
import { parseScript } from "../src/script.js";
import type { DraftConfig, DraftState, Result } from "../src/types.js";

const CONFIG: DraftConfig = {
  script: parseScript("Aban, Bpick x2, Apick"),
  heroPool: ["a", "b", "c", "d", "e"],
  mirrorPicks: false,
  autoFill: "lowestIndex",
  seed: "s",
};

function must<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

function play(state: DraftState, ...heroes: string[]): DraftState {
  const team = currentTurn(state)!.team;
  let next = state;
  for (const hero of heroes) next = must(stage(next, team, hero));
  return must(commit(next, team));
}

describe("diffEvents", () => {
  it("emits a ban and the turn change that follows it", () => {
    const before = must(createDraft(CONFIG));
    const after = play(before, "a");
    expect(diffEvents(before, after)).toEqual([
      { type: "ban", team: "A", heroes: ["a"], turnIndex: 0, auto: false },
      { type: "turnChange", turnIndex: 1, turn: { team: "B", action: "pick", count: 2 } },
    ]);
  });

  it("emits one pick event for a multi-pick turn, not two", () => {
    let state = must(createDraft(CONFIG));
    state = play(state, "a");
    const after = play(state, "b", "c");
    const picks = diffEvents(state, after).filter((e) => e.type === "pick");
    expect(picks).toEqual([{ type: "pick", team: "B", heroes: ["b", "c"], turnIndex: 1, auto: false }]);
  });

  it("marks a timer-resolved turn as auto", () => {
    const before = must(createDraft(CONFIG));
    const after = must(resolveTimeout(before));
    expect(diffEvents(before, after)[0]).toMatchObject({ type: "ban", auto: true });
  });

  it("emits draftComplete instead of turnChange on the final turn", () => {
    let state = must(createDraft(CONFIG));
    state = play(state, "a");
    state = play(state, "b", "c");
    const after = play(state, "d");
    const events = diffEvents(state, after);
    expect(events.map((e) => e.type)).toEqual(["pick", "draftComplete"]);
    expect(events.at(-1)).toEqual({
      type: "draftComplete",
      picks: { A: ["d"], B: ["b", "c"] },
      bans: { A: ["a"], B: [] },
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
    expect(types).toEqual(["ban", "pick", "pick", "draftComplete"]);
  });
});

describe("DraftEventBus", () => {
  it("delivers events to every subscriber", () => {
    const bus = new DraftEventBus();
    const first = vi.fn();
    const second = vi.fn();
    bus.subscribe(first);
    bus.subscribe(second);
    bus.publish([{ type: "turnChange", turnIndex: 0, turn: { team: "A", action: "ban", count: 1 } }]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("filters by type with on()", () => {
    const bus = new DraftEventBus();
    const onPick = vi.fn();
    bus.on("pick", onPick);
    bus.publish([
      { type: "ban", team: "A", heroes: ["a"], turnIndex: 0, auto: false },
      { type: "pick", team: "B", heroes: ["b"], turnIndex: 1, auto: false },
    ]);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]?.[0]).toMatchObject({ heroes: ["b"] });
  });

  it("unsubscribes", () => {
    const bus = new DraftEventBus();
    const handler = vi.fn();
    const off = bus.subscribe(handler);
    off();
    bus.publish([{ type: "ban", team: "A", heroes: ["a"], turnIndex: 0, auto: false }]);
    expect(handler).not.toHaveBeenCalled();
    expect(bus.size).toBe(0);
  });

  it("does not let a throwing subscriber take down the draft", () => {
    const errors: unknown[] = [];
    const bus = new DraftEventBus((error) => errors.push(error));
    const healthy = vi.fn();
    bus.subscribe(() => {
      throw new Error("stats site is down");
    });
    bus.subscribe(healthy);
    bus.publish([{ type: "pick", team: "A", heroes: ["a"], turnIndex: 0, auto: false }]);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
  });

  it("tolerates a subscriber unsubscribing mid-publish", () => {
    const bus = new DraftEventBus();
    const later = vi.fn();
    const off = bus.subscribe(() => off());
    bus.subscribe(later);
    bus.publish([{ type: "ban", team: "A", heroes: ["a"], turnIndex: 0, auto: false }]);
    expect(later).toHaveBeenCalledTimes(1);
  });
});
