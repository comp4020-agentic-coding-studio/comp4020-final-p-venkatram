// One WebSocket per client, multiplexed by a `type` field on each message —
// presence, WebRTC signaling, and shared-state broadcast (composition,
// lyrics comments) all over this same connection and the same per-room
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
import { addVoice, getComposition, removeVoice, renameVoice, setTempo, toggleCell } from "./compositions.ts";
import { getLyrics } from "./lyrics.ts";
import { addComment, listComments } from "./lyrics-comments.ts";
import { consumeAdmitted, listPending, resolvePending } from "./realtime/lobby.ts";
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

function onConnection(
  ws: WebSocket,
  db: DatabaseSync,
  roomId: string,
  userId: string,
  displayName: string,
  isOwner: boolean,
): void {
  const conn: Connection = { ws, userId, displayName };
  addConnection(roomId, conn);
  logEvent("room.join", { roomId, userId });

  const lyrics = getLyrics(db, roomId) ?? { title: null, lines: [] };
  ws.send(JSON.stringify({ type: "presence.sync", users: presentUsers(roomId) }));
  ws.send(JSON.stringify({ type: "composition.sync", ...getComposition(db, roomId) }));
  ws.send(JSON.stringify({ type: "lyrics.sync", ...lyrics, comments: listComments(db, roomId) }));
  ws.send(JSON.stringify({ type: "video.sync", ...getVideo(db, roomId) }));
  // Only the organizer gets the lobby queue — anyone already admitted (or
  // the join-request flow for a non-owner never reaches here, by design, see
  // server/routes/rooms.ts) has nothing to admit.
  if (isOwner) ws.send(JSON.stringify({ type: "lobby.sync", pending: listPending(roomId) }));
  broadcast(roomId, { type: "presence.join", user: { userId, displayName } }, conn);

  ws.on("message", (raw: Buffer) => {
    let message: unknown;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      return; // malformed frame: ignore rather than drop the connection
    }
    handleMessage(db, roomId, conn, message, isOwner);
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

function handleMessage(db: DatabaseSync, roomId: string, sender: Connection, message: unknown, isOwner: boolean): void {
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
    const next = toggleCell(
      db,
      roomId,
      String(record.voiceId ?? ""),
      Number(record.step),
      Number(record.pitch),
      Number(record.duration),
    );
    if (next) {
      broadcast(roomId, { type: "composition.update", ...next });
      logEvent("composition.toggle", {
        roomId,
        userId: sender.userId,
        voiceId: record.voiceId,
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

  // Voice management: same server-authoritative, broadcast-full-state
  // pattern as a cell toggle — no new trust model, just more of a room's
  // shared state to carry. A voice cap or an invalid/foreign voice id is
  // just a no-op, not an error back to the sender.
  if (record.type === "composition.add-voice") {
    const next = addVoice(db, roomId, typeof record.name === "string" ? record.name : undefined);
    if (next) {
      broadcast(roomId, { type: "composition.update", ...next });
      logEvent("composition.add-voice", { roomId, userId: sender.userId });
    }
    return;
  }

  if (record.type === "composition.remove-voice") {
    const next = removeVoice(db, roomId, String(record.voiceId ?? ""));
    broadcast(roomId, { type: "composition.update", ...next });
    logEvent("composition.remove-voice", { roomId, userId: sender.userId, voiceId: record.voiceId });
    return;
  }

  if (record.type === "composition.rename-voice") {
    const next = renameVoice(db, roomId, String(record.voiceId ?? ""), String(record.name ?? ""));
    if (next) {
      broadcast(roomId, { type: "composition.update", ...next });
      logEvent("composition.rename-voice", { roomId, userId: sender.userId, voiceId: record.voiceId });
    }
    return;
  }

  // Lyrics comments: a text-range anchor within one line, Google-Docs style
  // (see src/lib/lyrics-comments.ts for the client half). Server-authoritative
  // and bounds-checked the same way as composition edits — an invalid anchor
  // (stale line/offsets) is just ignored, not an error back to the sender.
  if (record.type === "lyrics.comment.add") {
    const comment = addComment(
      db,
      roomId,
      Number(record.lineIndex),
      Number(record.startOffset),
      Number(record.endOffset),
      sender.userId,
      sender.displayName,
      String(record.text ?? ""),
    );
    if (comment) {
      broadcast(roomId, { type: "lyrics.comment.add", comment });
      logEvent("lyrics.comment.add", { roomId, userId: sender.userId, lineIndex: comment.lineIndex });
    }
    return;
  }

  // Lobby admission: only the room's own organizer may admit or deny — a
  // non-owner's attempt is just ignored, the same "don't trust the client,
  // only apply a valid intent" posture as every other handler here. This is
  // point-to-point (resolving one specific requester's long-held HTTP
  // response in server/routes/rooms.ts, which does the join-admitted/denied
  // logging once that response actually completes), not a room-wide
  // broadcast.
  if ((record.type === "lobby.admit" || record.type === "lobby.deny") && isOwner) {
    resolvePending(roomId, String(record.userId ?? ""), record.type === "lobby.admit");
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

    const isOwner = room.ownerId === user.id;
    // Defensive re-check: a non-owner must have been admitted via
    // /api/rooms/:id/join-request moments ago (server/realtime/lobby.ts) —
    // the normal client flow never reaches here otherwise, but this is the
    // trust boundary, not the client's own good behavior. A known, accepted
    // gap: this still trusts that reaching this point at all implies the
    // join-request step happened, same as the rest of this app trusting a
    // valid session cookie with no further CSRF-style check.
    if (!isOwner && !consumeAdmitted(roomId, user.id)) {
      reject(socket, 403, "Not Admitted");
      return;
    }

    joinRoom(db, room.id, user.id);
    wss.handleUpgrade(req, socket, head, (ws) => {
      onConnection(ws, db, room.id, user.id, user.displayName, isOwner);
    });
  });
}
