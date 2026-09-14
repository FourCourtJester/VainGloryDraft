/**
 * Take a folder of hero portraits and make them usable by the draft screen.
 *
 *   node scripts/import-portraits.mjs "~/Hero Portraits"
 *   node scripts/import-portraits.mjs "~/Hero Portraits" --dry-run
 *
 * A folder of art exported from somewhere else is never quite ready to ship:
 * the pictures come at whatever size they happened to be saved at, a few are a
 * pixel or two off square, and together they weigh far more than anybody on a
 * phone should have to download to look at a hero grid. This squares them all
 * to one size, re-encodes them, and writes the result into the app.
 *
 * Files are matched to heroes by name, so `sanfeng.png` finds `san-feng`. A
 * hero with no portrait keeps `image: null` and goes on being drawn as a name,
 * which is what the grid already does — a missing picture is not a broken one.
 * Anything in the folder that is not one of our heroes is left alone and
 * reported, rather than guessed at.
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const source = args.find((arg) => !arg.startsWith("--"));
const dryRun = args.includes("--dry-run");

if (source === undefined) {
  console.error('Usage: node scripts/import-portraits.mjs <folder> [--dry-run]');
  process.exit(2);
}

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data/heroes.json");
const OUT_DIR = path.join(ROOT, "client/public/heroes");

/**
 * How big a portrait is written.
 *
 * The grid draws tiles at about 96 points across, so this covers a tile on a
 * two-times phone screen with a little to spare. Going bigger would only buy
 * detail nobody sees, at the cost of the download.
 */
const SIZE = 192;

/** Below this, a portrait is being stretched rather than shrunk, so it is worth saying so. */
const SHARP_ENOUGH = 200;

const slug = (value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** `sanfeng` and `san-feng` are the same hero written two ways. */
const squash = (value) => slug(value).replace(/-/g, "");

const file = JSON.parse(await readFile(DATA, "utf8"));
const heroes = file.heroes;

const entries = (await readdir(source, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
  .map((entry) => entry.name);

// Match on the squashed name, so a hyphen either side of the join is no obstacle.
const byName = new Map(heroes.map((hero) => [squash(hero.id), hero]));
const matched = new Map();
const unmatched = [];

for (const name of entries) {
  const key = squash(path.basename(name, path.extname(name)));
  const hero = byName.get(key);
  if (hero === undefined) unmatched.push(name);
  else matched.set(hero.id, name);
}

const missing = heroes.filter((hero) => !matched.has(hero.id)).map((hero) => hero.id);

console.log(`${matched.size} of ${heroes.length} heroes have a portrait.`);
if (missing.length > 0) console.log(`no portrait: ${missing.join(", ")}`);
if (unmatched.length > 0) console.log(`not one of our heroes, skipped: ${unmatched.join(", ")}`);

if (dryRun) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

// Start from empty, so a portrait dropped from a later export does not linger
// as a file nothing references any more.
await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

const soft = [];
let before = 0;
let after = 0;

for (const [id, name] of matched) {
  const input = path.join(source, name);
  const original = await sharp(input).metadata();
  before += (await stat(input)).size;

  // Square them off the middle. Several arrive a pixel or two out, and a grid
  // of tiles that are each very slightly the wrong shape looks wrong in a way
  // nobody can point at.
  const data = await sharp(input)
    .resize(SIZE, SIZE, { fit: "cover", position: "attention" })
    .webp({ quality: 82 })
    .toBuffer();

  await writeFile(path.join(OUT_DIR, `${id}.webp`), data);
  after += data.length;

  if (Math.min(original.width ?? 0, original.height ?? 0) < SHARP_ENOUGH) {
    soft.push(`${id} (${original.width}×${original.height})`);
  }
}

// The data file records where a portrait lives, and nothing else about it. A
// hero without one keeps null rather than a path to a picture that is not there.
file.heroes = heroes.map((hero) => ({
  ...hero,
  image: matched.has(hero.id) ? `/heroes/${hero.id}.webp` : null,
}));
file.portraits = {
  count: matched.size,
  size: SIZE,
  source: path.basename(source),
  note:
    missing.length === 0
      ? "Every hero has a portrait."
      : `No portrait yet for: ${missing.join(", ")}. Those heroes are drawn as a name.`,
};

await writeFile(DATA, `${JSON.stringify(file, null, 2)}\n`);

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
console.log(`\nwrote ${matched.size} portraits to client/public/heroes`);
console.log(`  ${kb(before)} in, ${kb(after)} out (${(after / matched.size / 1024).toFixed(1)} KB each)`);
if (soft.length > 0) {
  console.log(`\nSmaller than ${SHARP_ENOUGH}px, so stretched to fit and a little soft:`);
  console.log(`  ${soft.join("\n  ")}`);
  console.log("  Worth replacing if a sharper copy turns up.");
}
