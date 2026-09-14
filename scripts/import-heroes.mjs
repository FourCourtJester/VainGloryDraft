/**
 * Turn a hero export into data/heroes.json.
 *
 *   node scripts/import-heroes.mjs vgna-heroes.json
 *   node scripts/import-heroes.mjs vgna-heroes.json --keep-urls
 *   node scripts/import-heroes.mjs vgna-heroes.json --out /tmp/preview.json --dry-run
 *
 * Input is JSON: either an array of heroes or `{ "heroes": [...] }`. Keys are
 * matched loosely, because every export names them differently — id/heroId/slug,
 * name/heroName, icon/heroIcon/image, role/heroRole/roles.
 *
 * Icons are downloaded into client/public/heroes and referenced by local path,
 * per the handoff: do not hotlink a site that may disappear. `--keep-urls`
 * leaves the remote URLs alone if you would rather serve them from vgna.net.
 *
 * A hero with no role keeps `roles: []` and the file stays `verified: false`,
 * which is what stops the UI offering a role filter over data it cannot trust.
 * Nothing here invents a value that was not in the export.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const source = args.find((arg) => !arg.startsWith("--"));
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

if (source === undefined) {
  console.error("Usage: node scripts/import-heroes.mjs <export.json> [--keep-urls] [--out path] [--dry-run]");
  process.exit(2);
}

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.resolve(ROOT, option("out") ?? "data/heroes.json");
const ICON_DIR = path.resolve(ROOT, "client/public/heroes");

const pick = (hero, keys) => {
  for (const key of keys) {
    const found = Object.keys(hero).find((k) => k.toLowerCase().replace(/[^a-z]/g, "") === key);
    if (found !== undefined && hero[found] !== null && hero[found] !== "") return hero[found];
  }
  return undefined;
};

const slug = (value) =>
  String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * What is already on disk, so an export that is only about one thing does not
 * quietly throw away the other.
 *
 * The portraits were imported separately and are not in a role export, so a
 * hero the export says nothing about keeps the picture it already has. Always
 * the real data file, never `--out`: a preview still has to be judged against
 * what the app is actually carrying.
 */
const existing = await readFile(path.resolve(ROOT, "data/heroes.json"), "utf8")
  .then((text) => JSON.parse(text))
  .catch(() => ({ heroes: [], portraits: undefined }));
const existingById = new Map((existing.heroes ?? []).map((hero) => [hero.id, hero]));

/**
 * The only roles a hero is drafted for, read from the roster file so that this
 * script and the app share one list rather than each holding their own.
 */
const ROLES = existing.roles ?? ["Captain", "Jungle", "Lane"];

/**
 * "Captain / Lane" and ["Captain","Lane"] both mean two roles.
 *
 * Case is tidied up, since exports capitalise as they please, but nothing else
 * is interpreted: a role that is not one of the three is a mistake in whatever
 * produced the export, not a fourth role, so it is dropped and reported rather
 * than quietly becoming a filter nobody asked for.
 */
const toRoles = (value, id, problems) => {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[/,|]/);
  const named = [...new Set(list.map((role) => String(role).trim()).filter((role) => role !== ""))];

  const kept = [];
  for (const role of named) {
    const known = ROLES.find((candidate) => candidate.toLowerCase() === role.toLowerCase());
    if (known === undefined) problems.push(`${id}: "${role}" is not one of ${ROLES.join(", ")}; dropped`);
    else if (!kept.includes(known)) kept.push(known);
  }
  // Back into the order a captain thinks about them, whatever order they arrived in.
  return ROLES.filter((role) => kept.includes(role));
};

const raw = JSON.parse(await readFile(path.resolve(source), "utf8"));
const input = Array.isArray(raw) ? raw : (raw.heroes ?? raw.data ?? []);
if (!Array.isArray(input) || input.length === 0) {
  console.error("No heroes found: expected an array, or an object with a `heroes` array.");
  process.exit(1);
}

