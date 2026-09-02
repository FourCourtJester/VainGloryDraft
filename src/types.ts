/**
 * Core draft types.
 *
 * The whole model rests on one idea: a draft is a single ordered list of turns.
 * Bans and picks are not two systems, they are two values of `Action`. The engine
 * only ever answers "whose turn is it, and what are they allowed to do".
 */

export type Team = "A" | "B";

export type Action = "pick" | "ban";

/** One turn of a draft: a team performs an action on `count` heroes. */
export interface Turn {
  readonly team: Team;
  readonly action: Action;
  /** Heroes selected in this one turn. `2` means stage both, one confirm. */
  readonly count: number;
}

/** An ordered list of turns. 5v5, 3v3 and custom formats are all just arrays. */
export type TurnScript = readonly Turn[];

export interface Hero {
  /** Stable slug, e.g. "blackfeather". */
  readonly id: string;
  readonly name: string;
  /**
   * Captains filter by role constantly. Empty array means "not yet verified" —
   * see data/heroes.json. Never invent these.
   */
  readonly roles: readonly string[];
  /** `null` means not yet verified. */
  readonly attackType: "melee" | "ranged" | null;
  /** Local path to a self-hosted portrait. `null` until images are imported. */
  readonly image: string | null;
}

/** How ties are broken when the timer resolves a turn nobody confirmed. */
export type AutoFillStrategy = "random" | "lowestIndex";

/**
 * Everything about a draft that is fixed at room creation. Note `script` is the
 * *resolved* array, never a preset id: a room in progress must not change if a
 * preset is edited later.
 */
export interface DraftConfig {
  readonly script: TurnScript;
  /** Hero ids legal in this draft. Ordering is the canonical ordering. */
  readonly heroPool: readonly string[];
  /** May both teams pick the same hero? Default off. */
  readonly mirrorPicks: boolean;
  readonly autoFill: AutoFillStrategy;
  /** Seed for `autoFill: "random"`. Auto-actions must be reproducible. */
  readonly seed: string;
}

/** A turn that has been confirmed. Committed turns are append-only. */
export interface CommittedTurn {
  /** Index into `DraftConfig.script`. */
  readonly index: number;
  readonly team: Team;
  readonly action: Action;
  /** Length always equals the turn's `count`. */
  readonly heroes: readonly string[];
  /** True when the timer resolved this turn rather than the captain. */
  readonly auto: boolean;
}

/**
 * The full draft. Pure data: no timers, no sockets, no clock. The host (a
 * Durable Object) owns those and calls the engine.
 */
export interface DraftState {
  readonly config: DraftConfig;
  readonly committed: readonly CommittedTurn[];
  /** Staged heroes for the current turn only. Nothing here is committed. */
  readonly staged: readonly string[];
}

export type DraftErrorCode =
  | "draft_complete"
  | "unknown_hero"
  | "hero_banned"
  | "hero_picked"
  | "hero_picked_by_opponent"
  | "already_staged"
  | "not_staged"
  | "turn_full"
  | "turn_incomplete"
  | "wrong_team"
  | "invalid_script";

export interface DraftError {
  readonly code: DraftErrorCode;
  readonly message: string;
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: DraftError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(code: DraftErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message } };
}

/** Why a hero cannot be selected right now, or `null` if it can. */
export type HeroAvailability =
  | { readonly state: "available" }
  | { readonly state: "banned" }
  | { readonly state: "picked"; readonly by: Team };
