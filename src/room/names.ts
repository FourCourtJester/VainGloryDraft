/**
 * Names for players who have not typed one.
 *
 * Joining a draft should be one tap, so everybody arrives with a name already
 * filled in and can change it if they care. The name is worked out from the id
 * their browser keeps, which means the same person gets the same name every
 * time — open five drafts in a day and you are "Swift Falcon" in all of them.
 * That is a courtesy, not an identity: anybody can type whatever they like over
 * it, and it is the id underneath that a room actually goes on.
 */

const ADJECTIVES = [
  "Swift", "Bold", "Silent", "Iron", "Gilded", "Crimson", "Azure", "Storm",
  "Ember", "Frost", "Shadow", "Radiant", "Grim", "Keen", "Wild", "Steady",
  "Fabled", "Restless", "Cunning", "Stoic", "Fierce", "Nimble", "Ancient", "Lucky",
];

const NOUNS = [
  "Falcon", "Warden", "Lantern", "Comet", "Anvil", "Verdict", "Sentry", "Rook",
  "Tempest", "Compass", "Beacon", "Vanguard", "Herald", "Cipher", "Talon", "Bastion",
  "Drifter", "Kestrel", "Pilgrim", "Marshal", "Oracle", "Reveler", "Sable", "Wanderer",
];

/** A small spread of the id across the word lists, stable for the same id. */
function spread(input: string, salt: number): number {
  let hash = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash ^ (hash >>> 15)) >>> 0;
}

/** The name this player gets when they do not type one. Always the same for them. */
export function autoName(playerId: string): string {
  const adjective = ADJECTIVES[spread(playerId, 0x9e3779b9) % ADJECTIVES.length]!;
  const noun = NOUNS[spread(playerId, 0x85ebca6b) % NOUNS.length]!;
  return `${adjective} ${noun}`;
}

/** Tidies a typed name into something a roster can show, or falls back. */
export function cleanName(input: string, playerId: string): string {
  const trimmed = input.replace(/\s+/g, " ").trim().slice(0, 24);
  return trimmed === "" ? autoName(playerId) : trimmed;
}