const problems = [];
const heroes = [];
const seen = new Set();

for (const [index, entry] of input.entries()) {
  const name = pick(entry, ["name", "heroname", "title", "displayname"]);
  const id = slug(pick(entry, ["id", "heroid", "slug", "key"]) ?? name ?? "");
  if (name === undefined || id === "") {
    problems.push(`entry ${index}: no usable id or name`);
    continue;
  }
  if (seen.has(id)) {
    problems.push(`${id}: duplicate id, keeping the first`);
    continue;
  }
  seen.add(id);

  const roles = toRoles(pick(entry, ["roles", "role", "herorole", "position", "class"]), id, problems);
  const attack = String(pick(entry, ["attacktype", "attack", "range"]) ?? "").toLowerCase();
  heroes.push({
    id,
    name: String(name).trim(),
    roles,
    attackType: attack === "melee" || attack === "ranged" ? attack : null,
    // An export with nothing to say about pictures leaves the ones we have.
    image:
      pick(entry, ["image", "icon", "heroicon", "imageurl", "portrait", "thumbnail"]) ??
      existingById.get(id)?.image ??
      null,
  });
  if (roles.length === 0) problems.push(`${id}: no role in the export`);
}

heroes.sort((a, b) => a.name.localeCompare(b.name));

if (!flag("keep-urls") && !flag("dry-run")) {
  await mkdir(ICON_DIR, { recursive: true });
  for (const hero of heroes) {
    if (typeof hero.image !== "string" || !/^https?:\/\//.test(hero.image)) continue;
    try {
      const response = await fetch(hero.image);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      const type = response.headers.get("content-type") ?? "";
      const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("svg") ? "svg" : "jpg";
      // Name each portrait after its contents, so a re-import never leaves an
      // old picture cached in someone's browser under a name it still trusts.
      const tag = createHash("sha256").update(body).digest("hex").slice(0, 8);
      const file = `${hero.id}-${tag}.${ext}`;
      await writeFile(path.join(ICON_DIR, file), body);
      hero.image = `/heroes/${file}`;
      process.stdout.write(".");
    } catch (error) {
      problems.push(`${hero.id}: icon download failed (${error.message}); keeping the remote URL`);
    }
  }
  process.stdout.write("\n");
}

const withRoles = heroes.filter((hero) => hero.roles.length > 0).length;
const withIcons = heroes.filter((hero) => hero.image !== null).length;

const document = {
  // The roster only counts as verified when every hero has a role, since that
  // is what captains filter by. Melee or ranged is a nice extra and gates
  // nothing.
  verified: withRoles === heroes.length,
  // Carried through, because this is the list the app and this script both
  // read: dropping it on write would leave the next import with no idea what
  // a role is.
  roles: ROLES,
  note:
    withRoles === heroes.length
      ? `Imported from ${path.basename(source)}.`
      : `Imported from ${path.basename(source)}. ${heroes.length - withRoles} hero(es) have no role, so the file stays unverified and the UI will not offer a role filter.`,
  roster: { count: heroes.length, source: `Imported from ${path.basename(source)} on ${new Date().toISOString().slice(0, 10)}.` },
  // Whatever the portrait import last recorded, unless this export replaced the
  // pictures itself.
  ...(existing.portraits === undefined ? {} : { portraits: existing.portraits }),
  heroes,
};

if (flag("dry-run")) {
  console.log(JSON.stringify(document, null, 2).slice(0, 1200));
} else {
  await writeFile(OUT, `${JSON.stringify(document, null, 2)}\n`);
}

console.log(`\n${heroes.length} heroes — ${withRoles} with roles, ${withIcons} with icons`);
console.log(`verified: ${document.verified}`);
if (problems.length > 0) console.log(`\n${problems.length} note(s):\n  ${problems.slice(0, 12).join("\n  ")}`);
if (!flag("dry-run")) console.log(`\nWritten to ${path.relative(ROOT, OUT)} — run \`npm test\` and check the roster before committing.`);
