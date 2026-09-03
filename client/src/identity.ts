/**
 * Who this browser is, as far as a draft room is concerned.
 *
 * A player is remembered by an id their own browser keeps, so somebody whose
 * phone dies and comes back is recognised as themselves — still on their team,
 * still picking if that was their job. The name is kept too, so they only type
 * it once however many drafts they play.
 *
 * None of it identifies a person beyond this browser. It is a way of surviving a
 * reconnect, not an account.
 */

import { autoName } from "../../src/room/names.js";

const ID_KEY = "vgd.player.id";
const NAME_KEY = "vgd.player.name";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private windows and locked-down browsers throw rather than return null.
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not being able to remember is survivable: they type their name again.
  }
}

/** This browser's player id, made once and kept. */
export function playerId(): string {
  const existing = read(ID_KEY);
  if (existing !== null && /^[A-Za-z0-9_-]{6,64}$/.test(existing)) return existing;
  const made = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  write(ID_KEY, made);
  return made;
}

/**
 * The name to show this player, which is theirs if they have ever typed one and
 * otherwise a generated one that will be the same for them every time.
 */
export function suggestedName(): string {
  return read(NAME_KEY) ?? autoName(playerId());
}

export function rememberName(name: string): void {
  write(NAME_KEY, name.trim().slice(0, 24));
}
