# Games

The engine drafts whatever it is handed. Everything that makes one game's draft
different from another's lives in that game's **pack**, a folder of data under
`games/`. Adding a game is adding a folder and registering it; nothing in the
engine, the room, the worker or the screens changes.

Two packs ship:

- **`games/vainglory/`** — 58 heroes with portraits; the 5v5 and 3v3 standard
  orders.
- **`games/cs2/`** — a Counter-Strike 2 map veto: seven maps, best-of-one and
  best-of-three orders ending in a decider nobody picks. It is there to prove
  the engine is generic, and its map list and orders are marked unconfirmed.

## A pack

```
games/<id>/
  game.json      written by hand: teams, actions, formats, defaults
  catalog.json   usually written by the import scripts: what can be drafted
client/public/games/<id>/   the pictures, if there are any
```

Then two lines in `src/games.ts`, which is the one place that knows which packs
exist. Every pack is checked as it loads (`loadGame` in `src/game.ts`) and a
broken one stops the worker from starting at all, listing every problem at
once — better than failing half-way through somebody's draft. `tests/games.test.ts`
plays every format of every registered pack to the end, so a new pack is
covered the moment it is added.

### `game.json`

```jsonc
{
  "id": "cs2",                                  // lower-case; rooms store it
  "name": "Counter-Strike 2",
  "terms": { "item": "map", "items": "maps" },  // what the screens call things
  "teams": [
    { "id": "A", "name": "Team A" },            // ids are short: "A", "Blue", "Radiant"
    { "id": "B", "name": "Team B" }
  ],
  "actions": [
    { "id": "ban",  "label": "Ban",  "past": "banned", "effect": "remove" },
    { "id": "pick", "label": "Pick", "past": "picked", "effect": "take" }
  ],
  "defaults": { "preset": "cs2-bo3", "mirror": false, "perTurnMs": 60000, "bankMs": 120000 },
  "presets": [
    {
      "id": "cs2-bo3",
      "name": "Best of 3 veto",
      "official": false,                        // true only once confirmed as really played
      "script": "A ban, B ban, A pick, B pick, A ban, B ban, remaining pick",
      "teamSize": 1,                            // optional: squad size, when squads join
      "teams": [ … ],                           // optional: this format's own teams
      "notes": "…"
    }
  ]
}
```

**Actions are named by the game but do one of two things.** `remove` takes the
thing out of the draft for everybody — a ban, a veto, a strike. `take` gives it
to the team that chose it — a pick. Something taken cannot then be removed, and
a team can never take the same thing twice. Whether a second team may take
something the first already has is the room's **mirror** setting, which the pack
defaults and an organiser can change per room.

**Teams** can number anything from one upwards. The screens colour the first
four distinctly and handle more. A format can bring its own list — a three-way
draft inside a game that is usually two-sided — and a room can be made with
other team names without touching the pack.

**`teamSize`** is how many players a side waits for when a room asks for whole
squads — rooms are captains only unless they do. Left out, it is however many
things a team takes: five for a 5v5 hero draft.

### `catalog.json`

```jsonc
{
  "note": "Where this came from, and anything a reader should know about it.",
  "filters": [
    { "key": "role", "label": "Role", "values": ["Captain", "Jungle", "Lane"],
      "verified": false, "aliases": ["herorole", "position"] }
  ],
  "items": [
    { "id": "ardan", "name": "Ardan", "image": "/games/vainglory/ardan.webp", "tags": { "role": [] } }
  ]
}
```

- **Item ids are what rooms store.** Change one and saved drafts show the raw id
  where the name used to be.
- **`image: null`** draws the item as its name on a plain tile, which reads as
  deliberate. A map veto has no pictures at all and looks fine.
- **A filter is offered only when it is `verified`**, and only the values some
  item actually carries. Captains filter constantly under a clock, and a filter
  that hides the thing somebody was looking for is worse than none. A tag value a
  filter does not list is refused as the pack loads, rather than quietly becoming
  a new category. `aliases` are for the import script, which finds the tag in an
  export under other names.

## Notation

A format is one line, turns separated by commas:

```
A ban, B ban, A pick, B pick x2 @45s, A+B ban, remaining pick
```

| Piece | Means |
|---|---|
| `A ban` | Team A bans. The space may be left out — `Aban` — where that is unambiguous. |
| `x2` | Chooses two in that one turn: staged together, one confirm, one clock. |
| `@45s` | This turn's own time, instead of the room's usual allowance. |
| `A+B ban` | Both teams ban **at once, blind**. |
| `remaining pick` | Nobody chooses: the draft takes what is left. |

Team and action names are whatever the pack defines, in any case. `formatScript`
writes the same notation back out, which is what logs and listings print.

### A turn several teams play at once

`A+B ban` puts both teams on the clock together. Each chooses without seeing the
other, and nothing is revealed until the last of them confirms or runs out of
time — then everything is shown at once. Nobody outside a team sees its choice
in the meantime, spectators included, because a spectator link is one anybody
can open. What everyone can see is who has locked in.

Because nobody could see anybody else's choice, two teams can land on the same
thing. For a ban, that ban is simply spent twice. For a pick with mirrors off, it
means both have it — that is what "blind" means, and a format that cannot allow
it should not use a blind pick.

Each team has its own reserve and its own deadline, so one side running out of
time is settled at that moment, and the turn ends when the last side settles.

### A turn nobody plays

`remaining pick` is the decider in a map veto: once the teams have banned and
picked, the draft takes what is left the moment it gets there, with nobody to
wait for. If exactly as many things are left as the turn takes, that is simply
the leftover. If more are left, it draws among them the same way a timed-out
turn does — seeded, so it can be checked afterwards, and never guessable in
advance.

### A turn's own time

`@45s` gives that turn its own allowance instead of the room's. Each team still
spends its reserve once that runs out. This is the answer to whether a double
pick should get longer than a single one: it can, per turn, in the format.

## Vainglory's formats

`vg-5v5-standard`, the default:

```
A ban, B ban, A ban, B ban, A pick, B pick x2, A pick x2, B pick x2, A pick x2, B pick
```

Two bans each, then a 1-2-2-2-2-1 snake. Five picks a side across ten turns.

**A double pick is one turn.** Where the snake gives a team two picks in a row,
`x2` runs both on a single clock: the captain stages two heroes and locks them
in together, and may swap either right up until they confirm. If the clock runs
out first, whatever they had staged is kept and only the empty slot is filled in
for them. Two separate turns would hand a double pick twice the thinking time of
a single one, which is not how the game plays.

`vg-3v3-standard`:

```
A ban, B ban, A ban, B ban, A pick, B pick x2, A pick x2, B pick
```

The 5v5 order with the snake cut short at three a side: two bans each, then
1-2-2-1. It agrees with the 5v5 order choice by choice — "the same as the fives,
but three" — though not turn by turn, since the threes stop partway through what
the fives run as a double pick. `tests/vainglory.test.ts` compares them one
selection at a time for exactly that reason.

## Custom orders

An organiser does not need a pack change to try a new order: the create screen
takes one in the notation above, and so does `POST /api/rooms` as `script`. The
same checks run — every team and action must exist, and the pool must be big
enough, accounting for mirrors — and a problem comes back as a plain message
naming the turn.

A room stores the **resolved** format, teams and actions, never a preset id, so
editing a pack can never change a draft already in progress.
