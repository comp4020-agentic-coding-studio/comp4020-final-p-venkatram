import type { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sessionTokenFromRequest, userForToken } from "../auth.ts";
import { getRoom, isRoomMember } from "../rooms.ts";
import { addToQueue, castVote, listQueue, listQueueForBroadcast, removeFromQueue } from "../video-queue.ts";
import { extractYouTubeId } from "../../shared/youtube.ts";
import { readJsonBody, sendJson } from "../http-util.ts";
import { broadcast } from "../realtime/presence.ts";
import { logEvent } from "../log.ts";

interface AddToQueueBody {
  url?: string;
  title?: string;
}

interface VoteBody {
  value?: number;
}

const ROOM_QUEUE_RE = /^\/api\/rooms\/([^/]+)\/queue$/;
const QUEUE_VOTE_RE = /^\/api\/queue\/([^/]+)\/vote$/;
const QUEUE_ITEM_RE = /^\/api\/queue\/([^/]+)$/;

export async function handleVideoQueueApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  db: DatabaseSync,
): Promise<boolean> {
  const roomMatch = ROOM_QUEUE_RE.exec(path);
  if (roomMatch) {
    const roomId = roomMatch[1] as string;
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
      sendJson(res, 200, { items: listQueue(db, roomId, user.id) });
      return true;
    }

    if (req.method === "POST") {
      const body = await readJsonBody<AddToQueueBody>(req);
      const youtubeId = extractYouTubeId(body.url ?? "");
      if (!youtubeId) {
        sendJson(res, 400, { error: "That doesn't look like a YouTube link." });
        return true;
      }
      const title = typeof body.title === "string" && body.title.trim().length > 0 ? body.title.trim() : null;
      const item = addToQueue(db, roomId, youtubeId, title, user.id);
      broadcast(roomId, { type: "queue.update", items: listQueueForBroadcast(db, roomId) });
      logEvent("queue.add", { roomId, userId: user.id, itemId: item.id, youtubeId });
      sendJson(res, 201, { item });
      return true;
    }

    return false;
  }

  const voteMatch = QUEUE_VOTE_RE.exec(path);
  if (voteMatch && req.method === "POST") {
    const itemId = voteMatch[1] as string;
    const user = userForToken(db, sessionTokenFromRequest(req));
    if (!user) {
      sendJson(res, 401, { error: "Log in first." });
      return true;
    }
    const row = db.prepare("SELECT room_id FROM video_queue_items WHERE id = ?").get(itemId) as
      | { room_id: string }
      | undefined;
    if (!row) {
      sendJson(res, 404, { error: "No queued item with that id." });
      return true;
    }
    if (!isRoomMember(db, row.room_id, user.id)) {
      sendJson(res, 403, { error: "You're not a member of that room." });
      return true;
    }
    const body = await readJsonBody<VoteBody>(req);
    if (body.value !== 1 && body.value !== -1) {
      sendJson(res, 400, { error: "value must be 1 or -1." });
      return true;
    }
    castVote(db, row.room_id, itemId, user.id, body.value);
    broadcast(row.room_id, { type: "queue.update", items: listQueueForBroadcast(db, row.room_id) });
    logEvent("queue.vote", { roomId: row.room_id, userId: user.id, itemId, value: body.value });
    sendJson(res, 200, { items: listQueue(db, row.room_id, user.id) });
    return true;
  }

  const itemMatch = QUEUE_ITEM_RE.exec(path);
  if (itemMatch && req.method === "DELETE") {
    const itemId = itemMatch[1] as string;
    const user = userForToken(db, sessionTokenFromRequest(req));
    if (!user) {
      sendJson(res, 401, { error: "Log in first." });
      return true;
    }
    const row = db.prepare("SELECT room_id FROM video_queue_items WHERE id = ?").get(itemId) as
      | { room_id: string }
      | undefined;
    if (!row) {
      sendJson(res, 404, { error: "No queued item with that id." });
      return true;
    }
    if (!isRoomMember(db, row.room_id, user.id)) {
      sendJson(res, 403, { error: "You're not a member of that room." });
      return true;
    }
    removeFromQueue(db, row.room_id, itemId);
    broadcast(row.room_id, { type: "queue.update", items: listQueueForBroadcast(db, row.room_id) });
    logEvent("queue.remove", { roomId: row.room_id, userId: user.id, itemId });
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
