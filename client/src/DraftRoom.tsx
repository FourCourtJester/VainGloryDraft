import type { JSX } from "react";
import { useEffect, useState } from "react";
import type { DraftProjection } from "../../src/projection.js";
import type { Hero, Team } from "../../src/types.js";
import { DraftHistory } from "./DraftHistory.js";
import { HeroGrid } from "./HeroGrid.js";
import { JoinRoom } from "./JoinRoom.js";
import { Lobby } from "./Lobby.js";
import { clock, describeTurn, verbFor } from "./format.js";
import { useNow, useRoom } from "./useRoom.js";

interface Props {
  readonly roomId: string;
  readonly credential: string;
  /** What this player's teammates should see. Absent for spectators. */
  readonly name?: string | undefined;
  /** Hands a freshly typed code back up, after the last one was turned away. */
  readonly onRejoin?: ((code: string, name: string) => void) | undefined;
}

interface HeroFile {
  readonly verified: boolean;
  readonly heroes: readonly Hero[];
}

/**
 * The draft itself: the clock, both teams' picks and bans, the hero pool, and
 * the confirm button.
 *
 * This screen decides nothing about the draft. Which heroes can be clicked,
 * whose turn it is and how much time is left are all told to it by the room, so
 * there is no second copy of the rules here to fall out of step.
 */
export function DraftRoom({ roomId, credential, name: playerName, onRejoin }: Props): JSX.Element {
  const room = useRoom(roomId, credential, playerName);
  const [heroData, setHeroData] = useState<HeroFile | null>(null);
  // Which way a teammate is marking heroes for their captain.
  const [suggesting, setSuggesting] = useState<"want" | "ban">("want");

  useEffect(() => {
    void fetch("/api/heroes")
      .then((response) => response.json() as Promise<HeroFile>)
      .then(setHeroData)
      .catch(() => setHeroData({ verified: false, heroes: [] }));
  }, []);

  const projection = room.projection;
  const running = room.phase === "drafting";
  const now = useNow(running) + room.skewMs;

  if (room.refused !== null) {
    return <JoinRoom roomId={roomId} onJoin={(code, who) => onRejoin?.(code, who)} refused={room.refused} />;
  }

  if (projection === null || heroData === null) {
    return (
      <main className="loading">
        <p>{room.link === "offline" ? "Reconnecting…" : "Joining the room…"}</p>
      </main>
    );
  }

  const viewer = room.viewer;
  const turn = projection.turn;
  // Only the person leading the side on the clock may actually choose.
  const myTurn = projection.leading && turn !== null && viewer?.role === "player" && turn.team === viewer.team && running;
  const heroesById = new Map(heroData.heroes.map((hero) => [hero.id, hero]));
  const name = (id: string): string => heroesById.get(id)?.name ?? id;

  const remaining = projection.clock === null ? 0 : projection.clock.expiresAt - now;
  const turnRemaining =
    projection.clock === null ? 0 : projection.clock.turnStartedAt + projection.clock.perTurnMs - now;
  const onBank = turnRemaining <= 0 && remaining > 0;

  return (
    <div className="room">
      <header>
        <div className="identity">
          <img className="mark" src="/logo.svg" alt="Vainglory Draft" width={26} height={26} />
          <span className="room-id">Room {roomId}</span>
          <span className={`badge ${viewer?.role ?? ""}`}>
            {viewer === null
              ? "…"
              : viewer.role === "spectator"
                ? "Spectator"
                : `Team ${viewer.team}${projection.leading ? " · picking" : ""}`}
          </span>
        </div>
        <div className="link-state">
          {(["A", "B"] as const).map((team) => (
            <span key={team} className={`presence ${projection.presence[team]}`} title={`Captain ${team} is ${projection.presence[team]}`}>
              {team}
            </span>
          ))}
          <span className={`socket ${room.link}`}>{room.link}</span>
        </div>
      </header>

      {room.phase === "lobby" && (
        <Lobby
          projection={projection}
          onReady={(ready) => room.send({ t: "ready", ready })}
          onHandOver={(memberId) => room.send({ t: "handOver", memberId })}
          onClaimLead={() => room.send({ t: "claimLead" })}
          onStartAnyway={(agreed) => room.send({ t: "startAnyway", agreed })}
        />
      )}
      {room.phase === "complete" && <p className="banner done">Draft complete.</p>}
      {projection.record !== null && <DraftHistory record={projection.record} name={name} />}

      {running && turn !== null && (
        <div className={`turn ${myTurn ? "mine" : ""}`}>
          <span className="turn-label">{describeTurn(turn)}</span>
          <span className="progress">
            turn {projection.turnIndex + 1} of {projection.script.length}
          </span>
          <span className={`clock ${onBank ? "bank" : ""} ${remaining <= 5_000 ? "urgent" : ""}`}>
            {clock(remaining)}
          </span>
          {(projection.clock?.bank[turn.team] ?? 0) > 0 && (
            <span className="bank-note">
              {onBank ? "reserve" : `+${clock(projection.clock?.bank[turn.team] ?? 0)} reserve`}
            </span>
          )}
        </div>
      )}

      {running && viewer?.role === "player" && (
        <TeamStrip
          projection={projection}
          onHandOver={(memberId) => room.send({ t: "handOver", memberId })}
          onClaimLead={() => room.send({ t: "claimLead" })}
        />
      )}

      <div className="board">
        <TeamColumn team="A" projection={projection} name={name} />
        <div className="middle">
          {/* A player who is not choosing can still say what they want. Most of
              these teams are not in voice chat, so this is the only way the
              captain hears from them at all. */}
          {running && viewer?.role === "player" && !myTurn && (
            <div className="suggest-bar">
              <span className="note">Tell your captain</span>
              <button
                type="button"
                className={suggesting === "want" ? "mode want on" : "mode want"}
                onClick={() => setSuggesting("want")}
              >
                I want to play
              </button>
              <button
                type="button"
                className={suggesting === "ban" ? "mode ban on" : "mode ban"}
                onClick={() => setSuggesting("ban")}
              >
                Ban this
              </button>
              <span className="note">then tap heroes below</span>
            </div>
          )}

          <HeroGrid
            heroes={heroData.heroes}
            rolesVerified={heroData.verified}
            projection={projection}
            interactive={myTurn}
            onToggle={(heroId) => room.send({ t: "stage", heroId })}
            suggesting={running && viewer?.role === "player" && !myTurn ? suggesting : undefined}
            onSuggest={(heroId) => room.send({ t: "suggest", heroId, intent: suggesting })}
          />
          {/* What the side has asked for, in the order most of them agree on —
              which is what a captain actually reads with a clock running. */}
          {running && projection.suggestions.length > 0 && (
            <div className="asked-for">
              <span className="note">{myTurn ? "Your side wants" : "Your side has asked for"}</span>
              {projection.suggestions.slice(0, 6).map((entry) => (
                <span key={entry.heroId} className="asked" title={[...entry.want, ...entry.ban].join(", ")}>
                  {name(entry.heroId)}
                  {entry.want.length > 0 && <em className="ask want">{entry.want.length}</em>}
                  {entry.ban.length > 0 && <em className="ask ban">{entry.ban.length}</em>}
                </span>
              ))}
            </div>
          )}

          {myTurn && turn !== null && (
            <div className="confirm-bar">
              <span className="staged">
                {(projection.staged ?? []).map(name).join(" + ") || `Choose ${turn.count}`}
                <span className="slots">
                  {projection.stagedCount}/{turn.count}
                </span>
              </span>
              <button
                type="button"
                className="confirm"
                disabled={projection.stagedCount !== turn.count}
                onClick={() => room.send({ t: "confirm" })}
              >
                Confirm {verbFor(turn).toLowerCase()}
              </button>
            </div>
          )}
          {!myTurn && projection.staged !== null && projection.staged.length > 0 && (
            <div className="confirm-bar watching">
              <span className="staged">Staging: {projection.staged.map(name).join(" + ")}</span>
            </div>
          )}
        </div>
        <TeamColumn team="B" projection={projection} name={name} />
      </div>

      {room.error !== null && (
        <button type="button" className="toast" onClick={room.dismissError}>
          {room.error.message}
        </button>
      )}
    </div>
  );
}

