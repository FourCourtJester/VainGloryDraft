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
  // A spectator link carries a token; a captain's carries their code. Either
  // way it is in the address, and either way it can be typed instead.
  const fromUrl = params.get("token") ?? params.get("code");
  const [entered, setEntered] = useState<string | null>(null);

  if (match === null) return <CreateRoom />;

  const roomId = match[1]!;
  const credential = entered ?? fromUrl;
  if (credential === null) {
    return <JoinRoom roomId={roomId} onJoin={setEntered} refused={null} />;
  }
  return <DraftRoom key={credential} roomId={roomId} token={credential} onCredential={setEntered} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
