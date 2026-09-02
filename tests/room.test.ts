import { describe, expect, it } from "vitest";
import { currentTurn } from "../src/engine.js";
import { parseClientMessage } from "../src/room/protocol.js";
import { parseAutoFill, parseTimerRules } from "../src/room/options.js";
import { DEFAULT_TIMER_RULES, Room } from "../src/room/room.js";
import type { RoomSnapshot } from "../src/room/room.js";
import { generateRoomTokens, generateToken, tokensMatch } from "../src/room/tokens.js";
import { parseScript } from "../src/script.js";
import type { Viewer } from "../src/projection.js";

const T0 = 1_700_000_000_000;
const CAPTAIN_A: Viewer = { role: "captain", team: "A" };
const CAPTAIN_B: Viewer = { role: "captain", team: "B" };
const SPECTATOR: Viewer = { role: "spectator" };
const TOKENS = { A: "token-a-aaaaaaaaaaaaaaaa", B: "token-b-bbbbbbbbbbbbbbbb", spectator: "token-s-ssssssssssssssss" };

function snapshot(overrides: Parameters<typeof Room.create>[0] = {}): RoomSnapshot {
  return Room.create(
    {
      script: parseScript("Aban, Bban, Apick, Bpick x2, Apick"),
      heroPool: ["a", "b", "c", "d", "e", "f", "g"],
      autoFill: "lowestIndex",
      seed: "seed",
      tokens: TOKENS,
      roomId: "room-1",
      ...overrides,
    },
    T0,
  );
}

/** A room with both captains and a spectator connected, so the draft is live. */
function liveRoom(overrides: Parameters<typeof Room.create>[0] = {}): Room {
  const room = new Room(snapshot(overrides));
  room.attach("a1", CAPTAIN_A, T0);
  room.attach("b1", CAPTAIN_B, T0);
  room.attach("s1", SPECTATOR, T0);
  return room;
}

function play(room: Room, now: number, ...heroes: string[]): void {
  const team = currentTurn(room.snapshot.draft)!.team;
  const viewer: Viewer = { role: "captain", team };
  for (const hero of heroes) {
    const result = room.command(viewer, { t: "stage", heroId: hero }, now);
    if (result.error !== null) throw new Error(result.error.message);
  }
  const confirmed = room.command(viewer, { t: "confirm" }, now);
  if (confirmed.error !== null) throw new Error(confirmed.error.message);
}

describe("tokens", () => {
  it("maps each token to its viewer and rejects anything else", () => {
    const room = new Room(snapshot());
    expect(room.authenticate(TOKENS.A)).toEqual(CAPTAIN_A);
    expect(room.authenticate(TOKENS.B)).toEqual(CAPTAIN_B);
    expect(room.authenticate(TOKENS.spectator)).toEqual(SPECTATOR);
    expect(room.authenticate("guess")).toBeNull();
    expect(room.authenticate("")).toBeNull();
  });

  it("issues three distinct, URL-safe tokens per room", () => {
    const tokens = generateRoomTokens();
    expect(new Set([tokens.A, tokens.B, tokens.spectator]).size).toBe(3);
    for (const token of Object.values(tokens)) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("does not repeat tokens across rooms", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateToken()));
    expect(seen.size).toBe(50);
  });

  it("compares without leaking length or position", () => {
    expect(tokensMatch("abc", "abc")).toBe(true);
    expect(tokensMatch("abc", "abd")).toBe(false);
    expect(tokensMatch("abc", "abcd")).toBe(false);
  });

  it("stays usable after a reconnect — links are reusable by decision", () => {
    const room = new Room(snapshot());
    room.attach("a1", room.authenticate(TOKENS.A)!, T0);
    room.detach("a1", T0);
    expect(room.authenticate(TOKENS.A)).toEqual(CAPTAIN_A);
  });
});

describe("lobby", () => {
  it("does not start, or burn clock, until both captains are present", () => {
    const room = new Room(snapshot());
    room.attach("s1", SPECTATOR, T0);
    room.attach("a1", CAPTAIN_A, T0);
    expect(room.phase).toBe("lobby");
    expect(room.alarmAt()).toBeNull();
    expect(room.clock(T0 + 600_000)).toBeNull();

    // Ten minutes in the lobby costs nothing.
    room.tick(T0 + 600_000);
    expect(room.snapshot.draft.committed).toHaveLength(0);

    room.attach("b1", CAPTAIN_B, T0 + 600_000);
    expect(room.phase).toBe("drafting");
    expect(room.alarmAt()).toBe(T0 + 600_000 + 90_000);
  });

  it("refuses commands before the draft starts", () => {
    const room = new Room(snapshot());
    room.attach("a1", CAPTAIN_A, T0);
    expect(room.command(CAPTAIN_A, { t: "stage", heroId: "a" }, T0).error?.code).toBe("not_started");
  });

  it("treats a captain's second device as the same captain", () => {
    const room = new Room(snapshot());
    room.attach("a1", CAPTAIN_A, T0);
    room.attach("a2", CAPTAIN_A, T0);
    expect(room.phase).toBe("lobby");
    expect(room.presence()).toEqual({ A: "connected", B: "disconnected" });
  });
});