/** Your own squad, while the draft runs: who is here, and who is picking. */
function TeamStrip({
  projection,
  onHandOver,
  onClaimLead,
}: {
  readonly projection: DraftProjection;
  readonly onHandOver: (memberId: string) => void;
  readonly onClaimLead: () => void;
}): JSX.Element | null {
  const you = projection.lobby.members.find((member) => member.you);
  if (you === undefined) return null;
  const mates = projection.lobby.members.filter((member) => member.team === you.team);
  const leaderGone = mates.some((member) => member.leader && !member.connected);

  return (
    <div className={`strip team-${you.team}`}>
      <span className="note">Your side</span>
      {mates.map((member) => (
        <span key={member.id} className={`chip${member.connected ? "" : " away"}${member.leader ? " lead" : ""}`}>
          {member.name}
          {member.leader && " · picking"}
          {you.leader && !member.leader && (
            <button type="button" className="hand-over" onClick={() => onHandOver(member.id)}>
              hand over
            </button>
          )}
        </span>
      ))}
      {leaderGone && !you.leader && (
        <button type="button" className="claim" onClick={onClaimLead}>
          Take over picking
        </button>
      )}
    </div>
  );
}

interface ColumnProps {
  readonly team: Team;
  readonly projection: NonNullable<ReturnType<typeof useRoom>["projection"]>;
  readonly name: (id: string) => string;
}

/** One team's side of the board: their picks, in order, and their bans. */
function TeamColumn({ team, projection, name }: ColumnProps): JSX.Element {
  const active = projection.turn?.team === team;
  const slots = projection.script
    .filter((turn) => turn.team === team && turn.action === "pick")
    .reduce((total, turn) => total + turn.count, 0);
  const picks = projection.picks[team];

  // Mark heroes the clock chose. A hero nobody picked on purpose must never
  // look like one that was, or there is an argument waiting to happen.
  const auto = new Set(projection.committed.filter((entry) => entry.auto).flatMap((entry) => [...entry.heroes]));
  const label = (id: string): JSX.Element => (
    <>
      {name(id)}
      {auto.has(id) && <span className="auto" title="Chosen by the timer, not the captain">auto</span>}
    </>
  );

  return (
    <section className={`team team-${team}${active ? " active" : ""}`}>
      <h2>Team {team}</h2>
      <ol className="picks">
        {Array.from({ length: slots }, (_, index) => (
          <li key={index} className={picks[index] === undefined ? "empty" : "filled"}>
            {picks[index] === undefined ? "—" : label(picks[index]!)}
          </li>
        ))}
      </ol>
      <h3>Bans</h3>
      <ul className="bans">
        {projection.bans[team].map((id) => (
          <li key={id}>{label(id)}</li>
        ))}
        {projection.bans[team].length === 0 && <li className="empty">—</li>}
      </ul>
    </section>
  );
}
