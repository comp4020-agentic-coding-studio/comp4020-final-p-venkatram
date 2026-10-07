// The in-memory registry behind every room feature: presence now, WebRTC
// signaling and shared-state broadcast in later commits. Purely in-process —
// fine because the course's deploy is a single machine, never more than one.
import type { WebSocket } from "ws";

export interface Connection {
  ws: WebSocket;
  userId: string;
  displayName: string;
}

export interface PresentUser {
  userId: string;
  displayName: string;
}

const roomConnections = new Map<string, Set<Connection>>();

export function addConnection(roomId: string, conn: Connection): void {
  let set = roomConnections.get(roomId);
  if (!set) {
    set = new Set();
    roomConnections.set(roomId, set);
  }
  set.add(conn);
}

export function removeConnection(roomId: string, conn: Connection): void {
  const set = roomConnections.get(roomId);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) roomConnections.delete(roomId);
}

export function presentUsers(roomId: string): PresentUser[] {
  const set = roomConnections.get(roomId);
  if (!set) return [];
  // A user open in two tabs should show once, not twice — "who's here"
  // answers "which people", not "how many sockets".
  const seen = new Map<string, PresentUser>();
  for (const conn of set) seen.set(conn.userId, { userId: conn.userId, displayName: conn.displayName });
  return [...seen.values()];
}

export function connectionsInRoom(roomId: string): Set<Connection> {
  return roomConnections.get(roomId) ?? new Set();
}

export function broadcast(roomId: string, message: unknown, exclude?: Connection): void {
  const payload = JSON.stringify(message);
  for (const conn of connectionsInRoom(roomId)) {
    if (conn === exclude) continue;
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(payload);
  }
}

// WebRTC signaling is point-to-point, not room-wide. If a user has more than
// one tab open in the same room, only one gets the message — an accepted gap
// for a small-group tool, not worth a multi-target fan-out for.
export function sendToUser(roomId: string, userId: string, message: unknown): boolean {
  for (const conn of connectionsInRoom(roomId)) {
    if (conn.userId === userId && conn.ws.readyState === conn.ws.OPEN) {
      conn.ws.send(JSON.stringify(message));
      return true;
    }
  }
  return false;
}
