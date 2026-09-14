/**
 * Draws the Vainglory Draft mark and writes every size the app and a browser
 * need.
 *
 * The mark is a shield split down the middle — one half the colour of team A,
 * the other team B — with a V cut through the join. A draft is two sides facing
 * each other over one board, so the badge is the two sides and the V is what
 * they are drafting for. It is an original mark, not a copy of the game's own,
 * which matters for something a tournament will put on a public page.
 *
 * Everything is drawn as vector, so the same shape is sharp at 1024px and still
 * legible in a browser tab. The trim is dropped from the small sizes: at 16px
 * a thin gold outline turns to mud and takes the shape down with it.
 *
 * Run it whenever the shape or the palette changes:
 *
 *   node scripts/make-logo.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUT = path.resolve(import.meta.dirname, "../client/public");

const BLUE = "#00d4ff";   // team A, the blue side, and the left half
const RED = "#ff3b5c";    // team B, the red side, and the right half
const GOLD = "#e0a82e";   // the trim, and nothing else
const DARK = "#0e131c";   // the app's background, and the icon tile
const LIGHT = "#f2f6ff";  // the V

// A heater shield with squared shoulders: angular enough to read as tournament
// hardware rather than heraldry, and simple enough to survive being shrunk.
const SHIELD = "M64 12 L114 27 V67 C114 94 92 111 64 120 C36 111 14 94 14 67 V27 Z";
const SHIELD_INNER = "M64 18 L109 31 V67 C109 92 89 107 64 115 C39 107 19 92 19 67 V31 Z";

// The V, cut through the middle of the shield where the two sides meet.
const V_PATH = "M40 40 L55 40 L64 74 L73 40 L88 40 L71 96 L57 96 Z";

const svg = (body, size = 128) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}">${body}</svg>`;

/**
 * The shield, split down the middle. The halves are drawn by clipping two
 * rectangles to the shield rather than by drawing two half-shields, so the two
 * sides always meet exactly on the centre line whatever the outline does.
 */
const shieldBody = (trim) => `
  <defs><clipPath id="shield"><path d="${trim ? SHIELD_INNER : SHIELD}"/></clipPath></defs>
  ${trim ? `<path d="${SHIELD}" fill="${GOLD}"/>` : ""}
  <g clip-path="url(#shield)">
    <rect x="0" y="0" width="64" height="128" fill="${BLUE}"/>
    <rect x="64" y="0" width="64" height="128" fill="${RED}"/>
  </g>
  <path d="${V_PATH}" fill="${LIGHT}"/>`;

/** The mark on its own, for anywhere with a background of its own. */
const markTwoTone = svg(shieldBody(true));

/** No trim, for the sizes where a thin gold outline would only muddy it. */
const markPlain = svg(shieldBody(false));

/** One colour, for print, stamps, and anywhere colour would fight. */
const markMono = (colour = BLUE) =>
  svg(`<path fill-rule="evenodd" d="${SHIELD} ${V_PATH}" fill="${colour}"/>`);

/**
 * The mark on its own tile. Phone home screens and app listings put an icon on
 * a background of their choosing, so this one brings its own.
 */
const tile = (size) =>
  svg(
    `<rect width="128" height="128" rx="28" fill="${DARK}"/>` +
      `<g transform="translate(64 64) scale(0.76) translate(-64 -64)">${shieldBody(true)}</g>`,
    size,
  );

/** The mark beside the name, for a page header or a readme. */
const lockup = (colour, background) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 160" width="720" height="160">
  ${background === null ? "" : `<rect width="720" height="160" fill="${background}"/>`}
  <g transform="translate(48 16)">${shieldBody(true)}</g>
  <text x="200" y="76" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif"
        font-size="46" font-weight="700" letter-spacing="1" fill="${colour}">VAINGLORY</text>
  <text x="202" y="122" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif"
        font-size="34" font-weight="400" letter-spacing="14" fill="${colour}" opacity="0.7">DRAFT</text>
</svg>`;

const png = (source, size) => sharp(Buffer.from(source)).resize(size, size).png().toBuffer();

/** Wraps PNGs into a .ico, which is still what some browsers reach for first. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

await mkdir(OUT, { recursive: true });
const written = [];
const write = async (name, data) => {
  await writeFile(path.join(OUT, name), data);
  written.push(`${name} (${(data.length / 1024).toFixed(1)} KB)`);
};

// Vectors: the masters. Everything else is rendered from these.
await write("logo.svg", markTwoTone);
await write("logo-mono.svg", markMono());
await write("logo-mono-white.svg", markMono("#ffffff"));
await write("favicon.svg", markTwoTone);
await write("logo-wordmark.svg", lockup("#e6e9ef", null));

// Browser tabs. The trimmed mark below 48px loses the shape to the trim, so
// the small sizes get the plain one.
const favicons = await Promise.all(
  [16, 32, 48].map(async (size) => ({ size, data: await png(size < 48 ? markPlain : markTwoTone, size) })),
);
for (const { size, data } of favicons) await write(`favicon-${size}.png`, data);
await write("favicon.ico", ico(favicons));

// Home screens and app listings, which want an opaque tile.
await write("apple-touch-icon.png", await png(tile(180), 180));
await write("icon-192.png", await png(tile(192), 192));
await write("icon-512.png", await png(tile(512), 512));

// Plain artwork, for a readme or a site that brings its own background.
await write("logo-512.png", await png(markTwoTone, 512));
await write("logo-1024.png", await png(markTwoTone, 1024));
await write(
  "logo-wordmark.png",
  await sharp(Buffer.from(lockup("#e6e9ef", DARK))).resize(1440).png().toBuffer(),
);
await write(
  "logo-wordmark-light.png",
  await sharp(Buffer.from(lockup("#12141a", "#ffffff"))).resize(1440).png().toBuffer(),
);

console.log(`wrote ${written.length} files to client/public:\n  ${written.join("\n  ")}`);
