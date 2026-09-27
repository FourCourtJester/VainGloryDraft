# Room protocol

One Durable Object per room holds the authoritative state and clock. Clients
connect over a WebSocket and are told what they are allowed to see.

## HTTP

| Route | Purpose |
|---|---|
| `POST /api/rooms` | Create a room. Returns `roomId`, a link and a code per team, and a spectator link. |
| `GET /api/rooms/:id/ws?token=` or `?code=` | WebSocket upgrade. |
| `GET /api/rooms/:id/state?token=` or `?code=` | One-shot projection. A fallback for reconnects. |
| `GET /api/rooms/:id/record?token=` or `?code=` | The whole draft in the order it happened. |
| `GET /api/games` | Every game on offer, with its formats and defaults. |
| `GET /api/games/:id` | One game in full: teams, actions, its catalog, and the filters that can be trusted. |

`POST /api/rooms` body — `game` is required, everything else optional:

```jsonc
{ "game": "vainglory",
  "preset": "vg-5v5-standard",          // one of the game's formats…
  "script": "A ban, B ban, A pick x2",  // …or an order written out, which wins
  "teams": [{ "id": "A", "name": "Liquid" }, { "id": "B", "name": "FaZe" }],
  "pool": ["ozo", "krul", "…"],         // a part of the catalog, if not all of it
  "mirror": false, "perTurnMs": 30000, "bankMs": 60000,
  "joining": "captains",                // or "squads"
  "readyCheck": true,
  "teamSize": 5 }                       // squads only
```

`script` is the notation in [GAMES.md](GAMES.md) and wins over `preset`. With
neither, a room gets the game's default format. `teams` replaces the format's
teams — other names, or more of them — and must still cover every team the
order names. The clock and mirror setting default to the game's own.

The room is handed the rules — teams, actions, turns, pool — rather than the
name of a game to look them up in. It keeps its own copy, and never reads a pack
itself.

Room options are validated before they reach the engine: `perTurnMs` and `bankMs`
must be finite numbers inside sane bounds, an order must parse and fit the pool,
and a pool may only name things in the game's catalog. Anything wrong comes back as a
`400` saying what.

## Identity

A room hands out two kinds of credential, because the two audiences want
opposite things.

**Players get a six-character code**, one per team, shared by that whole team — `9YZ6P7` — drawn from an alphabet with no
characters that get confused when read aloud (no O/0, no I/L/1). It arrives in
their link, so tapping it is enough, and it can be typed at `/r/:roomId` by
anyone who was given the code some other way. Case and stray spaces are
forgiven. A player also gives a name, so their side knows who is who.

**Everyone else gets a long spectator link** and no code. Watching is not worth
protecting, and a link that can be pasted into a channel is worth a lot.

Either is resolved to a viewer **once, at connect**. No message carries a claim
about who sent it, so a client cannot assert a team: `{"t":"confirm","team":"B"}`
is just a confirm from whoever holds that socket. Both are reusable, so a captain
may hold several sockets at once — a laptop and a phone both count as present.

### Guessing

Six characters is comfortable to type and short enough to guess if you are
allowed to sit there trying. A room counts wrong codes and, after eight in five
minutes, stops answering them until the window passes; the refusal says when to
try again. Spectator links are checked first and are never affected, so one
person grinding at codes cannot shut a tournament out of watching. A captain who
gets in clears the count, so their own typos cost the next person nothing.

## Creating rooms from a bot

Anybody who finds the site can start a draft, and a bot is simply another
caller: it posts to `/api/rooms` like the create screen does. Nothing is rate
limited in the app itself; if the site ever needs protecting, Cloudflare's own
rate-limiting rule does it without code.

The response carries the codes on their own as well as inside the links, so a bot
can either paste a link or read a code out:

