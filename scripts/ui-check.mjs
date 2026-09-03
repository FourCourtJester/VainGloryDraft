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
// A short clock so the alarm can be watched without a long wait. This check is
// about drafting rather than the lobby, so one player a side.
await organiser.fill('input[type="number"] >> nth=0', "1"); // players per side
await organiser.fill('input[type="number"] >> nth=1', "8"); // seconds per turn
await organiser.fill('input[type="number"] >> nth=2', "4"); // reserve
await organiser.click("button.confirm");
await organiser.waitForSelector(".links code");
const [captainA, captainB, spectatorLink] = await organiser.locator(".links code").allTextContents();
// The captains get a short code in their link; spectators get a long token.
check("hands the captains a code and spectators a link",
  captainA.includes("code=") && captainB.includes("code=") && spectatorLink.includes("token="));
await shot(organiser, "ui-create");

// ── the lobby holds the clock ───────────────────────────────────────────────
// A separate browser context per player: their own storage, their own id, the
// way six people on six phones actually arrive.
const enter = async (link, who) => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  watch(page, who);
  await page.goto(link);
  await page.waitForSelector("input[aria-label='Your name']", { timeout: 5_000 });
  await page.fill("input[aria-label='Your name']", who);
  await page.click("button.confirm");
  // The lobby if the draft has not begun; the board if it has.
  await page.waitForSelector(".lobby, .turn", { timeout: 8_000 });
  return page;
};

const a = await enter(captainA, "Ana");
check("puts a player on the side their link belongs to", (await a.locator(".badge").textContent()).startsWith("Team A"));
check("and has them picking, as the first to arrive", (await a.locator(".squad.team-A .tag.lead").count()) === 1);
check("runs no clock while waiting", (await a.locator(".turn").count()) === 0);
await shot(a, "ui-lobby");

const b = await enter(captainB, "Ben");
const spectator = await context.newPage();
watch(spectator, "spectator");
await spectator.goto(spectatorLink);
await wait(400);
check("does not start merely because both sides are present", (await a.locator(".turn").count()) === 0);

await a.click(".ready-bar button");
await wait(300);
check("nor when only one side has confirmed", (await a.locator(".turn").count()) === 0);
await b.click(".ready-bar button");
await a.waitForSelector(".turn", { timeout: 5_000 });
check("starts once every player is ready", (await a.locator(".turn-label").textContent()).startsWith("Team A bans"));
check("shows both sides connected", (await a.locator(".presence.connected").count()) === 2);

// ── the staging rule, in the rendered DOM ───────────────────────────────────
await a.locator("button.hero", { hasText: "Ozo" }).first().click();
await wait(400);
check("the side on the clock sees its own staging", (await a.locator("button.hero.staged").count()) === 1);
check("spectators see the active team's staging", (await spectator.locator("button.hero.staged").count()) === 1);
check("the opposing side does not", (await b.locator("button.hero.staged").count()) === 0);
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

// Out of turn a hero can still be tapped, but only to tell your captain: it
// stages nothing, and no action is offered that the server would refuse.
await a.locator('button.hero[data-hero="ringo"]').click();
await wait(400);
check("out of turn, tapping a hero stages nothing", (await a.locator("button.hero.staged").count()) === 0);
check("and no confirm bar is shown", (await a.locator(".confirm-bar").count()) === 0);
check("the turn is undisturbed", (await b.locator(".turn-label").textContent()).startsWith("Team B"));

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
check("shows a side as disconnected", (await spectator.locator(".presence.disconnected").count()) === 1);
const rejoined = await enter(captainA, "Ana");
check("the same link rejoins mid-draft", (await rejoined.locator(".badge").textContent()).startsWith("Team A"));
check("with the draft intact", (await rejoined.locator(".team-A .bans li").first().textContent()) === "Ozo");

