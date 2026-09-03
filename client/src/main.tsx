import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { CreateRoom } from "./CreateRoom.js";
import { DraftRoom } from "./DraftRoom.js";
import { JoinRoom } from "./JoinRoom.js";
import "./styles.css";

/**
 * There are only two screens, so which one to show is decided from the address
 * rather than by anything more elaborate: the front page creates a draft, and a
 * room link opens that draft.
 */
function App(): ReturnType<typeof CreateRoom> {
  const match = /^\/r\/([A-Za-z0-9_-]+)\/?$/.exec(window.location.pathname);
  const params = new URLSearchParams(window.location.search);
  // A watch link carries a token; a team link carries a code. Either can also
  // be typed, and a player gives a name so their side knows who is who.
  const token = params.get("token");
  const codeFromUrl = params.get("code");
  const [joined, setJoined] = useState<{ code: string; name: string } | null>(null);

  if (match === null) return <CreateRoom />;
  const roomId = match[1]!;

  // Watching needs nothing but the link.
  if (token !== null && joined === null) {
    return <DraftRoom roomId={roomId} credential={token} />;
  }

  if (joined === null) {
    return (
      <JoinRoom
        roomId={roomId}
        code={codeFromUrl ?? undefined}
        refused={null}
        onJoin={(code, name) => setJoined({ code, name })}
      />
    );
  }

  return (
    <DraftRoom
      key={`${joined.code}:${joined.name}`}
      roomId={roomId}
      credential={joined.code}
      name={joined.name}
      onRejoin={(code, name) => setJoined({ code, name })}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
