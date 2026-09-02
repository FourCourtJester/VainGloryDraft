# VainGloryDraft

A tool for running custom pick/ban drafts for Vainglory, aimed at tournament
organisers and their captains. 5v5 and 3v3 run on the same engine.

The design is in [docs/HANDOFF.md](docs/HANDOFF.md). What is built: a pure draft
engine, a Cloudflare Durable Object holding one room each with an authoritative
clock, and a React client. You can create a room, hand out three links, and run
a draft end to end.

## The one idea

A draft is a single ordered list of turns. Bans and picks are not two systems:

```ts
const script = parseScript("Aban, Bban, Apick, Bpick x2, Apick x2, Bpick");
```

5v5, 3v3 and any custom order are different arrays, nothing else. Everything the
engine reports — expected picks per team, minimum pool size, whose turn it is —
is *derived* from the script. Nothing assumes "five picks a side".

## What is here

| Module | Responsibility |
|---|---|
| `src/types.ts` | `Team`, `Action`, `Turn`, `TurnScript`, `Hero`, `DraftConfig`, `DraftState` |
| `src/script.ts` | Script validation, derived totals, `parseScript`/`formatScript` notation |
| `src/config.ts` | Room defaults: mirror picks off, auto-fill random |
| `src/engine.ts` | The engine: current turn, legal heroes, staging, commit, timeout resolution |
| `src/timer.ts` | Per-turn clock plus reserve bank. Pure: computes, never counts down |
| `src/events.ts` | `pick \| ban \| turnChange \| draftComplete` and a subscription bus |
| `src/projection.ts` | Per-token filtered views of the room |
| `src/presets.ts` | Named scripts, including the default `vg-5v5-standard` |
| `src/heroes.ts`, `data/heroes.json` | Static roster, checked in, never fetched at runtime |
| `src/room/` | Room: engine + clock + tokens + connections. No Cloudflare imports |
| `worker/` | Durable Object and Worker routes — a thin adapter over `Room` |
| `client/` | React + Vite SPA: the create screen and the draft room |

```
npm install
npm test          # 126 tests
npm run typecheck
npm run dev       # builds the client, then wrangler dev on :8787
npm run smoke     # protocol end-to-end against a running dev worker
npm run ui-check  # the same in a real browser, three viewers at once
```

Open http://127.0.0.1:8787, create a room, and open the two captain links in
separate windows.

`smoke` and `ui-check` need a worker already running, so CI runs the first
three only.

The protocol — routes, messages, phases — is in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Design decisions the code enforces

- **Nothing is committed until confirm.** Click a hero to stage, click again to
  unstage, then Accept. A `count: 2` turn is one confirm, not two.
- **Timeouts are deterministic.** `autoFillSelection` keeps whatever was staged
  and fills only the remainder, seeded from the room seed plus the turn index, so
  any auto-action can be replayed from the room log and argued about with facts.
  Random is the rule for every timeout, not just partially staged turns — see
  [docs/DECISIONS.md](docs/DECISIONS.md).
- **No pause.** The clock is a pure function of `turnStartedAt` and each team's
  bank. A disconnect burns time like any other silence; the projection carries a
  per-captain connection indicator so the room can see it and decide for itself.
- **Staging visibility.** The captain on the clock sees their own staging and
  spectators see the active team's. The opposing captain sees only a slot count.
- **Mirror picks are per-room**, default off. A team can never pick the same hero
  twice regardless, and a picked hero can never be banned afterwards.
- **The engine does not know consumers exist.** Events are derived by comparing
  two states (`diffEvents`), so a stats panel, an overlay or a webhook is a new
  subscriber and never surgery on the engine.
- **A room stores the resolved script array, not a preset id.** Editing a preset
  cannot change a draft in progress.
- **A finished draft is kept and can be read back.** Every turn is recorded in
  order, with the time it landed and whether the clock chose it, so opening the
  room later shows how the draft actually went rather than just its result.

## The formats

`vg-5v5-standard`, the script a room gets if the organiser picks nothing:

```
Aban, Bban, Aban, Bban, Apick, Bpick, Bpick, Apick, Apick, Bpick, Bpick, Apick, Apick, Bpick
```

Two bans each, then a 1-2-2-2-2-1 snake. Five picks a side, fourteen turns.
`vg-3v3-standard` is the same script with the snake cut short at three a side —
a strict prefix of it, which is what "the same as the fives, but three" means.
Each pick is its own turn, so a team picking twice in a row gets **two clocks
and two confirms**. If a double pick should instead be one clock and one
confirm, that is `Bpick x2` — a one-line change to the preset, and the engine
already handles it.

## Waiting on data

`data/heroes.json` carries 58 hero names with `roles: []` and no icons, and is
marked `verified: false` — the UI will not offer a role filter over data it
cannot trust. A vgna.net export drops straight in:

```
npm run import-heroes -- vgna-heroes.json
```

See [docs/HERO_DATA.md](docs/HERO_DATA.md). Both draft formats are in and
confirmed; nothing else is blocked.

## Where the logic lives

`Room` (`src/room/room.ts`) holds the authoritative state: it decides whose turn
it is, what a timeout resolves to, when the draft starts, and who may see
staging. It takes `now` as an argument and imports nothing from Cloudflare, so a
whole draft — including a clock that expires and an alarm that fires late — is
tested in milliseconds.

The Durable Object owns only sockets, storage and the alarm. That alarm is the
reason for the whole choice of platform: it fires **whether or not anyone is
connected**, so a draft cannot be frozen by closing a laptop, and a room evicted
mid-draft wakes up and resolves each missed turn at its own deadline rather than
all at once.

A room sits in a lobby, clock stopped, until both captains connect.

## The client

A React + Vite SPA, served by the same Worker. It renders what the server sends
and asks for things; it decides nothing. In particular it never computes
legality — a hero is clickable because the server said it was selectable — and
it draws the countdown from `expiresAt` against the server's own clock, which
each `state` message carries, so a viewer with a fast laptop sees the same time
as the captain beside them.

Auto-resolved actions are tagged `auto` wherever they appear, because a hero the
clock chose must never look like one a captain chose.

## Known gaps

Things a tournament organiser would hit, in rough order of how much they matter:

- **No hero portraits or roles yet.** Waiting on the vgna.net export; the
  importer and the UI are both ready for it.
- **Rooms are kept forever.** That is deliberate — a finished draft can be
  reopened weeks later — but it does mean storage only grows. A retention rule
  is an organiser decision as much as a technical one.
- **No organiser controls.** No start button (the room starts itself when both
  captains connect), no remake, no undo. Deliberate for now: a remake is a new
  room, and undo would need a rule about who may call it.
- **Open CORS and no rate limiting** on `/api`. Anyone can create rooms. Fine for
  a private deploy, not for a public one — and worth remembering that the free
  plan has a daily request allowance somebody else could spend for you.
- **Never deployed.** `wrangler deploy` has not been run — everything here was
  verified against `wrangler dev` locally. See [docs/DEPLOYING.md](docs/DEPLOYING.md).

## Next

Portraits and role data, once the scrape can be run; the 3v3 preset, once the
order is supplied. Settled questions are recorded in
[docs/DECISIONS.md](docs/DECISIONS.md).
