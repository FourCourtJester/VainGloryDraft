# Vainglory Draft Tool — Design Handoff

Status: **design settled, no code written.** This document is the input to the first coding session.

---

## 1. What it is

A web app for running custom pick/ban drafts for Vainglory. Primary use case is tournament
organisers and their captains. 5v5 is the original ask; 3v3 must be supported by the same engine.

Vainglory is no longer in development, so the hero roster is fixed and there is nothing to keep
in sync.

---

## 2. Core architectural decision

**A draft is a single ordered list of turns.** Bans and picks are not two separate systems.

```
type Team = "A" | "B";
type Action = "pick" | "ban";

interface Turn {
  team: Team;
  action: Action;
  count: number;   // heroes selected in this one turn
}

type TurnScript = Turn[];
```

The engine only ever answers: *whose turn is it, and what are they allowed to do.*

Consequences:
- 5v5, 3v3, and arbitrary custom orders are just different arrays.
- Configurable ban count and pick order come for free.
- The validator must **derive** expected pick/ban totals from the script. Do not hardcode
  "each team ends with 5 picks" — that breaks 3v3 and every custom format.

---

## 3. Decisions locked in

| Area | Decision |
|---|---|
| Who drafts | Captains only. Not all ten players. |
| Identity | Link tokens, no accounts. Three per room: captain A, captain B, spectator. |
| Mirror picks | Configurable per room. Default off. |
| Fearless draft | Not a concern. Out of scope. |
| Timer | Per-turn timer **plus** a reserve bank per team. |
| Disconnects | **No pause.** Timer keeps burning. |
| Multi-pick turns | `count: 2` = stage both, one confirm. Not two sequential confirms. |
| Staging visibility | Spectators see the **active team's** staged picks. Nobody else does. |
| Hero data | Static JSON checked into the repo. |

### On disconnects
Deliberately unhandled. If a captain drops, the room either agrees to remake or plays on —
that is a tournament organiser's call, not the app's. Pausing was rejected as abusable.

Do surface a **per-captain connection indicator** so the room can see what happened and decide.
Show the state; don't act on it.

### On timeout
Auto-action fires. Must be **deterministic and visible** so nobody can argue it.
On a partially-staged multi-pick turn: **keep what was staged, randomise the remainder.**

### On staging
- Click a hero once to stage, click again to unstage.
- A separate Accept/Confirm button commits the turn.
- Nothing is committed until confirm.
- Server holds staged state separately from locked picks.

### On the staging leak (resolved, no action needed)
Earlier concern: a captain could open the spectator link in a second tab to see enemy staging.
Not a problem — staging is only ever visible for the team **currently on the clock**, and that
team is about to make their selection public anyway. Nothing leaks that isn't seconds from
being public. No mitigation required.

---

## 4. Presets

Captain picks a named script at room creation (`vg-5v5-standard`, `vg-3v3-standard`, etc).

**Store the resolved array on the room, not the preset ID.** A room in progress must not change
if a preset is edited later.

Custom user-authored scripts are a later advanced option. Nothing structural changes to add them.

---

## 5. Server / transport

Recommendation: **Cloudflare Durable Objects.** One object per draft room.

Rationale: the app needs an *authoritative clock*. Timers, auto-pick on expiry, and reconnects
all break if the browser owns state, and a pure relay (Pusher-style) means every client is
guessing. DO gives one object holding state in memory, WebSockets straight into it, and alarms
for the turn timer. No server to rent, no idle cost. Reconnect = re-fetch current state.

Supabase Realtime was considered and set aside — turn validation ends up in Postgres, which is
more friction than it's worth here.

### Timer representation
Store `turnStartedAt` and `bankRemainingMs` per team. **Compute, never count down.** Clients
render a countdown derived from those values. On reconnect, replay the same computation and
drift disappears.

Because there is no pause, the timer is a pure function of those two values. No pause state to
track or reconcile.

### Event stream
The room emits full state; each connection receives a **projection filtered by its token**.
Needed for the spectator staging rule regardless, so build it in from the start rather than
broadcasting one payload to everyone.

---

## 6. Extensibility hook (important)

The client exposes a subscription surface over draft state changes:

```
pick | ban | turnChange | draftComplete
```

The draft engine must **not** know that any consumer exists. It emits; something else reacts.

First planned consumer: a stats panel that pulls hero stats from an external stats site when a
hero is picked. Later candidates: broadcast overlay, outbound webhooks. All of these should be
new subscribers, never surgery on the engine.

---

## 7. Hero data

No usable live API. Options investigated:

- **vaingloryfire.com/vainglory/wiki** — community wiki, most complete roster (~58 heroes,
  including late additions: Amael, Caine, Churnwalker, Corpus, Ishtar, Karas, Kensei, Malene,
  Miho, San Feng, Shin, Warhawk). Best seed source. Scrape once, do not depend on at runtime.
- **vainglory.fandom.com** — stale, only ~35 heroes. Do not use.
- **vg-esports.fandom.com** — ~60 pages but includes non-hero pages. Secondary.

Plan: scrape once into a static JSON file. Self-host portrait images — do not hotlink a site
that may disappear.

Proposed shape:

```
interface Hero {
  id: string;        // slug
  name: string;
  roles: string[];   // captains filter by role constantly; without this it's a wall of 58 portraits
  attackType: "melee" | "ranged";
  image: string;     // local path
}
```

---

## 8. Open / unresolved

- ⚠️ **The actual in-game 5v5 ban/pick order has not been supplied yet.** Shaun knows it. It was
  going to be brought to the first coding session and wasn't. The `vg-5v5-standard` preset
  cannot be written until it is. Do not guess it — ask.
- ⚠️ **Hero role assignments are unverified.** The roster *names* are reasonably confident from
  the sources above, but per-hero role/attackType data has not been checked against a reliable
  source. Do not invent it. Either scrape it properly or leave the fields empty and fill later.
- The current *custom* draft format the community wants is unknown. Mimicking the in-game order
  is the agreed starting point; change later. Cheap to change — it's data, not code.
- Captain link single-use vs reusable. Reusable is friendlier for reconnects but forwardable.
  Not decided.
- Auto-fill on timeout: random vs lowest-index. Random was mentioned for the partial multi-pick
  case. Confirm whether that's the rule for all timeouts.
- Frontend stack assumed React. Not formally decided.
- 3v3 turn script not written (same blocker as 5v5 — need the real order).

---

## 9. Suggested first coding session

1. `Hero`, `Turn`, `TurnScript`, `RoomState`, `Draft` types.
2. Pure engine: given a script and a list of committed actions, return current turn, legal
   heroes, and completion state. No I/O, no timers — fully testable in isolation.
3. Static hero JSON (names first, roles flagged as incomplete).
4. Only then: transport, timers, UI.

Build the engine as a pure function first. Everything else — Durable Object, WebSockets, React —
wraps around it.
