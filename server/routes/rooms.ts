import type { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sessionTokenFromRequest, userForToken } from "../auth.ts";
import { createRoom, getRoom, listRoomsForUser, setRoomPassword, verifyRoomPassword } from "../rooms.ts";
import { addPending } from "../realtime/lobby.ts";
import { BadRequestError, readJsonBody, sendJson } from "../http-util.ts";
import { logEvent } from "../log.ts";

interface CreateRoomBody {
  name?: string;
  password?: string;
}

interface JoinRequestBody {
  password?: string;
}

interface SetPasswordBody {
  password?: string;
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
      const room = createRoom(db, user.id, body.name ?? "", body.password ?? "");
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

  // Submits a password and (unless you're the owner) waits for the live
  // organizer to admit you — this request intentionally stays open until
  // that decision arrives (or it times out, which denies); it is not the
  // WebSocket upgrade itself. See server/realtime/lobby.ts for why this is
  // a long-held response rather than polling or an early /ws connection.
  const joinRequestMatch = /^\/api\/rooms\/([^/]+)\/join-request$/.exec(path);
  if (joinRequestMatch && req.method === "POST") {
    const roomId = joinRequestMatch[1] as string;
    const room = getRoom(db, roomId);
    if (!room) {
      sendJson(res, 404, { error: "No room with that id." });
      return true;
    }
    if (room.ownerId === user.id) {
      sendJson(res, 200, { admitted: true });
      return true;
    }
    const body = await readJsonBody<JoinRequestBody>(req);
    if (!verifyRoomPassword(db, roomId, body.password ?? "")) {
      sendJson(res, 403, { error: "Incorrect room password." });
      return true;
    }
    logEvent("room.join-request", { roomId, userId: user.id });
    const admitted = await addPending(roomId, room.ownerId, user.id, user.displayName);
    logEvent(admitted ? "room.join-admitted" : "room.join-denied", { roomId, userId: user.id });
    sendJson(res, 200, { admitted });
    return true;
  }

  // Owner-only: set or change a room's password (also the only way to give
  // a pre-gate room — migration 0007's orphaned case — a password at all).
  const setPasswordMatch = /^\/api\/rooms\/([^/]+)\/password$/.exec(path);
  if (setPasswordMatch && req.method === "POST") {
    const roomId = setPasswordMatch[1] as string;
    try {
      const body = await readJsonBody<SetPasswordBody>(req);
      const ok = setRoomPassword(db, roomId, user.id, body.password ?? "");
      if (!ok) {
        sendJson(res, 404, { error: "No room with that id, or you're not its organizer." });
        return true;
      }
      logEvent("room.password-set", { roomId, userId: user.id });
      sendJson(res, 200, { ok: true });
    } catch (err) {
      if (err instanceof Error) sendJson(res, 400, { error: err.message });
      else throw err;
    }
    return true;
  }

  return false;
}
