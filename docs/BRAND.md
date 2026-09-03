# The mark

A **D** whose counter is a **V** — the two initials in one shape, so the badge is
readable at the size of a browser tab and still says what it is.

The V is in the colour the app gives team B and the D in team A's, which means
the two sides of a draft are in the badge itself.

It is an original mark. It is deliberately *not* a version of Vainglory's own
logo: this is a community tool that will sit on public pages, and borrowing
somebody else's mark is a problem waiting to happen for whoever runs the
tournament.

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
| Team A, and the D | `#4aa3ff` |
| Team B, and the V | `#ff7a59` |
| Background | `#12141a` |

## The wordmark

The name is set in whatever grotesque the machine has. That is fine for now and
deliberately easy to change: if the project ever picks a real typeface, the
wordmark is four lines in `scripts/make-logo.mjs`. The mark itself is pure
geometry and does not depend on any font.
