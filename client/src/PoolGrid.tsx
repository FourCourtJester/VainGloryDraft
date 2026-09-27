import type { JSX } from "react";
import { useMemo, useState } from "react";
import type { DraftProjection } from "../../src/projection.js";
import type { ActionId } from "../../src/types.js";
import { actionOf, slotOf } from "./format.js";
import type { GameView } from "./game.js";

interface Props {
  readonly game: GameView;
  readonly projection: DraftProjection;
  /** True when this viewer is the one choosing for their side right now. */
  readonly interactive: boolean;
  readonly onToggle: (itemId: string) => void;
  /** Set for a player who is not choosing: tapping something tells their captain. */
  readonly suggesting?: ActionId | undefined;
  readonly onSuggest?: ((itemId: string) => void) | undefined;
}

/**
 * The wall of things a captain chooses from, with a search box and whatever
 * filters the game has trustworthy data for.
 *
 * Anything removed or already taken is shown struck through or greyed rather
 * than taken away, so everybody can see at a glance what has gone.
 */
export function PoolGrid({ game, projection, interactive, onToggle, suggesting, onSuggest }: Props): JSX.Element {
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<Readonly<Record<string, string>>>({});

  const byId = useMemo(() => new Map(game.items.map((item) => [item.id, item])), [game.items]);
  const staged = new Set(projection.staged ?? []);
  const selectable = new Set(projection.selectable);
  // What this side has asked for, so a captain can see it on the tiles.
  const marks = new Map(projection.suggestions.map((entry) => [entry.itemId, entry]));
  const effectOf = (action: string): string => actionOf(projection.actions, action)?.effect ?? "take";

  const query = search.trim().toLowerCase();
  const visible = projection.pool.filter(({ id }) => {
    const item = byId.get(id);
    const name = item?.name ?? id;
    if (query !== "" && !name.toLowerCase().includes(query)) return false;
    for (const [key, value] of Object.entries(chosen)) {
      if (value !== "all" && !(item?.tags[key] ?? []).includes(value)) return false;
    }
    return true;
  });

  return (
    <section className="pool">
      <div className="pool-filters">
        <input
          type="search"
          placeholder={`Search ${game.terms.items}`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label={`Search ${game.terms.items}`}
        />
        {game.filters.map((filter) => (
          <select
            key={filter.key}
            value={chosen[filter.key] ?? "all"}
            onChange={(event) => setChosen({ ...chosen, [filter.key]: event.target.value })}
            aria-label={`Filter by ${filter.label.toLowerCase()}`}
          >
            <option value="all">Any {filter.label.toLowerCase()}</option>
            {filter.values.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        ))}
        {game.unverifiedFilters.length > 0 && (
          // No filter until its data is known to be right: one that hides the
          // thing somebody was looking for is worse than none.
          <span className="note" title={`${game.unverifiedFilters.join(", ")} not verified yet`}>
            {game.unverifiedFilters.join(", ").toLowerCase()} filter unavailable
          </span>
        )}
        <span className="count">
          {visible.length} {game.terms.items}
        </span>
      </div>

      <ul className="grid">
        {visible.map(({ id, availability }) => {
          const item = byId.get(id);
          const image = item?.image ?? null;
          const isStaged = staged.has(id);
          const canPick = interactive && selectable.has(id);
          const asked = marks.get(id);
          const yours = projection.yourSuggestions[id];
          // A player who is not choosing can still tell their captain.
          const canSuggest = !interactive && suggesting !== undefined && availability.state === "available";
          const takenBy = availability.state === "taken" ? availability.by : [];
          const state =
            availability.state === "removed"
              ? "removed"
              : availability.state === "taken"
                ? `taken${takenBy[0] === undefined ? "" : ` ${slotOf(projection.teams, takenBy[0])}`}`
                : "available";
          return (
            <li key={id}>
              <button
                type="button"
                className={
                  `item ${state}${isStaged ? " staged" : ""}${image === null ? "" : " has-icon"}` +
                  (yours === undefined ? "" : ` marked-${effectOf(yours)}`)
                }
                disabled={!canPick && !canSuggest}
                onClick={() => (canPick ? onToggle(id) : onSuggest?.(id))}
                data-item={id}
                aria-pressed={isStaged}
              >
                {image !== null && (
                  // The name beside it does the naming, so the picture is left
                  // unlabelled. Anything without one reads perfectly well as a
                  // name alone.
                  <img className="item-icon" src={image} alt="" loading="lazy" width={28} height={28} />
                )}
                <span className="item-name">{item?.name ?? id}</span>
                {asked !== undefined && asked.total > 0 && (
                  <span
                    className="asks"
                    title={Object.entries(asked.by)
                      .map(([action, names]) => `${actionOf(projection.actions, action)?.label ?? action}: ${names.join(", ")}`)
                      .join(" · ")}
                  >
                    {Object.entries(asked.by).map(([action, names]) => (
                      <em key={action} className={`ask ${effectOf(action)}`}>
                        {names.length}
                      </em>
                    ))}
                  </span>
                )}
                {availability.state === "removed" && (
                  <span className="tag">{actionOf(projection.actions, availability.action)?.past ?? "gone"}</span>
                )}
                {availability.state === "taken" && (
                  <span className="tag">
                    {takenBy.length > 0
                      ? takenBy.join("+")
                      : (actionOf(projection.actions, availability.action)?.past ?? "taken")}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
