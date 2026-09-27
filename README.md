# VainGloryDraft

![Vainglory Draft](client/public/logo-wordmark.png)

A drafting engine: pick, ban and veto, for any game, run live in a room with a
clock. Tournament organisers make a room, hand every team a link, and the draft
runs itself — the clock included, whether or not anybody is watching.

It started as a Vainglory draft tool and is now game-agnostic. What a game's
draft looks like — its teams, what its turns do, its formats, what can be
drafted — is data in a **pack** under `games/`. Two ship: **Vainglory** (5v5
and 3v3 hero drafts) and a **Counter-Strike 2** map veto, which is there to
prove the point. The Vainglory-only version is kept on the `archive/vainglory`
branch. The name will change later.

## The one idea

A draft is a single ordered list of turns, written on one line:

```
A ban, B ban, A pick, B pick x2 @45s, A+B ban, remaining pick
```

Team A bans; team B bans; A picks one; B picks two together, with forty-five
seconds to do it; both teams ban blind at the same time; and whatever is left is
taken. A hero draft, a map veto and a format a tournament invents next month are
different lines, nothing else. Everything the engine reports — whose turn it
is, what each team ends up with, how big the pool has to be — is worked out from
the line. Nothing assumes two teams, five picks, or that "ban" is a word.

What each action does comes from the game: an action either **removes** the
thing for everybody (a ban, a veto, a strike) or **takes** it for the team that
chose it (a pick). How to write a pack, and the notation in full, are in
[docs/GAMES.md](docs/GAMES.md).

## What is here

| Module | Responsibility |
|---|---|
| `src/types.ts` | `Team`, `ActionDefinition`, `Turn`, `TurnScript`, `DraftConfig`, `DraftState` |
| `src/script.ts` | The notation, validation, and everything derived from a format |
| `src/engine.ts` | The rules: whose turn, what is legal, staging, locking in, blind reveals, timeouts |
| `src/timer.ts` | Per-turn clock plus a reserve per team. Pure: computes, never counts down |
| `src/events.ts` | `choice \| turnChange \| draftComplete`, worked out by comparing two states |
| `src/record.ts` | The account of a finished draft, derived from its choices |
| `src/projection.ts` | What each person in a room is allowed to see |
| `src/config.ts` | Room defaults: mirrors off |
| `src/game.ts` | What a pack is, and the checks it must pass to load |
| `src/games.ts` | The one place that knows which packs exist |
| `games/<id>/` | The packs: `game.json` by hand, `catalog.json` by the import scripts |
| `src/room/` | Room: engine + clock + codes + connections. No Cloudflare imports, no game |
| `src/room/roster.ts` | Who is on each side, who leads, and who has said they are ready |
| `src/room/suggestions.ts` | What a side has asked its own captain for |
| `worker/` | Durable Object and Worker routes — a thin adapter over `Room` |
| `client/` | React + Vite SPA: the create screen and the draft room |
| `scripts/import-catalog.mjs` | Takes a roster export and writes a game's catalog |
| `scripts/import-portraits.mjs` | Squares, shrinks and self-hosts a folder of pictures |
| `scripts/make-logo.mjs` | Draws the mark and every icon size — see [docs/BRAND.md](docs/BRAND.md) |

```
npm install
npm test          # 295 tests
npm run typecheck
npm run dev       # builds the client, then wrangler dev on :8787
npm run smoke     # the protocol end to end against a running dev worker
npm run ui-check  # a real browser, several players, each in its own window
```

Open http://127.0.0.1:8787, choose a game, create a room, and open two team
links in separate windows.

`smoke` and `ui-check` need a worker already running, so CI runs the first
three only.

The protocol — routes, messages, phases — is in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Kinds of turn

- **One team.** They choose, confirm, and it is done. `x2` means two chosen
  together, on one clock, with one confirm.
- **Several teams at once, blind** — `A+B ban`. Each chooses without seeing the
  others and nothing is shown until the last confirms or runs out of time; then
  it is all revealed together. Nobody outside a team sees its choice before
  that, spectators included, since anybody can open a spectator link. Everyone
  can see who has locked in.
- **Nobody** — `remaining pick`. The draft takes what is left the moment it gets
  there: a map veto's decider.

Any turn can carry its own time (`@45s`) in place of the room's usual one.

## Design decisions the code enforces

- **Nothing is committed until confirm.** Click to stage, click again to
  unstage, then confirm. A `count: 2` turn is one confirm, not two.
- **Timeouts are random, and repeatable.** `autoFillSelection` keeps whatever was
  staged and draws only the remainder, seeded from the room seed plus the turn
  index, so any auto-action can be replayed from the room log and argued about
  with facts — see [docs/DECISIONS.md](docs/DECISIONS.md).
