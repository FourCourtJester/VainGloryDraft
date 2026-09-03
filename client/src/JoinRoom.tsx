import type { JSX } from "react";
import { useState } from "react";

interface Props {
  readonly roomId: string;
  readonly onJoin: (code: string) => void;
  readonly refused: string | null;
}

/**
 * Where a captain types the code they were given.
 *
 * Their link normally carries it, so most people never see this. It is here for
 * the ones who were read the code over voice, or who opened the room on a
 * different device from the one the link arrived on.
 */
export function JoinRoom({ roomId, onJoin, refused }: Props): JSX.Element {
  const [code, setCode] = useState("");

  return (
    <main className="create join">
      <header className="brand">
        <img src="/logo.svg" alt="" width={44} height={44} />
        <span>
          <strong>Vainglory</strong> Draft
        </span>
      </header>
      <h1>Join room {roomId}</h1>
      <p className="note">Enter the code your team was given. Spectators do not need one — use the watch link.</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (code.trim() !== "") onJoin(code);
        }}
      >
        <label>
          Team code
          <input
            className="code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="ABC234"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
            aria-label="Team code"
          />
        </label>
        <button type="submit" className="confirm" disabled={code.trim() === ""}>
          Join draft
        </button>
      </form>

      {refused !== null && <p className="warn">{refused}</p>}
    </main>
  );
}
