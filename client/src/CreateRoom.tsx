import type { JSX } from "react";
import { useEffect, useState } from "react";
import type { TeamDefinition } from "../../src/types.js";
import type { GameSummary } from "./game.js";

interface Created {
  readonly roomId: string;
  readonly teams: readonly TeamDefinition[];
  readonly format: string;
  readonly codes: Readonly<Record<string, string>>;
  readonly links: {
    readonly teams: Readonly<Record<string, string>>;
    readonly spectator: string;
    readonly join: string;
  };
}

/**
 * The screen an organiser starts from: choose a game, a format and the clock,
 * create the room, and get back a link for every team and one for spectators.
 *
 * A format can be one the game ships or one typed out here, so a tournament
 * trying a new order does not need anybody to change the app first.
 */
export function CreateRoom(): JSX.Element {
  const [games, setGames] = useState<readonly GameSummary[]>([]);
  const [gameId, setGameId] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [mirror, setMirror] = useState<boolean | null>(null);
  const [perTurnSeconds, setPerTurnSeconds] = useState<number | null>(null);
  const [bankSeconds, setBankSeconds] = useState<number | null>(null);
  // How many players a side waits for. Follows the format unless the organiser
  // says otherwise — a captains-only draft is one a side.
  const [teamSize, setTeamSize] = useState<number | null>(null);
  const [room, setRoom] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/games")
      .then((response) => response.json() as Promise<{ games: GameSummary[] }>)
      .then((data) => setGames(data.games))
      .catch(() => setError("Could not load the games."));
  }, []);

  const game = games.find((g) => g.id === gameId) ?? games[0];
  const preset = game?.presets.find((p) => p.id === (presetId ?? game.defaults.preset)) ?? game?.presets[0];
  // Everything below follows the game until the organiser changes it.
  const turnSeconds = perTurnSeconds ?? (game === undefined ? 30 : game.defaults.clock.perTurnMs / 1000);
  const reserveSeconds = bankSeconds ?? (game === undefined ? 60 : game.defaults.clock.bankMs / 1000);
  const mirrors = mirror ?? game?.defaults.mirror ?? false;
  const usingCustom = custom.trim() !== "";

  const chooseGame = (id: string): void => {
    setGameId(id);
    setPresetId(null);
    setPerTurnSeconds(null);
    setBankSeconds(null);
    setMirror(null);
    setTeamSize(null);
  };

  const create = async (): Promise<void> => {
    if (game === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          game: game.id,
          ...(usingCustom ? { script: custom } : { preset: preset?.id }),
          mirror: mirrors,
          perTurnMs: turnSeconds * 1000,
          bankMs: reserveSeconds * 1000,
          teamSize: teamSize ?? undefined,
        }),
      });
      const data = (await response.json()) as Created & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not create the room.");
      setRoom(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the room.");
    } finally {
      setBusy(false);
    }
  };

  if (room !== null) {
    return (
      <main className="create">
        <Brand />
        <h1>Room {room.roomId}</h1>
        <p className="note">
          Send each side its own link. Everyone on a team uses the same one; the first to arrive does the
          choosing and can hand that job to a teammate. The draft starts once every player is ready — until
          then the clock is not running.
        </p>
        <ul className="links">
          {room.teams.map((team) => (
            <LinkRow key={team.id} label={team.name} href={room.links.teams[team.id] ?? ""} code={room.codes[team.id]} />
          ))}
          <LinkRow label="Spectators" href={room.links.spectator} />
        </ul>
        <p className="note">
          A team's link carries its code, so tapping it is enough. If it is easier to read the code out,
          send them <code>{room.links.join}</code> and the six characters instead.
        </p>
        <p className="note">
          Everything here is reusable: the same link or code works again after a refresh, a crash, or on a
          second device.
        </p>
        <p className="note">Order: {room.format}</p>
      </main>
    );
  }

  return (
    <main className="create">
      <Brand />
      <h1>New draft</h1>

      {games.length > 1 && (
        <label>
          Game
          <select value={game?.id ?? ""} onChange={(event) => chooseGame(event.target.value)}>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label>
        Format
        <select
          value={preset?.id ?? ""}
          disabled={usingCustom}
          onChange={(event) => {
            setPresetId(event.target.value);
            setTeamSize(null);
          }}
        >
          {game?.presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.turns} turns
            </option>
          ))}
        </select>
      </label>
      {!usingCustom && preset?.notes !== null && preset?.notes !== undefined && <p className="note">{preset.notes}</p>}
      {!usingCustom && preset?.official === false && (
        <p className="warn">This format has not been confirmed as the one really played. Check it before a match.</p>
      )}

      <label>
        Or write your own order
        <input
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          placeholder={preset?.format ?? "A ban, B ban, A pick, B pick x2"}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <p className="note">
        Turns separated by commas: a team and an action, then "x2" to choose two at once, "@45s" for a turn's own
        clock. "A+B ban" has both sides ban blind at the same time; "remaining pick" takes whatever is left.
      </p>

      <label className="row">
        <input type="checkbox" checked={mirrors} onChange={(event) => setMirror(event.target.checked)} />
        Let more than one team take the same {game?.terms.item ?? "thing"}
      </label>

      <label>
        Players per side
        <input
          type="number"
          min={1}
          max={10}
          value={teamSize ?? (usingCustom ? 1 : (preset?.teamSize ?? 1))}
          onChange={(event) => setTeamSize(Number(event.target.value))}
        />
      </label>
      <p className="note">
        Everyone joins before the draft begins. Set this to 1 if only the captains are turning up.
      </p>

      <label>
        Seconds per turn
        <input
          type="number"
          min={5}
          max={300}
          value={turnSeconds}
          onChange={(event) => setPerTurnSeconds(Number(event.target.value))}
        />
      </label>

      <label>
        Reserve bank per team (seconds)
        <input
          type="number"
          min={0}
          max={900}
          value={reserveSeconds}
          onChange={(event) => setBankSeconds(Number(event.target.value))}
        />
      </label>

      <p className="note">
        There is no pause. If somebody drops, the clock keeps running and the room decides what to do.
      </p>

      <button type="button" className="confirm" disabled={busy || game === undefined} onClick={() => void create()}>
        {busy ? "Creating…" : "Create room"}
      </button>
      {error !== null && <p className="warn">{error}</p>}
    </main>
  );
}

function Brand(): JSX.Element {
  return (
    <header className="brand">
      <img src="/logo.svg" alt="" width={44} height={44} />
      <span>
        <strong>Vainglory</strong> Draft
      </span>
    </header>
  );
}

/** One link, with a button to copy it, ready to paste to a team. */
function LinkRow({
  label,
  href,
  code,
}: {
  readonly label: string;
  readonly href: string;
  readonly code?: string | undefined;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <li>
      <span className="link-label">{label}</span>
      <span className="link-body">
        <code>{href}</code>
        {code !== undefined && <em className="code-chip">{code}</em>}
      </span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(href);
          setCopied(true);
          setTimeout(() => setCopied(false), 1_500);
        }}
      >
        {copied ? "copied" : "copy"}
      </button>
    </li>
  );
}
