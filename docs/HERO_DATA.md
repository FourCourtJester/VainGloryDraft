# Hero data

Vainglory is no longer in development, so the roster is fixed and there is
nothing to keep in sync. `data/heroes.json` is checked into the repo, read at
build time, and never fetched at runtime from a site that may disappear.

## Current state: names and portraits, no roles

```json
{ "verified": false, "heroes": [{ "id": "ozo", "name": "Ozo", "roles": [], "attackType": null, "image": "/heroes/ozo.webp" }] }
```

- **58 hero names.** Assembled from the design handoff plus community roster
  listings.
- **57 portraits**, supplied by VGNA from their own bot's asset set and
  self-hosted here. Corpus has none, and is drawn as a name — see below.
- **`roles: []` and `attackType: null` everywhere, still on purpose.** The
  handoff is explicit that per-hero role data must not be invented. Empty is
  honest; plausible-looking guesses would silently mislead a captain filtering a
  wall of 58 portraits.
- The file-level `verified` flag is exported as `HERO_DATA_VERIFIED`. **The UI
  must not offer role filtering while it is false** — a filter over invented data
  is worse than no filter. Portraits arriving does not change that: they are a
  different question from roles, and the flag is about roles.

## The three roles

VGNA have confirmed the vocabulary: **Captain**, **Jungle**, **Lane**. A 5v5
side fields one captain, one jungler and three lanes, so "lane" is one role
covering three seats rather than naming each of them — which is why there are
three and not five.

The list lives in `data/heroes.json` beside the roster it describes, so the app
and `import-heroes.mjs` read one copy rather than each holding their own to fall
out of step. Anything outside it is a mistake in whatever produced the export
rather than a fourth role: the importer drops it, says which hero and which
value, and leaves that hero role-less — which keeps the file unverified and the
filter hidden, rather than quietly offering a filter nobody asked for. Casing is
tidied (`jungle` becomes `Jungle`) and order normalised, since exports capitalise
as they please.

**Which hero plays which role is still outstanding.** The vocabulary is not the
data: nothing here knows that, say, Ardan is a Captain, and it will not be
guessed at. Until a per-hero mapping arrives the filter stays hidden. The
intended scrape could not be run from the environment this was written in —
outbound network access is restricted to package registries, so
`vaingloryfire.com` and both Fandom wikis are unreachable.

## Portraits

```
node scripts/import-portraits.mjs "~/Hero Portraits"
node scripts/import-portraits.mjs "~/Hero Portraits" --dry-run
```

Point it at a folder of pictures named after heroes. It matches them by name
(`sanfeng.png` finds `san-feng`), squares each one to 192px, re-encodes to WebP,
writes them into `client/public/heroes`, and fills in `image` on every hero it
matched.

Art exported from somewhere else is never quite ready to ship. The set supplied
arrived between 120px and 294px, several of them a pixel or two off square, and
3.7 MB in total — more than anybody on a phone should download to look at a hero
grid. Squared and re-encoded it comes to 483 KB, about 8.5 KB a hero, and the
grid loads them lazily on top of that.

The folder is treated as the source of truth: the output directory is emptied
first, so a portrait dropped from a later set does not linger as a file nothing
references. Anything in the folder that is not one of our heroes is reported and
skipped rather than guessed at.

**Eleven portraits came in below 200px** and are stretched slightly to fit —
anka, churnwalker, grace, inara, kensei, kinetic, lorelai, malene, reza,
silvernail and yates. They are legible and fine to ship; the script lists them
on every run, so they can be swapped out if sharper copies turn up.

**Corpus has no portrait.** Its tile is drawn as a name on a plain ground, which
is what every hero looked like before the art arrived, so it reads as deliberate
rather than broken. A blank placeholder was supplied alongside the set and is
not used: an empty picture looks like a failure, a name does not.

## Filling it in from a vgna.net export

`scripts/import-heroes.mjs` takes a JSON export in the shape
`{ heroId, heroName, heroIcon, heroRole }` — as an array, or under a `heroes`
key — and writes `data/heroes.json`:

```
npm run import-heroes -- vgna-heroes.json
```

- Keys are matched loosely (`id`/`heroId`/`slug`, `name`/`heroName`,
  `icon`/`heroIcon`/`image`, `role`/`heroRole`/`roles`), because every export
  names them differently.
- Ids are slugged, so `san_feng` and `San Feng` both become `san-feng`. **Ids are
  the primary key rooms store**, so if a future export changes one, saved drafts
  break — check the diff.
- A role of `"Captain / Support"` becomes two roles. An empty role leaves
  `roles: []` and keeps the file `verified: false`, which is what stops the UI
  offering a filter over partial data. The script never invents a value.
- Icons are downloaded into `client/public/heroes/` and referenced by local path,
  per the handoff's "do not hotlink a site that may disappear". Pass
  `--keep-urls` to serve them from vgna.net instead — reasonable if it is your
  own site, but then the draft tool goes down when that site does.
- `attackType` is not in that shape and stays `null`. It gates nothing: the role
  filter only needs roles.

Check `npm test` afterwards — the roster tests will catch a truncated or
mis-slugged import.

## Filling it in by hand

Source order from the handoff:

1. **vaingloryfire.com/vainglory/wiki** — most complete roster (~58 heroes,
   including the late additions: Amael, Caine, Churnwalker, Corpus, Ishtar,
   Karas, Kensei, Malene, Miho, San Feng, Shin, Warhawk). Best seed source.
2. **vg-esports.fandom.com** — ~60 pages but includes non-hero pages. Secondary.
3. **vainglory.fandom.com** — stale, ~35 heroes. Do not use.

Scrape **once**, from a machine with open network access, into `data/heroes.json`:

- Confirm the roster against source 1 and reconcile any name this file has that
  the source does not (and vice versa). Every id must stay a lowercase slug of
  the name — ids are the primary key used by rooms and stored drafts, so changing
  one breaks saved drafts.
- Fill `roles` and `attackType` from the same source. If a hero's role cannot be
  confirmed, leave it empty rather than inferring it from a sibling.
- Download portraits and self-host them under `public/heroes/`; set `image` to
  the local path. Do not hotlink.
- Set `verified: true` only when `roles` and `attackType` are complete. The
  `heroes.test.ts` check pairs the flag with `heroesMissingMetadata()`, so a
  premature flip fails the suite.
