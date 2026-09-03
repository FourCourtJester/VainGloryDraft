import type { JSX } from "react";
import { useEffect, useState } from "react";

interface PresetSummary {
  readonly id: string;
  readonly name: string;
  readonly format: string;
  readonly official: boolean;
  readonly turns: number;
  readonly notes: string | null;
}

interface Pending {
  readonly id: string;
  readonly format: string;
  readonly blockedOn: string;
}

interface Created {
  readonly roomId: string;
  readonly links: { readonly captainA: string; readonly captainB: string; readonly spectator: string };
}

/**
 * The screen an organiser starts from: choose a format and the clock, create the
 * room, and get back the three links to hand out.
 */
export function CreateRoom(): JSX.Element {
  const [presets, setPresets] = useState<readonly PresetSummary[]>([]);
  const [pending, setPending] = useState<readonly Pending[]>([]);
  const [presetId, setPresetId] = useState("vg-5v5-standard");
  const [mirrorPicks, setMirrorPicks] = useState(false);
  const [perTurnSeconds, setPerTurnSeconds] = useState(30);
  const [bankSeconds, setBankSeconds] = useState(60);
  const [room, setRoom] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/presets")
      .then((response) => response.json() as Promise<{ presets: PresetSummary[]; pending: Pending[] }>)
      .then((data) => {
        setPresets(data.presets);
        setPending(data.pending);
      })
      .catch(() => setError("Could not load presets."));
  }, []);

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          presetId,
          mirrorPicks,
          perTurnMs: perTurnSeconds * 1000,
          bankMs: bankSeconds * 1000,
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
        <header className="brand">
          <img src="/logo.svg" alt="" width={44} height={44} />
          <span>
            <strong>Vainglory</strong> Draft
          </span>
        </header>
        <h1>Room {room.roomId}</h1>
        <p className="note">
          Send each captain their own link. The draft starts when both captains have connected — until then
          the clock is not running.
        </p>
        <ul className="links">
          <LinkRow label="Captain A" href={room.links.captainA} />
          <LinkRow label="Captain B" href={room.links.captainB} />
          <LinkRow label="Spectators" href={room.links.spectator} />
        </ul>
        <p className="note">
          Links are reusable: the same one works again after a refresh, a crash, or on a second device.
        </p>
      </main>
    );
  }

  const chosen = presets.find((preset) => preset.id === presetId);

  return (
    <main className="create">
      <header className="brand">
        <img src="/logo.svg" alt="" width={44} height={44} />
        <span>
          <strong>Vainglory</strong> Draft
        </span>
      </header>
      <h1>New draft</h1>

      <label>
        Format
        <select value={presetId} onChange={(event) => setPresetId(event.target.value)}>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name} — {preset.turns} turns
            </option>
          ))}
        </select>
      </label>
      {chosen?.official === false && (
        <p className="warn">
          This is a development placeholder, not a competitive format. {chosen.notes}
        </p>
      )}
      {pending.length > 0 && (
        <p className="note">
          Not available yet: {pending.map((entry) => `${entry.id} (${entry.blockedOn})`).join("; ")}
        </p>
      )}

      <label className="row">
        <input type="checkbox" checked={mirrorPicks} onChange={(event) => setMirrorPicks(event.target.checked)} />
        Allow mirror picks
      </label>

      <label>
        Seconds per turn
        <input
          type="number"
          min={5}
          max={300}
          value={perTurnSeconds}
          onChange={(event) => setPerTurnSeconds(Number(event.target.value))}
        />
      </label>

      <label>
        Reserve bank per team (seconds)
        <input
          type="number"
          min={0}
          max={900}
          value={bankSeconds}
          onChange={(event) => setBankSeconds(Number(event.target.value))}
        />
      </label>

      <p className="note">
        There is no pause. If a captain drops, the clock keeps running and the room decides what to do.
      </p>

      <button type="button" className="confirm" disabled={busy} onClick={() => void create()}>
        {busy ? "Creating…" : "Create room"}
      </button>
      {error !== null && <p className="warn">{error}</p>}
    </main>
  );
}

/** One link, with a button to copy it, ready to paste to a captain. */
function LinkRow({ label, href }: { readonly label: string; readonly href: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <li>
      <span className="link-label">{label}</span>
      <code>{href}</code>
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
