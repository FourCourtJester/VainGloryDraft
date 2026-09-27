/**
 * End-to-end smoke test against a running worker.
 *
 *   npm run dev            # terminal 1
 *   npm run smoke          # terminal 2
 *
 * Drives a real room over real WebSockets: the lobby gate, per-token staging
 * visibility, rejected commands, and — the part unit tests cannot prove — the
 * Durable Object alarm firing on its own and auto-resolving an expired turn.
 * Then a second game, to show the same worker running a draft that is not
 * Vainglory: a Counter-Strike map veto with a blind turn and a decider.
 */

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:8787";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  const pass = a === b;
  if (!pass) failures++;
  console.log(`${pass ? "ok  " : "FAIL"}  ${label}${pass ? "" : `\n        expected ${b}\n        actual   ${a}`}`);
}

const created = await fetch(`${BASE}/api/rooms`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  // A deliberately tiny clock so the alarm can be observed in a few seconds.
  body: JSON.stringify({ game: "vainglory", perTurnMs: 2000, bankMs: 1000 }),
});
const room = await created.json();
console.log(`room ${room.roomId}`);

const state = {};
let joined = 0;
function connect(name, link, roomId = room.roomId) {
  // A captain's link carries their code; a spectator's carries a token.
  const url = new URL(link);
  const token = url.searchParams.get("token") ?? url.searchParams.get("code");
  return new Promise((resolve) => {
    // Players bring an id and a name; a spectator brings neither.
    const identity = url.searchParams.has("code") ? `&player=smoke-player-${++joined}&name=${name}` : "";
    const socket = new WebSocket(`${BASE.replace("http", "ws")}/api/rooms/${roomId}/ws?token=${token}${identity}`);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.t === "state") state[name] = message;
      if (message.t === "error") state[`${name}:error`] = message.error.code;
      if (message.t === "welcome") resolve(socket);
    });
  });
}

const a = await connect("A", room.links.teams.A);
const s = await connect("S", room.links.spectator);
await wait(200);
check("stays in the lobby while players arrive", state.A.phase, "lobby");

const b = await connect("B", room.links.teams.B);
await wait(200);
check("does not start merely because both sides are present", state.A.phase, "lobby");

a.send(JSON.stringify({ t: "ready", ready: true }));
await wait(150);
check("nor when only one side has confirmed", state.A.phase, "lobby");
b.send(JSON.stringify({ t: "ready", ready: true }));
await wait(250);
check("starts once every player is ready", state.A.phase, "drafting");

const bad = await fetch(`${BASE}/api/rooms/${room.roomId}/state?code=NONSEN`);
check("rejects a code that is not this room's", bad.status, 403);

a.send(JSON.stringify({ t: "stage", itemId: "ozo" }));
await wait(200);
check("the side on the clock sees its own staging", state.A.projection.staged, ["ozo"]);
check("spectators see the active team's staging", state.S.projection.staged, ["ozo"]);
check("the opposing side does not", state.B.projection.staged, null);
check("but does see the slot count", state.B.projection.stagedCount, { A: 1 });

b.send(JSON.stringify({ t: "stage", itemId: "ozo" }));
a.send(JSON.stringify({ t: "stage", itemId: "not-a-hero" }));
a.send(JSON.stringify({ t: "nonsense" }));
await wait(200);
check("rejects the side that is not on the clock", state["B:error"], "wrong_team");
check("rejects an unrecognised message", state["A:error"], "bad_message");

a.send(JSON.stringify({ t: "confirm" }));
await wait(200);
check("commits on confirm", state.S.projection.byTeam.A, { ban: ["ozo"], pick: [] });
check("moves to the next turn", state.S.projection.turn, { teams: ["B"], action: "ban", count: 1 });

console.log("waiting out B's clock (2s turn + 1s bank)...");
await wait(3600);
check("the alarm resolved the expired turn", state.S.projection.committed.at(-1)?.auto, true);
check("and moved the draft on", state.S.projection.turn, { teams: ["A"], action: "ban", count: 1 });

