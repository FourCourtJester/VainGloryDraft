# The mark

A **shield split down the middle** — one half the colour of team A, the other
team B — with a **V** cut through the join, and a fine gold trim around it.

A draft is two sides facing each other over one board, so the badge is the two
sides and the V is what they are drafting for. The same two colours run through
the whole app, which means the badge and the draft screen say the same thing.

It is an original mark. It is deliberately *not* a version of Vainglory's own
logo: this is a community tool that will sit on public pages, and borrowing
somebody else's mark is a problem waiting to happen for whoever runs the
tournament.

The trim comes off below 48px. A gold hairline at the size of a browser tab
turns to mud and takes the shape with it, so the small favicons are the plain
two-tone shield — which still reads at 16px, because that is what the shape was
chosen for.

## The files

Everything in `client/public` is generated. Change the shape or the colours in
`scripts/make-logo.mjs` and run it again:

```
node scripts/make-logo.mjs
```

| File | For |
|---|---|
| `logo.svg` | The mark. Use this wherever you can — it is sharp at any size |
| `logo-mono.svg`, `logo-mono-white.svg` | One colour, for print or where colour would fight |
| `logo-512.png`, `logo-1024.png` | The mark as a picture, transparent behind |
| `logo-wordmark.png`, `-light.png` | Mark and name together, for a page header |
| `favicon.svg`, `favicon.ico`, `favicon-16/32/48.png` | Browser tabs |
| `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` | Home screens, on their own dark tile |

The tile versions have a background of their own because phones put an icon on a
backdrop they choose, and a mark with nothing behind it would be lost.

## Colours

| | |
|---|---|
| Team A, the blue side, the shield's left half | `#00d4ff` |
| Team B, the red side, the shield's right half | `#ff3b5c` |
| The trim, and nothing else | `#e0a82e` |
| Background | `#0e131c` |

These two are the only strong colours in the app, and they never cross: a
side's colour must never appear in the other side's slots, or in a control
acting on the other side's behalf. Everything else on screen is a step on one
grey ramp, which is what keeps a screen that dense readable.

Gold is reserved for the state of the room rather than for either side — the
reserve clock, a finished draft, the hero the timer chose.

## The typefaces

The app sets anything read at a glance — the clock, the turn label, every
uppercase label — in **Barlow Condensed**, and anything read properly in
**Inter**. Condensed type is what lets a tournament HUD carry large, confident
labels without breaking the grid.

The wordmark image is still set in whatever grotesque the machine generating it
has, because the generator renders without a browser. Worth matching to Barlow
Condensed before anything goes on a stream overlay; it is four lines in
`scripts/make-logo.mjs`. The mark itself is pure geometry and depends on no
font at all.
