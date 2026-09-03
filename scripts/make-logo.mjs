/**
 * Draws the Vainglory Draft mark and writes every size the app and a browser
 * need.
 *
 * The mark is a D whose counter is a V — the two initials in one shape, with the
 * V in the colour the app gives team B, so the thing the tool is for is in its
 * own badge. It is an original mark, not a copy of the game's own, which matters
 * for something a tournament will put on a public page.
 *
 * Run it whenever the shape or the palette changes:
 *
 *   node scripts/make-logo.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUT = path.resolve(import.meta.dirname, "../client/public");

const BLUE = "#4aa3ff";   // team A, and the mark's body
const ORANGE = "#ff7a59"; // team B, and the V
const DARK = "#12141a";   // the app's background, and the icon tile

// The letterforms. A squared bowl rather than a plain round one, so the D reads
// as drawn rather than as a default shape.
const D_PATH = "M14 14 L62 14 C92 14 114 36 114 64 C114 92 92 114 62 114 L14 114 Z";
const V_PATH = "M41 34 L54 34 L66 72 L78 34 L91 34 L72 92 L60 92 Z";

const svg = (body, size = 128) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}">${body}</svg>`;

/** The mark on its own, for anywhere with a background of its own. */
const markTwoTone = svg(`<path d="${D_PATH}" fill="${BLUE}"/><path d="${V_PATH}" fill="${ORANGE}"/>`);

/** One colour, for print, stamps, and anywhere colour would fight. */
const markMono = (colour = BLUE) =>
  svg(`<path fill-rule="evenodd" d="${D_PATH} ${V_PATH}" fill="${colour}"/>`);

/**
 * The mark on its own tile. Phone home screens and app listings put an icon on
 * a background of their choosing, so this one brings its own.
 */
const tile = (size) =>
  svg(
    `<rect width="128" height="128" rx="28" fill="${DARK}"/>` +
      `<g transform="translate(64 64) scale(0.72) translate(-64 -64)">` +
      `<path d="${D_PATH}" fill="${BLUE}"/><path d="${V_PATH}" fill="${ORANGE}"/></g>`,
    size,
  );

/** The mark beside the name, for a page header or a readme. */
const lockup = (colour, background) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 160" width="720" height="160">
  ${background === null ? "" : `<rect width="720" height="160" fill="${background}"/>`}
  <g transform="translate(48 16)">
    <path d="${D_PATH}" fill="${BLUE}"/><path d="${V_PATH}" fill="${ORANGE}"/>
  </g>
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

// Browser tabs.
const favicons = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(markTwoTone, size) })));
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
