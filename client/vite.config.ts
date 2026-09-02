import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Builds the app the browser runs.
 *
 * Everything on screen comes from the room as the draft happens, so there is
 * nothing to prepare in advance on a server. While developing, requests for
 * rooms are passed through to the worker running alongside.
 */
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", ws: true, changeOrigin: true },
    },
  },
});
