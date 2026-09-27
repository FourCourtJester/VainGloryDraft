import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import type { DraftProjection } from "../../src/projection.js";
import type { ActionId, Team } from "../../src/types.js";
import { DraftHistory } from "./DraftHistory.js";
import { JoinRoom } from "./JoinRoom.js";
import { Lobby } from "./Lobby.js";
import { PoolGrid } from "./PoolGrid.js";
import { actionOf, clock, describeTurn, slotOf, tally, teamName, verbFor } from "./format.js";
import { useGame } from "./game.js";
import { useNow, useRoom } from "./useRoom.js";

interface Props {
  readonly roomId: string;
  readonly credential: string;
  /** What this player's teammates should see. Absent for spectators. */
  readonly name?: string | undefined;
  /** Hands a freshly typed code back up, after the last one was turned away. */
  readonly onRejoin?: ((code: string, name: string) => void) | undefined;
}

/**
 * The draft itself: the clock, every team's choices, the pool, and the confirm
 * button.
 *
 * This screen decides nothing about the draft. What can be clicked, whose turn
 * it is, what the teams and actions are called and how much time is left are
 * all told to it by the room, so there is no second copy of the rules here to
 * fall out of step. The game's catalog only supplies names and pictures.
 */
export function DraftRoom({ roomId, credential, name: playerName, onRejoin }: Props): JSX.Element {
  const room = useRoom(roomId, credential, playerName);
  const projection = room.projection;
  const game = useGame(projection?.game ?? null);
  // Which action a teammate is suggesting to their captain.
  const [suggesting, setSuggesting] = useState<ActionId | null>(null);

  const running = room.phase === "drafting";
  const now = useNow(running) + room.skewMs;

  if (room.refused !== null) {
    return <JoinRoom roomId={roomId} onJoin={(code, who) => onRejoin?.(code, who)} refused={room.refused} />;
  }

  if (projection === null || game === null) {
    return (
      <main className="loading">
        <p>{room.link === "offline" ? "Reconnecting…" : "Joining the room…"}</p>
      </main>
    );
  }

  const { teams, actions } = projection;
  const viewer = room.viewer;
  const turn = projection.turn;
  const yourTeam = viewer?.role === "player" ? viewer.team : null;
  const onThisTurn = yourTeam !== null && turn !== null && turn.teams.includes(yourTeam);
  const youLocked = yourTeam !== null && projection.locked.includes(yourTeam);
  // Only the person leading a side the turn is still waiting on may choose.
  const myTurn = running && projection.leading && onThisTurn && !youLocked;
  const itemsById = new Map(game.items.map((item) => [item.id, item]));
  const name = (id: string): string => itemsById.get(id)?.name ?? id;
  const portrait = (id: string): string | null => itemsById.get(id)?.image ?? null;
  const mode = suggesting ?? actions.find((action) => action.effect === "take")?.id ?? actions[0]?.id ?? "";

  // Whose clock to show: your own if you are choosing, otherwise whoever runs
  // out first.
  const deadlines = projection.clock?.deadlines ?? {};
  const clockTeam: Team | null =
    yourTeam !== null && deadlines[yourTeam] !== undefined
      ? yourTeam
      : (Object.entries(deadlines).sort(([, a], [, b]) => a - b)[0]?.[0] ?? null);
  const expiresAt = clockTeam === null ? null : (deadlines[clockTeam] ?? null);
  const remaining = expiresAt === null ? 0 : expiresAt - now;
  const turnRemaining =
    projection.clock === null ? 0 : projection.clock.turnStartedAt + projection.clock.allowanceMs - now;
  const onBank = turnRemaining <= 0 && remaining > 0;
  const bank = clockTeam === null ? 0 : (projection.clock?.bank[clockTeam] ?? 0);

  // The colour of whoever acts: you, on a turn you are playing; otherwise the
  // one team on the clock, if there is only one.
  const acting = onThisTurn ? yourTeam : turn?.teams.length === 1 ? turn.teams[0]! : null;
  const turnSlot = turn === null ? "" : turn.teams.length === 1 ? slotOf(teams, turn.teams[0]!) : "blind";

  const half = Math.ceil(teams.length / 2);

  return (
    <div className={`room${acting === null ? "" : ` act-${slotOf(teams, acting).slice(1)}`}`}>
      <header>
        <div className="identity">
          <img className="mark" src="/logo.svg" alt="Vainglory Draft" width={26} height={26} />
          <span className="room-id">
            {game.name} · Room {roomId}
          </span>
          <span className={`badge ${viewer?.role ?? ""}`}>
            {viewer === null
              ? "…"
              : viewer.role === "spectator"
                ? "Spectator"
                : `${teamName(teams, viewer.team)}${projection.leading ? " · choosing" : ""}`}
          </span>
        </div>
        <div className="link-state">
          {teams.map((team) => (
            <span
              key={team.id}
              className={`presence ${slotOf(teams, team.id)} ${projection.presence[team.id] ?? "disconnected"}`}
              title={`${team.name}'s captain is ${projection.presence[team.id] ?? "disconnected"}`}
            >
              {team.id}
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
      {projection.record !== null && (
        <DraftHistory record={projection.record} teams={teams} actions={actions} name={name} />
      )}

      {running && turn !== null && (
        <div className={`turn ${turnSlot}${myTurn ? " mine" : ""}`}>
          <span className="turn-label">{describeTurn(turn, teams, actions)}</span>
          <span className="progress">
            turn {projection.turnIndex + 1} of {projection.script.length}
            {turn.teams.length > 1 && " · blind"}
          </span>
          <span className={`clock ${onBank ? "bank" : ""} ${remaining <= 5_000 ? "urgent" : ""}`}>
            {clock(remaining)}
          </span>
          {bank > 0 && <span className="bank-note">{onBank ? "reserve" : `+${clock(bank)} reserve`}</span>}
          {turn.teams.length > 1 && (
            // Who has locked in, and never what: that waits for the reveal.
            <span className="locks">
              {turn.teams.map((team) => (
                <span
                  key={team}
                  className={`lock ${slotOf(teams, team)}${projection.locked.includes(team) ? " done" : ""}`}
                >
                  {team} {projection.locked.includes(team) ? "locked" : "choosing"}
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      {(running || room.phase === "complete") && <OrderRail projection={projection} name={name} />}

      {running && viewer?.role === "player" && (
        <TeamStrip
          projection={projection}
          onHandOver={(memberId) => room.send({ t: "handOver", memberId })}
          onClaimLead={() => room.send({ t: "claimLead" })}
        />
      )}

      <div className="board">
        <div className="flank">
          {teams.slice(0, half).map((team) => (
            <TeamColumn key={team.id} team={team.id} projection={projection} name={name} portrait={portrait} />
          ))}
        </div>
        <div className="middle">
          {/* A player who is not choosing can still say what they want. Plenty
              of teams are not in voice chat, so this is the only way the
              captain hears from them at all. */}
          {running && viewer?.role === "player" && !myTurn && (
            <div className="suggest-bar">
              <span className="note">Tell your captain</span>
              {actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className={`mode ${action.effect}${mode === action.id ? " on" : ""}`}
                  onClick={() => setSuggesting(action.id)}
                >
                  {action.label} this
                </button>
              ))}
              <span className="note">then tap {game.terms.items} below</span>
            </div>
          )}

          <PoolGrid
            game={game}
            projection={projection}
            interactive={myTurn}
            onToggle={(itemId) => room.send({ t: "stage", itemId })}
            suggesting={running && viewer?.role === "player" && !myTurn ? mode : undefined}
            onSuggest={(itemId) => room.send({ t: "suggest", itemId, intent: mode })}
          />
          {/* What the side has asked for, in the order most of them agree on —
              which is what a captain actually reads with a clock running. */}
          {running && projection.suggestions.length > 0 && (
            <div className="asked-for">
              <span className="note">{myTurn ? "Your side wants" : "Your side has asked for"}</span>
              {projection.suggestions.slice(0, 6).map((entry) => (
                <span key={entry.itemId} className="asked" title={Object.values(entry.by).flat().join(", ")}>
                  {name(entry.itemId)}
                  {Object.entries(entry.by).map(([action, names]) => (
                    <em key={action} className={`ask ${actionOf(actions, action)?.effect ?? "take"}`}>
                      {names.length}
                    </em>
                  ))}
                </span>
              ))}
            </div>
          )}

          {myTurn && turn !== null && (
            <div className="confirm-bar">
              <span className="staged">
                {(projection.staged ?? []).map(name).join(" + ") || `Choose ${turn.count}`}
                <span className="slots">
                  {yourTeam === null ? 0 : (projection.stagedCount[yourTeam] ?? 0)}/{turn.count}
                </span>
              </span>
              <button
                type="button"
                className="confirm"
                disabled={(yourTeam === null ? 0 : (projection.stagedCount[yourTeam] ?? 0)) !== turn.count}
                onClick={() => room.send({ t: "confirm" })}
              >
                Confirm {verbFor(turn, actions).toLowerCase()}
              </button>
            </div>
          )}
          {running && youLocked && projection.yourLock !== null && turn !== null && (
            // Locked in on a blind turn: yours to see, and nobody else's yet.
            <div className="confirm-bar watching">
              <span className="staged">
                Locked in: {projection.yourLock.map(name).join(" + ")}
                <span className="slots">
                  waiting on {turn.teams.filter((team) => !projection.locked.includes(team)).join(", ")}
                </span>
              </span>
            </div>
          )}
          {!myTurn && !youLocked && projection.staged !== null && projection.staged.length > 0 && (
            <div className="confirm-bar watching">
              <span className="staged">Staging: {projection.staged.map(name).join(" + ")}</span>
            </div>
          )}
        </div>
        <div className="flank">
          {teams.slice(half).map((team) => (
            <TeamColumn key={team.id} team={team.id} projection={projection} name={name} portrait={portrait} />
          ))}
        </div>
      </div>

      <footer className="room-footer">
        <span className="wordmark">
          <img src="/logo.svg" alt="" width={22} height={22} />
          Vainglory Draft
          <span className="sep">/</span>
          <span className="vgd">VGD</span>
        </span>
        <span className="format">
          {projection.script.length} turns
          {actions.map((action) => (
            <span key={action.id}> &middot; {tally(totalOf(projection.script, action.id), action)}</span>
          ))}
        </span>
      </footer>

      {room.error !== null && (
        <button type="button" className="toast" onClick={room.dismissError}>
          {room.error.message}
        </button>
      )}
    </div>
  );
}

/** How many things a whole draft chooses with one action, across every team. */
function totalOf(script: DraftProjection["script"], action: ActionId): number {
  return script.reduce(
    (total, turn) => (turn.action === action ? total + turn.count * Math.max(1, turn.teams.length) : total),
    0,
  );
}

/**
 * Every turn of the draft in one strip, left to right.
 *
 * What has been taken, what is being decided now, and what is still to come.
 * It answers the question a captain asks constantly with a clock running —
 * "what do they get next?" — without anybody having to hold the order in their
 * head, and it is the same strip a finished draft is read back from.
 */
function OrderRail({
  projection,
  name,
}: {
  readonly projection: DraftProjection;
  readonly name: (id: string) => string;
}): JSX.Element {
  const active = useRef<HTMLLIElement | null>(null);

  // On a phone the rail is wider than the screen, so the turn on the clock is
  // brought into view rather than left somewhere off to the right.
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [projection.turnIndex]);

  return (
    <div className="rail-wrap">
      <ol className="rail">
        {projection.script.map((turn, index) => {
          const taken = projection.committed.filter((selection) => selection.index === index);
          const state = taken.length > 0 ? "done" : index === projection.turnIndex ? "now" : "pending";
          const slot =
            turn.teams.length === 0 ? "" : turn.teams.length === 1 ? slotOf(projection.teams, turn.teams[0]!) : "blind";
          const who = turn.teams.length === 0 ? "rest" : turn.teams.join("+");
          const label = actionOf(projection.actions, turn.action)?.label ?? turn.action;
          return (
            <li key={index} className={`${slot} ${state}`} ref={state === "now" ? active : null}>
              <span className="slot-label">
                {who} {label}
                {turn.count > 1 && ` ×${turn.count}`}
              </span>
              <span className="slot-items">
                {taken.length === 0
                  ? state === "now"
                    ? "on the clock"
                    : "—"
                  : taken
                      .map((selection) =>
                        taken.length > 1 && selection.team !== null
                          ? `${selection.team}: ${selection.items.map(name).join(" + ")}`
                          : selection.items.map(name).join(" + "),
                      )
                      .join(" · ")}
                {taken.some((selection) => selection.auto && selection.team !== null) && (
                  <span className="auto">auto</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Your own squad, while the draft runs: who is here, and who is choosing. */
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
    <div className={`strip ${slotOf(projection.teams, you.team)}`}>
      <span className="note">Your side</span>
      {mates.map((member) => (
        <span key={member.id} className={`chip${member.connected ? "" : " away"}${member.leader ? " lead" : ""}`}>
          {member.name}
          {member.leader && " · choosing"}
          {you.leader && !member.leader && (
            <button type="button" className="hand-over" onClick={() => onHandOver(member.id)}>
              hand over
            </button>
          )}
        </span>
      ))}
      {leaderGone && !you.leader && (
        <button type="button" className="claim" onClick={onClaimLead}>
          Take over choosing
        </button>
      )}
    </div>
  );
}

interface ColumnProps {
  readonly team: Team;
  readonly projection: DraftProjection;
  readonly name: (id: string) => string;
  readonly portrait: (id: string) => string | null;
}

/**
 * One team's side of the board: what they have taken, in order, in the slots
 * the format gives them, and everything they have removed.
 */
function TeamColumn({ team, projection, name, portrait }: ColumnProps): JSX.Element {
  const { actions, script } = projection;
  const active = projection.turn?.teams.includes(team) === true;
  const chosen = projection.byTeam[team] ?? {};

  // Mark what the clock chose. Something nobody picked on purpose must never
  // look like something that was, or there is an argument waiting to happen.
  const auto = new Set(
    projection.committed
      .filter((selection) => selection.auto && selection.team === team)
      .flatMap((selection) => [...selection.items]),
  );
  const label = (id: string): JSX.Element => {
    const face = portrait(id);
    return (
      <>
        {face !== null && <img src={face} alt="" width={26} height={26} loading="lazy" />}
        {name(id)}
        {auto.has(id) && <span className="auto" title="Chosen by the timer, not the captain">auto</span>}
      </>
    );
  };

  const takes = actions.filter((action) => action.effect === "take");
  const removes = actions.filter((action) => action.effect === "remove");

  return (
    <section className={`team ${slotOf(projection.teams, team)}${active ? " active" : ""}`}>
      <h2>{teamName(projection.teams, team)}</h2>
      {takes.map((action) => {
        const slots = script
          .filter((turn) => turn.teams.includes(team) && turn.action === action.id)
          .reduce((total, turn) => total + turn.count, 0);
        if (slots === 0) return null;
        const picks = chosen[action.id] ?? [];
        return (
          <div key={action.id}>
            {takes.length > 1 && <h3>{action.past}</h3>}
            <ol className="picks">
              {Array.from({ length: slots }, (_, index) => (
                <li key={index} className={picks[index] === undefined ? "empty" : "filled"}>
                  {picks[index] === undefined ? "—" : label(picks[index]!)}
                </li>
              ))}
            </ol>
          </div>
        );
      })}
      {removes.map((action) => {
        const gone = chosen[action.id] ?? [];
        return (
          <div key={action.id}>
            <h3>{action.past}</h3>
            <ul className="bans">
              {gone.map((id) => (
                <li key={id}>{label(id)}</li>
              ))}
              {gone.length === 0 && <li className="empty">—</li>}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
