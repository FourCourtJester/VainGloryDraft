/**
 * The shapes everything else is built from.
 *
 * A draft, in this app, is a single ordered list of turns. Team A bans, then
 * team B bans, then somebody picks, and so on to the end. Banning and picking
 * are just two things a turn can be, rather than two separate features, so one
 * list describes a whole draft from start to finish.
 *
 * Because a format is only a list, supporting a new one means writing a new
 * list. 5v5, 3v3 and anything a tournament invents later all run the same code.
 */

export type Team = "A" | "B";

export type Action = "pick" | "ban";

/**
 * One turn: a team bans or picks a number of heroes.
 *
 * A turn with a count above one is a single go at the draft board — the captain
 * chooses that many heroes together and confirms them all at once, rather than
 * taking several separate turns in a row.
 */
export interface Turn {
  readonly team: Team;
  readonly action: Action;
  /** How many heroes this turn takes. Two means both are chosen before confirming. */
  readonly count: number;
}

/** A whole draft format, start to finish, as an ordered list of turns. */
export type TurnScript = readonly Turn[];

export interface Hero {
  /** Stable slug, e.g. "blackfeather". */
  readonly id: string;
  readonly name: string;
  /**
   * What the hero is usually played as, for the role filter in the hero pool.
   *
   * An empty list means nobody has confirmed this hero's roles yet. The app
   * would rather show no filter at all than a filter built on guesswork.
   */
  readonly roles: readonly string[];
  /** Melee or ranged, where that is known. Nothing depends on it yet. */
  readonly attackType: "melee" | "ranged" | null;
  /** Where to find the hero's portrait. Null until a roster with icons is imported. */
  readonly image: string | null;
}

/**
 * How the app chooses for a captain who ran out of time.
 *
 * "random" draws from whatever is still legal; "lowestIndex" takes the first
 * available hero on the list.
 */
export type AutoFillStrategy = "random" | "lowestIndex";

/**
 * The rules of one particular draft, settled the moment the room is made and
 * never changed after.
 *
 * The format is stored here as the actual list of turns rather than the name of
 * a preset, so that a draft already under way keeps the rules everyone agreed
 * to even if the preset it came from is edited afterwards.
 */
export interface DraftConfig {
  readonly script: TurnScript;
  /** The heroes available in this draft, in the order they are shown. */
  readonly heroPool: readonly string[];
  /** Whether both teams may take the same hero. Off unless the room asks for it. */
  readonly mirrorPicks: boolean;
  readonly autoFill: AutoFillStrategy;
  /**
   * A private number belonging to this room, used to make the choices the timer
   * makes on a captain's behalf repeatable. Anyone reviewing the room afterwards
   * can check that the draft played out the way it says it did.
   */
  readonly seed: string;
}

/** A turn a captain has confirmed. Once a turn is here, it is part of the draft. */
export interface CommittedTurn {
  /** Which turn of the format this was. */
  readonly index: number;
  readonly team: Team;
  readonly action: Action;
  /** The heroes taken, always as many as the turn called for. */
  readonly heroes: readonly string[];
  /**
   * True when the clock ran out and the app chose instead of the captain. The
   * room is shown this, so a hero nobody picked on purpose is never mistaken
   * for one that was.
   */
  readonly auto: boolean;
}

/**
 * A draft as it stands right now: the rules, everything confirmed so far, and
 * whatever the captain on the clock has chosen but not yet confirmed.
 *
 * This is only the state of the draft itself. Clocks, connections and saving to
 * storage all live elsewhere and act on it from outside.
 */
export interface DraftState {
  readonly config: DraftConfig;
  readonly committed: readonly CommittedTurn[];
  /**
   * What the captain on the clock has selected but not confirmed. Selecting a
   * hero puts it here and selecting it again takes it back out; nothing counts
   * until they confirm.
   */
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

export type HeroAvailability =
  | { readonly state: "available" }
  | { readonly state: "banned" }
  | { readonly state: "picked"; readonly by: readonly Team[] };
