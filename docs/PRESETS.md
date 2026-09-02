# Presets

A preset is a named `TurnScript`. A room stores the **resolved array**, never the
preset id, so editing a preset can never change a draft already in progress.

## Notation

`parseScript` reads a compact notation, so a preset is one line:

```
"Aban, Bban, Apick, Bpick x2, Apick x2, Bpick"
```

- `A` / `B` — team
- `pick` / `ban` — action
- `x2` — heroes selected in that one turn (staged together, one confirm)

`formatScript` writes the same notation back out, which is what logs and preset
listings should print.

## What is missing

`src/presets.ts` ships only `example-*` scripts, all flagged `official: false`.
They exist so the engine and tests have something to run and **must not be
offered to a tournament as a standard format.**

The two presets that matter are declared in `PENDING`:

| id | blocked on |
|---|---|
| `vg-5v5-standard` | The real in-game 5v5 ban/pick order has not been supplied. |
| `vg-3v3-standard` | The real in-game 3v3 ban/pick order has not been supplied. |

Requesting either from `resolveScript` throws with that reason rather than
falling back to something plausible-looking. This is deliberate: a draft tool
that quietly runs the wrong order is worse than one that refuses to start.

## Adding a real order

1. Write the order in the notation above.
2. Add a `preset(...)` entry in `src/presets.ts` with `official: true`.
3. Remove the matching row from `PENDING`.
4. Update the `"ships no preset claiming to be an official format yet"` test in
   `tests/presets.test.ts` — it is there to make step 2 a conscious decision.

Nothing else changes. Ban count, pick order and multi-pick turns are all data.

## Custom scripts

User-authored scripts are a later advanced option and need no structural change:
they are the same array, authored somewhere else. `validateScript` and `canRun`
are already the checks a custom-script editor would call — `canRun` also
confirms the hero pool is large enough for the script, accounting for whether
mirror picks are on.
