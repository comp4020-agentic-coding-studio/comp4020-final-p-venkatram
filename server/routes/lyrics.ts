import type { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sessionTokenFromRequest, userForToken } from "../auth.ts";
import { getLyrics, saveLyrics } from "../lyrics.ts";
import { clearComments } from "../lyrics-comments.ts";
import { getRoom } from "../rooms.ts";
import { readJsonBody, sendJson } from "../http-util.ts";
import { broadcast } from "../realtime/presence.ts";
import { logEvent } from "../log.ts";

interface UploadLyricsBody {
  title?: string;
  raw?: string;
}

const ROOM_LYRICS_RE = /^\/api\/rooms\/([^/]+)\/lyrics$/;

export async function handleLyricsApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  db: DatabaseSync,
): Promise<boolean> {
  const match = ROOM_LYRICS_RE.exec(path);
  if (!match) return false;
  const roomId = match[1] as string;

  const user = userForToken(db, sessionTokenFromRequest(req));
  if (!user) {
    sendJson(res, 401, { error: "Log in first." });
    return true;
  }
  if (!getRoom(db, roomId)) {
    sendJson(res, 404, { error: "No room with that id." });
    return true;
  }

  if (req.method === "GET") {
    sendJson(res, 200, { lyrics: getLyrics(db, roomId) });
    return true;
  }

  if (req.method === "POST") {
    const body = await readJsonBody<UploadLyricsBody>(req);
    const document = saveLyrics(db, roomId, body.title ?? "", body.raw ?? "");
    // New lyrics means the old line numbers no longer mean anything — rather
    // than guess at re-anchoring, comments on this room's lyrics start over.
    clearComments(db, roomId);
    broadcast(roomId, { type: "lyrics.update", ...document, comments: [] });
    logEvent("lyrics.upload", { roomId, userId: user.id, lineCount: document.lines.length });
    sendJson(res, 200, { lyrics: document });
    return true;
  }

  return false;
}