// ── joining with a code ────────────────────────────────────────────────────
// A captain read their code over voice rather than tapping a link.
const roomAddress = captainA.split("?")[0];
const typed = await context.newPage();
watch(typed, "captain typing a code");
await typed.goto(roomAddress);
await typed.waitForSelector("input.code", { timeout: 5_000 });
check("the bare room address asks for a code", (await typed.locator("h1").textContent()).includes("Join room"));

await typed.fill("input[aria-label='Your name']", "Ash");
await typed.fill("input.code", "ZZZZZZ");
await typed.click("button.confirm");
await typed.waitForSelector(".warn", { timeout: 10_000 }).catch(() => {});
check("a wrong code comes back to the join screen", (await typed.locator("input.code").count()) === 1);
check("and says what went wrong", ((await typed.locator(".warn").textContent()) ?? "").length > 0);

const codeA = new URL(captainA).searchParams.get("code");
await typed.fill("input[aria-label='Your name']", "Ash");
await typed.fill("input.code", codeA.toLowerCase());
await typed.click("button.confirm");
await typed.waitForSelector(".badge", { timeout: 8_000 });
check("the right code gets in, whatever the case", (await typed.locator(".badge").textContent()).startsWith("Team A"));

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

// ── a whole squad in the lobby ──────────────────────────────────────────────
// A second room, three a side, for the part that only shows up with a crowd:
// who leads, handing that job on, and the ready check.
const squadRoom = await (
  await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ presetId: "vg-3v3-standard", perTurnMs: 60_000 }),
  })
).json();

const squad = async (code, who) => {
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 900 } })).newPage();
  watch(page, who);
  await page.goto(`${BASE}/r/${squadRoom.roomId}?code=${code}`);
  await page.waitForSelector("input[aria-label='Your name']", { timeout: 5_000 });
  await page.fill("input[aria-label='Your name']", who);
  await page.click("button.confirm");
  await page.waitForSelector(".lobby, .turn", { timeout: 8_000 });
  return page;
};

const ana = await squad(squadRoom.codes.A, "Ana");
check("the first player on a side does the picking", (await ana.locator(".squad.team-A .tag.lead").count()) === 1);
const ali = await squad(squadRoom.codes.A, "Ali");
const ash = await squad(squadRoom.codes.A, "Ash");
await wait(500);
check("teammates land on the same side", (await ana.locator(".squad.team-A li:not(.empty)").count()) === 3);
check("and only one of them picks", (await ana.locator(".squad.team-A .tag.lead").count()) === 1);
check("a teammate is offered no hand-over", (await ali.locator("button.hand-over").count()) === 0);
check("the one picking is offered one per teammate", (await ana.locator("button.hand-over").count()) === 2);
await shot(ana, "ui-lobby-squad");

await ana.locator(".squad.team-A li", { hasText: "Ash" }).locator("button.hand-over").click();
await wait(600);
check("handing over moves the job", (await ash.locator(".squad.team-A li").filter({ hasText: "Ash" }).locator(".tag.lead").count()) === 1);
check("and takes the buttons with it", (await ana.locator("button.hand-over").count()) === 0);

const ben = await squad(squadRoom.codes.B, "Ben");
const bea = await squad(squadRoom.codes.B, "Bea");
await wait(400);
check("a side still short keeps everyone waiting", (await ana.locator(".turn").count()) === 0);
const bo = await squad(squadRoom.codes.B, "Bo");
await wait(500);
check("a full room asks everybody to confirm", (await ana.locator(".lobby-head h2").textContent()) === "Ready check");

for (const page of [ana, ali, ash, ben, bea]) await page.click(".ready-bar button");
await wait(600);
check("five of six is not everybody", (await ana.locator(".turn").count()) === 0);
await bo.click(".ready-bar button");
await ana.waitForSelector(".turn", { timeout: 8_000 });
check("the last confirmation starts the draft", (await ana.locator(".turn").count()) === 1);

