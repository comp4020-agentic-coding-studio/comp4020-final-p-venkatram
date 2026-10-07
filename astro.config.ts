import { defineConfig } from "astro/config";

// Static output: the Node server (server/) serves dist/ directly alongside
// the API and WebSocket, so there's no second SSR runtime competing for the
// single Fly machine's 256MB. No `base` — this app is served from its own
// domain root (fly.dev), not a GitHub Pages subpath.
export default defineConfig({
  output: "static",
  srcDir: "./src",
  outDir: "./dist",
  vite: {
    server: {
      // `astro dev` (this process) only builds pages; the API, /readme/ and
      // the WebSocket live in server/index.ts, run separately in dev via
      // `pnpm dev:server` — proxied here so the browser only ever talks to
      // one origin, matching production.
      proxy: {
        "/api": "http://localhost:8080",
        "/readme": "http://localhost:8080",
        "/ws": { target: "ws://localhost:8080", ws: true },
      },
    },
  },
});
