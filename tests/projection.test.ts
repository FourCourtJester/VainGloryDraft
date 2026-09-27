import { describe, expect, it } from "vitest";
import { commit, createDraft, currentTurn, stage } from "../src/engine.js";
import { canSeeStaging, project } from "../src/projection.js";
import type { Presence, Viewer } from "../src/projection.js";
import type { DraftConfig, DraftState } from "../src/types.js";
import { ACTIONS, TEAMS, must, script } from "./helpers.js";

const CONFIG: DraftConfig = {
  teams: TEAMS,
  actions: ACTIONS,
  script: script("Aban, Bpick x2, Apick"),
  pool: ["a", "b", "c", "d", "e"],
  mirror: false,
  autoFill: "lowestIndex",
  seed: "s",
};

const PRESENCE: Presence = { A: "connected", B: "disconnected" };
const CAPTAIN_A: Viewer = { role: "player", team: "A", memberId: "a1" };
const CAPTAIN_B: Viewer = { role: "player", team: "B", memberId: "b1" };
const SPECTATOR: Viewer = { role: "spectator" };

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
  return project({
    state, game: "test", viewer, presence: PRESENCE, clock: null, lobby: lobbyFor(viewer),
    suggestions: [], yourSuggestions: {},
  });
}

function play(state: DraftState, ...heroes: string[]): DraftState {
  const team = currentTurn(state)!.teams[0]!;
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
    expect({ ...opponent, stagedCount: {} }).toEqual({ ...view(clean, CAPTAIN_B), stagedCount: {} });
  });

  it("still tells everyone how many slots are filled", () => {
    const state = must(stage(must(createDraft(CONFIG)), "A", "a"));
    expect(view(state, CAPTAIN_B).stagedCount).toEqual({ A: 1 });
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

describe("blind turns", () => {
  const blind = { ...CONFIG, script: script("A+B ban, Apick") };

  it("shows each team only its own choice, and spectators neither", () => {
    let state = must(createDraft(blind));
    state = must(stage(state, "A", "a"));
    state = must(stage(state, "B", "b"));
    expect(view(state, CAPTAIN_A).staged).toEqual(["a"]);
    expect(view(state, CAPTAIN_B).staged).toEqual(["b"]);
    // A spectator link is one anybody can open, captains included.
    expect(view(state, SPECTATOR).staged).toBeNull();
    expect(view(state, SPECTATOR).stagedCount).toEqual({ A: 1, B: 1 });
  });

  it("tells everybody who has confirmed, and only that team what it confirmed", () => {
    let state = must(createDraft(blind));
    state = must(commit(must(stage(state, "B", "b")), "B"));
    expect(view(state, SPECTATOR).locked).toEqual(["B"]);
    expect(view(state, CAPTAIN_B).yourLock).toEqual(["b"]);
    expect(view(state, CAPTAIN_A).yourLock).toBeNull();
    expect(view(state, SPECTATOR).yourLock).toBeNull();
    // A team that has confirmed has nothing left to click.
    expect(view(state, CAPTAIN_B).selectable).toEqual([]);
    expect(view(state, CAPTAIN_A).selectable).toHaveLength(5);
    // And nothing about B's choice shows in the pool before the reveal.
    expect(view(state, CAPTAIN_A).pool.every((entry) => entry.availability.state === "available")).toBe(true);
  });
});

describe("selectable items", () => {
  it("offers selections only to the captain on the clock", () => {
    const state = must(createDraft(CONFIG));
    expect(view(state, CAPTAIN_A).selectable).toEqual(["a", "b", "c", "d", "e"]);
    expect(view(state, CAPTAIN_B).selectable).toEqual([]);
    expect(view(state, SPECTATOR).selectable).toEqual([]);
  });

  it("drops banned and picked items from the offer", () => {
    let state = must(createDraft(CONFIG));
    state = play(state, "a");
    state = play(state, "b", "c");
    expect(view(state, CAPTAIN_A).selectable).toEqual(["d", "e"]);
  });
});

describe("shared view", () => {
  it("gives every viewer the same committed choices and availability", () => {
    let state = must(createDraft(CONFIG));
    state = play(state, "a");
    const a = view(state, CAPTAIN_A);
    const b = view(state, CAPTAIN_B);
    expect(a.byTeam).toEqual(b.byTeam);
    expect(a.pool).toEqual(b.pool);
    expect(a.pool[0]).toEqual({ id: "a", availability: { state: "removed", by: "A", action: "ban" } });
  });

  it("carries the teams, the actions and the game, so a screen needs no rules of its own", () => {
    const projection = view(must(createDraft(CONFIG)), SPECTATOR);
    expect(projection.teams).toEqual(TEAMS);
    expect(projection.actions).toEqual(ACTIONS);
    expect(projection.game).toBe("test");
  });

  it("reports connection state without acting on it", () => {
    const state = must(createDraft(CONFIG));
    const projection = view(state, SPECTATOR);
    expect(projection.presence).toEqual({ A: "connected", B: "disconnected" });
    // Somebody dropping out changes nothing about whose turn it is.
    expect(projection.turn).toEqual({ teams: ["A"], action: "ban", count: 1 });
  });

  it("passes the clock through untouched so clients derive their own countdown", () => {
    const clock = { turnStartedAt: 1_000, allowanceMs: 30_000, bank: { A: 60_000, B: 60_000 }, deadlines: { A: 91_000 } };
    const projection = project({
      state: must(createDraft(CONFIG)), game: "test", viewer: SPECTATOR, presence: PRESENCE, clock, lobby: lobbyFor(SPECTATOR),
      suggestions: [], yourSuggestions: {},
    });
    expect(projection.clock).toEqual(clock);
  });
});
