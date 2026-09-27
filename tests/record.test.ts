import { describe, expect, it } from "vitest";
import { commit, createDraft, currentTurn, isComplete, resolveTimeout, stage } from "../src/engine.js";
import { draftRecord } from "../src/record.js";
import type { DraftState, Team } from "../src/types.js";
import { ACTIONS, TEAMS, must, script } from "./helpers.js";

const T0 = 1_700_000_000_000;

function start(order = "Aban, Bban, Apick, Bpick x2"): DraftState {
  return must(
    createDraft({
      teams: TEAMS,
      actions: ACTIONS,
      script: script(order),
      pool: ["a", "b", "c", "d", "e", "f"],
      mirror: false,
      seed: "seed",
    }),
  );
}

function play(state: DraftState, at: number, ...heroes: string[]): DraftState {
  return playAs(state, currentTurn(state)!.teams[0]!, at, ...heroes);
}

function playAs(state: DraftState, team: Team, at: number, ...heroes: string[]): DraftState {
  let next = state;
  for (const hero of heroes) next = must(stage(next, team, hero));
  return must(commit(next, team, at));
}

describe("draftRecord", () => {
  it("reads back the draft in the order it happened", () => {
    let state = start();
    state = play(state, T0 + 5_000, "a");
    state = play(state, T0 + 12_000, "b");
    state = play(state, T0 + 20_000, "c");
    state = play(state, T0 + 26_000, "d", "e");

    const record = draftRecord(state, T0);
    expect(record.complete).toBe(true);
    expect(record.turns.map((turn) => `${turn.number}:${turn.team}${turn.action}`)).toEqual([
      "1:Aban",
      "2:Bban",
      "3:Apick",
      "4:Bpick",
    ]);
    expect(record.turns.at(-1)?.items).toEqual(["d", "e"]);
  });

  it("says how long each turn took, and the draft as a whole", () => {
    let state = start();
    state = play(state, T0 + 5_000, "a");
    state = play(state, T0 + 12_000, "b");
    state = play(state, T0 + 20_000, "c");
    state = play(state, T0 + 26_000, "d", "e");

    const record = draftRecord(state, T0);
    expect(record.turns.map((turn) => turn.tookMs)).toEqual([5_000, 7_000, 8_000, 6_000]);
    expect(record.durationMs).toBe(21_000);
  });

  it("times every team on a blind turn from when that turn began", () => {
    let state = start("A+B ban, Apick, remaining pick");
    state = playAs(state, "B", T0 + 4_000, "a");
    state = playAs(state, "A", T0 + 9_000, "b");
    state = play(state, T0 + 15_000, "c");
    const record = draftRecord(state, T0);
    expect(record.turns.map((turn) => [turn.number, turn.team, turn.tookMs])).toEqual([
      [1, "A", 9_000],
      [1, "B", 4_000],
      [2, "A", 6_000],
      [3, null, null],
    ]);
  });

  it("marks what the clock chose, and counts it per team", () => {
    let state = start();
    state = play(state, T0 + 5_000, "a");
    state = must(resolveTimeout(state, T0 + 95_000)); // B ran out of time
    state = play(state, T0 + 100_000, "c");
    state = must(resolveTimeout(state, T0 + 190_000)); // and again, on a two-hero turn

    const record = draftRecord(state, T0);
    expect(record.turns.map((turn) => turn.auto)).toEqual([false, true, false, true]);
    expect(record.autoCounts).toEqual({ A: 0, B: 3 });
  });

  it("reads a draft still in progress without pretending it is finished", () => {
    const record = draftRecord(play(start(), T0 + 5_000, "a"), T0);
    expect(record.complete).toBe(false);
    expect(record.turns).toHaveLength(1);
  });

  it("is empty, not broken, for a draft nobody has started", () => {
    expect(draftRecord(start(), T0)).toMatchObject({ complete: false, turns: [], durationMs: null });
  });

  it("survives being stored and read back, which is the whole point", () => {
    let state = start();
    state = play(state, T0 + 5_000, "a");
    state = play(state, T0 + 12_000, "b");
    const reloaded = JSON.parse(JSON.stringify(state)) as DraftState;
    expect(draftRecord(reloaded, T0)).toEqual(draftRecord(state, T0));
  });

  it("still reads back an older draft that was recorded without times", () => {
    let state = start();
    state = play(state, T0 + 5_000, "a");
    // Turns recorded before the room kept times are missing them.
    const older: DraftState = {
      ...state,
      committed: state.committed.map((turn) => ({ ...turn, at: null })),
    };
    const record = draftRecord(older, null);
    expect(record.turns[0]).toMatchObject({ team: "A", action: "ban", tookMs: null });
    expect(record.durationMs).toBeNull();
  });
});

describe("the length of a draft", () => {
  it("runs from the earliest choice to the latest, whichever team is listed first", () => {
    let state = start("A+B ban, Apick");
    state = playAs(state, "B", T0 + 2_000, "a");
    state = playAs(state, "A", T0 + 5_000, "b");
    state = play(state, T0 + 9_000, "c");
    expect(draftRecord(state, T0).durationMs).toBe(7_000);
  });
});
