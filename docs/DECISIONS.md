# Decisions

Resolutions to the open items in [HANDOFF.md](HANDOFF.md) §8, recorded as they
are settled. Anything still listed as open there is still open.

## Resolved

**Auto-fill on timeout: random, for every timeout.** Not only for the partially
staged multi-pick case. Seeded random cannot be played for; lowest-index would
let a captain who wants the first legal hero simply stall until the clock hands
it to them. Determinism comes from the seed, not from predictability: the room
seed plus the turn index reproduce any auto-action exactly, so a disputed pick
can be replayed from the log. It is the only strategy: taking the first legal
option was available per room once, and was cut because nobody should want it.

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

**Public room creation stays open, with nothing in front of it.** Anybody who
finds the site can start a draft, and a bot is simply another caller. A per-address
allowance, a bot key, a private mode and a finished-draft webhook were all
built and then cut as more machinery than the tool needs: should the site ever
be scripted at, Cloudflare's own rate-limiting rule covers it without code, and
a bot can fetch a finished draft's record whenever it likes.

**A double pick is one turn, on one clock.** Where the snake gives a team two
picks in a row, they stage both heroes and lock them in together, rather than
taking a fresh clock and a separate confirm for each. Two turns would hand a
double pick twice the thinking time of a single one, which is not how the game
plays; one turn also lets a captain rethink the pairing, since neither hero is
committed until they confirm. Running out of time keeps whatever was staged and
fills only the empty slots, so a captain who had decided on one of the two does
not lose it.

Whether a double-pick turn should get a longer clock than a single one is a
separate question, and open. The format can now say so per turn (see below);
what is open is the number.

**The look comes from the supplied design; the rules do not.** A design was
commissioned externally (Google Stitch, "Halcyon Draft HUD") and its visual
language is what the app now wears: the dark layered ground, the two faction
colours, Barlow Condensed for anything read at a glance with Inter for anything
read properly, micro-radius corners, and depth from thin lit edges rather than
soft shadows.

Where that design implied *behaviour*, the behaviour already settled here wins,
because the design was drawn without knowledge of it. Specifically ignored: its
own ban/pick order (it shows a second ban phase and twelve slots); five ban
slots a side; lane and role assignment per player, which this tool does not
model at all; per-hero win rate, pick rate and "draft synergy" figures, for
which there is no data and no source; and a "counter pick" state that is not a
thing the engine has. Its role filter chips are kept as a shape but stay
unavailable until hero roles arrive, since a filter that hides the hero somebody
was looking for is worse than no filter.

The mark was redrawn to match: a shield split between the two sides with a V
through the join, replacing the D-with-a-V-counter. Redrawn as vector rather
than kept as the supplied image, which was a bitmap on someone else's CDN and
would have rotted.

**The engine is generic; Vainglory is one pack.** Nothing in the engine, the
room, the worker or the screens knows which game it is running. Teams, actions,
formats, the catalog and the default clock all come from a game's pack under
`games/`, and a room keeps its own copy of the rules it was made with. The
Vainglory-only state of the app is kept on the `archive/vainglory` branch.

Actions are named by the game but each does one of two things — removes the
thing for everybody, or gives it to the team that chose it — rather than being
a scripting hook. Every draft mechanic asked for so far is one of those two
with a different name on it, and data is far easier to check than code: a pack
that loads is a pack the engine can run.

Teams are a list of any length. Nearly every draft has two, but nothing is
cheaper to allow than a list, and once a team is a name rather than "A" or "B"
there is nothing left that assumes two.

**A blind turn hides everything until the last team has chosen — from
spectators too.** A spectator link is one anybody can open, captains included,
so showing a blind choice to spectators would be showing it to the other side.
Everyone may see *that* a team has locked in, never what. Two teams can land on
the same thing, since neither could see the other; that is what blind means.
Each team spends its own reserve and has its own deadline, and the turn ends
when the last of them settles.

**A turn nobody plays takes what is left, the moment the draft reaches it.**
That is a map veto's decider. When more is left than the turn takes, it draws
among it with the room's seed, exactly as a timed-out turn does, so it can be
checked afterwards and never guessed beforehand.

**A turn can carry its own time.** `@45s` on a turn replaces the room's
allowance for that turn only, which is how a double pick could get longer than a
single one if organisers decide it should.

**A team's colour comes from its place, not its name.** The first team is the
blue side and the second the red, whatever a game calls them; a third and fourth
get colours of their own.

**Rooms saved before this change are not carried over.** A saved room is a
snapshot of the rules it was made with, and the shape of those rules changed.
Nothing had been deployed, so there were none to carry; a room from an older
shape now answers "no such room" rather than being run wrongly.

**Captains only, unless a room asks for whole squads.** Most drafts are run by
one captain a side, so that is the default: the room waits for them and nobody
else. Anybody else opening a team's link is a stand-in who can take over if the
captain drops, and does not hold up the start. Whole squads — everybody joins,
teammates watch their side choose and tell their captain what they want — is an
option per room, since it is worth having and not worth making everybody wait
for.

**The ready check is its own switch, and on by default.** Being connected is not
the same as being ready, for two captains as much as for ten players, so the
clock waits for everybody to say so. A room can turn it off and begin the moment
the last person arrives.

## Still open
- Whether a double-pick turn gets more time on the clock than a single pick.
  Waiting on confirmation. The engine can now do it — `B pick x2 @45s` — so it
  is only a matter of writing the number into the Vainglory formats.
- Per-hero roles and icons, pending the vgna.net export. See
  [HERO_DATA.md](HERO_DATA.md).
- Whether hero icons are self-hosted or served from vgna.net. The importer
  self-hosts by default; `--keep-urls` does not.
- Which custom format the community actually wants. Mimicking the in-game order
  is the agreed starting point, and it is data, not code.