```jsonc
{ "roomId": "d0jdFJPePKM",
  "game": "vainglory",
  "teams": [{ "id": "A", "name": "Team A" }, { "id": "B", "name": "Team B" }],
  "format": "A ban, B ban, A ban, B ban, A pick, B pick x2, …",
  "codes": { "A": "9YZ6P7", "B": "QADXBU" },
  "links": { "teams": { "A": "…?code=9YZ6P7", "B": "…?code=QADXBU" },
             "spectator": "…?token=99tXdNC0NnTHe0cRIRi3EQ", "join": "…/r/d0jdFJPePKM" } }
```

`codes` and `links.teams` have one entry per team, keyed by team id, however
many teams there are.

## Client → server

```jsonc
{ "t": "stage",   "itemId": "ozo" }   // toggles: staging something staged unstages it
{ "t": "unstage", "itemId": "ozo" }
{ "t": "confirm" }                     // commits the whole staged turn at once
{ "t": "resync" }                      // "send me the current state"
{ "t": "ready",     "ready": true }    // "I am ready", or taking that back
{ "t": "handOver",  "memberId": "A:…" } // the leader giving the job to a teammate
{ "t": "claimLead" }                   // a teammate stepping in for an absent leader
{ "t": "startAnyway", "agreed": true } // a leader agreeing to begin short-handed
{ "t": "suggest", "itemId": "ozo", "intent": "pick" }  // any of the draft's actions — telling your own captain
```

Anything else is answered with `{"t":"error","error":{"code":"bad_message"}}` and
changes nothing.

## Server → client

```jsonc
{ "t": "welcome", "roomId": "…", "viewer": { "role": "player", "team": "A", "memberId": "A:…" } }
{ "t": "state",   "phase": "drafting", "serverTime": 1730000000000, "projection": { … }, "events": [ … ] }
{ "t": "error",   "error": { "code": "wrong_team", "message": "…" } }
```

- **`serverTime`** is the room's own clock when it sent the message. Clients
  compare it with theirs and draw the countdown against the room's, so a viewer
  whose laptop is a minute fast does not see a minute less time.
- **`state`** goes to every connection after anything changes, each with its own
  projection. The projection carries the room's `game`, `teams` and `actions`,
  so a screen needs no rules of its own — only the game's catalog, for names
  and pictures. `staged` is `null` for a viewer not allowed to see it;
  `stagedCount` (per team on the clock) and `locked` (which teams on a blind
  turn have confirmed) are always present. A team that has locked in on a blind
  turn is sent its own choice as `yourLock`, and nobody else is.
- **`events`** are settled choices only — `choice` (with its `team`, `action`
  and `items`; `team` is null for what the draft took itself), `turnChange`,
  `draftComplete`. Staging never produces an event, and neither does one team
  locking in on a blind turn, so the subscription surface cannot leak either.
  This is the hook a stats panel or overlay subscribes to.
- **`error`** goes only to the socket whose command was rejected. A rejected
  command is not persisted and triggers no broadcast.

## What a room keeps, and for how long

A room is saved as it plays, so a draft can be opened again days later from the
same links and read back exactly as it happened. It does not last forever,
though — a room clears itself out on its own, at one of two points:

- **A month after the draft finishes.** Long past anybody's interest in a set
  that is over, and it means storage does not simply grow without limit.
- **Six hours after a room was made, if nobody ever played in it.** A link made
  and never used is rubbish rather than history. The six hours run from the last
  time anybody was seen in the room, not from when the link was made, so a room
  set up well in advance of a match — with people sitting in it waiting — is
  never swept out from under them.

A room that has cleared itself out is gone for good: its links stop working and
`GET /state` answers 404. Both windows can be set per room at creation with
`retentionSeconds` and `abandonAfterSeconds`, which is mostly useful for testing.

What is kept is the draft itself — every choice in order, which team, what they
chose, whether the clock chose it because a captain ran out of time, and the
moment it landed. Nothing else needs recording, because the account of the draft
is worked out from those turns rather than written separately.

`GET /api/rooms/:id/record` returns it as JSON, for keeping elsewhere:

