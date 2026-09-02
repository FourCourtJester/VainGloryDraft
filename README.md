# VainGloryDraft

A tool for running custom pick/ban drafts for Vainglory, aimed at tournament
organisers and their captains. 5v5 and 3v3 run on the same engine.

The design is in [docs/HANDOFF.md](docs/HANDOFF.md). This repository currently
holds the first slice of it: **the pure draft engine and its supporting types.**
No transport, no UI yet.

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
| `src/presets.ts` | Named scripts. The real in-game orders are **not here yet** — see below |
| `src/heroes.ts`, `data/heroes.json` | Static roster, checked in, never fetched at runtime |

```
npm install
npm test          # 87 tests
npm run typecheck
```

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

## Blocked, on purpose

Two things in the design cannot be written without information the codebase does
not have, and guessing either would be worse than leaving them empty:

1. **The real in-game 5v5 and 3v3 ban/pick orders.** `vg-5v5-standard` and
   `vg-3v3-standard` are declared in `PENDING` in `src/presets.ts` and throw a
   named error if requested. The `example-*` presets are development
   placeholders and are flagged `official: false`. See
   [docs/PRESETS.md](docs/PRESETS.md) — adding a real order is a one-line change.
2. **Hero roles and attack types.** `data/heroes.json` carries 58 hero names with
   `roles: []` and `attackType: null`, and the file is marked `verified: false`.
   See [docs/HERO_DATA.md](docs/HERO_DATA.md).

## Next

Transport (Cloudflare Durable Object, one per room), the turn alarm, reusable
captain link tokens, then a React + Vite client. All of it wraps the engine; none
of it changes it. Settled questions are recorded in
[docs/DECISIONS.md](docs/DECISIONS.md).
