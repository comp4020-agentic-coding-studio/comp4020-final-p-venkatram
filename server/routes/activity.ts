import type { IncomingMessage, ServerResponse } from "node:http";
import { recentEvents, subscribeToEvents } from "../log.ts";
import { sendJson } from "../http-util.ts";

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

export async function handleActivityApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
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
