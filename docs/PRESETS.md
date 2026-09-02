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

## The default: `vg-5v5-standard`

```
Aban, Bban, Aban, Bban, Apick, Bpick, Bpick, Apick, Apick, Bpick, Bpick, Apick, Apick, Bpick
```

Two bans each, then a 1-2-2-2-2-1 snake pick order. Five picks a side, fourteen
turns. `DEFAULT_PRESET_ID` points at it, so `defaultScript()` is what a room gets
when the organiser chooses nothing.

**Each pick is its own turn.** Transcribed exactly as supplied, so a team picking
twice in a row (`…Bpick, Bpick…`) gets two clocks and two confirms. The
alternative reading — one turn holding two heroes, staged together and confirmed
once — is `Bpick x2`, which the engine supports equally well. Swapping is a
one-line edit to the notation, but it changes how much time a double pick is
worth, so it should be a decided change rather than a silent one.

## What is missing

`vg-3v3-standard` is still in `PENDING`:

| id | blocked on |
|---|---|
| `vg-3v3-standard` | 3v3 order not supplied, and not derivable from the 5v5 one. |

Requesting it from `resolveScript` throws with that reason rather than falling
back to something plausible-looking. This is deliberate: a draft tool that
quietly runs the wrong order is worse than one that refuses to start.
`example-3v3-snake` is a development placeholder, flagged `official: false`, and
**must not be offered to a tournament as a standard format.**

## Adding a real order

1. Write the order in the notation above.
2. Add a `preset(...)` entry in `src/presets.ts` with `official: true`.
3. Remove the matching row from `PENDING`.
4. Add a shape test in `tests/presets.test.ts` alongside the 5v5 ones: turn
   count, and picks/bans per team.

Nothing else changes. Ban count, pick order and multi-pick turns are all data.

## Custom scripts

User-authored scripts are a later advanced option and need no structural change:
they are the same array, authored somewhere else. `validateScript` and `canRun`
are already the checks a custom-script editor would call — `canRun` also
confirms the hero pool is large enough for the script, accounting for whether
mirror picks are on.