```jsonc
{
  "roomId": "vWsxh4rNyic",
  "createdAt": 1788345973614,
  "phase": "complete",
  "game": "vainglory",
  "teams": [{ "id": "A", "name": "Team A" }, { "id": "B", "name": "Team B" }],
  "format": "A ban, B ban, A ban, B ban, A pick, B pick x2, A pick x2, B pick",
  "mirror": false,
  "complete": true,
  "durationMs": 12900,
  "autoCounts": { "A": 0, "B": 1 },
  "turns": [
    { "number": 1, "team": "A", "action": "ban", "items": ["ozo"], "auto": false, "at": 1788345974700, "tookMs": 1086 }
  ]
}
```

On a blind turn every team gets its own entry, sharing the turn's `number`, each
timed from when that turn began. A turn nobody plays has `team: null`.

Opening a finished room shows the same account on screen, above the board.

## Who is in the room

Everyone on a side joins with the same code. The **first to arrive leads** —
they are the only one who can choose for the side — and they can hand that job to a
teammate at any time, before or during the draft. If the person leading is not
connected, a teammate may take over; while they are connected, nobody can take
it from them.

A player is remembered by an id their browser keeps, so somebody whose phone
dies comes back as themselves: same side, still leading if they were. The id is
scoped to the side, so one browser can hold both team links without the second
one arriving as the first. A bot that knows who is who can supply the id and
name in the link instead — see [IDENTITY.md](IDENTITY.md), which is the better
answer if you want to recognise a player across drafts.

If the leader stays disconnected for 45 seconds the job passes to the
longest-serving connected teammate on its own, so nobody has to notice and
click. A teammate can take over sooner by asking.

A no-show should not be able to cancel a match, so the sides' leaders can
agree to begin without a full room (`startAnyway`). It takes every one of them,
so no side can start on another.

Teammates see their own side's staging. Other sides never do.

## Telling your captain what you want

Plenty of teams are not in voice chat, so a player who is not choosing can mark
things with any of the draft's actions — "pick this", "ban that". The person
choosing sees the marks gathered per item, most-agreed first, with the names
behind each — which is what they can actually read with a clock running.

A mark is not an action: it takes no turn and spends no time, and only the
person leading the side ever commits anything.

Marks go to that side alone. Unlike a staged choice — seconds from being public
anyway — a suggestion says what a team means to do several turns ahead, so other
sides and the spectators never see them. Anything already removed or taken drops
off the list, since it is noise at the moment there is least time for it.

## Phases

`lobby → drafting → complete`

A room sits in `lobby`, clock stopped, until everybody it waits for is present
and — with the ready check on, which is the default — has said they are ready.
Being present is not enough on its own: two people staring at a loading screen
is exactly when somebody is still finding their headset. Time spent waiting
costs nobody anything, and readiness can be taken back. With the ready check
off, the draft begins the moment the last of them arrives. Draft commands in
the lobby are refused with `not_started`. `complete` stops the clock and clears
the alarm.

Who a room waits for is its `joining` setting:

- **`captains`**, the default: one person a side. Anybody else who opens a
  team's link is a stand-in — they can take over if the captain drops — and
  nobody waits for them or their readiness.
- **`squads`**: the whole team joins, so teammates can watch their own side
  choose and tell their captain what they want. The room waits for `teamSize`
  players a side, which defaults to the format's own figure — five for a 5v5
  hero draft. Sending `teamSize` without `joining: "squads"` is refused rather
  than quietly ignored.

## The clock

`turnStartedAt` plus a per-team bank, and the client derives its own countdown —
the server sends values, never a countdown. A turn's allowance is the room's
`perTurnMs` unless the format gives that turn its own (`@45s`). The projection's
clock carries `deadlines`, one per team still choosing: on a blind turn each
team has its own, because each spends its own reserve. The Durable Object's
alarm is set to the soonest of them and fires **whether or not anyone is
connected**, so a draft cannot be frozen by closing a laptop.

A late alarm is resolved turn by turn, each at *its own* deadline rather than all
at the wake-up time, so a room that was evicted for two minutes produces the same
history as one that was watched the whole way through.

## Trying it

```
npm run dev       # builds the client, then wrangler dev on :8787
npm run smoke     # drives a real room end to end, alarm included
npm run ui-check  # the same through the real UI in Chromium
```
