import { describe, expect, it } from "vitest";
import { commit, createDraft, currentTurn, isComplete, resolveTimeout, stage } from "../src/engine.js";
import { draftRecord } from "../src/record.js";
import { parseScript } from "../src/script.js";
import type { DraftState, Result } from "../src/types.js";

const T0 = 1_700_000_000_000;

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function start(): DraftState {
  return must(
    createDraft({
      script: parseScript("Aban, Bban, Apick, Bpick x2"),
      heroPool: ["a", "b", "c", "d", "e", "f"],
      mirrorPicks: false,
      autoFill: "lowestIndex",
      seed: "seed",
    }),
  );
}

function play(state: DraftState, at: number, ...heroes: string[]): DraftState {
  const team = currentTurn(state)!.team;
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
    expect(record.turns.at(-1)?.heroes).toEqual(["d", "e"]);
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

  it("marks the heroes the clock chose, and counts them per team", () => {
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
