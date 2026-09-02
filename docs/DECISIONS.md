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

**5v5 ban/pick order: supplied, and it is the default.** Two bans each, then a
1-2-2-2-2-1 snake:
`Aban, Bban, Aban, Bban, Apick, Bpick, Bpick, Apick, Apick, Bpick, Bpick, Apick, Apick, Bpick`.
Shipped as `vg-5v5-standard` with `official: true`, and pointed at by
`DEFAULT_PRESET_ID`. Transcribed as fourteen single-hero turns, so a team picking
twice in a row gets two clocks and two confirms; the one-clock reading is
`Bpick x2` and remains a one-line change.

**Frontend: React + Vite.** As assumed in the handoff. A plain SPA over a
WebSocket to the Durable Object; no SSR, since a room is entirely live state.
Not yet implemented.

**A room waits in a lobby until both captains connect.** Not in the handoff, and
it had to be decided to build the clock at all: something must say when time
starts counting. Auto-starting on the second captain's arrival needs no extra
control and cannot burn a captain's bank before they have the link open. The
alternative — an explicit organiser "start" — is a later addition that changes
nothing structural, since the phase already exists.

## Still open

- The 3v3 ban/pick order. Blocks `vg-3v3-standard`; see [PRESETS.md](PRESETS.md).
- Whether a double pick in the 5v5 order is two clocks (as shipped) or one.
- Per-hero roles and attack types. See [HERO_DATA.md](HERO_DATA.md).
- Which custom format the community actually wants. Mimicking the in-game order
  is the agreed starting point, and it is data, not code.
