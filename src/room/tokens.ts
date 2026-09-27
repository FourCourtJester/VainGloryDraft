/**
 * How somebody proves which seat in a draft is theirs.
 *
 * There are no accounts and nothing to sign up for. A room hands out two kinds
 * of credential, because the two audiences want opposite things:
 *
 * A **captain** gets a short code — six characters a person can read off Discord
 * and type on a phone between matches. It arrives in their link so that tapping
 * it is enough, and there is a box to type it for anyone who got the code
 * some other way. A code that short is guessable given enough attempts, which is
 * why the room counts failures and stops answering after a handful.
 *
 * **Everyone else** gets a long spectator link and no code at all. Watching is
 * not worth protecting, and a link that can simply be pasted into a channel is
 * worth a great deal.
 *
 * Both keep working. A captain whose phone dies mid-draft opens the link again;
 * since the clock never pauses, being locked out of your own draft would cost
 * you the game.
 */

import type { Team } from "../types.js";

/** No O or 0, no I, L or 1: these get read aloud and typed by hand. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

export interface RoomCredentials {
  /** The teams' codes, one per side. */
  readonly codes: Readonly<Record<Team, string>>;
  /** The spectator link's token. Long, because nobody types it. */
  readonly spectator: string;
}

/** Makes one unguessable link token, safe to put in a web address. */
export function generateToken(bytes = 16): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Makes a captain's code: short enough to read out over voice, drawn from an
 * alphabet with no characters that get confused for one another.
 */
export function generateCode(length = CODE_LENGTH): string {
  const buffer = new Uint8Array(length);
  crypto.getRandomValues(buffer);
  let code = "";
  // Rejecting the tail of the byte range keeps every letter equally likely.
  for (let i = 0; i < length; i++) {
    let byte = buffer[i]!;
    while (byte >= 256 - (256 % CODE_ALPHABET.length)) {
      const extra = new Uint8Array(1);
      crypto.getRandomValues(extra);
      byte = extra[0]!;
    }
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Everything a new room hands out: a code for each team, all different, and a
 * spectator token.
 */
export function generateCredentials(teams: readonly Team[]): RoomCredentials {
  const codes: Record<Team, string> = {};
  const used = new Set<string>();
  for (const team of teams) {
    let code = generateCode();
    // Thirty-one characters to the sixth power makes a clash vanishingly
    // unlikely, but two teams holding the same code would be one team.
    while (used.has(code)) code = generateCode();
    used.add(code);
    codes[team] = code;
  }
  return { codes, spectator: generateToken() };
}

/** Codes get typed, so treat case and stray spaces as the person meant them. */
export function normaliseCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, "");
}

/**
 * Compares a credential against a room's, in a way that takes the same time
 * whether the first character is wrong or the last, so nobody can work one out
 * by measuring how quickly they are turned away.
 */
export function credentialsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
