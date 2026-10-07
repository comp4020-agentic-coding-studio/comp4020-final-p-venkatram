// Rooms are shareable by link, not access-controlled by membership: anyone
// with the id (and an account) can view and join one, the way a video-call
// link already works. `room_members` just records who's been in a room
// before, for their own "your rooms" list — it's history, not a gate.
import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

export interface Room {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
}

interface RoomRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
}

function toRoom(row: RoomRow): Room {
  return { id: row.id, name: row.name, ownerId: row.owner_id, createdAt: row.created_at };
}

function generateRoomId(): string {
  return randomBytes(5).toString("hex");
}

export function createRoom(db: DatabaseSync, ownerId: string, name: string): Room {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error("A room name is required.");

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateRoomId();
    const existing = db.prepare("SELECT id FROM rooms WHERE id = ?").get(id);
    if (existing) continue; // vanishingly unlikely, but cheap to guard
    const createdAt = Date.now();
    db.prepare("INSERT INTO rooms (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)").run(
      id,
      trimmed,
      ownerId,
      createdAt,
    );
    joinRoom(db, id, ownerId);
    return { id, name: trimmed, ownerId, createdAt };
  }
  throw new Error("Could not allocate a room id, try again.");
}

export function getRoom(db: DatabaseSync, id: string): Room | null {
  const row = db.prepare("SELECT * FROM rooms WHERE id = ?").get(id) as RoomRow | undefined;
  return row ? toRoom(row) : null;
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
