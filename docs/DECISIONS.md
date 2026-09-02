# Decisions

Resolutions to the open items in [HANDOFF.md](HANDOFF.md) §8, recorded as they
are settled. Anything still listed as open there is still open.

## Resolved

**Auto-fill on timeout: random, for every timeout.** Not only for the partially
staged multi-pick case. Seeded random cannot be played for; lowest-index would
let a captain who wants the first legal hero simply stall until the clock hands
it to them. Determinism comes from the seed, not from predictability: the room
seed plus the turn index reproduce any auto-action exactly, so a disputed pick
can be replayed from the log. Implemented as `DRAFT_DEFAULTS.autoFill` in
`src/config.ts`; `lowestIndex` stays available per room.

**Captain links: reusable.** The same link works after a browser crash, on a
phone, or on a reconnect. Forwardable in principle, but the room already assumes
captains hold their own links, and with no pause a captain locked out of their
own draft just burns the clock — the failure mode of single-use links is worse
than the risk of reusable ones. Not yet implemented; it belongs to the transport
slice. Organiser-side revoke/reissue was not chosen and can be added later
without changing the token model.

**Frontend: React + Vite.** As assumed in the handoff. A plain SPA over a
WebSocket to the Durable Object; no SSR, since a room is entirely live state.
Not yet implemented.

## Still open

- The real in-game 5v5 and 3v3 ban/pick orders. Blocks `vg-5v5-standard` and
  `vg-3v3-standard`; see [PRESETS.md](PRESETS.md).
- Per-hero roles and attack types. See [HERO_DATA.md](HERO_DATA.md).
- Which custom format the community actually wants. Mimicking the in-game order
  is the agreed starting point, and it is data, not code.
