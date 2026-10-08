// One WebSocket per client, multiplexed by a `type` field on each message —
// presence, WebRTC signaling, and shared-state broadcast (composition today,
// lyrics transport next) all over this same connection and the same per-room
// registry (realtime/presence.ts). One socket per client keeps this simple
// on a single small machine: no per-feature connection, no separate
// signaling server.
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { DatabaseSync } from "node:sqlite";
import { WebSocketServer, type WebSocket } from "ws";
import { getDb } from "./db.ts";
import { sessionTokenFromRequest, userForToken } from "./auth.ts";
import { getRoom, joinRoom } from "./rooms.ts";
import { getComposition, setTempo, toggleCell } from "./compositions.ts";
import { getLyrics } from "./lyrics.ts";
import { getTransport, pause, play, seek } from "./realtime/lyrics-transport.ts";
import { getVideo } from "./videos.ts";
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

function onConnection(ws: WebSocket, db: DatabaseSync, roomId: string, userId: string, displayName: string): void {
  const conn: Connection = { ws, userId, displayName };
  addConnection(roomId, conn);
  logEvent("room.join", { roomId, userId });

  const lyrics = getLyrics(db, roomId) ?? { title: null, lines: [] };
  ws.send(JSON.stringify({ type: "presence.sync", users: presentUsers(roomId) }));
  ws.send(JSON.stringify({ type: "composition.sync", ...getComposition(db, roomId) }));
  ws.send(JSON.stringify({ type: "lyrics.sync", ...lyrics, ...getTransport(roomId) }));
  ws.send(JSON.stringify({ type: "video.sync", ...getVideo(db, roomId) }));
  broadcast(roomId, { type: "presence.join", user: { userId, displayName } }, conn);

  ws.on("message", (raw: Buffer) => {
    let message: unknown;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      return; // malformed frame: ignore rather than drop the connection
    }
    handleMessage(db, roomId, conn, message);
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

function asRecord(message: unknown): Record<string, unknown> | null {
  return typeof message === "object" && message !== null ? (message as Record<string, unknown>) : null;
}

function handleMessage(db: DatabaseSync, roomId: string, sender: Connection, message: unknown): void {
  // The server relays SDP/ICE between two specific peers without reading
  // their contents — actual audio/video stays peer-to-peer, never routed
  // through this process.
  if (isSignalMessage(message)) {
    const { to, ...rest } = message;
    sendToUser(roomId, to, { ...rest, from: sender.userId });
    return;
  }

  // Composition edits: the server is authoritative (see compositions.ts) —
  // apply the change, then broadcast the resulting state to everyone in the
  // room, sender included, so there's exactly one code path that renders it.
  const record = asRecord(message);
  if (!record) return;

  if (record.type === "composition.toggle") {
    const next = toggleCell(db, roomId, Number(record.step), Number(record.pitch), Number(record.duration));
    if (next) {
      broadcast(roomId, { type: "composition.update", ...next });
      logEvent("composition.toggle", {
        roomId,
        userId: sender.userId,
        step: record.step,
        pitch: record.pitch,
        duration: record.duration,
      });
    }
    return;
  }

  if (record.type === "composition.tempo") {
    const next = setTempo(db, roomId, Number(record.bpm));
    broadcast(roomId, { type: "composition.update", ...next });
    logEvent("composition.tempo", { roomId, userId: sender.userId, bpm: next.bpm });
    return;
  }

  // Lyrics transport: whoever acts becomes the leader for that moment —
  // there's no ownership check, matching the ADR's no-locking shape.
  if (record.type === "lyrics.play") {
    broadcast(roomId, { type: "lyrics.transport", ...play(roomId) });
    logEvent("lyrics.play", { roomId, userId: sender.userId });
  } else if (record.type === "lyrics.pause") {
    broadcast(roomId, { type: "lyrics.transport", ...pause(roomId) });
    logEvent("lyrics.pause", { roomId, userId: sender.userId });
  } else if (record.type === "lyrics.seek") {
    broadcast(roomId, { type: "lyrics.transport", ...seek(roomId, Number(record.positionMs)) });
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
      onConnection(ws, db, room.id, user.id, user.displayName);
    });
  });
}
