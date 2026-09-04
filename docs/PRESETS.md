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
Aban, Bban, Aban, Bban, Apick, Bpick x2, Apick x2, Bpick x2, Apick x2, Bpick
```

Two bans each, then a 1-2-2-2-2-1 snake pick order. Five picks a side across ten
turns. `DEFAULT_PRESET_ID` points at it, so `defaultScript()` is what a room gets
when the organiser chooses nothing.

**A double pick is one turn.** Where the snake gives a team two picks in a row,
`x2` runs both on a single clock: the captain stages two heroes and locks them in
together, and may swap either right up until they confirm. If the clock runs out
first, whatever they had staged is kept and only the empty slot is filled in for
them. Running the pair as two separate turns instead would hand a double pick
twice the thinking time of a single one, which is not how the game plays.

## `vg-3v3-standard`

```
Aban, Bban, Aban, Bban, Apick, Bpick x2, Apick x2, Bpick
```

The 5v5 order with the pick snake cut short at three a side: two bans each, then
1-2-2-1. Team A picks first, team B picks last.

It agrees with the 5v5 order choice by choice, which is the rule it comes from —
"the same as the fives, but three". Not turn by turn, though: the threes stop
partway through what the fives run as a double pick, so team B's last pick is a
single one here. The test compares the two one selection at a time for exactly
that reason.

`PENDING` is now empty. If another format is ever needed and its order is not
known, add it there rather than shipping a guess: `resolveScript` throws with the
reason instead of falling back to something plausible-looking, because a draft
tool that quietly runs the wrong order is worse than one that refuses to start.

## Adding a real order

1. Write the order in the notation above.
2. Add a `preset(...)` entry in `src/presets.ts` with `official: true`.
3. Remove the matching row from `PENDING`.
4. Add a shape test in `tests/presets.test.ts` alongside the existing ones: turn
   count, and picks/bans per team.

Nothing else changes. Ban count, pick order and multi-pick turns are all data.

## Custom scripts

User-authored scripts are a later advanced option and need no structural change:
they are the same array, authored somewhere else. `validateScript` and `canRun`
are already the checks a custom-script editor would call — `canRun` also
confirms the hero pool is large enough for the script, accounting for whether
mirror picks are on.
