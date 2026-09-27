import { describe, expect, it } from "vitest";
import { currentTurn } from "../src/engine.js";
import { parseClientMessage } from "../src/room/protocol.js";
import { parseAutoFill, parseTimerRules } from "../src/room/options.js";
import { DEFAULT_TIMER_RULES, Room } from "../src/room/room.js";
import type { RoomSnapshot } from "../src/room/room.js";
import { credentialsMatch, generateCode, generateCredentials, generateToken, normaliseCode } from "../src/room/tokens.js";
import type { Viewer } from "../src/projection.js";
import { ACTIONS, TEAMS, script } from "./helpers.js";

const T0 = 1_700_000_000_000;
// `seat` scopes a player's id to their side, so that is what a viewer carries.
const CAPTAIN_A: Viewer = { role: "player", team: "A", memberId: "A:a1" };
const CAPTAIN_B: Viewer = { role: "player", team: "B", memberId: "B:b1" };
const SPECTATOR: Viewer = { role: "spectator" };
const CODES = { A: "AAAAAA", B: "BBBBBB" };
const CREDS = { codes: CODES, spectator: "spectator-token-ssssssss" };

type Overrides = Partial<Parameters<typeof Room.create>[0]>;

function snapshotOptions(): Parameters<typeof Room.create>[0] {
  return {
    game: "test",
    teams: TEAMS,
    actions: ACTIONS,
    script: script("Aban, Bban, Apick, Bpick x2, Apick"),
    pool: ["a", "b", "c", "d", "e", "f", "g"],
    autoFill: "lowestIndex",
    seed: "seed",
    credentials: CREDS,
    roomId: "room-1",
    teamSize: 1,
  };
}

function snapshot(overrides: Overrides = {}): RoomSnapshot {
  return Room.create({ ...snapshotOptions(), ...overrides }, T0);
}

/** Seats one player per side and a spectator, without readying anybody up. */
function seatedRoom(overrides: Overrides = {}): Room {
  const room = new Room(snapshot(overrides));
  room.attach("c-a1", room.seat("A", "a1", "Ana", T0), T0);
  room.attach("c-b1", room.seat("B", "b1", "Ben", T0), T0);
  room.attach("c-s1", SPECTATOR, T0);
  return room;
}

/** The same, with everybody ready, so the draft is under way. */
function liveRoom(overrides: Overrides = {}): Room {
  const room = seatedRoom(overrides);
  room.command(CAPTAIN_A, { t: "ready", ready: true }, T0);
  room.command(CAPTAIN_B, { t: "ready", ready: true }, T0);
  return room;
}

function play(room: Room, now: number, ...heroes: string[]): void {
  const team = currentTurn(room.snapshot.draft)!.teams[0]!;
  playAs(room, team === "A" ? CAPTAIN_A : CAPTAIN_B, now, ...heroes);
}

function playAs(room: Room, viewer: Viewer, now: number, ...heroes: string[]): void {
  for (const hero of heroes) {
    const result = room.command(viewer, { t: "stage", itemId: hero }, now);
    if (result.error !== null) throw new Error(result.error.message);
  }
  const confirmed = room.command(viewer, { t: "confirm" }, now);
  if (confirmed.error !== null) throw new Error(confirmed.error.message);
}

