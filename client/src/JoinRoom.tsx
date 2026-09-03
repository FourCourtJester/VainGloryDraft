import type { JSX } from "react";
import { useState } from "react";
import { rememberName, rememberedName } from "./identity.js";

interface Props {
  readonly roomId: string;
  readonly onJoin: (code: string, name: string) => void;
  readonly refused: string | null;
  /** Filled in when they arrived by link and only the name is missing. */
  readonly code?: string | undefined;
}

/**
 * Where a captain types the code they were given.
 *
 * Their link normally carries it, so most people never see this. It is here for
 * the ones who were read the code over voice, or who opened the room on a
 * different device from the one the link arrived on.
 */
export function JoinRoom({ roomId, onJoin, refused, code: known }: Props): JSX.Element {
  const [code, setCode] = useState(known ?? "");
  const [name, setName] = useState(rememberedName);

  return (
    <main className="create join">
      <header className="brand">
        <img src="/logo.svg" alt="" width={44} height={44} />
        <span>
          <strong>Vainglory</strong> Draft
        </span>
      </header>
      <h1>Join room {roomId}</h1>
      <p className="note">
        {known === undefined
          ? "Enter your team's code and the name your teammates will know you by. Spectators need no code — use the watch link."
          : "Your team is expecting you. What should your teammates see?"}
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (code.trim() === "" || name.trim() === "") return;
          rememberName(name);
          onJoin(code, name.trim());
        }}
      >
        <label>
          Your name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Shaun"
            autoComplete="nickname"
            maxLength={24}
            aria-label="Your name"
          />
        </label>
        {known === undefined && (
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
        )}
        <button type="submit" className="confirm" disabled={code.trim() === "" || name.trim() === ""}>
          Join draft
        </button>
      </form>

      {refused !== null && <p className="warn">{refused}</p>}
    </main>
  );
}
