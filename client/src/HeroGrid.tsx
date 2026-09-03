import type { JSX } from "react";
import { useMemo, useState } from "react";
import type { Hero } from "../../src/types.js";
import type { DraftProjection } from "../../src/projection.js";

interface Props {
  readonly heroes: readonly Hero[];
  readonly rolesVerified: boolean;
  readonly projection: DraftProjection;
  /** True when this viewer is the one choosing for their side right now. */
  readonly interactive: boolean;
  readonly onToggle: (heroId: string) => void;
  /** Set for a player who is not choosing: tapping a hero tells their captain. */
  readonly suggesting?: "want" | "ban" | undefined;
  readonly onSuggest?: ((heroId: string) => void) | undefined;
}

/**
 * The wall of heroes a captain chooses from, with a search box and a role
 * filter for finding one among nearly sixty.
 *
 * Heroes that are banned or already taken are shown struck through or greyed
 * rather than removed, so both captains can see at a glance what has gone.
 */
export function HeroGrid({
  heroes,
  rolesVerified,
  projection,
  interactive,
  onToggle,
  suggesting,
  onSuggest,
}: Props): JSX.Element {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");

  const byId = useMemo(() => new Map(heroes.map((hero) => [hero.id, hero])), [heroes]);
  const staged = new Set(projection.staged ?? []);
  const selectable = new Set(projection.selectable);
  // What this side has asked for, so a captain can see it on the tiles.
  const marks = new Map(projection.suggestions.map((entry) => [entry.heroId, entry]));

  const roles = useMemo(() => {
    const found = new Set<string>();
    for (const hero of heroes) for (const r of hero.roles) found.add(r);
    return [...found].sort();
  }, [heroes]);

  // Named apart from the `availability` each tile destructures below.
  const availabilityOf = (heroId: string): string =>
    projection.heroes.find((hero) => hero.id === heroId)?.availability.state ?? "available";

  const query = search.trim().toLowerCase();
  const visible = projection.heroes.filter(({ id }) => {
    const hero = byId.get(id);
    if (hero === undefined) return false;
    if (query !== "" && !hero.name.toLowerCase().includes(query)) return false;
    if (role !== "all" && !hero.roles.includes(role)) return false;
    return true;
  });

  return (
    <section className="pool">
      <div className="pool-filters">
        <input
          type="search"
          placeholder="Search heroes"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search heroes"
        />
        {rolesVerified ? (
          <select value={role} onChange={(event) => setRole(event.target.value)} aria-label="Filter by role">
            <option value="all">All roles</option>
            {roles.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          // No role filter until the roles are known to be right: one that
          // hides the hero somebody was looking for is worse than none.
          <span className="note" title="Hero roles have not been verified yet">
            role filter unavailable
          </span>
        )}
        <span className="count">{visible.length} heroes</span>
      </div>

      <ul className="grid">
        {visible.map(({ id, availability }) => {
          const hero = byId.get(id)!;
          const isStaged = staged.has(id);
          const canPick = interactive && selectable.has(id);
          const asked = marks.get(id);
          const yours = projection.yourSuggestions[id];
          // A player who is not choosing can still tell their captain.
          const canSuggest = !interactive && suggesting !== undefined && availabilityOf(id) === "available";
          const state =
            availability.state === "banned"
              ? "banned"
              : availability.state === "picked"
                ? `picked-${availability.by}`
                : "available";
          return (
            <li key={id}>
              <button
                type="button"
                className={
                  `hero ${state}${isStaged ? " staged" : ""}${hero.image === null ? "" : " has-icon"}` +
                  (yours === undefined ? "" : ` marked-${yours}`)
                }
                disabled={!canPick && !canSuggest}
                onClick={() => (canPick ? onToggle(id) : onSuggest?.(id))}
                data-hero={id}
                aria-pressed={isStaged}
              >
                {hero.image !== null && (
                  // The name beside it does the naming, so the portrait is left
                  // unlabelled. There are no portraits until a roster with them
                  // is imported, and a hero reads perfectly well without one.
                  <img className="hero-icon" src={hero.image} alt="" loading="lazy" width={28} height={28} />
                )}
                <span className="hero-name">{hero.name}</span>
                {asked !== undefined && (asked.want.length > 0 || asked.ban.length > 0) && (
                  <span
                    className="asks"
                    title={[
                      asked.want.length > 0 ? `wants: ${asked.want.join(", ")}` : "",
                      asked.ban.length > 0 ? `ban: ${asked.ban.join(", ")}` : "",
                    ]
                      .filter((line) => line !== "")
                      .join(" · ")}
                  >
                    {asked.want.length > 0 && <em className="ask want">{asked.want.length}</em>}
                    {asked.ban.length > 0 && <em className="ask ban">{asked.ban.length}</em>}
                  </span>
                )}
                {availability.state === "banned" && <span className="tag">banned</span>}
                {availability.state === "picked" && <span className="tag">{availability.by.join("+")}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
