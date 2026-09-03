/**
 * Browser check: drives the real UI against a running worker.
 *
 *   npm run dev          # terminal 1
 *   npm run ui-check     # terminal 2
 *
 * Three pages — organiser, both captains, a spectator — on one room, covering
 * what only a browser can show: that the staging rule holds in the rendered DOM,
 * that a reusable link reconnects mid-draft, and that the clock resolves a turn
 * with the room open in front of you.
 *
 * Set CHROMIUM_PATH if Playwright's bundled browser is not installed.
 */

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const SHOTS = process.env.SHOTS ?? null;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok || detail === "" ? "" : `  — ${detail}`}`);
}
const shot = async (page, name) => (SHOTS === null ? undefined : page.screenshot({ path: `${SHOTS}/${name}.png` }));

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH === undefined ? {} : { executablePath: process.env.CHROMIUM_PATH },
);
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const clientErrors = [];
const watch = (page, who) => page.on("pageerror", (error) => clientErrors.push(`${who}: ${error.message}`));

// ── create a room ───────────────────────────────────────────────────────────
const organiser = await context.newPage();
watch(organiser, "organiser");
await organiser.goto(BASE);
await organiser.waitForSelector("select");
check("offers the 5v5 standard", (await organiser.locator("select option").first().textContent()).includes("5v5 Standard"));
// A short clock so the alarm can be watched without a long wait.
await organiser.fill('input[type="number"] >> nth=0', "8");
await organiser.fill('input[type="number"] >> nth=1', "4");
await organiser.click("button.confirm");
await organiser.waitForSelector(".links code");
const [captainA, captainB, spectatorLink] = await organiser.locator(".links code").allTextContents();
// The captains get a short code in their link; spectators get a long token.
check("hands the captains a code and spectators a link",
  captainA.includes("code=") && captainB.includes("code=") && spectatorLink.includes("token="));
await shot(organiser, "ui-create");

// ── the lobby holds the clock ───────────────────────────────────────────────
const a = await context.newPage();
watch(a, "captain A");
await a.goto(captainA);
await a.waitForSelector(".badge");
check("identifies the captain from the token alone", (await a.locator(".badge").textContent()) === "Captain A");
check("waits in the lobby", (await a.locator(".banner").textContent()).includes("Waiting for both captains"));
check("runs no clock while waiting", (await a.locator(".turn").count()) === 0);
await shot(a, "ui-lobby");

const b = await context.newPage();
watch(b, "captain B");
await b.goto(captainB);
const spectator = await context.newPage();
watch(spectator, "spectator");
await spectator.goto(spectatorLink);
await a.waitForSelector(".turn", { timeout: 5_000 });
check("starts once both captains are present", (await a.locator(".turn-label").textContent()).startsWith("Team A bans"));
check("shows both captains connected", (await a.locator(".presence.connected").count()) === 2);

// ── the staging rule, in the rendered DOM ───────────────────────────────────
await a.locator("button.hero", { hasText: "Ozo" }).first().click();
await wait(400);
check("the acting captain sees their own staging", (await a.locator("button.hero.staged").count()) === 1);
check("spectators see the active team's staging", (await spectator.locator("button.hero.staged").count()) === 1);
check("the opposing captain does not", (await b.locator("button.hero.staged").count()) === 0);
// Spectators can see what the team on the clock is considering, but must not be
// able to join in.
check("a spectator cannot click the staged hero", await spectator.locator("button.hero.staged").first().isDisabled());
await shot(a, "ui-staged");
await shot(b, "ui-opponent");

await a.locator("button.hero", { hasText: "Ozo" }).first().click();
await wait(300);
check("clicking a staged hero unstages it", (await a.locator("button.hero.staged").count()) === 0);
check("confirm is refused with nothing staged", await a.locator("button.confirm").isDisabled());

await a.locator("button.hero", { hasText: "Ozo" }).first().click();
await wait(300);
await a.locator("button.confirm").click();
await wait(500);
check("the ban lands for every viewer", (await spectator.locator(".team-A .bans li").first().textContent()) === "Ozo");
check("and the turn passes on", (await b.locator(".turn-label").textContent()).startsWith("Team B bans"));
check("a banned hero is struck out of the pool", (await spectator.locator("button.hero.banned").count()) === 1);

// Between turns nothing is clickable, so a captain is never offered a choice
// that would only be refused.
check("out of turn, the pool is not clickable", await a.locator("button.hero", { hasText: "Ringo" }).first().isDisabled());
check("and no confirm bar is shown", (await a.locator(".confirm-bar").count()) === 0);

// ── the clock resolves a turn nobody answered ───────────────────────────────
console.log("      waiting out B's clock (8s turn + 4s reserve)…");
await wait(13_000);
const autoBan = await spectator.locator(".team-B .bans li").first().textContent();
check("the timer resolved B's ban unattended", autoBan !== "—" && autoBan.length > 0, autoBan);
check("and play moved to the next turn", (await spectator.locator(".turn-label").textContent()).startsWith("Team A bans"));
check("marks the timer's choice as auto", (await spectator.locator(".team-B .bans .auto").count()) === 1);
check("leaves a captain's own ban unmarked", (await spectator.locator(".team-A .bans .auto").count()) === 0);
check("shows how far through the draft the room is", (await spectator.locator(".progress").textContent()).includes("of 14"));
await shot(spectator, "ui-spectator");

// ── reusable links, mid-draft ───────────────────────────────────────────────
await a.close();
await wait(600);
check("shows a captain as disconnected", (await spectator.locator(".presence.disconnected").count()) === 1);
const rejoined = await context.newPage();
watch(rejoined, "captain A (rejoined)");
await rejoined.goto(captainA);
await rejoined.waitForSelector(".turn", { timeout: 5_000 });
check("the same link rejoins mid-draft", (await rejoined.locator(".badge").textContent()) === "Captain A");
check("with the draft intact", (await rejoined.locator(".team-A .bans li").first().textContent()) === "Ozo");

// ── joining with a code ────────────────────────────────────────────────────
// A captain read their code over voice rather than tapping a link.
const roomAddress = captainA.split("?")[0];
const typed = await context.newPage();
watch(typed, "captain typing a code");
await typed.goto(roomAddress);
await typed.waitForSelector("input.code", { timeout: 5_000 });
check("the bare room address asks for a code", (await typed.locator("h1").textContent()).includes("Join room"));

await typed.fill("input.code", "ZZZZZZ");
await typed.click("button.confirm");
await typed.waitForSelector(".warn", { timeout: 10_000 }).catch(() => {});
check("a wrong code comes back to the join screen", (await typed.locator("input.code").count()) === 1);
check("and says what went wrong", ((await typed.locator(".warn").textContent()) ?? "").length > 0);

const codeA = new URL(captainA).searchParams.get("code");
await typed.fill("input.code", codeA.toLowerCase());
await typed.click("button.confirm");
await typed.waitForSelector(".badge", { timeout: 8_000 });
check("the right code gets in, whatever the case", (await typed.locator(".badge").textContent()) === "Captain A");

// Somebody grinding at codes is shut out; watching is untouched by it.
let lockout = null;
for (let index = 0; index < 12; index++) {
  const response = await fetch(`${BASE}/api/rooms/${roomAddress.split("/r/")[1]}/state?code=BADCD${index % 10}`);
  if (response.status === 403) {
    const body = await response.json();
    if (body.retryAt !== undefined) lockout = body;
  }
}
check("guessing at codes gets shut out", lockout !== null);
const watching = await fetch(`${BASE}/api/rooms/${roomAddress.split("/r/")[1]}/state?token=${new URL(spectatorLink).searchParams.get("token")}`);
check("without shutting out spectators", watching.status === 200);

check("no uncaught client errors", clientErrors.length === 0, clientErrors.join(" | "));

await browser.close();
console.log(failures === 0 ? "\nall UI checks passed" : `\n${failures} UI check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
