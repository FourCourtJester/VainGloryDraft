/**
 * The shapes everything else is built from.
 *
 * A draft, to this engine, is a single ordered list of turns. One team removes
 * something, another takes something, two teams choose at once, and so on to
 * the end. What the teams are called, what the things being drafted are, and
 * what each kind of turn does are all data handed in from outside — a game's
 * pack, or whoever made the room — so nothing in here knows which game it is
 * running.
 *
 * Because a format is only a list, supporting a new one means writing a new
 * list, and supporting a new game means writing a new pack. Neither touches
 * the code.
 */

/** A team's id, such as "A". What it is called on screen lives beside it, in its definition. */
export type Team = string;

/** An action's id, such as "ban" or "pick". What it does lives in its definition. */
export type ActionId = string;

export interface TeamDefinition {
  readonly id: Team;
  /** What the team is called on screen: "Team A", "Blue", "Radiant". */
  readonly name: string;
}

/**
 * What an action does to the thing it is used on.
 *
 * - `remove` takes it out of the draft for everybody: a ban, a veto, a strike.
 * - `take` gives it to the team that chose it: a pick. Whether another team may
 *   then take the same thing as well is the room's mirror setting.
 *
 * Every kind of turn a game has is one of these two with its own name on it,
 * which is what lets a new game describe its turns without new code.
 */
export type ActionEffect = "remove" | "take";

export interface ActionDefinition {
  readonly id: ActionId;
  /** The word on the button: "Ban", "Pick", "Veto". */
  readonly label: string;
  /** How it reads once done: "banned", "picked", "vetoed". */
  readonly past: string;
  readonly effect: ActionEffect;
}

/**
 * One turn of a draft.
 *
 * Who plays it is a list, because there are three kinds of turn:
 *
 * - **One team**, the usual case: they choose, confirm, and it is done.
 * - **Several teams at once**, blind. Each chooses without seeing the others,
 *   and nothing is shown until every one of them has confirmed or run out of
 *   time; then all of it is revealed together. Because nobody could see what
 *   anybody else chose, two teams can land on the same thing.
 * - **Nobody**: the draft takes what is left, the way the last map standing in
 *   a veto becomes the one that is played. There is nobody to wait for, so it
 *   happens the moment the draft reaches it.
 *
 * A count above one is still a single turn — the team chooses that many
 * together and confirms them all at once, on one clock.
 */
export interface Turn {
  readonly teams: readonly Team[];
  readonly action: ActionId;
  /** How many things each team playing this turn chooses. */
  readonly count: number;
  /**
   * This turn's own time, where it should differ from the room's usual
   * allowance — a longer clock for a turn that takes two, say.
   */
  readonly timeMs?: number;
}

/** A whole draft format, start to finish, as an ordered list of turns. */
export type TurnScript = readonly Turn[];

/**
 * How the engine chooses for a team that ran out of time, and for a turn
 * nobody plays.
 *
 * "random" draws from whatever is still legal; "lowestIndex" takes the first
 * available item on the list.
 */
export type AutoFillStrategy = "random" | "lowestIndex";

/**
 * The rules of one particular draft, settled the moment the room is made and
 * never changed after.
 *
 * Everything is stored here as a copy — the teams, what each action does, the
 * actual list of turns — rather than as the name of a preset or a pack. A draft
 * already under way therefore keeps the rules everyone agreed to, even if the
 * pack it came from is edited while it is being played.
 */
export interface DraftConfig {
  readonly teams: readonly TeamDefinition[];
  readonly actions: readonly ActionDefinition[];
  readonly script: TurnScript;
  /** The ids of everything that can be drafted, in the order they are shown. */
  readonly pool: readonly string[];
  /** Whether more than one team may take the same thing. Off unless the room asks for it. */
  readonly mirror: boolean;
  readonly autoFill: AutoFillStrategy;
  /**
   * A private number belonging to this room, used to make the choices the
   * engine makes on a team's behalf repeatable. Anyone reviewing the room
   * afterwards can check that the draft played out the way it says it did.
   */
  readonly seed: string;
}

/**
 * What one team chose on one turn, once it counts.
 *
 * A turn played by one team leaves one of these; a turn played blind by two
 * leaves two, sharing a turn index; a turn nobody plays leaves one with no team.
 */
export interface Selection {
  /** Which turn of the format this was. */
  readonly index: number;
  /** Who chose. Null when nobody did — the draft took what was left. */
  readonly team: Team | null;
  readonly action: ActionId;
  /** What was chosen, always as many as the turn called for while that many were left. */
  readonly items: readonly string[];
  /**
   * True when the engine chose rather than the team: their clock ran out, or
   * nobody plays this turn. The room is shown this, so a thing nobody chose on
   * purpose is never mistaken for one that was.
   */
  readonly auto: boolean;
  /**
   * When the team settled it.
   *
   * A finished draft is kept, and can be opened again days later to see how it
   * went. Recording the moment each choice landed means that record shows not
   * just what was taken and in what order, but how long each side sat on the
   * decision — which is often the interesting part.
   */
  readonly at: number | null;
}

/** A team's choice on a blind turn, held back until everybody else has made theirs. */
export interface LockedChoice {
  readonly items: readonly string[];
  readonly auto: boolean;
  readonly at: number | null;
}

/**
 * A draft as it stands right now: the rules, everything settled so far, and
 * whatever the teams on the clock have chosen but not yet confirmed.
 *
 * This is only the state of the draft itself. Clocks, connections and saving to
 * storage all live elsewhere and act on it from outside.
 */
export interface DraftState {
  readonly config: DraftConfig;
  /** Everything settled, in the order it was revealed. */
  readonly committed: readonly Selection[];
  /** Which turn of the format is being played. Equal to the script's length once it is over. */
  readonly turnIndex: number;
  /**
   * What each team on the clock has selected but not confirmed. Selecting an
   * item puts it here and selecting it again takes it back out; nothing counts
   * until they confirm.
   */
  readonly staged: Readonly<Record<Team, readonly string[]>>;
  /**
   * On a turn several teams play at once, the ones who have already confirmed.
   * What they chose stays here, out of sight, until the last of them has.
   */
  readonly locked: Readonly<Record<Team, LockedChoice>>;
}

export type DraftErrorCode =
  | "draft_complete"
  | "unknown_item"
  | "item_removed"
  | "item_taken"
  | "item_taken_by_opponent"
  | "already_staged"
  | "not_staged"
  | "already_locked"
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

/**
 * What has happened to one thing in the pool.
 *
 * Taken with nobody in `by` means the draft itself took it, on a turn nobody
 * plays.
 */
export type Availability =
  | { readonly state: "available" }
  | { readonly state: "removed"; readonly by: Team | null; readonly action: ActionId }
  | { readonly state: "taken"; readonly by: readonly Team[]; readonly action: ActionId };
