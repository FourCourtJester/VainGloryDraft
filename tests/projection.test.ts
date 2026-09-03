import { describe, expect, it } from "vitest";
import { commit, createDraft, currentTurn, stage } from "../src/engine.js";
import { canSeeStaging, project } from "../src/projection.js";
import type { Presence, Viewer } from "../src/projection.js";
import { parseScript } from "../src/script.js";
import type { DraftConfig, DraftState, Result } from "../src/types.js";

const CONFIG: DraftConfig = {
  script: parseScript("Aban, Bpick x2, Apick"),
  heroPool: ["a", "b", "c", "d", "e"],
  mirrorPicks: false,
  autoFill: "lowestIndex",
  seed: "s",
};

const PRESENCE: Presence = { A: "connected", B: "disconnected" };
const CAPTAIN_A: Viewer = { role: "player", team: "A", memberId: "a1" };
const CAPTAIN_B: Viewer = { role: "player", team: "B", memberId: "b1" };
const SPECTATOR: Viewer = { role: "spectator" };

function must<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

/** Both sides full, both leaders, everybody ready — the state during a draft. */
function lobbyFor(viewer: Viewer) {
  const member = (id: string, team: "A" | "B") => ({
    id, name: id.toUpperCase(), team, ready: true, connected: true, leader: true,
    you: viewer.role === "player" && viewer.memberId === id,
  });
  return {
    teamSize: 1,
    members: [member("a1", "A"), member("b1", "B")],
    everyoneHere: true,
    everyoneReady: true,
    startAnyway: { A: false, B: false },
  };
}

function view(state: DraftState, viewer: Viewer) {
  return project({ state, viewer, presence: PRESENCE, clock: null, lobby: lobbyFor(viewer) });
}

function play(state: DraftState, ...heroes: string[]): DraftState {
  const team = currentTurn(state)!.team;
  let next = state;
  for (const hero of heroes) next = must(stage(next, team, hero));
  return must(commit(next, team));
}

describe("staging visibility", () => {
  it("shows the active captain their own staging", () => {
    const state = must(stage(must(createDraft(CONFIG)), "A", "a"));
    expect(view(state, CAPTAIN_A).staged).toEqual(["a"]);
  });

  it("shows spectators the active team's staging", () => {
    const state = must(stage(must(createDraft(CONFIG)), "A", "a"));
    expect(view(state, SPECTATOR).staged).toEqual(["a"]);
  });

  it("hides staging from the captain who is not on the clock", () => {
    const clean = must(createDraft(CONFIG));
    const staged = must(stage(clean, "A", "a")); // turn 0 is a single ban
    const opponent = view(staged, CAPTAIN_B);
    expect(opponent.staged).toBeNull();
    // The opposing captain may know how many heroes have been chosen, but must
    // not be able to work out which ones from anything they are sent.
    expect({ ...opponent, stagedCount: 0 }).toEqual({ ...view(clean, CAPTAIN_B), stagedCount: 0 });
  });

  it("still tells everyone how many slots are filled", () => {
    const state = must(stage(must(createDraft(CONFIG)), "A", "a"));
    expect(view(state, CAPTAIN_B).stagedCount).toBe(1);
  });

  it("shows nobody staging once the draft is complete", () => {
    let state = must(createDraft(CONFIG));
    state = play(state, "a");
    state = play(state, "b", "c");
    state = play(state, "d");
    expect(canSeeStaging(state, SPECTATOR)).toBe(false);
    expect(view(state, SPECTATOR).staged).toBeNull();
  });
});

describe("selectable heroes", () => {
  it("offers selections only to the captain on the clock", () => {
    const state = must(createDraft(CONFIG));
    expect(view(state, CAPTAIN_A).selectable).toEqual(["a", "b", "c", "d", "e"]);
    expect(view(state, CAPTAIN_B).selectable).toEqual([]);
    expect(view(state, SPECTATOR).selectable).toEqual([]);
  });

  it("drops banned and picked heroes from the offer", () => {
    let state = must(createDraft(CONFIG));
    state = play(state, "a");
    state = play(state, "b", "c");
    expect(view(state, CAPTAIN_A).selectable).toEqual(["d", "e"]);
  });
});

describe("shared view", () => {
  it("gives every viewer the same committed picks, bans and availability", () => {
    let state = must(createDraft(CONFIG));
    state = play(state, "a");
    const a = view(state, CAPTAIN_A);
    const b = view(state, CAPTAIN_B);
    expect(a.picks).toEqual(b.picks);
    expect(a.bans).toEqual(b.bans);
    expect(a.heroes).toEqual(b.heroes);
    expect(a.heroes[0]).toEqual({ id: "a", availability: { state: "banned" } });
  });

  it("reports connection state without acting on it", () => {
    const state = must(createDraft(CONFIG));
    const projection = view(state, SPECTATOR);
    expect(projection.presence).toEqual({ A: "connected", B: "disconnected" });
    // Somebody dropping out changes nothing about whose turn it is.
    expect(projection.turn).toEqual({ team: "A", action: "ban", count: 1 });
  });

  it("passes the clock through untouched so clients derive their own countdown", () => {
    const clock = { turnStartedAt: 1_000, perTurnMs: 30_000, bank: { A: 60_000, B: 60_000 }, expiresAt: 91_000 };
    const projection = project({
      state: must(createDraft(CONFIG)), viewer: SPECTATOR, presence: PRESENCE, clock, lobby: lobbyFor(SPECTATOR),
    });
    expect(projection.clock).toEqual(clock);
  });
});
