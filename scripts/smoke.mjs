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
  body: JSON.stringify({ perTurnMs: 2000, bankMs: 1000 }),
});
const room = await created.json();
console.log(`room ${room.roomId}`);

const state = {};
function connect(name, link) {
  const token = new URL(link).searchParams.get("token");
  return new Promise((resolve) => {
    const socket = new WebSocket(`${BASE.replace("http", "ws")}/api/rooms/${room.roomId}/ws?token=${token}`);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.t === "state") state[name] = message;
      if (message.t === "error") state[`${name}:error`] = message.error.code;
      if (message.t === "welcome") resolve(socket);
    });
  });
}

const a = await connect("A", room.links.captainA);
const s = await connect("S", room.links.spectator);
await wait(200);
check("stays in the lobby until both captains arrive", state.A.phase, "lobby");

const b = await connect("B", room.links.captainB);
await wait(200);
check("starts once both captains are connected", state.A.phase, "drafting");

const bad = await fetch(`${BASE}/api/rooms/${room.roomId}/state?token=nonsense`);
check("rejects an invalid token", bad.status, 403);

a.send(JSON.stringify({ t: "stage", heroId: "ozo" }));
await wait(200);
check("the acting captain sees their own staging", state.A.projection.staged, ["ozo"]);
check("spectators see the active team's staging", state.S.projection.staged, ["ozo"]);
check("the opposing captain does not", state.B.projection.staged, null);
check("but does see the slot count", state.B.projection.stagedCount, 1);

b.send(JSON.stringify({ t: "stage", heroId: "ozo" }));
a.send(JSON.stringify({ t: "stage", heroId: "not-a-hero" }));
a.send(JSON.stringify({ t: "nonsense" }));
await wait(200);
check("rejects the captain who is not on the clock", state["B:error"], "wrong_team");
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
check("shows a captain as disconnected without pausing", state.S.projection.presence, {
  A: "disconnected",
  B: "connected",
});

s.close();
b.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
