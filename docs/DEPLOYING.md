# Putting it online

The whole app — the pages, the draft rooms and their clocks — deploys to
Cloudflare as one thing:

```
npm install
npm run build      # the client the browser runs
npx wrangler deploy
```

`wrangler` will ask you to log in the first time. When it finishes it prints the
address the app is now at.

## It runs on the free plan

Confirmed with Cloudflare: the Workers free plan includes SQLite-backed durable
objects, which is what a draft room is.

The line that matters is `new_sqlite_classes` in `wrangler.toml`. That declares
the free kind of room. The older key-value kind, `new_classes`, is not free —
changing that line would quietly move the app onto a paid plan.

Nothing else in the app needs anything beyond that: one worker, the app's own
files, and one room per draft. No database, no file storage, no queues.

## What a draft actually costs

Measured rather than guessed:

- **A finished 5v5 draft takes 2.7 KB of storage**, so a gigabyte would hold
  around 390,000 of them. Storage will never be the thing that costs money.
- **A draft wakes its room at most fourteen times** — once per turn, and only
  when a turn's time actually runs out. A briskly played draft barely wakes it
  at all.
- **A room sleeps while captains are thinking.** Connections stay open, but the
  room is not sitting there running up time between clicks. Without that, a slow
  tournament would be the expensive case.

The number worth keeping an eye on is the free plan's daily request allowance,
since every page load, every draft action and every alarm counts towards it.
Check the current figure on the Workers pricing page or in the dashboard, which
also shows what has actually been used.

## Before it is public

Set the room-creation secret, or anyone who finds the address can make rooms on
your allowance:

```
npx wrangler secret put ROOM_CREATE_SECRET
```

The bot then sends it as an `x-api-key` header. Nobody types it and no player
ever sees it, so make it long and boring.

## Rooms are kept forever

A draft stays readable from its links indefinitely, which is deliberate: a
finished draft can be reopened weeks later. Nothing deletes old rooms, so
storage only grows — at 2.7 KB a draft, that will take a very long time to
matter, but it is worth a retention decision eventually.

## If Cloudflare is ever the wrong answer

The draft logic — the rules, the clock, who may see what — is in `src/` and
imports nothing Cloudflare-specific. Moving to an ordinary always-on server
means replacing the transport around it: sockets instead of Cloudflare's,
ordinary timers instead of its alarms, and somewhere to keep rooms. About a day
of work, and none of the rules change.
