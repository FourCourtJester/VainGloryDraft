# Knowing who a player is

Three things want to be told apart, and it helps to name them separately.

| | |
|---|---|
| **A seat** | Which side you are on. Comes from the team code. |
| **A player** | Which person you are across drafts. Comes from an id. |
| **A name** | What your teammates see. A courtesy, changeable at will. |

## The name

Everybody arrives with a name already filled in, so joining is one tap. It is
worked out from the player id, which means the same person is suggested the same
name every time — open five drafts in a day and you are "Gilded Warden" in all
of them. Anyone can type over it.

Names are never treated as identity. Two people can call themselves the same
thing; the room goes on the id underneath.

## The player id

By default it is made once by the browser and kept in local storage. That
carries a player between drafts on the same device, which is what makes the
suggested name stable and a mid-draft reconnect recognisable.

**It is deliberately not a fingerprint.** The id is a random value the browser
stores, not something derived from the device.

The finished draft's record, and the callback a bot receives, list every player
by id, name, side, and whether they did the picking. So whoever keeps the
tournament's records can already answer "did this player draft five times
today", as long as the ids line up.

## Making ids line up properly: let the bot say who is who

Local storage is a convenience, not an identity. It is per-device and
per-browser: the same person on their phone and their laptop is two ids, and
clearing site data makes a third.

The authoritative answer is one you already have. VGNA's bot knows exactly who
is in a lobby, because it matched them. It can put that in the link it DMs each
player:

```
/r/<roomId>?code=<team code>&player=<discord user id>&name=<their handle>
```

Then the room's record comes back keyed to Discord accounts. The same player is
the same id on any device, in any browser, forever, with no guessing — and the
correlation you want across five drafts in a day is exact rather than
approximate.

The team code still works on its own for anybody who arrives without a
personalised link.

## Why not a device fingerprint

Combining browser, operating system, screen and IP address into an identifier is
the obvious idea, and it does not work for this. Two reasons, in the order that
matters.

**It is not reliable, which defeats the purpose.** A fingerprint has to be both
stable and unique, and this one is neither:

- Browser and OS give very little to go on. A dozen players on the same phone
  model, same browser version, same timezone produce the same fingerprint. In a
  regional tournament that is a likely draw, not a rare one.
- IP addresses are shared and they move. A household behind one router is one
  address; a mobile carrier can put thousands of players behind the same one. The
  same phone changes address walking from wifi to mobile data, mid-draft.
- Browsers actively fight this. Safari and Firefox already reduce or randomise
  the values a fingerprint is built from, and each release makes it worse.

So it would sometimes merge two players into one and sometimes split one player
into several — silently, in a system whose whole job is knowing whose turn it is.
An identifier that is wrong occasionally and invisibly is worse than no
identifier.

**And it is tracking, with the wrong audience.** A fingerprint follows a person
across visits whether they want it to or not, and it cannot be cleared. Under
GDPR and the ePrivacy rules that puts it in the same bracket as cookies —
needing a lawful basis and disclosure — and this is a game with a young player
base, which raises the bar rather than lowering it. It would also be an
unpleasant surprise for anyone who read the page source: a draft tool has no
business identifying the machine somebody is sitting at.

The bot-supplied id gives better data for less work and nothing to explain to
anybody. That is the path this project takes.
