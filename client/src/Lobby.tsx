import type { JSX } from "react";
import type { DraftProjection } from "../../src/projection.js";
import type { Team } from "../../src/types.js";
import { slotOf, teamName } from "./format.js";

interface Props {
  readonly projection: DraftProjection;
  readonly onReady: (ready: boolean) => void;
  readonly onHandOver: (memberId: string) => void;
  readonly onClaimLead: () => void;
  readonly onStartAnyway: (agreed: boolean) => void;
}

/**
 * The room before the draft: the captains — or whole squads, if the room asked
 * for them — arriving, saying they are ready, and settling who does the
 * choosing.
 *
 * Nothing here costs anybody time. The clock does not start until the last
 * person has said they are ready, so a team still finding their headsets is not
 * being punished for it.
 */
export function Lobby({ projection, onReady, onHandOver, onClaimLead, onStartAnyway }: Props): JSX.Element {
  const { lobby } = projection;
  const you = lobby.members.find((member) => member.you);
  const waitingFor = lobby.members.filter((member) => !member.ready).length;
  const agreed = lobby.startAnyway;
  const others = you === undefined ? [] : projection.teams.filter((team) => team.id !== you.team);
  const othersAgreed = others.length > 0 && others.every((team) => agreed[team.id] === true);
  const squads = lobby.joining === "squads";
  const expected = lobby.teamSize * projection.teams.length;
  const who = squads ? "players" : "captains";

  return (
    <section className="lobby">
      <div className="lobby-head">
        <h2>{lobby.everyoneHere && lobby.readyCheck ? "Ready check" : `Waiting for ${who}`}</h2>
        <span className="note">
          {lobby.everyoneHere && lobby.readyCheck
            ? `${waitingFor} still to confirm`
            : `${Math.min(lobby.members.length, expected)} of ${expected} here`}
        </span>
      </div>

      <div className="squads">
        {projection.teams.map((team) => (
          <Squad
            key={team.id}
            team={team.id}
            projection={projection}
            you={you}
            onHandOver={onHandOver}
            onClaimLead={onClaimLead}
          />
        ))}
      </div>

      {you !== undefined && lobby.readyCheck && (
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
      {!lobby.readyCheck && (
        <p className="note">The draft begins the moment the last of the {who} arrives.</p>
      )}

      {/* A no-show should not be able to cancel a match, so the leaders can
          agree to begin without a full room. It takes all of them, so no side
          can start on another. */}
      {squads && you?.leader === true && !lobby.everyoneHere && others.length > 0 && (
        <div className="start-anyway">
          <button
            type="button"
            className={agreed[you.team] === true ? "claim agreed" : "claim"}
            onClick={() => onStartAnyway(agreed[you.team] !== true)}
          >
            {agreed[you.team] === true ? "Waiting for the other side" : "Begin without a full room"}
          </button>
          <span className="note">
            {othersAgreed
              ? "Everybody else has agreed. Confirm and the draft begins."
              : "Every side's leader has to agree. Use this for a no-show."}
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
    <section className={`squad ${slotOf(projection.teams, team)}`}>
      <h3>{teamName(projection.teams, team)}</h3>
      <ul>
        {members.map((member) => (
          <li key={member.id} className={member.connected ? "" : "away"}>
            <span className={`dot ${member.ready ? "ready" : ""}`} aria-hidden="true" />
            <span className="who">
              {member.name}
              {member.you && <em> (you)</em>}
            </span>
            {member.leader && <span className="tag lead">chooses</span>}
            {/* Only the person currently choosing can pass the job on. */}
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
          Take over choosing
        </button>
      )}
    </section>
  );
}
