/**
 * End-to-end smoke test against a running worker.
 *
 *   npm run dev            # terminal 1
 *   npm run smoke          # terminal 2
 *
 * Drives a real room over real WebSockets: the lobby gate, per-token staging
 * visibility, rejected commands, and — the part unit tests cannot prove — the
 * Durable Object alarm firing on its own and auto-resolving an expired turn.
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
  body: JSON.stringify({ perTurnMs: 2000, bankMs: 1000, teamSize: 1 }),
});
const room = await created.json();
console.log(`room ${room.roomId}`);

const state = {};
let joined = 0;
function connect(name, link) {
  // A captain's link carries their code; a spectator's carries a token.
  const url = new URL(link);
  const token = url.searchParams.get("token") ?? url.searchParams.get("code");
  return new Promise((resolve) => {
    // Players bring an id and a name; a spectator brings neither.
    const identity = url.searchParams.has("code") ? `&player=smoke-player-${++joined}&name=${name}` : "";
    const socket = new WebSocket(`${BASE.replace("http", "ws")}/api/rooms/${room.roomId}/ws?token=${token}${identity}`);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.t === "state") state[name] = message;
      if (message.t === "error") state[`${name}:error`] = message.error.code;
      if (message.t === "welcome") resolve(socket);
    });
  });
}

const a = await connect("A", room.links.teamA);
const s = await connect("S", room.links.spectator);
await wait(200);
check("stays in the lobby while players arrive", state.A.phase, "lobby");

const b = await connect("B", room.links.teamB);
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

a.send(JSON.stringify({ t: "stage", heroId: "ozo" }));
await wait(200);
check("the side on the clock sees its own staging", state.A.projection.staged, ["ozo"]);
check("spectators see the active team's staging", state.S.projection.staged, ["ozo"]);
check("the opposing side does not", state.B.projection.staged, null);
check("but does see the slot count", state.B.projection.stagedCount, 1);

b.send(JSON.stringify({ t: "stage", heroId: "ozo" }));
a.send(JSON.stringify({ t: "stage", heroId: "not-a-hero" }));
a.send(JSON.stringify({ t: "nonsense" }));
await wait(200);
check("rejects the side that is not on the clock", state["B:error"], "wrong_team");
check("rejects an unrecognised message", state["A:error"], "bad_message");

a.send(JSON.stringify({ t: "confirm" }));
await wait(200);
check("commits on confirm", state.S.projection.bans, { A: ["ozo"], B: [] });
check("moves to the next turn", state.S.projection.turn, { team: "B", action: "ban", count: 1 });

console.log("waiting out B's clock (2s turn + 1s bank)...");
await wait(3600);
check("the alarm resolved the expired turn", state.S.projection.committed.at(-1)?.auto, true);
check("and moved the draft on", state.S.projection.turn, { team: "A", action: "ban", count: 1 });

a.close();
await wait(300);
check("shows a side as disconnected without pausing", state.S.projection.presence, {
  A: "disconnected",
  B: "connected",
});

s.close();
b.close();

// A room that never gets used should throw itself away. Real rooms wait hours;
// this one is told to give up after a couple of seconds so the sweep can be
// watched happening.
console.log("\nchecking that an unused room clears itself out...");
const doomed = await (
  await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ abandonAfterSeconds: 2, teamSize: 1 }),
  })
).json();

const alive = await fetch(`${BASE}/api/rooms/${doomed.roomId}/state?token=${new URL(doomed.links.spectator).searchParams.get("token")}`);
check("a new room answers", alive.status, 200);

await wait(4000);
const gone = await fetch(`${BASE}/api/rooms/${doomed.roomId}/state?token=${new URL(doomed.links.spectator).searchParams.get("token")}`);
check("a room nobody ever used is thrown away", gone.status, 404);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
