// Single Node process: serves the Astro static build, the API, /readme/, and
// (from a later commit) the WebSocket — all on one port, because that's the
// whole of what the course's one 256MB Fly machine gives this app to work
// with. node:http + a hand-rolled router rather than a framework, to keep the
// resident footprint small.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db.ts";
import { logEvent, recentEvents, subscribeToEvents } from "./log.ts";
import { renderReadmePage } from "./readme.ts";
import { serveStatic } from "./static.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 8080);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

function streamActivity(res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  for (const entry of recentEvents()) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
  const unsubscribe = subscribeToEvents((entry) => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  });
  res.on("close", unsubscribe);
}

async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (path === "/api/activity/recent" && req.method === "GET") {
    sendJson(res, 200, { events: recentEvents() });
    return true;
  }
  if (path === "/api/activity/stream" && req.method === "GET") {
    streamActivity(res);
    return true;
  }
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

getDb(); // boots the schema before the first request can touch it
const server = createServer((req, res) => {
  void requestListener(req, res);
});
server.listen(PORT, "0.0.0.0", () => {
  logEvent("server.start", { port: PORT });
});