a.close();
await wait(300);
check("shows a side as disconnected without pausing", state.S.projection.presence, {
  A: "disconnected",
  B: "connected",
});

s.close();
b.close();

// The same worker, a different game: a map veto with its own vocabulary, a
// blind opening ban, and a decider nobody plays.
console.log("\nplaying a Counter-Strike veto on the same engine...");
const veto = await (
  await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ game: "cs2", script: "A+B ban, A pick, B pick, A ban, B ban, remaining pick", perTurnMs: 60_000 }),
  })
).json();
check("the veto room is made with its own format", veto.format, "A+B ban, A pick, B pick, A ban, B ban, remaining pick");
const va = await connect("VA", veto.links.teams.A, veto.roomId);
const vb = await connect("VB", veto.links.teams.B, veto.roomId);
const vs = await connect("VS", veto.links.spectator, veto.roomId);
for (const socket of [va, vb]) socket.send(JSON.stringify({ t: "ready", ready: true }));
await wait(300);
check("it is a veto of maps", state.VS.projection.game, "cs2");
check("with both sides on the clock at once", state.VS.projection.turn.teams, ["A", "B"]);

vb.send(JSON.stringify({ t: "stage", itemId: "nuke" }));
vb.send(JSON.stringify({ t: "confirm" }));
va.send(JSON.stringify({ t: "stage", itemId: "train" }));
await wait(300);
check("one side locking in reveals nothing", state.VS.projection.committed, []);
check("though everyone can see that it has", state.VS.projection.locked, ["B"]);
check("and a spectator cannot see either side's choice", state.VS.projection.staged, null);
check("while the side still choosing sees its own", state.VA.projection.staged, ["train"]);

va.send(JSON.stringify({ t: "confirm" }));
await wait(300);
check("the second lock reveals both", state.VS.projection.committed.map((s) => s.items[0]), ["train", "nuke"]);

const moves = [
  [va, "mirage"],
  [vb, "inferno"],
  [va, "ancient"],
  [vb, "anubis"],
];
for (const [socket, map] of moves) {
  socket.send(JSON.stringify({ t: "stage", itemId: map }));
  socket.send(JSON.stringify({ t: "confirm" }));
  await wait(200);
}
check("the veto finishes itself", state.VS.phase, "complete");
check("on the one map nobody touched", state.VS.projection.committed.at(-1), {
  index: 5,
  team: null,
  action: "pick",
  items: ["dust2"],
  auto: true,
  at: state.VS.projection.committed.at(-2).at,
});
for (const socket of [va, vb, vs]) socket.close();

// Without a ready check, the draft begins the moment the last captain arrives.
console.log("\nchecking a room with no ready check...");
const quick = await (
  await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ game: "vainglory", readyCheck: false }),
  })
).json();
const qa = await connect("QA", quick.links.teams.A, quick.roomId);
await wait(200);
check("waits while one captain is missing", state.QA.phase, "lobby");
const qb = await connect("QB", quick.links.teams.B, quick.roomId);
await wait(300);
check("and starts as soon as the second arrives", state.QA.phase, "drafting");
qa.close();
qb.close();

const refused = await fetch(`${BASE}/api/rooms`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ game: "vainglory", teamSize: 3 }),
});
check("a squad size without squads is refused rather than ignored", refused.status, 400);

// A room that never gets used should throw itself away. Real rooms wait hours;
// this one is told to give up after a couple of seconds so the sweep can be
// watched happening.
console.log("\nchecking that an unused room clears itself out...");
const doomed = await (
  await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ game: "vainglory", abandonAfterSeconds: 2 }),
  })
).json();

const alive = await fetch(`${BASE}/api/rooms/${doomed.roomId}/state?token=${new URL(doomed.links.spectator).searchParams.get("token")}`);
check("a new room answers", alive.status, 200);

await wait(4000);
const gone = await fetch(`${BASE}/api/rooms/${doomed.roomId}/state?token=${new URL(doomed.links.spectator).searchParams.get("token")}`);
check("a room nobody ever used is thrown away", gone.status, 404);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
