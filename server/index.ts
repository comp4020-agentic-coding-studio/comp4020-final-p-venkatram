// Single Node process: serves the Astro static build, the API, /readme/, and
// (from a later commit) the WebSocket — all on one port, because that's the
// whole of what the course's one 256MB Fly machine gives this app to work
// with. node:http + a hand-rolled router rather than a framework, to keep the
// resident footprint small. Each feature's routes live in routes/*.ts;
// this file just dispatches to them in turn.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db.ts";
import { logEvent } from "./log.ts";
import { renderReadmePage } from "./readme.ts";
import { serveStatic } from "./static.ts";
import { sendJson } from "./http-util.ts";
import { handleActivityApi } from "./routes/activity.ts";
import { handleAuthApi } from "./routes/auth.ts";
import { handleRoomsApi } from "./routes/rooms.ts";
import { attachWebSocketServer } from "./ws.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 8080);
const db = getDb(); // boots the schema before the first request can touch it

async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (await handleAuthApi(req, res, path, db)) return true;
  if (await handleRoomsApi(req, res, path, db)) return true;
  if (await handleActivityApi(req, res, path)) return true;
  return false;
}

async function requestListener(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://internal");
  const path = url.pathname;
  const started = Date.now();

  if (path === "/readme/" || path === "/readme") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderReadmePage(ROOT));
    return;
  }

  if (path.startsWith("/api/")) {
    const handled = await handleApi(req, res, path);
    if (handled) {
      if (path !== "/api/activity/stream") {
        logEvent("http.request", { method: req.method, path, status: res.statusCode, ms: Date.now() - started });
      }
      return;
    }
    sendJson(res, 404, { error: "not found" });
    return;
  }

  if (serveStatic(DIST, path, res)) return;

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

const server = createServer((req, res) => {
  requestListener(req, res).catch((err: unknown) => {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
  });
});
attachWebSocketServer(server);
server.listen(PORT, "0.0.0.0", () => {
  logEvent("server.start", { port: PORT });
});