- **No pause.** The clock is a pure function of `turnStartedAt` and each team's
  reserve. A disconnect burns time like any other silence; the room shows who is
  connected and leaves the decision to the people running it.
- **Staging visibility.** A team sees its own staging. On a single-team turn
  spectators see it too; nobody else ever does.
- **Mirrors are per room**, defaulting to the game's rule. A team can never take
  the same thing twice regardless, and something taken can never be removed
  afterwards.
- **Events are derived, not recorded.** `diffEvents` compares two states, so a
  room picked back up from storage announces exactly what an uninterrupted one
  would have.
- **The room never reads a pack.** It is handed its teams, actions, format and
  pool when it is made and keeps a copy, so editing a pack cannot change a draft
  in progress, and the room can run any game.
- **Each side gets a short code, spectators get a link.** A code is six
  characters that can be read out over voice, carried in a link for one tap, or
  typed. Wrong codes are counted and the room stops answering after a handful.
- **Captains only, or whole squads — the room's choice.** By default one captain
  a side joins and the room waits for nobody else; anybody else with the link is
  a stand-in who can take over if the captain drops. With squads, everyone on a
  team joins on the same code, the first to arrive chooses, and teammates tell
  their captain what they want — marks the other side never sees.
- **The draft starts on a ready check**, not on a connection — on by default,
  and a room can turn it off to begin the moment the last person arrives. With
  squads, the leaders can also agree to begin short-handed, for a no-show.
- **Names arrive already filled in**, and identity is an id, never a name or a
  device fingerprint — see [docs/IDENTITY.md](docs/IDENTITY.md).
- **A finished draft is kept and can be read back**, choice by choice, with when
  each landed and whether the clock chose it.
- **A room clears itself out.** A finished draft is kept a month; a room nobody
  ever played in goes six hours after the last sign of anybody in it.
- **Anybody may start a draft.** There is no key and no limit in the app; if the
  site is ever scripted at, Cloudflare's own rate-limiting rule covers it.

## The packs

**Vainglory.** `vg-5v5-standard` is two bans each, then a 1-2-2-2-2-1 snake;
`vg-3v3-standard` is the same cut short at three a side. A double pick is one
turn. 58 heroes, 57 with self-hosted portraits. Roles are known as a vocabulary
— Captain, Jungle, Lane — but no hero has one yet, so no role filter is offered:
a filter over guessed data is worse than none. A per-hero export drops straight
in:

```
npm run import-catalog -- vainglory vgna-heroes.json --dry-run
node scripts/import-portraits.mjs vainglory "~/Hero Portraits"
```

See [docs/HERO_DATA.md](docs/HERO_DATA.md).

**Counter-Strike 2.** Best-of-one and best-of-three vetoes over seven maps, each
ending in a decider nobody picks. The map list is an example and the orders are
the common Valve Major shape, both marked unconfirmed: check them against a real
rulebook before a real match.

## Where the logic lives

`Room` (`src/room/room.ts`) holds the authoritative state: it decides whose turn
it is, what a timeout resolves to, when the draft starts, and who may see
staging. It takes `now` as an argument and imports nothing from Cloudflare, so a
whole draft — including a clock that expires and an alarm that fires late — is
tested in milliseconds.

The Durable Object owns only sockets, storage and the alarm. That alarm is the
reason for the whole choice of platform: it fires **whether or not anyone is
connected**, so a draft cannot be frozen by closing a laptop, and a room evicted
mid-draft wakes up and resolves each missed deadline at the moment it passed.

## The client

A React + Vite SPA, served by the same Worker. It renders what the server sends
and asks for things; it decides nothing. The rules — teams, actions, what is
selectable — arrive with every update; the game's catalog supplies only names
and pictures. The countdown is drawn from each team's deadline against the
server's own clock, so a viewer with a fast laptop sees the same time as the
captain beside them.

Auto-resolved choices are tagged `auto` wherever they appear, because something
the clock chose must never look like something a captain chose.

## Known gaps

- **Branding still says Vainglory.** The name, logo and wordmark are the old
  tool's, pending a rename.
- **Packs are files in the repo.** Adding a game is a pull request, not a form.
  An organiser can already write their own order when making a room.
- **No per-hero roles for Vainglory yet** — waiting on VGNA.
- **No list of past drafts.** A draft reopens from its own link, but nothing
  enumerates them; that needs an index and a decision about whose history a
  person may see.
- **No organiser controls.** No remake, no undo, no pause.
- **Open CORS.** Worth narrowing if the API grows readers beyond the app and a
  bot.
- **Never deployed.** Everything here was verified against `wrangler dev`
  locally. See [docs/DEPLOYING.md](docs/DEPLOYING.md).

Settled questions are recorded in [docs/DECISIONS.md](docs/DECISIONS.md), and
what is still open is at the end of it.
