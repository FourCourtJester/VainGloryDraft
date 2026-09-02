import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CreateRoom } from "./CreateRoom.js";
import { DraftRoom } from "./DraftRoom.js";
import "./styles.css";

/**
 * Two screens, so no router: `/` creates a room, `/r/:roomId?token=…` is one.
 */
function App(): ReturnType<typeof CreateRoom> {
  const match = /^\/r\/([A-Za-z0-9_-]+)\/?$/.exec(window.location.pathname);
  const token = new URLSearchParams(window.location.search).get("token");

  if (match === null) return <CreateRoom />;
  if (token === null) {
    return (
      <main className="create">
        <h1>Missing link token</h1>
        <p className="note">This room needs the full link you were sent, including its <code>?token=</code> part.</p>
      </main>
    );
  }
  return <DraftRoom roomId={match[1]!} token={token} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
