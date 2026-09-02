/**
 * Link tokens. No accounts: three per room — captain A, captain B, spectator.
 *
 * Tokens are reusable, by decision (docs/DECISIONS.md): the same link works
 * after a browser crash, on a phone, or on a reconnect. Since there is no pause,
 * a captain locked out of their own draft just burns clock, which is a worse
 * failure than a forwardable link.
 */

export interface RoomTokens {
  readonly A: string;
  readonly B: string;
  readonly spectator: string;
}

/** URL-safe random id. 16 bytes is well past guessable for a room that lives an hour. */
export function generateToken(bytes = 16): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateRoomTokens(): RoomTokens {
  return { A: generateToken(), B: generateToken(), spectator: generateToken() };
}

/** Length-independent comparison, so a token cannot be probed a character at a time. */
export function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
