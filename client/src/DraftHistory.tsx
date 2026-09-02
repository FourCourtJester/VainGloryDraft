import type { JSX } from "react";
import type { DraftRecord } from "../../src/record.js";
import { duration } from "./format.js";

interface Props {
  readonly record: DraftRecord;
  readonly name: (heroId: string) => string;
}

/**
 * How the draft went, in the order it happened.
 *
 * A finished draft is kept, so this is what somebody sees when they open the
 * room again days later: every ban and pick in sequence, how long each side took
 * over it, and which heroes nobody actually chose because the clock ran out.
 */
export function DraftHistory({ record, name }: Props): JSX.Element {
  return (
    <section className="history">
      <div className="history-head">
        <h2>How the draft went</h2>
        {record.durationMs !== null && <span className="note">{duration(record.durationMs)} in total</span>}
        {(record.autoCounts.A > 0 || record.autoCounts.B > 0) && (
          <span className="note">
            chosen by the clock — A {record.autoCounts.A}, B {record.autoCounts.B}
          </span>
        )}
      </div>
      <ol className="history-list">
        {record.turns.map((turn) => (
          <li key={turn.number} className={`history-turn team-${turn.team}${turn.auto ? " was-auto" : ""}`}>
            <span className="history-number">{turn.number}</span>
            <span className="history-team">{turn.team}</span>
            <span className="history-action">{turn.action === "ban" ? "banned" : "picked"}</span>
            <span className="history-heroes">{turn.heroes.map(name).join(" + ")}</span>
            {turn.auto && <span className="auto">auto</span>}
            <span className="history-took">{turn.tookMs === null ? "" : duration(turn.tookMs)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