describe("commands", () => {
  it("runs a whole draft to completion", () => {
    const room = liveRoom();
    play(room, T0 + 1_000, "a");
    play(room, T0 + 2_000, "b");
    play(room, T0 + 3_000, "c");
    play(room, T0 + 4_000, "d", "e");
    play(room, T0 + 5_000, "f");
    expect(room.phase).toBe("complete");
    expect(room.alarmAt()).toBeNull();
  });

  it("rejects a spectator trying to act", () => {
    const room = liveRoom();
    expect(room.command(SPECTATOR, { t: "stage", heroId: "a" }, T0).error?.code).toBe("not_a_captain");
  });

  it("rejects the captain who is not on the clock", () => {
    const room = liveRoom();
    expect(room.command(CAPTAIN_B, { t: "stage", heroId: "a" }, T0).error?.code).toBe("wrong_team");
  });

  it("rejects an illegal hero without disturbing the draft", () => {
    const room = liveRoom();
    play(room, T0 + 1_000, "a");
    const result = room.command(CAPTAIN_B, { t: "stage", heroId: "a" }, T0 + 2_000);
    expect(result.error?.code).toBe("hero_banned");
    expect(room.snapshot.draft.staged).toEqual([]);
  });

  it("emits committed actions, never staging", () => {
    const room = liveRoom();
    const staged = room.command(CAPTAIN_A, { t: "stage", heroId: "a" }, T0 + 1_000);
    expect(staged.events).toEqual([]);
    const confirmed = room.command(CAPTAIN_A, { t: "confirm" }, T0 + 2_000);
    expect(confirmed.events[0]).toMatchObject({ type: "ban", team: "A", heroes: ["a"], auto: false });
  });

  it("treats resync as a no-op that still gets a fresh view", () => {
    const room = liveRoom();
    const result = room.command(CAPTAIN_A, { t: "resync" }, T0 + 1_000);
    expect(result).toEqual({ events: [], error: null, changed: true });
  });
});

describe("the clock", () => {
  it("charges only the overrun to the acting team", () => {
    const room = liveRoom();
    play(room, T0 + 50_000, "a"); // 20s into A's bank
    expect(room.snapshot.timer.bank).toEqual({ A: 40_000, B: 60_000 });
  });

  it("auto-resolves a turn whose deadline passed, at the deadline", () => {
    const room = liveRoom();
    const deadline = room.alarmAt()!;
    const outcome = room.tick(deadline + 5_000);
    expect(outcome.events[0]).toMatchObject({ type: "ban", team: "A", auto: true });
    expect(room.snapshot.timer.turnStartedAt).toBe(deadline);
    expect(room.snapshot.timer.bank.A).toBe(0);
  });

  it("catches up several turns when an alarm fires very late", () => {
    const room = liveRoom();
    const outcome = room.tick(T0 + 10 * 60_000);
    expect(room.phase).toBe("complete");
    expect(outcome.events.filter((e) => e.type === "pick" || e.type === "ban")).toHaveLength(5);
    expect(outcome.events.at(-1)?.type).toBe("draftComplete");
  });

  it("keeps burning while a captain is gone — there is no pause", () => {
    const room = liveRoom();
    room.detach("a1", T0 + 1_000);
    expect(room.presence()).toEqual({ A: "disconnected", B: "connected" });
    expect(room.alarmAt()).toBe(T0 + 90_000);
    room.tick(T0 + 90_000);
    expect(room.snapshot.draft.committed[0]).toMatchObject({ auto: true });
  });

  it("will not let a late click beat an expiry that already happened", () => {
    const room = liveRoom();
    const deadline = room.alarmAt()!;
    const result = room.command(CAPTAIN_A, { t: "stage", heroId: "a" }, deadline + 1);
    // A's ban was resolved by the clock; the click lands on B's turn instead.
    expect(result.events[0]).toMatchObject({ type: "ban", auto: true });
    expect(result.error?.code).toBe("wrong_team");
  });

  it("gives each turn its own fresh per-turn time", () => {
    const room = liveRoom();
    play(room, T0 + 10_000, "a");
    expect(room.clock(T0 + 10_000)?.expiresAt).toBe(T0 + 10_000 + 90_000);
  });

  it("stops the clock when the draft completes", () => {
    const room = liveRoom();
    room.tick(T0 + 10 * 60_000);
    expect(room.clock(T0 + 10 * 60_000)).toBeNull();
    expect(room.alarmAt()).toBeNull();
  });
});

