// Rooms are shareable by link, but — since the room gate (server/routes/
// rooms.ts's join-request endpoint, server/realtime/lobby.ts) landed —
// entering one needs the organizer's password and, unless you're the
// organizer, the organizer's live admission too. `room_members` still just
// records who's been in a room before, for their own "your rooms" list —
// it's history, not the gate itself.
import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { hashSecret, verifySecret } from "./auth.ts";

export interface Room {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
  // Null until the organizer has ever set a password — true for every room
  // created after the gate shipped, false only for a pre-existing room that
  // hasn't had one set since (see migration 0007's note on why these aren't
  // silently backfilled).
  hasPassword: boolean;
}

interface RoomRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
  password_hash: string;
  password_salt: string;
  password_set_at: number | null;
}

function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    hasPassword: row.password_set_at !== null,
  };
}

function generateRoomId(): string {
  return randomBytes(5).toString("hex");
}

const MIN_PASSWORD_LENGTH = 8;

export function createRoom(db: DatabaseSync, ownerId: string, name: string, password: string): Room {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error("A room name is required.");
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`A room password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashSecret(password, salt);

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateRoomId();
    const existing = db.prepare("SELECT id FROM rooms WHERE id = ?").get(id);
    if (existing) continue; // vanishingly unlikely, but cheap to guard
    const createdAt = Date.now();
    db.prepare(
      `INSERT INTO rooms (id, name, owner_id, created_at, password_hash, password_salt, password_set_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, trimmed, ownerId, createdAt, passwordHash, salt, createdAt);
    joinRoom(db, id, ownerId);
    return { id, name: trimmed, ownerId, createdAt, hasPassword: true };
  }
  throw new Error("Could not allocate a room id, try again.");
}

export function getRoom(db: DatabaseSync, id: string): Room | null {
  const row = db.prepare("SELECT * FROM rooms WHERE id = ?").get(id) as RoomRow | undefined;
  return row ? toRoom(row) : null;
}

// Not exposed over HTTP as part of `Room` — only used by the join-request
// route to check a submitted password against the stored hash.
export function verifyRoomPassword(db: DatabaseSync, roomId: string, password: string): boolean {
  const row = db.prepare("SELECT password_hash, password_salt, password_set_at FROM rooms WHERE id = ?").get(roomId) as
    | Pick<RoomRow, "password_hash" | "password_salt" | "password_set_at">
    | undefined;
  if (!row || row.password_set_at === null) return false;
  return verifySecret(password, row.password_salt, row.password_hash);
}

// Lets the owner of a pre-gate room (migration 0007's orphaned case) set a
// password after the fact, so the room isn't permanently unreachable via the
// join-request flow.
export function setRoomPassword(db: DatabaseSync, roomId: string, ownerId: string, password: string): boolean {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`A room password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const room = db.prepare("SELECT owner_id FROM rooms WHERE id = ?").get(roomId) as { owner_id: string } | undefined;
  if (!room || room.owner_id !== ownerId) return false;
  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashSecret(password, salt);
  db.prepare("UPDATE rooms SET password_hash = ?, password_salt = ?, password_set_at = ? WHERE id = ?").run(
    passwordHash,
    salt,
    Date.now(),
    roomId,
  );
  return true;
}

export function joinRoom(db: DatabaseSync, roomId: string, userId: string): void {
  db.prepare("INSERT OR IGNORE INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)").run(
    roomId,
    userId,
    Date.now(),
  );
}

export function listRoomsForUser(db: DatabaseSync, userId: string): Room[] {
  const rows = db
    .prepare(
      `SELECT rooms.* FROM rooms
       JOIN room_members ON room_members.room_id = rooms.id
       WHERE room_members.user_id = ?
       ORDER BY room_members.joined_at DESC`,
    )
    .all(userId) as unknown as RoomRow[];
  return rows.map(toRoom);
}
