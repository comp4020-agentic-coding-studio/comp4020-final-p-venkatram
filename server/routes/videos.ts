import type { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sessionTokenFromRequest, userForToken } from "../auth.ts";
import { getVideo, setVideo } from "../videos.ts";
import { getRoom } from "../rooms.ts";
import { readJsonBody, sendJson } from "../http-util.ts";
import { broadcast } from "../realtime/presence.ts";
import { logEvent } from "../log.ts";

interface SetVideoBody {
  url?: string;
}

const ROOM_VIDEO_RE = /^\/api\/rooms\/([^/]+)\/video$/;

export async function handleVideosApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  db: DatabaseSync,
): Promise<boolean> {
  const match = ROOM_VIDEO_RE.exec(path);
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
    sendJson(res, 200, getVideo(db, roomId));
    return true;
  }

  if (req.method === "POST") {
    const body = await readJsonBody<SetVideoBody>(req);
    const next = setVideo(db, roomId, body.url ?? "");
    if (!next) {
      sendJson(res, 400, { error: "That doesn't look like a YouTube link." });
      return true;
    }
    broadcast(roomId, { type: "video.update", ...next });
    logEvent("video.set", { roomId, userId: user.id, youtubeId: next.youtubeId });
    sendJson(res, 200, next);
    return true;
  }

  return false;
}
