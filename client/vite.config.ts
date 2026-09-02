import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The client is a plain SPA: a room is entirely live state, so there is nothing
 * to server-render. In dev it proxies to `wrangler dev`, which owns the rooms.
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
