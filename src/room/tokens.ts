/**
 * The three links that get handed out for a draft.
 *
 * There are no accounts and nothing to sign up for. An organiser creates a room
 * and sends one link to each captain and a third to everyone else; holding a
 * link is what makes you that captain or a spectator. The links are long and
 * random enough that nobody finds a room by guessing.
 *
 * A link keeps working, so a captain whose browser crashes or whose phone dies
 * mid-draft simply opens it again. Since the clock never pauses, being locked
 * out of your own draft would cost you the game.
 */

export interface RoomTokens {
  readonly A: string;
  readonly B: string;
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

/** Makes a fresh set of links for a new room. */
export function generateRoomTokens(): RoomTokens {
  return { A: generateToken(), B: generateToken(), spectator: generateToken() };
}

/**
 * Compares a link token against a room's, in a way that takes the same time
 * whether the first character is wrong or the last, so nobody can work a token
 * out by measuring how quickly they are turned away.
 */
export function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
