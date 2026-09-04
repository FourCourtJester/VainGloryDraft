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

Determinism here is not the same as predictability, and the distinction is the
whole point: the room seed never leaves the server, so a draw can be replayed
from the log *and the seed*, but not guessed in advance from the draws already
seen. `src/random.ts` carries 128 bits of state for that reason.

**Captain links: reusable.** The same link works after a browser crash, on a
phone, or on a reconnect. Forwardable in principle, but the room already assumes
captains hold their own links, and with no pause a captain locked out of their
own draft just burns the clock — the failure mode of single-use links is worse
than the risk of reusable ones. Not yet implemented; it belongs to the transport
slice. Organiser-side revoke/reissue was not chosen and can be added later
without changing the token model.

**5v5 ban/pick order: supplied, and it is the default.** Two bans each, then a
1-2-2-2-2-1 snake:
`Aban, Bban, Aban, Bban, Apick, Bpick x2, Apick x2, Bpick x2, Apick x2, Bpick`.
Shipped as `vg-5v5-standard` with `official: true`, and pointed at by
`DEFAULT_PRESET_ID`.

**Frontend: React + Vite.** As assumed in the handoff. A plain SPA over a
WebSocket to the Durable Object; no SSR, since a room is entirely live state.
Not yet implemented.

**A room waits in a lobby until both captains connect.** Not in the handoff, and
it had to be decided to build the clock at all: something must say when time
starts counting. Auto-starting on the second captain's arrival needs no extra
control and cannot burn a captain's bank before they have the link open. The
alternative — an explicit organiser "start" — is a later addition that changes
nothing structural, since the phase already exists.

**3v3 order: the 5v5 order, cut short at three a side.** Two bans each, then
1-2-2-1, with team A picking first and team B last —
`Aban, Bban, Aban, Bban, Apick, Bpick x2, Apick x2, Bpick`. It agrees with the
5v5 order choice by choice, which is the rule it comes from, and a test asserts
that. Not turn by turn, though: the threes stop partway through what the fives
run as a double pick, so the test compares the two one selection at a time.

**Rooms clear themselves out.** A finished draft is kept a month; a room nobody
ever played in is thrown away six hours after the last sign of anybody in it.
Keeping everything forever was the simpler thing to build, but nobody looks at a
draft once the set it belonged to is over, and storage that only grows is a bill
waiting to happen. The room's own alarm — already there to run the turn clock —
does the sweeping, so this costs no extra machinery. Both windows are settable
per room at creation.

**Public room creation stays open, and an allowance protects it.** Anybody who
finds the site can start a draft; the org's bot is simply a caller that holds a
key. A shared secret was the wrong tool, because it can only answer "yes" or
"no" to a whole audience — so it now marks a caller as trusted rather than
gating the door, and everybody else is held to five rooms in a burst, one back
every twenty seconds, and a hundred a day, counted per address by a durable
object of its own. `ROOM_CREATE_PRIVATE` still shuts the door completely for
anyone who wants a deployment of their own.

The count is written down rather than merely held in memory. An object that has
gone quiet gets put away, and a script pacing itself around that would have been
handed a fresh allowance every time — which is exactly the case the daily
ceiling exists for. What is written down deletes itself a day later, on the same
principle as the rooms.

**A double pick is one turn, on one clock.** Where the snake gives a team two
picks in a row, they stage both heroes and lock them in together, rather than
taking a fresh clock and a separate confirm for each. Two turns would hand a
double pick twice the thinking time of a single one, which is not how the game
plays; one turn also lets a captain rethink the pairing, since neither hero is
committed until they confirm. Running out of time keeps whatever was staged and
fills only the empty slots, so a captain who had decided on one of the two does
not lose it.

Whether a double-pick turn should get a longer clock than a single one is a
separate question, and open. It would mean a per-turn time on the format rather
than one figure for the whole draft.

## Still open
- Whether a double-pick turn gets more time on the clock than a single pick.
  Waiting on confirmation; it needs a per-turn override on the script.
- Per-hero roles and icons, pending the vgna.net export. See
  [HERO_DATA.md](HERO_DATA.md).
- Whether hero icons are self-hosted or served from vgna.net. The importer
  self-hosts by default; `--keep-urls` does not.
- Which custom format the community actually wants. Mimicking the in-game order
  is the agreed starting point, and it is data, not code.
