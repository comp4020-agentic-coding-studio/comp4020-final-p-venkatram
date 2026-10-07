// One WebSocket per client, multiplexed by a `type` field on each message —
// presence today, WebRTC signaling and shared-state broadcast (composition,
// lyrics transport) in later commits, all over this same connection and the
// same per-room registry (realtime/presence.ts). One socket per client keeps
// this simple on a single small machine: no per-feature connection, no
// separate signaling server.
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { getDb } from "./db.ts";
import { sessionTokenFromRequest, userForToken } from "./auth.ts";
import { getRoom, joinRoom } from "./rooms.ts";
import {
  addConnection,
  broadcast,
  type Connection,
  presentUsers,
  removeConnection,
  sendToUser,
} from "./realtime/presence.ts";
import { logEvent } from "./log.ts";

const SIGNAL_TYPES = new Set(["webrtc.offer", "webrtc.answer", "webrtc.ice"]);

const wss = new WebSocketServer({ noServer: true });

function reject(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\n\r\n`);
  socket.destroy();
}

function onConnection(ws: WebSocket, roomId: string, userId: string, displayName: string): void {
  const conn: Connection = { ws, userId, displayName };
  addConnection(roomId, conn);
  logEvent("room.join", { roomId, userId });

  ws.send(JSON.stringify({ type: "presence.sync", users: presentUsers(roomId) }));
  broadcast(roomId, { type: "presence.join", user: { userId, displayName } }, conn);

  ws.on("message", (raw: Buffer) => {
    let message: unknown;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      return; // malformed frame: ignore rather than drop the connection
    }
    handleMessage(roomId, conn, message);
  });

  ws.on("close", () => {
    removeConnection(roomId, conn);
    broadcast(roomId, { type: "presence.leave", userId });
    logEvent("room.leave", { roomId, userId });
  });
}

interface SignalMessage {
  type: string;
  to: string;
  [field: string]: unknown;
}

function isSignalMessage(message: unknown): message is SignalMessage {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Record<string, unknown>;
  return typeof candidate.type === "string" && SIGNAL_TYPES.has(candidate.type) && typeof candidate.to === "string";
}

function handleMessage(roomId: string, sender: Connection, message: unknown): void {
  // The server relays SDP/ICE between two specific peers without reading
  // their contents — actual audio/video stays peer-to-peer, never routed
  // through this process. Shared-state broadcast (composition, lyrics
  // transport) lands here in a later commit, on the same dispatch.
  if (isSignalMessage(message)) {
    const { to, ...rest } = message;
    sendToUser(roomId, to, { ...rest, from: sender.userId });
  }
}

export function attachWebSocketServer(server: Server): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://internal");
    if (url.pathname !== "/ws") {
      reject(socket, 404, "Not Found");
      return;
    }

    const db = getDb();
    const user = userForToken(db, sessionTokenFromRequest(req));
    if (!user) {
      reject(socket, 401, "Unauthorized");
      return;
    }

    const roomId = url.searchParams.get("room");
    if (!roomId) {
      reject(socket, 400, "Bad Request");
      return;
    }
    const room = getRoom(db, roomId);
    if (!room) {
      reject(socket, 404, "Room Not Found");
      return;
    }

    joinRoom(db, room.id, user.id);
    wss.handleUpgrade(req, socket, head, (ws) => {
      onConnection(ws, room.id, user.id, user.displayName);
    });
  });
}