describe("audience", () => {
  it("gives each connection a view filtered by its token", () => {
    const room = liveRoom();
    room.command(CAPTAIN_A, { t: "stage", heroId: "a" }, T0 + 1_000);
    const views = new Map([...room.audience(T0 + 1_000)].map((entry) => [entry.connectionId, entry.projection]));
    expect(views.get("a1")?.staged).toEqual(["a"]);
    expect(views.get("s1")?.staged).toEqual(["a"]);
    expect(views.get("b1")?.staged).toBeNull();
    expect(views.get("b1")?.stagedCount).toBe(1);
  });

  it("reports connection state to everyone", () => {
    const room = liveRoom();
    room.detach("b1", T0 + 1_000);
    for (const { projection } of room.audience(T0 + 1_000)) {
      expect(projection.presence).toEqual({ A: "connected", B: "disconnected" });
    }
  });
});

describe("persistence", () => {
  it("rebuilds an identical room from its snapshot", () => {
    const room = liveRoom();
    play(room, T0 + 1_000, "a");
    play(room, T0 + 2_000, "b");

    const stored = JSON.parse(JSON.stringify(room.snapshot)) as RoomSnapshot;
    const restored = new Room(stored);
    restored.attach("a1", CAPTAIN_A, T0 + 3_000);
    restored.attach("b1", CAPTAIN_B, T0 + 3_000);

    expect(restored.phase).toBe("drafting");
    expect(restored.alarmAt()).toBe(room.alarmAt());
    expect(restored.snapshot.draft).toEqual(room.snapshot.draft);
    // The restored room resolves the same auto-action as the original would.
    expect(restored.tick(restored.alarmAt()!).events).toEqual(room.tick(room.alarmAt()!).events);
  });

  it("keeps the resolved script, so an edited preset cannot change a live room", () => {
    const room = new Room(snapshot());
    expect(room.snapshot.draft.config.script).toHaveLength(5);
  });
});

describe("defaults", () => {
  it("uses the 5v5 standard script and the full roster when nothing is specified", () => {
    const room = new Room(Room.create({}, T0));
    expect(room.snapshot.draft.config.script).toHaveLength(14);
    expect(room.snapshot.draft.config.heroPool.length).toBeGreaterThan(50);
    expect(room.snapshot.rules).toEqual(DEFAULT_TIMER_RULES);
  });

  it("refuses to create a room whose script the pool cannot satisfy", () => {
    expect(() => Room.create({ heroPool: ["a", "b"] }, T0)).toThrow(/Cannot create room/);
  });
});

describe("parseClientMessage", () => {
  it("accepts the four commands", () => {
    expect(parseClientMessage('{"t":"confirm"}')).toEqual({ t: "confirm" });
    expect(parseClientMessage('{"t":"resync"}')).toEqual({ t: "resync" });
    expect(parseClientMessage('{"t":"stage","heroId":"ozo"}')).toEqual({ t: "stage", heroId: "ozo" });
    expect(parseClientMessage('{"t":"unstage","heroId":"ozo"}')).toEqual({ t: "unstage", heroId: "ozo" });
  });

  it("returns null for anything else rather than throwing", () => {
    for (const raw of ["", "null", "[]", "not json", '{"t":"drop_table"}', '{"t":"stage"}', '{"t":"stage","heroId":7}']) {
      expect(parseClientMessage(raw)).toBeNull();
    }
  });

  it("ignores a claim about who is sending — identity comes from the token", () => {
    expect(parseClientMessage('{"t":"confirm","team":"B","role":"captain"}')).toEqual({ t: "confirm" });
  });
});

describe("option validation", () => {
  it("keeps the defaults when nothing is supplied", () => {
    expect(parseTimerRules(undefined, undefined)).toEqual({ rules: DEFAULT_TIMER_RULES, problems: [] });
  });

  it("accepts sane values", () => {
    expect(parseTimerRules(45_000, 0).rules).toEqual({ perTurnMs: 45_000, bankMs: 0 });
  });

  it("refuses values that would break the clock", () => {
    // A NaN or a negative deadline reaches the alarm, where it is unrecoverable.
    for (const bad of [Number.NaN, Infinity, -1, 0, "30000", true, {}]) {
      expect(parseTimerRules(bad, undefined).problems.length).toBeGreaterThan(0);
    }
    expect(parseTimerRules(30_000, -5).problems).toHaveLength(1);
    expect(parseTimerRules(30_000, 10 ** 12).problems).toHaveLength(1);
  });

  it("falls back rather than storing a bad value", () => {
    expect(parseTimerRules(Number.NaN, undefined).rules).toEqual(DEFAULT_TIMER_RULES);
  });

  it("only accepts the two auto-fill strategies", () => {
    expect(parseAutoFill("random")).toBe("random");
    expect(parseAutoFill("lowestIndex")).toBe("lowestIndex");
    for (const bad of ["lowest", "", null, 7]) expect(parseAutoFill(bad)).toBeUndefined();
  });
});
