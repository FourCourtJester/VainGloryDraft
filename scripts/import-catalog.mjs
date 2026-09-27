/**
 * Turn an export of a game's roster into games/<game>/catalog.json.
 *
 *   node scripts/import-catalog.mjs vainglory vgna-heroes.json
 *   node scripts/import-catalog.mjs vainglory vgna-heroes.json --keep-urls
 *   node scripts/import-catalog.mjs vainglory vgna-heroes.json --out /tmp/preview.json --dry-run
 *
 * Input is JSON: either an array, or an object holding one under `items`,
 * `heroes`, `maps` or `data`. Keys are matched loosely, because every export
 * names them differently — id/slug/key, name/title, icon/image/portrait — and
 * each of the catalog's filters says which keys it may be found under.
 *
 * Pictures are downloaded into client/public/games/<game> and referenced by
 * local path: do not hotlink a site that may disappear. `--keep-urls` leaves
 * the remote addresses alone if you would rather serve them from elsewhere.
 *
 * A filter's value is only ever what the export said, tidied up. Anything the
 * filter does not allow is dropped and reported rather than becoming a new
 * category, and a filter is only marked verified once every item has a value
 * for it — which is what lets a screen offer it. Nothing here invents a value
 * that was not in the export.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const [game, source] = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--out");
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

if (game === undefined || source === undefined) {
  console.error("Usage: node scripts/import-catalog.mjs <game> <export.json> [--keep-urls] [--out path] [--dry-run]");
  process.exit(2);
}

const ROOT = path.resolve(import.meta.dirname, "..");
const CATALOG = path.join(ROOT, "games", game, "catalog.json");
const OUT = path.resolve(ROOT, option("out") ?? CATALOG);
const ICON_DIR = path.join(ROOT, "client/public/games", game);

const squash = (key) => String(key).toLowerCase().replace(/[^a-z]/g, "");
const pick = (entry, keys) => {
  for (const key of keys.map(squash)) {
    const found = Object.keys(entry).find((k) => squash(k) === key);
    if (found !== undefined && entry[found] !== null && entry[found] !== "") return entry[found];
  }
  return undefined;
};

const slug = (value) =>
  String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * What is already on disk, so an export that is only about one thing does not
 * quietly throw away the other.
 *
 * Pictures are often imported separately and are not in a roster export, so an
 * item the export says nothing about keeps the picture it already has. Always
 * the real catalog, never `--out`: a preview still has to be judged against
 * what the app is actually carrying.
 */
const existing = await readFile(CATALOG, "utf8")
  .then((text) => JSON.parse(text))
  .catch(() => {
    console.error(`No catalog at ${path.relative(ROOT, CATALOG)}. Make the game's folder and a catalog.json first.`);
    process.exit(1);
  });
const existingById = new Map((existing.items ?? []).map((item) => [item.id, item]));
const filters = existing.filters ?? [];

/**
 * "Captain / Lane" and ["Captain","Lane"] both mean two values.
 *
 * Case is tidied up, since exports capitalise as they please, but nothing else
 * is interpreted: a value the filter does not allow is a mistake in whatever
 * produced the export, not a new category, so it is dropped and reported.
 */
const toValues = (value, filter, id, problems) => {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[/,|]/);
  const named = [...new Set(list.map((v) => String(v).trim()).filter((v) => v !== ""))];

  const kept = [];
  for (const v of named) {
    const known = filter.values.find((candidate) => candidate.toLowerCase() === v.toLowerCase());
    if (known === undefined) problems.push(`${id}: "${v}" is not one of ${filter.values.join(", ")}; dropped`);
    else if (!kept.includes(known)) kept.push(known);
  }
  // Back into the filter's own order, whatever order they arrived in.
  return filter.values.filter((v) => kept.includes(v));
};

const raw = JSON.parse(await readFile(path.resolve(source), "utf8"));
const input = Array.isArray(raw) ? raw : (raw.items ?? raw.heroes ?? raw.maps ?? raw.data ?? []);
if (!Array.isArray(input) || input.length === 0) {
  console.error("Nothing found: expected an array, or an object with an `items` array.");
  process.exit(1);
}

const problems = [];
const items = [];
const seen = new Set();

for (const [index, entry] of input.entries()) {
  const name = pick(entry, ["name", "title", "displayname", "heroname", "mapname"]);
  const id = slug(pick(entry, ["id", "slug", "key", "heroid", "mapid"]) ?? name ?? "");
  if (name === undefined || id === "") {
    problems.push(`entry ${index}: no usable id or name`);
    continue;
  }
  if (seen.has(id)) {
    problems.push(`${id}: duplicate id, keeping the first`);
    continue;
  }
  seen.add(id);

  const tags = {};
  for (const filter of filters) {
    const keys = [filter.key, `${filter.key}s`, filter.label, ...(filter.aliases ?? [])];
    tags[filter.key] = toValues(pick(entry, keys), filter, id, problems);
    if (tags[filter.key].length === 0) problems.push(`${id}: no ${filter.label.toLowerCase()} in the export`);
  }

  items.push({
    id,
    name: String(name).trim(),
    // An export with nothing to say about pictures leaves the ones we have.
    image: pick(entry, ["image", "icon", "imageurl", "portrait", "thumbnail", "heroicon"]) ?? existingById.get(id)?.image ?? null,
    tags,
  });
}

items.sort((a, b) => a.name.localeCompare(b.name));

if (!flag("keep-urls") && !flag("dry-run")) {
  await mkdir(ICON_DIR, { recursive: true });
  for (const item of items) {
    if (typeof item.image !== "string" || !/^https?:\/\//.test(item.image)) continue;
    try {
      const response = await fetch(item.image);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      const type = response.headers.get("content-type") ?? "";
      const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("svg") ? "svg" : "jpg";
      // Name each picture after its contents, so a re-import never leaves an
      // old one cached in someone's browser under a name it still trusts.
      const tag = createHash("sha256").update(body).digest("hex").slice(0, 8);
      const file = `${item.id}-${tag}.${ext}`;
      await writeFile(path.join(ICON_DIR, file), body);
      item.image = `/games/${game}/${file}`;
      process.stdout.write(".");
    } catch (error) {
      problems.push(`${item.id}: picture download failed (${error.message}); keeping the remote URL`);
    }
  }
  process.stdout.write("\n");
}

// A filter only counts as verified once every item has a value for it, since
// a filter that hides the thing somebody was looking for is worse than none.
const complete = (filter) => items.every((item) => item.tags[filter.key].length > 0);
const document = {
  ...existing,
  note: `Imported from ${path.basename(source)} on ${new Date().toISOString().slice(0, 10)}.`,
  filters: filters.map((filter) => ({ ...filter, verified: complete(filter) })),
  items,
};

if (flag("dry-run")) {
  console.log(JSON.stringify(document, null, 2).slice(0, 1200));
} else {
  await writeFile(OUT, `${JSON.stringify(document, null, 2)}\n`);
}

console.log(`\n${items.length} items, ${items.filter((item) => item.image !== null).length} with pictures`);
for (const filter of document.filters) {
  const have = items.filter((item) => item.tags[filter.key].length > 0).length;
  console.log(`  ${filter.label}: ${have} of ${items.length}${filter.verified ? " — verified, so it will be offered" : ""}`);
}
if (problems.length > 0) console.log(`\n${problems.length} note(s):\n  ${problems.slice(0, 12).join("\n  ")}`);
if (!flag("dry-run")) console.log(`\nWritten to ${path.relative(ROOT, OUT)} — run \`npm test\` and check it before committing.`);
