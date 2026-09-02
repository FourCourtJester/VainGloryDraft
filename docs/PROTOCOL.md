# Room protocol

One Durable Object per room holds the authoritative state and clock. Clients
connect over a WebSocket and are told what they are allowed to see.

## HTTP

| Route | Purpose |
|---|---|
| `POST /api/rooms` | Create a room. Returns `roomId` and the three links. |
| `GET /api/rooms/:id/ws?token=` | WebSocket upgrade. |
| `GET /api/rooms/:id/state?token=` | One-shot projection. A fallback for reconnects. |
| `GET /api/heroes` | Static roster, with the `verified` flag. |
| `GET /api/presets` | Preset list plus the still-`PENDING` ids. |

`POST /api/rooms` body (all optional):

```json
{ "presetId": "vg-5v5-standard", "script": "Aban, Bban, Apick x2",
  "mirrorPicks": false, "autoFill": "random", "perTurnMs": 30000, "bankMs": 60000 }
```

`script` is compact notation and wins over `presetId`. With neither, a room gets
`vg-5v5-standard`. The response carries three links — captain A, captain B,
spectator — of the form `/r/:roomId?token=…`, which is the **client** route: the
UI does not exist yet, so those links 404 until it does. The WebSocket path above
is what works today.

## Identity

The token in the query string is resolved to a viewer **once, at connect**. No
message carries a claim about who sent it, so a client cannot assert a team; a
`{"t":"confirm","team":"B"}` is just a confirm from whoever holds that socket.

Tokens are reusable, so a captain may hold several sockets at once — a laptop and
a phone both count as that captain being present.

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
{ "t": "state",   "phase": "drafting", "projection": { … }, "events": [ … ] }
{ "t": "error",   "error": { "code": "wrong_team", "message": "…" } }
```

- **`state`** goes to every connection after anything changes, each with its own
  projection. `staged` is `null` for a viewer not allowed to see it; `stagedCount`
  is always present.
- **`events`** are committed actions only — `pick`, `ban`, `turnChange`,
  `draftComplete`. Staging never produces an event, so the subscription surface
  cannot leak it. This is the hook a stats panel or overlay subscribes to.
- **`error`** goes only to the socket whose command was rejected. A rejected
  command is not persisted and triggers no broadcast.

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
npm run dev      # wrangler dev on :8787
npm run smoke    # drives a real room end to end, alarm included
```
