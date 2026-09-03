# Room protocol

One Durable Object per room holds the authoritative state and clock. Clients
connect over a WebSocket and are told what they are allowed to see.

## HTTP

| Route | Purpose |
|---|---|
| `POST /api/rooms` | Create a room. Returns `roomId` and the three links. |
| `GET /api/rooms/:id/ws?token=` or `?code=` | WebSocket upgrade. |
| `GET /api/rooms/:id/state?token=` or `?code=` | One-shot projection. A fallback for reconnects. |
| `GET /api/rooms/:id/record?token=` or `?code=` | The whole draft in the order it happened. |
| `GET /api/heroes` | Static roster, with the `verified` flag. |
| `GET /api/presets` | Preset list plus the still-`PENDING` ids. |

`POST /api/rooms` body (all optional):

```json
{ "presetId": "vg-5v5-standard", "script": "Aban, Bban, Apick x2",
  "mirrorPicks": false, "autoFill": "random", "perTurnMs": 30000, "bankMs": 60000,
  "callbackUrl": "https://bot.example/draft-finished" }
```

`script` is compact notation and wins over `presetId`. With neither, a room gets
`vg-5v5-standard`. The response carries three links — captain A, captain B,
spectator — of the form `/r/:roomId?token=…`. The Worker serves the SPA there,
which reads the room id and token straight from the URL.

Room options are validated before they reach the engine: `perTurnMs` and `bankMs`
must be finite numbers inside sane bounds, and an unknown `autoFill` falls back
to `random` rather than being stored.

## Identity

A room hands out two kinds of credential, because the two audiences want
opposite things.

**Captains get a six-character code** — `9YZ6P7` — drawn from an alphabet with no
characters that get confused when read aloud (no O/0, no I/L/1). It arrives in
their link, so tapping it is enough, and it can be typed at `/r/:roomId` by
anyone who was given the code some other way. Case and stray spaces are
forgiven.

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

Set `ROOM_CREATE_SECRET` and only a caller who sends it as `x-api-key` can make
rooms. Left unset, anybody who finds the address can — fine while it is private,
not fine on a public deployment where somebody else can spend your request
allowance.

`POST /api/rooms` also takes `callbackUrl` (https only). When the draft finishes,
the room POSTs the same body as `GET /record` to that address, once — a bot
posting the result to a channel should not post it twice because a spectator
reloaded. A bot that is down when it fires misses nothing: the record can still
be fetched whenever it comes back.

The response carries the codes on their own as well as inside the links, so a bot
can either paste a link or read a code out:

```jsonc
{ "roomId": "d0jdFJPePKM",
  "codes": { "A": "9YZ6P7", "B": "QADXBU" },
  "links": { "captainA": "…?code=9YZ6P7", "captainB": "…?code=QADXBU",
             "spectator": "…?token=99tXdNC0NnTHe0cRIRi3EQ", "join": "…/r/d0jdFJPePKM" } }
```

## Client → server

```jsonc
{ "t": "stage",   "heroId": "ozo" }   // toggles: staging a staged hero unstages it
{ "t": "unstage", "heroId": "ozo" }
{ "t": "confirm" }                     // commits the whole staged turn at once
{ "t": "resync" }                      // "send me the current state"
```

Anything else is answered with `{"t":"error","error":{"code":"bad_message"}}` and
changes nothing.

## Server → client

```jsonc
{ "t": "welcome", "roomId": "…", "viewer": { "role": "captain", "team": "A" } }
{ "t": "state",   "phase": "drafting", "serverTime": 1730000000000, "projection": { … }, "events": [ … ] }
{ "t": "error",   "error": { "code": "wrong_team", "message": "…" } }
```

- **`serverTime`** is the room's own clock when it sent the message. Clients
  compare it with theirs and draw the countdown against the room's, so a viewer
  whose laptop is a minute fast does not see a minute less time.
- **`state`** goes to every connection after anything changes, each with its own
  projection. `staged` is `null` for a viewer not allowed to see it; `stagedCount`
  is always present.
- **`events`** are committed actions only — `pick`, `ban`, `turnChange`,
  `draftComplete`. Staging never produces an event, so the subscription surface
  cannot leak it. This is the hook a stats panel or overlay subscribes to.
- **`error`** goes only to the socket whose command was rejected. A rejected
  command is not persisted and triggers no broadcast.

## What a room keeps, and for how long

A room is saved as it plays, and stays saved. There is no expiry: it lasts until
somebody deletes it, so a draft can be opened again a week later from the same
links and read back exactly as it happened.

What is kept is the draft itself — every turn in order, which team, which heroes,
whether the clock chose them because a captain ran out of time, and the moment
each turn landed. Nothing else needs recording, because the account of the draft
is worked out from those turns rather than written separately.

`GET /api/rooms/:id/record` returns it as JSON, for keeping elsewhere:

```jsonc
{
  "roomId": "vWsxh4rNyic",
  "createdAt": 1788345973614,
  "phase": "complete",
  "format": "Aban, Bban, Aban, Bban, Apick, Bpick, Bpick, Apick, Apick, Bpick",
  "mirrorPicks": false,
  "complete": true,
  "durationMs": 12900,
  "autoCounts": { "A": 0, "B": 1 },
  "turns": [
    { "number": 1, "team": "A", "action": "ban", "heroes": ["ozo"], "auto": false, "at": 1788345974700, "tookMs": 1086 }
  ]
}
```

Opening a finished room shows the same account on screen, above the board.

## Phases

`lobby → drafting → complete`

A room sits in `lobby`, clock stopped, until **both captains have connected**;
time spent waiting costs nobody anything. Commands in the lobby are refused with
`not_started`. `complete` stops the clock and clears the alarm.

## The clock

`turnStartedAt` plus a per-team bank, and the client derives its own countdown —
the server sends values, never a countdown. The Durable Object's alarm is set to
the current turn's deadline and fires **whether or not anyone is connected**, so a
draft cannot be frozen by closing a laptop.

A late alarm is resolved turn by turn, each at *its own* deadline rather than all
at the wake-up time, so a room that was evicted for two minutes produces the same
history as one that was watched the whole way through.

## Trying it

```
npm run dev       # builds the client, then wrangler dev on :8787
npm run smoke     # drives a real room end to end, alarm included
npm run ui-check  # the same through the real UI in Chromium
```