await ash.locator("button.hero", { hasText: /^Ozo$/ }).first().click();
await wait(400);
check("the one picking can choose", (await ash.locator("button.hero.staged").count()) === 1);
check("a teammate watches their own side deliberate", (await ali.locator("button.hero.staged").count()) === 1);
check("the other side cannot", (await ben.locator("button.hero.staged").count()) === 0);
// The leader already has one hero staged at this point, so the test is that a
// teammate's tap adds nothing to it and offers them nothing to confirm.
const stagedBefore = await ash.locator("button.hero.staged").count();
await ali.locator('button.hero[data-hero="ringo"]').click();
await wait(400);
check("a teammate tapping a hero stages nothing", (await ash.locator("button.hero.staged").count()) === stagedBefore);
check("and they are offered nothing to confirm", (await ali.locator("button.confirm").count()) === 0);

// ── telling the captain what you want ──────────────────────────────────────
// Most of these teams are not in voice chat, so this is how the captain hears
// from anybody. Marks add a count to a tile, so go by hero id, not by name.
check("the one picking gets no suggest controls", (await ash.locator(".suggest-bar").count()) === 0);
check("their teammates do", (await ali.locator(".suggest-bar").count()) === 1);

for (const page of [ali, ana]) {
  await page.click(".suggest-bar .mode.want");
  await page.locator('button.hero[data-hero="krul"]').click();
}
await ana.click(".suggest-bar .mode.ban");
await ana.locator('button.hero[data-hero="saw"]').click();
await wait(700);

const askedFor = await ash.locator(".asked-for .asked").allTextContents();
check("the captain is shown what their side asked for", askedFor.some((text) => text.startsWith("Krul")), askedFor.join(" | "));
check("with the most-agreed first", askedFor[0]?.startsWith("Krul") === true, askedFor.join(" | "));
check("and how many of them wanted it", (await ash.locator(".asked-for .ask.want").first().textContent()) === "2");
check("a ban asked for reads apart from a want", (await ash.locator(".asked-for .ask.ban").count()) === 1);
check("the other side is shown none of it", (await ben.locator(".asked-for").count()) === 0);
check("a teammate sees their own marks", (await ana.locator("button.hero.marked-want").count()) === 1);
check("marking never moves the draft on", (await ash.locator(".turn-label").textContent()).startsWith("Team A"));

// ── names, and beginning short-handed ──────────────────────────────────────
const shortRoom = await (
  await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ presetId: "vg-3v3-standard", perTurnMs: 60_000, teamSize: 3 }),
  })
).json();

const lead = async (code, who) => {
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 900 } })).newPage();
  watch(page, who);
  await page.goto(`${BASE}/r/${shortRoom.roomId}?code=${code}`);
  await page.waitForSelector("input[aria-label='Your name']", { timeout: 5_000 });
  const suggested = await page.inputValue("input[aria-label='Your name']");
  await page.click("button.confirm");
  await page.waitForSelector(".lobby, .turn", { timeout: 8_000 });
  return { page, suggested };
};

const first = await lead(shortRoom.codes.A, "Ana");
check("a name is filled in already, so joining is one tap", /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(first.suggested), first.suggested);
const second = await lead(shortRoom.codes.B, "Ben");
check("a different browser gets a different name", first.suggested !== second.suggested);
await wait(400);

// Three a side were expected and one each turned up: the leaders can begin anyway.
check("a short room offers its leaders a way to begin", (await first.page.locator(".start-anyway button").count()) === 1);
await first.page.click(".start-anyway button");
await wait(400);
check("one side agreeing is not enough", (await first.page.locator(".turn").count()) === 0);
check("and the other side is told it can finish it", (await second.page.locator(".start-anyway .note").textContent()).includes("has agreed"));
await second.page.click(".start-anyway button");
await first.page.waitForSelector(".turn", { timeout: 8_000 });
check("both leaders agreeing begins it short-handed", (await first.page.locator(".turn").count()) === 1);

check("no uncaught client errors", clientErrors.length === 0, clientErrors.join(" | "));

await browser.close();
console.log(failures === 0 ? "\nall UI checks passed" : `\n${failures} UI check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