describe("getting into a room", () => {
  it("gives each credential its seat and turns away anything else", () => {
    const room = new Room(snapshot());
    expect(room.authenticate(CODES.A)).toBe("A");
    expect(room.authenticate(CODES.B)).toBe("B");
    expect(room.authenticate(CREDS.spectator)).toBe("spectator");
    expect(room.authenticate("QQQQQQ")).toBeNull();
    expect(room.authenticate("")).toBeNull();
  });

  it("takes a captain's code however they typed it", () => {
    const room = new Room(snapshot());
    expect(room.authenticate("aaaaaa")).toBe("A");
    expect(room.authenticate("  bbbbbb ")).toBe("B");
    expect(room.authenticate("aa-aaaa")).toBe("A");
    expect(normaliseCode(" ab-cd ef ")).toBe("ABCDEF");
  });

  it("draws codes people can read aloud, with no lookalike characters", () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it("gives every room its own credentials", () => {
    const rooms = Array.from({ length: 40 }, () => generateCredentials(["A", "B"]));
    expect(new Set(rooms.map((r) => r.codes.A)).size).toBe(40);
    expect(new Set(rooms.flatMap((r) => [r.codes.A, r.codes.B])).size).toBe(80);
  });

  it("hands out a code for every team, however many there are", () => {
    const credentials = generateCredentials(["Red", "Green", "Blue"]);
    expect(Object.keys(credentials.codes)).toEqual(["Red", "Green", "Blue"]);
    expect(new Set(Object.values(credentials.codes)).size).toBe(3);
  });

  it("does not repeat spectator tokens across rooms", () => {
    expect(new Set(Array.from({ length: 50 }, () => generateToken())).size).toBe(50);
  });

  it("compares without leaking length or position", () => {
    expect(credentialsMatch("abc", "abc")).toBe(true);
    expect(credentialsMatch("abc", "abd")).toBe(false);
    expect(credentialsMatch("abc", "abcd")).toBe(false);
  });

  it("stays usable after a reconnect — credentials are reusable by decision", () => {
    const room = new Room(snapshot());
    expect(room.authenticate(CODES.A)).toBe("A");
    room.attach("c1", room.seat("A", "a1", "Ana", T0), T0);
    room.detach("c1", T0);
    expect(room.authenticate(CODES.A)).toBe("A");
  });
});

describe("guessing at a captain's code", () => {
  it("stops answering once somebody is clearly trying codes", () => {
    const room = new Room(snapshot());
    for (let i = 0; i < 8; i++) expect(room.authenticate(`WRONG${i}`, T0)).toBeNull();
    expect(room.lockedOut(T0)).toBe(true);
    // Even the right code is refused while the room is closed to guessing.
    expect(room.authenticate(CODES.A, T0)).toBeNull();
  });

  it("lets spectators in regardless, so one guesser cannot shut out the room", () => {
    const room = new Room(snapshot());
    for (let i = 0; i < 12; i++) room.authenticate(`WRONG${i}`, T0);
    expect(room.lockedOut(T0)).toBe(true);
    expect(room.authenticate(CREDS.spectator, T0)).toBe("spectator");
  });

  it("opens up again after a few minutes", () => {
    const room = new Room(snapshot());
    for (let i = 0; i < 8; i++) room.authenticate(`WRONG${i}`, T0);
    expect(room.lockedOut(T0 + 4 * 60_000)).toBe(true);
    expect(room.lockedOut(T0 + 6 * 60_000)).toBe(false);
    expect(room.authenticate(CODES.A, T0 + 6 * 60_000)).toBe("A");
  });

  it("forgives a captain who fat-fingers their own code", () => {
    const room = new Room(snapshot());
    for (let i = 0; i < 5; i++) room.authenticate("WRONGX", T0);
    expect(room.authenticate(CODES.A, T0)).toBe("A");
    // Getting in clears the count, so their earlier typos cost the next person nothing.
    for (let i = 0; i < 7; i++) room.authenticate("WRONGX", T0);
    expect(room.lockedOut(T0)).toBe(false);
  });

  it("says when it will listen again", () => {
    const room = new Room(snapshot());
    expect(room.lockedUntil(T0)).toBeNull();
    for (let i = 0; i < 8; i++) room.authenticate(`WRONG${i}`, T0);
    expect(room.lockedUntil(T0)).toBe(T0 + 5 * 60_000);
  });
});

describe("reporting a finished draft", () => {
  it("has nothing to report when nobody asked", () => {
    const room = liveRoom();
    while (room.phase === "drafting") room.tick(room.alarmAt()! + 1);
    expect(room.pendingReport).toBeNull();
  });

  it("reports once the draft is over, and only once", () => {
    const room = liveRoom({ callbackUrl: "https://bot.example/draft-done" });
    expect(room.pendingReport).toBeNull(); // not while it is still being played
    while (room.phase === "drafting") room.tick(room.alarmAt()! + 1);
    expect(room.pendingReport).toBe("https://bot.example/draft-done");
    room.markReported();
    expect(room.pendingReport).toBeNull();
  });
});

describe("the lobby", () => {
  it("does not start, or burn clock, until everybody says they are ready", () => {
    const room = seatedRoom();
    expect(room.phase).toBe("lobby");
    // The room still wakes once, but only to check whether anybody ever came.
    expect(room.alarmAt()).toBe(T0 + 6 * 60 * 60_000);
    expect(room.clock()).toBeNull();

    // Ten minutes waiting around costs nobody anything.
    room.tick(T0 + 600_000);
    expect(room.snapshot.draft.committed).toHaveLength(0);

    room.command(CAPTAIN_A, { t: "ready", ready: true }, T0 + 600_000);
    expect(room.phase).toBe("lobby"); // one side is not everybody
    room.command(CAPTAIN_B, { t: "ready", ready: true }, T0 + 600_000);
    expect(room.phase).toBe("drafting");
    expect(room.alarmAt()).toBe(T0 + 600_000 + 90_000);
  });

  it("waits for a side that has not turned up at all", () => {
    const room = new Room(snapshot());
    room.attach("c1", room.seat("A", "a1", "Ana", T0), T0);
    room.command(CAPTAIN_A, { t: "ready", ready: true }, T0);
    expect(room.phase).toBe("lobby");
    expect(room.projection(CAPTAIN_A, T0).lobby.everyoneHere).toBe(false);
  });

  it("lets somebody take their readiness back before it starts", () => {
    const room = seatedRoom();
    room.command(CAPTAIN_A, { t: "ready", ready: true }, T0);
    room.command(CAPTAIN_A, { t: "ready", ready: false }, T0);
    room.command(CAPTAIN_B, { t: "ready", ready: true }, T0);
    expect(room.phase).toBe("lobby");
  });

  it("refuses draft commands before the draft starts", () => {
    const room = seatedRoom();
    expect(room.command(CAPTAIN_A, { t: "stage", itemId: "a" }, T0).error?.code).toBe("not_started");
  });

  it("treats a player's second device as the same player", () => {
    const room = new Room(snapshot());
    const viewer = room.seat("A", "a1", "Ana", T0);
    room.attach("laptop", viewer, T0);
    room.attach("phone", viewer, T0);
    expect(room.projection(viewer, T0).lobby.members).toHaveLength(1);
  });
});

describe("who leads a side", () => {
  const bigRoom = (): Room => {
    const room = new Room(snapshot({ teamSize: 3 }));
    for (const [id, name] of [["a1", "Ana"], ["a2", "Ali"], ["a3", "Ash"]] as const) {
      room.attach(`c-${id}`, room.seat("A", id, name, T0), T0);
    }
    for (const [id, name] of [["b1", "Ben"], ["b2", "Bea"], ["b3", "Bo"]] as const) {
      room.attach(`c-${id}`, room.seat("B", id, name, T0), T0);
    }
    return room;
  };
  const asPlayer = (team: "A" | "B", id: string): Viewer => ({ role: "player", team, memberId: `${team}:${id}` });

  it("gives it to whoever arrived first", () => {
    const lobby = bigRoom().projection(asPlayer("A", "a2"), T0).lobby;
    expect(lobby.members.find((m) => m.leader && m.team === "A")?.id).toBe("A:a1");
  });

  it("lets the leader hand it to a teammate", () => {
    const room = bigRoom();
    expect(room.command(asPlayer("A", "a1"), { t: "handOver", memberId: "A:a3" }, T0).error).toBeNull();
    const lobby = room.projection(asPlayer("A", "a3"), T0).lobby;
    expect(lobby.members.find((m) => m.leader && m.team === "A")?.id).toBe("A:a3");
  });

  it("refuses a teammate trying to take it while the leader is there", () => {
    const room = bigRoom();
    expect(room.command(asPlayer("A", "a2"), { t: "handOver", memberId: "A:a2" }, T0).error?.code).toBe("not_your_call");
    expect(room.command(asPlayer("A", "a2"), { t: "claimLead" }, T0).error?.code).toBe("leader_present");
  });

  it("refuses handing the lead to the other side", () => {
    const room = bigRoom();
    expect(room.command(asPlayer("A", "a1"), { t: "handOver", memberId: "B:b2" }, T0).error?.code).toBe("not_your_call");
  });

  it("lets a teammate step in once the leader has dropped", () => {
    const room = bigRoom();
    room.detach("c-a1", T0);
    expect(room.command(asPlayer("A", "a2"), { t: "claimLead" }, T0).error).toBeNull();
    const lobby = room.projection(asPlayer("A", "a2"), T0).lobby;
    expect(lobby.members.find((m) => m.leader && m.team === "A")?.id).toBe("A:a2");
  });

  it("only lets the leader pick and ban", () => {
    const room = bigRoom();
    for (const m of room.projection(asPlayer("A", "a1"), T0).lobby.members) {
      room.command({ role: "player", team: m.team, memberId: m.id }, { t: "ready", ready: true }, T0);
    }
    expect(room.phase).toBe("drafting");
    expect(room.command(asPlayer("A", "a2"), { t: "stage", itemId: "a" }, T0).error?.code).toBe("not_your_call");
    expect(room.command(asPlayer("A", "a1"), { t: "stage", itemId: "a" }, T0).error).toBeNull();
  });

  it("shows teammates their own side's staging, and hides it from the other", () => {
    const room = bigRoom();
    for (const m of room.projection(asPlayer("A", "a1"), T0).lobby.members) {
      room.command({ role: "player", team: m.team, memberId: m.id }, { t: "ready", ready: true }, T0);
    }
    room.command(asPlayer("A", "a1"), { t: "stage", itemId: "a" }, T0);
    expect(room.projection(asPlayer("A", "a3"), T0).staged).toEqual(["a"]);
    expect(room.projection(asPlayer("B", "b2"), T0).staged).toBeNull();
    expect(room.projection(SPECTATOR, T0).staged).toEqual(["a"]);
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
    // No turn to wake for; the one alarm left is the clear-out, a month away.
    expect(room.clock()).toBeNull();
    expect(room.alarmAt()).toBe(room.snapshot.completedAt! + 30 * 24 * 60 * 60_000);
  });

  it("rejects a spectator trying to act", () => {
    const room = liveRoom();
    expect(room.command(SPECTATOR, { t: "stage", itemId: "a" }, T0).error?.code).toBe("not_a_player");
  });

  it("rejects the captain who is not on the clock", () => {
    const room = liveRoom();
    expect(room.command(CAPTAIN_B, { t: "stage", itemId: "a" }, T0).error?.code).toBe("wrong_team");
  });

  it("rejects an illegal hero without disturbing the draft", () => {
    const room = liveRoom();
    play(room, T0 + 1_000, "a");
    const result = room.command(CAPTAIN_B, { t: "stage", itemId: "a" }, T0 + 2_000);
    expect(result.error?.code).toBe("item_removed");
    expect(room.snapshot.draft.staged).toEqual({});
  });

  it("emits committed actions, never staging", () => {
    const room = liveRoom();
    const staged = room.command(CAPTAIN_A, { t: "stage", itemId: "a" }, T0 + 1_000);
    expect(staged.events).toEqual([]);
    const confirmed = room.command(CAPTAIN_A, { t: "confirm" }, T0 + 2_000);
    expect(confirmed.events[0]).toMatchObject({ type: "choice", action: "ban", team: "A", items: ["a"], auto: false });
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
    expect(outcome.events[0]).toMatchObject({ type: "choice", action: "ban", team: "A", auto: true });
    expect(room.snapshot.timer.turnStartedAt).toBe(deadline);
    expect(room.snapshot.timer.bank.A).toBe(0);
  });

  it("catches up several turns when an alarm fires very late", () => {
    const room = liveRoom();
    const outcome = room.tick(T0 + 10 * 60_000);
    expect(room.phase).toBe("complete");
    expect(outcome.events.filter((e) => e.type === "choice")).toHaveLength(5);
    expect(outcome.events.at(-1)?.type).toBe("draftComplete");
  });

  it("keeps burning while a captain is gone — there is no pause", () => {
    const room = liveRoom();
    room.detach("c-a1", T0 + 1_000);
    expect(room.presence()).toEqual({ A: "disconnected", B: "connected" });
    expect(room.alarmAt()).toBe(T0 + 90_000);
    room.tick(T0 + 90_000);
    expect(room.snapshot.draft.committed[0]).toMatchObject({ auto: true });
  });

  it("will not let a late click beat an expiry that already happened", () => {
    const room = liveRoom();
    const deadline = room.alarmAt()!;
    const result = room.command(CAPTAIN_A, { t: "stage", itemId: "a" }, deadline + 1);
    // A's ban was resolved by the clock; the click lands on B's turn instead.
    expect(result.events[0]).toMatchObject({ type: "choice", action: "ban", auto: true });
    expect(result.error?.code).toBe("wrong_team");
  });

  it("gives each turn its own fresh per-turn time", () => {
    const room = liveRoom();
    play(room, T0 + 10_000, "a");
    expect(room.clock()?.deadlines).toEqual({ B: T0 + 10_000 + 90_000 });
  });

  it("gives a turn with its own time that time, instead of the room's", () => {
    const room = liveRoom({ script: script("Aban, Bpick x2 @45s, Apick") });
    play(room, T0 + 10_000, "a");
    expect(room.clock()).toMatchObject({ allowanceMs: 45_000, deadlines: { B: T0 + 10_000 + 45_000 + 60_000 } });
  });

  it("stops the clock when the draft completes", () => {
    const room = liveRoom();
    room.tick(T0 + 10 * 60_000);
    expect(room.clock()).toBeNull();
    // The turn clock is done; what remains is the room's own clear-out.
    expect(room.disposable(T0 + 10 * 60_000)).toBeNull();
    expect(room.alarmAt()).toBeGreaterThan(T0 + 29 * 24 * 60 * 60_000);
  });
});

describe("audience", () => {
  it("gives each connection a view filtered by its token", () => {
    const room = liveRoom();
    room.command(CAPTAIN_A, { t: "stage", itemId: "a" }, T0 + 1_000);
    const views = new Map([...room.audience(T0 + 1_000)].map((entry) => [entry.connectionId, entry.projection]));
    expect(views.get("c-a1")?.staged).toEqual(["a"]);
    expect(views.get("c-s1")?.staged).toEqual(["a"]);
    expect(views.get("c-b1")?.staged).toBeNull();
    expect(views.get("c-b1")?.stagedCount).toEqual({ A: 1 });
  });

  it("reports connection state to everyone", () => {
    const room = liveRoom();
    room.detach("c-b1", T0 + 1_000);
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
  it("falls back to the default clock, and works out how many players a side has", () => {
    const { teamSize: _unused, ...rest } = snapshotOptions();
    const room = new Room(Room.create(rest, T0));
    expect(room.snapshot.rules).toEqual(DEFAULT_TIMER_RULES);
    expect(room.snapshot.roster.teamSize).toBe(2);
  });

  it("refuses to create a room whose script the pool cannot satisfy", () => {
    expect(() => Room.create({ ...snapshotOptions(), pool: ["a", "b"] }, T0)).toThrow(/Cannot create room/);
  });

  it("refuses credentials that leave a team without a code", () => {
    expect(() =>
      Room.create({ ...snapshotOptions(), credentials: { codes: { A: "AAAAAA" }, spectator: "s" } }, T0),
    ).toThrow(/every team needs a code/);
  });
});

describe("parseClientMessage", () => {
  it("accepts the four commands", () => {
    expect(parseClientMessage('{"t":"confirm"}')).toEqual({ t: "confirm" });
    expect(parseClientMessage('{"t":"resync"}')).toEqual({ t: "resync" });
    expect(parseClientMessage('{"t":"stage","itemId":"ozo"}')).toEqual({ t: "stage", itemId: "ozo" });
    expect(parseClientMessage('{"t":"unstage","itemId":"ozo"}')).toEqual({ t: "unstage", itemId: "ozo" });
    expect(parseClientMessage('{"t":"suggest","itemId":"ozo","intent":"pick"}')).toEqual({
      t: "suggest",
      itemId: "ozo",
      intent: "pick",
    });
  });

  it("returns null for anything else rather than throwing", () => {
    for (const raw of ["", "null", "[]", "not json", '{"t":"drop_table"}', '{"t":"stage"}', '{"t":"stage","itemId":7}']) {
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
    // A nonsensical turn length would become the clock everyone plays against.
    for (const bad of [Number.NaN, Infinity, -1, 0, "30000", true, {}]) {
      expect(parseTimerRules(bad, undefined).problems.length).toBeGreaterThan(0);
    }
    expect(parseTimerRules(30_000, -5).problems).toHaveLength(1);
    expect(parseTimerRules(30_000, 10 ** 12).problems).toHaveLength(1);
  });

  it("falls back rather than storing a bad value", () => {
    expect(parseTimerRules(Number.NaN, undefined).rules).toEqual(DEFAULT_TIMER_RULES);
  });

  it("falls back to a game's own clock when it has one", () => {
    const own = { perTurnMs: 60_000, bankMs: 120_000 };
    expect(parseTimerRules(undefined, undefined, own).rules).toEqual(own);
    expect(parseTimerRules(45_000, undefined, own).rules).toEqual({ perTurnMs: 45_000, bankMs: 120_000 });
  });

  it("only accepts the two auto-fill strategies", () => {
    expect(parseAutoFill("random")).toBe("random");
    expect(parseAutoFill("lowestIndex")).toBe("lowestIndex");
    for (const bad of ["lowest", "", null, 7]) expect(parseAutoFill(bad)).toBeUndefined();
  });
});

describe("a command that changes nothing must not swallow the clock", () => {
  // A room checks the clock before it checks whether a request is allowed, so a
  // request it is about to turn down may still have carried a turn past its
  // time limit on the way in. That turn really happened, and the room has to
  // hear about it, or the draft quietly stops with nothing left to restart it.
  it("reports the tick's changes even when the sender is a spectator", () => {
    const room = liveRoom();
    const deadline = room.alarmAt()!;
    const outcome = room.command(SPECTATOR, { t: "stage", itemId: "a" }, deadline + 1);

    expect(outcome.error?.code).toBe("not_a_player");
    expect(outcome.events[0]).toMatchObject({ type: "choice", action: "ban", auto: true });
    expect(outcome.changed).toBe(true);
  });

  it("reports them when the draft finished on that same tick", () => {
    const room = liveRoom();
    // Let every turn run out, including the last one.
    let at = T0;
    while (room.phase === "drafting" && room.alarmAt() !== null) {
      at = room.alarmAt()! + 1;
      const outcome = room.command(SPECTATOR, { t: "confirm" }, at);
      expect(outcome.changed).toBe(true);
    }
    expect(room.phase).toBe("complete");

    // And once complete, a stray message changes nothing at all.
    const after = room.command(SPECTATOR, { t: "confirm" }, at + 1_000);
    expect(after.changed).toBe(false);
  });

  it("keeps reporting them for a captain refused before the draft starts", () => {
    const room = new Room(snapshot());
    room.attach("a1", CAPTAIN_A, T0);
    const outcome = room.command(CAPTAIN_A, { t: "confirm" }, T0 + 600_000);
    expect(outcome.error?.code).toBe("not_started");
    expect(outcome.changed).toBe(false); // the lobby clock never started
  });
});

describe("beginning without a full room", () => {
  const shortRoom = (): Room => {
    const room = new Room(snapshot({ teamSize: 3 }));
    room.attach("c-a1", room.seat("A", "a1", "Ana", T0), T0);
    room.attach("c-b1", room.seat("B", "b1", "Ben", T0), T0);
    return room;
  };

  it("will not start on one side's word alone", () => {
    const room = shortRoom();
    expect(room.command(CAPTAIN_A, { t: "startAnyway", agreed: true }, T0).error).toBeNull();
    expect(room.phase).toBe("lobby");
  });

  it("starts once both sides' leaders agree", () => {
    const room = shortRoom();
    room.command(CAPTAIN_A, { t: "startAnyway", agreed: true }, T0);
    room.command(CAPTAIN_B, { t: "startAnyway", agreed: true }, T0);
    expect(room.phase).toBe("drafting");
  });

  it("lets a side change its mind before the other agrees", () => {
    const room = shortRoom();
    room.command(CAPTAIN_A, { t: "startAnyway", agreed: true }, T0);
    room.command(CAPTAIN_A, { t: "startAnyway", agreed: false }, T0);
    room.command(CAPTAIN_B, { t: "startAnyway", agreed: true }, T0);
    expect(room.phase).toBe("lobby");
  });

  it("is the leader's call, not any teammate's", () => {
    const room = shortRoom();
    room.attach("c-a2", room.seat("A", "a2", "Ali", T0), T0);
    const teammate: Viewer = { role: "player", team: "A", memberId: "A:a2" };
    expect(room.command(teammate, { t: "startAnyway", agreed: true }, T0).error?.code).toBe("not_your_call");
  });

  it("still needs somebody on each side to do the picking", () => {
    const room = new Room(snapshot({ teamSize: 3 }));
    room.attach("c-a1", room.seat("A", "a1", "Ana", T0), T0);
    room.command(CAPTAIN_A, { t: "startAnyway", agreed: true }, T0);
    expect(room.canBegin()).toBe(false);
  });
});

describe("names", () => {
  it("gives a player who typed nothing a name of their own", () => {
    const room = new Room(snapshot());
    const viewer = room.attach("c1", room.seat("A", "player-xyz", "", T0), T0) && room.seat("A", "player-xyz", "", T0);
    const named = room.projection(viewer, T0).lobby.members[0]!;
    expect(named.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it("keeps the same name for the same player across rooms", () => {
    const first = new Room(snapshot());
    const second = new Room(snapshot({ roomId: "room-2" }));
    const a = first.seat("A", "player-xyz", "", T0);
    const b = second.seat("A", "player-xyz", "", T0);
    expect(first.projection(a, T0).lobby.members[0]!.name).toBe(second.projection(b, T0).lobby.members[0]!.name);
  });

  it("prefers what they typed", () => {
    const room = new Room(snapshot());
    const viewer = room.seat("A", "player-xyz", "  Shaun  ", T0);
    expect(room.projection(viewer, T0).lobby.members[0]!.name).toBe("Shaun");
  });
});

describe("the finished draft's players", () => {
  it("says who was there, on which side, and who did the picking", () => {
    const room = liveRoom();
    while (room.phase === "drafting") room.tick(room.alarmAt()! + 1);
    expect(room.players()).toEqual([
      { id: "A:a1", name: "Ana", team: "A", led: true },
      { id: "B:b1", name: "Ben", team: "B", led: true },
    ]);
  });
});

describe("clearing rooms out", () => {
  const HOUR = 60 * 60_000;
  const DAY = 24 * HOUR;

  it("wakes a waiting room only to check whether anybody ever came", () => {
    const room = new Room(snapshot());
    expect(room.alarmAt()).toBe(T0 + 6 * HOUR);
    expect(room.disposable(T0 + 5 * HOUR)).toBeNull();
    expect(room.disposable(T0 + 7 * HOUR)).toBe("abandoned");
  });

  it("leaves a room alone while people are actually in it", () => {
    const room = seatedRoom();
    expect(room.disposable(T0 + HOUR)).toBeNull();
  });

  it("does not throw away a room booked well ahead of the match", () => {
    // A squad turns up early and waits. Hours later they are still there, and
    // the room is theirs, not rubbish.
    const room = seatedRoom();
    room.tick(T0 + 5 * HOUR);
    expect(room.disposable(T0 + 7 * HOUR)).toBeNull();
    expect(room.alarmAt()).toBe(T0 + 5 * HOUR + 6 * HOUR);

    // Once they give up and leave, the countdown runs from when they were last
    // seen rather than from when the link was made.
    expect(room.disposable(T0 + 12 * HOUR)).toBe("abandoned");
  });

  it("does not throw away a draft being played", () => {
    const room = liveRoom();
    expect(room.phase).toBe("drafting");
    // A long draft is still a draft: only the turn clock matters here.
    expect(room.disposable(T0 + 7 * HOUR)).toBeNull();
    expect(room.alarmAt()).toBe(T0 + 90_000);
  });

  it("keeps a finished draft for a month, then clears it", () => {
    const room = liveRoom();
    let at = T0;
    while (room.phase === "drafting") {
      at = room.alarmAt()! + 1;
      room.tick(at);
    }
    expect(room.phase).toBe("complete");
    expect(room.disposable(at + 29 * DAY)).toBeNull();
    expect(room.disposable(at + 31 * DAY)).toBe("expired");
    expect(room.alarmAt()).toBeGreaterThan(at + 29 * DAY);
  });

  it("starts the month from when the draft finished, not when it began", () => {
    const room = liveRoom();
    let at = T0;
    while (room.phase === "drafting") {
      at = room.alarmAt()! + 1;
      room.tick(at);
    }
    expect(room.snapshot.completedAt).toBe(at - 1);
    expect(room.alarmAt()).toBe(room.snapshot.completedAt! + 30 * DAY);
  });

  it("takes a room's own retention when one was set", () => {
    const room = new Room(snapshot({ abandonAfterMs: 60_000, retentionMs: 5 * 60_000 }));
    expect(room.alarmAt()).toBe(T0 + 60_000);
    expect(room.disposable(T0 + 61_000)).toBe("abandoned");
  });
});

describe("a turn two teams play at once", () => {
  const blindRoom = (): Room => liveRoom({ script: script("A+B ban, Apick, Bpick") });

  it("waits for both, then reveals both, and starts the next turn from the second", () => {
    const room = blindRoom();
    playAs(room, CAPTAIN_B, T0 + 5_000, "a");
    expect(room.snapshot.draft.committed).toEqual([]);
    // B is done; only A's clock is still running.
    expect(room.clock()?.deadlines).toEqual({ A: T0 + 90_000 });
    expect(room.projection(SPECTATOR, T0 + 5_000).locked).toEqual(["B"]);

    const outcome = room.command(CAPTAIN_A, { t: "stage", itemId: "b" }, T0 + 40_000);
    expect(outcome.events).toEqual([]);
    const revealed = room.command(CAPTAIN_A, { t: "confirm" }, T0 + 40_000);
    expect(revealed.events.map((e) => e.type)).toEqual(["choice", "choice", "turnChange"]);
    expect(room.snapshot.timer).toEqual({ turnStartedAt: T0 + 40_000, bank: { A: 50_000, B: 60_000 } });
  });

  it("runs each team's clock out separately", () => {
    const room = blindRoom();
    // A confirms early; B never does, and is settled at its own deadline.
    playAs(room, CAPTAIN_A, T0 + 1_000, "a");
    const outcome = room.tick(T0 + 90_000);
    expect(outcome.events[1]).toMatchObject({ type: "choice", team: "B", auto: true });
    expect(room.snapshot.draft.committed.map((s) => s.at)).toEqual([T0 + 1_000, T0 + 90_000]);
    expect(room.snapshot.timer.turnStartedAt).toBe(T0 + 90_000);
  });

  it("refuses a team trying to change its mind once it has confirmed", () => {
    const room = blindRoom();
    playAs(room, CAPTAIN_A, T0 + 1_000, "a");
    expect(room.command(CAPTAIN_A, { t: "stage", itemId: "b" }, T0 + 2_000).error?.code).toBe("already_locked");
  });

  it("shows a spectator neither team's choice until the reveal", () => {
    const room = blindRoom();
    room.command(CAPTAIN_A, { t: "stage", itemId: "a" }, T0 + 1_000);
    expect(room.projection(SPECTATOR, T0 + 1_000).staged).toBeNull();
    expect(room.projection(CAPTAIN_B, T0 + 1_000).staged).toEqual([]);
    expect(room.projection(CAPTAIN_A, T0 + 1_000).staged).toEqual(["a"]);
  });
});

describe("a turn nobody plays", () => {
  it("finishes the draft on the last real turn, and is recorded as the draft's own", () => {
    const room = liveRoom({ script: script("Aban, Bban, Apick, Bpick, remaining pick"), pool: ["a", "b", "c", "d", "e"] });
    play(room, T0 + 1_000, "a");
    play(room, T0 + 2_000, "b");
    play(room, T0 + 3_000, "c");
    play(room, T0 + 4_000, "d");
    expect(room.phase).toBe("complete");
    expect(room.snapshot.completedAt).toBe(T0 + 4_000);
    expect(room.record().turns.at(-1)).toMatchObject({ team: null, items: ["e"], auto: true });
  });
});

describe("a room of three teams", () => {
  const THREE = [...TEAMS, { id: "C", name: "Team C" }];
  const CAPTAIN_C: Viewer = { role: "player", team: "C", memberId: "C:c1" };
  const threeRoom = (): Room => {
    const room = new Room(
      snapshot({
        teams: THREE,
        script: [
          { teams: ["A"], action: "pick", count: 1 },
          { teams: ["B"], action: "pick", count: 1 },
          { teams: ["C"], action: "pick", count: 1 },
        ],
        credentials: { codes: { ...CODES, C: "CCCCCC" }, spectator: CREDS.spectator },
      }),
    );
    room.attach("c-a1", room.seat("A", "a1", "Ana", T0), T0);
    room.attach("c-b1", room.seat("B", "b1", "Ben", T0), T0);
    return room;
  };

  it("lets the third team in with its own code", () => {
    expect(threeRoom().authenticate("cccccc")).toBe("C");
  });

  it("waits for every team before it starts", () => {
    const room = threeRoom();
    room.command(CAPTAIN_A, { t: "ready", ready: true }, T0);
    room.command(CAPTAIN_B, { t: "ready", ready: true }, T0);
    expect(room.phase).toBe("lobby");
    room.attach("c-c1", room.seat("C", "c1", "Cy", T0), T0);
    room.command(CAPTAIN_C, { t: "ready", ready: true }, T0);
    expect(room.phase).toBe("drafting");
    expect(room.snapshot.timer.bank).toEqual({ A: 60_000, B: 60_000, C: 60_000 });
  });

  it("needs every leader to agree to begin short-handed", () => {
    const room = threeRoom();
    room.command(CAPTAIN_A, { t: "startAnyway", agreed: true }, T0);
    room.command(CAPTAIN_B, { t: "startAnyway", agreed: true }, T0);
    expect(room.canBegin()).toBe(false);
  });

  it("plays through to the end, each team in turn", () => {
    const room = threeRoom();
    room.attach("c-c1", room.seat("C", "c1", "Cy", T0), T0);
    for (const captain of [CAPTAIN_A, CAPTAIN_B, CAPTAIN_C]) room.command(captain, { t: "ready", ready: true }, T0);
    playAs(room, CAPTAIN_A, T0 + 1_000, "a");
    playAs(room, CAPTAIN_B, T0 + 2_000, "b");
    playAs(room, CAPTAIN_C, T0 + 3_000, "c");
    expect(room.phase).toBe("complete");
    expect(room.presence()).toEqual({ A: "connected", B: "connected", C: "connected" });
  });
});

describe("suggestions", () => {
  it("accepts any of the draft's own actions, and nothing else", () => {
    const room = liveRoom();
    expect(room.command(CAPTAIN_B, { t: "suggest", itemId: "c", intent: "pick" }, T0).error).toBeNull();
    expect(room.projection(CAPTAIN_B, T0).suggestions).toEqual([{ itemId: "c", by: { pick: ["Ben"] }, total: 1 }]);
    expect(room.command(CAPTAIN_B, { t: "suggest", itemId: "c", intent: "want" }, T0).error?.code).toBe("unknown_action");
    expect(room.command(CAPTAIN_B, { t: "suggest", itemId: "zz", intent: "pick" }, T0).error?.code).toBe("unknown_item");
  });
});
