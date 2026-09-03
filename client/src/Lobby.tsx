import type { JSX } from "react";
import type { DraftProjection } from "../../src/projection.js";
import type { Team } from "../../src/types.js";

interface Props {
  readonly projection: DraftProjection;
  readonly onReady: (ready: boolean) => void;
  readonly onHandOver: (memberId: string) => void;
  readonly onClaimLead: () => void;
}

/**
 * The room before the draft: both squads arriving, saying they are ready, and
 * settling who is going to do the picking.
 *
 * Nothing here costs anybody time. The clock does not start until the last
 * person has said they are ready, so a team still finding their headsets is not
 * being punished for it.
 */
export function Lobby({ projection, onReady, onHandOver, onClaimLead }: Props): JSX.Element {
  const { lobby } = projection;
  const you = lobby.members.find((member) => member.you);
  const waitingFor = lobby.members.filter((member) => !member.ready).length;

  return (
    <section className="lobby">
      <div className="lobby-head">
        <h2>{lobby.everyoneHere ? "Ready check" : "Waiting for players"}</h2>
        <span className="note">
          {lobby.everyoneHere
            ? `${waitingFor} still to confirm`
            : `${lobby.members.length} of ${lobby.teamSize * 2} here`}
        </span>
      </div>

      <div className="squads">
        {(["A", "B"] as const).map((team) => (
          <Squad
            key={team}
            team={team}
            projection={projection}
            you={you}
            onHandOver={onHandOver}
            onClaimLead={onClaimLead}
          />
        ))}
      </div>

      {you !== undefined && (
        <div className="ready-bar">
          <button
            type="button"
            className={you.ready ? "confirm ready-off" : "confirm"}
            onClick={() => onReady(!you.ready)}
          >
            {you.ready ? "Not ready" : "I'm ready"}
          </button>
          <span className="note">
            {lobby.everyoneReady ? "Starting…" : "The draft begins when everyone has confirmed."}
          </span>
        </div>
      )}
    </section>
  );
}

interface SquadProps {
  readonly team: Team;
  readonly projection: DraftProjection;
  readonly you: DraftProjection["lobby"]["members"][number] | undefined;
  readonly onHandOver: (memberId: string) => void;
  readonly onClaimLead: () => void;
}

function Squad({ team, projection, you, onHandOver, onClaimLead }: SquadProps): JSX.Element {
  const { lobby } = projection;
  const members = lobby.members.filter((member) => member.team === team);
  const empty = Math.max(0, lobby.teamSize - members.length);
  const yourSide = you?.team === team;
  const leaderGone = members.some((member) => member.leader && !member.connected);

  return (
    <section className={`squad team-${team}`}>
      <h3>Team {team}</h3>
      <ul>
        {members.map((member) => (
          <li key={member.id} className={member.connected ? "" : "away"}>
            <span className={`dot ${member.ready ? "ready" : ""}`} aria-hidden="true" />
            <span className="who">
              {member.name}
              {member.you && <em> (you)</em>}
            </span>
            {member.leader && <span className="tag lead">picks</span>}
            {/* Only the person currently picking can pass the job on. */}
            {you?.leader === true && yourSide && !member.leader && (
              <button type="button" className="hand-over" onClick={() => onHandOver(member.id)}>
                hand over
              </button>
            )}
          </li>
        ))}
        {Array.from({ length: empty }, (_, index) => (
          <li key={`empty-${index}`} className="empty">
            waiting…
          </li>
        ))}
      </ul>
      {yourSide && leaderGone && you?.leader !== true && (
        <button type="button" className="claim" onClick={onClaimLead}>
          Take over picking
        </button>
      )}
    </section>
  );
}
