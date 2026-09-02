import type { JSX } from "react";
import { useEffect, useState } from "react";
import type { Team } from "../../src/types.js";
import type { Hero } from "../../src/types.js";
import { HeroGrid } from "./HeroGrid.js";
import { clock, describeTurn, verbFor } from "./format.js";
import { useNow, useRoom } from "./useRoom.js";

interface Props {
  readonly roomId: string;
  readonly token: string;
}

interface HeroFile {
  readonly verified: boolean;
  readonly heroes: readonly Hero[];
}

export function DraftRoom({ roomId, token }: Props): JSX.Element {
  const room = useRoom(roomId, token);
  const [heroData, setHeroData] = useState<HeroFile | null>(null);

  useEffect(() => {
    void fetch("/api/heroes")
      .then((response) => response.json() as Promise<HeroFile>)
      .then(setHeroData)
      .catch(() => setHeroData({ verified: false, heroes: [] }));
  }, []);

  const projection = room.projection;
  const running = room.phase === "drafting";
  const now = useNow(running) + room.skewMs;

  if (projection === null || heroData === null) {
    return (
      <main className="loading">
        <p>{room.link === "offline" ? "Reconnecting…" : "Joining the room…"}</p>
      </main>
    );
  }

  const viewer = room.viewer;
  const turn = projection.turn;
  const myTurn = viewer?.role === "captain" && turn !== null && turn.team === viewer.team && running;
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
          <span className="room-id">Room {roomId}</span>
          <span className={`badge ${viewer?.role ?? ""}`}>
            {viewer === null ? "…" : viewer.role === "captain" ? `Captain ${viewer.team}` : "Spectator"}
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
        <p className="banner">Waiting for both captains to connect. The clock is not running.</p>
      )}
      {room.phase === "complete" && <p className="banner done">Draft complete.</p>}

      {running && turn !== null && (
        <div className={`turn ${myTurn ? "mine" : ""}`}>
          <span className="turn-label">{describeTurn(turn)}</span>
          <span className="progress">
            turn {projection.turnIndex + 1} of {projection.script.length}
          </span>
          <span className={`clock ${onBank ? "bank" : ""} ${remaining <= 5_000 ? "urgent" : ""}`}>
            {clock(remaining)}
          </span>
          <span className="bank-note">
            {onBank ? "reserve" : `+${clock(projection.clock?.bank[turn.team] ?? 0)} reserve`}
          </span>
        </div>
      )}

      <div className="board">
        <TeamColumn team="A" projection={projection} name={name} />
        <div className="middle">
          <HeroGrid
            heroes={heroData.heroes}
            rolesVerified={heroData.verified}
            projection={projection}
            interactive={myTurn}
            onToggle={(heroId) => room.send({ t: "stage", heroId })}
          />
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

interface ColumnProps {
  readonly team: Team;
  readonly projection: NonNullable<ReturnType<typeof useRoom>["projection"]>;
  readonly name: (id: string) => string;
}

function TeamColumn({ team, projection, name }: ColumnProps): JSX.Element {
  const active = projection.turn?.team === team;
  const slots = projection.script
    .filter((turn) => turn.team === team && turn.action === "pick")
    .reduce((total, turn) => total + turn.count, 0);
  const picks = projection.picks[team];

  // A hero the clock chose must never look like one a captain chose: the
  // handoff asks for auto-actions to be visible so nobody can argue them.
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
