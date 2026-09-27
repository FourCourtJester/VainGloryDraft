import type { JSX } from "react";
import type { DraftRecord } from "../../src/record.js";
import type { ActionDefinition, TeamDefinition } from "../../src/types.js";
import { actionOf, duration, slotOf, teamName } from "./format.js";

interface Props {
  readonly record: DraftRecord;
  readonly teams: readonly TeamDefinition[];
  readonly actions: readonly ActionDefinition[];
  readonly name: (itemId: string) => string;
}

/**
 * How the draft went, in the order it happened.
 *
 * A finished draft is kept, so this is what somebody sees when they open the
 * room again days later: every choice in sequence, how long each side took over
 * it, and what nobody actually chose because the clock ran out.
 */
export function DraftHistory({ record, teams, actions, name }: Props): JSX.Element {
  const lostToClock = Object.entries(record.autoCounts).filter(([, count]) => count > 0);
  return (
    <section className="history">
      <div className="history-head">
        <h2>How the draft went</h2>
        {record.durationMs !== null && <span className="note">{duration(record.durationMs)} in total</span>}
        {lostToClock.length > 0 && (
          <span className="note">
            chosen by the clock — {lostToClock.map(([team, count]) => `${team} ${count}`).join(", ")}
          </span>
        )}
      </div>
      <ol className="history-list">
        {record.turns.map((turn, index) => (
          <li
            key={index}
            className={`history-turn${turn.team === null ? "" : ` ${slotOf(teams, turn.team)}`}${turn.auto ? " was-auto" : ""}`}
          >
            <span className="history-number">{turn.number}</span>
            <span className="history-team">{turn.team === null ? "Remaining" : teamName(teams, turn.team)}</span>
            <span className="history-action">{actionOf(actions, turn.action)?.past ?? turn.action}</span>
            <span className="history-items">{turn.items.map(name).join(" + ")}</span>
            {turn.auto && turn.team !== null && <span className="auto">auto</span>}
            <span className="history-took">{turn.tookMs === null ? "" : duration(turn.tookMs)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
