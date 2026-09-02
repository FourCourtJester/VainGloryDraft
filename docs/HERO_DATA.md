# Hero data

Vainglory is no longer in development, so the roster is fixed and there is
nothing to keep in sync. `data/heroes.json` is checked into the repo, read at
build time, and never fetched at runtime from a site that may disappear.

## Current state: names only, unverified

```json
{ "verified": false, "heroes": [{ "id": "san-feng", "name": "San Feng", "roles": [], "attackType": null, "image": null }] }
```

- **58 hero names.** Assembled from the design handoff plus community roster
  listings.
- **`roles: []` and `attackType: null` everywhere, on purpose.** The handoff is
  explicit that per-hero role data must not be invented. Empty is honest;
  plausible-looking guesses would silently mislead a captain filtering a wall of
  58 portraits.
- **`image: null`.** Portraits are not yet self-hosted.
- The file-level `verified` flag is exported as `HERO_DATA_VERIFIED`. **The UI
  must not offer role filtering while it is false** — a filter over invented data
  is worse than no filter.

The intended scrape could not be run from the environment this was written in:
outbound network access is restricted to package registries, so
`vaingloryfire.com` and both Fandom wikis are unreachable. The names are
therefore a seed, not a verified roster.

## Filling it in

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
