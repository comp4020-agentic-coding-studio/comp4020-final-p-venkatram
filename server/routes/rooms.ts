import type { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sessionTokenFromRequest, userForToken } from "../auth.ts";
import { createRoom, getRoom, listRoomsForUser } from "../rooms.ts";
import { BadRequestError, readJsonBody, sendJson } from "../http-util.ts";
import { logEvent } from "../log.ts";

interface CreateRoomBody {
  name?: string;
}

export async function handleRoomsApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  db: DatabaseSync,
): Promise<boolean> {
  if (!path.startsWith("/api/rooms")) return false;

  const user = userForToken(db, sessionTokenFromRequest(req));
  if (!user) {
    sendJson(res, 401, { error: "Log in first." });
    return true;
  }

  if (path === "/api/rooms" && req.method === "GET") {
    sendJson(res, 200, { rooms: listRoomsForUser(db, user.id) });
    return true;
  }

  if (path === "/api/rooms" && req.method === "POST") {
    try {
      const body = await readJsonBody<CreateRoomBody>(req);
      const room = createRoom(db, user.id, body.name ?? "");
      logEvent("room.create", { roomId: room.id, userId: user.id });
      sendJson(res, 201, { room });
    } catch (err) {
      if (err instanceof BadRequestError || err instanceof Error) sendJson(res, 400, { error: err.message });
      else throw err;
    }
    return true;
  }

  // Exactly one segment after /api/rooms/ — not /api/rooms/<id>/lyrics or
  // anything deeper, which belong to their own route modules.
  const detailMatch = /^\/api\/rooms\/([^/]+)$/.exec(path);
  if (detailMatch && req.method === "GET") {
    const room = getRoom(db, detailMatch[1] as string);
    if (!room) sendJson(res, 404, { error: "No room with that id." });
    else sendJson(res, 200, { room });
    return true;
  }

  return false;
}
