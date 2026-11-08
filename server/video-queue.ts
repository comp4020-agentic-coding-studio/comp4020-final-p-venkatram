// A room's "up next" list, separate from videos.ts's singleton "now playing"
// slot. Net score (upvotes minus downvotes) orders the queue, ties broken by
// when the item was added — the same ordering is used everywhere this table
// is read, so a manual skip and an auto-advance never disagree about what's
// next.
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export interface QueueItem {
  id: string;
  roomId: string;
  youtubeId: string;
  title: string | null;
  addedBy: string;
  createdAt: number;
  score: number;
  myVote: -1 | 0 | 1;
}

interface QueueRow {
  id: string;
  room_id: string;
  youtube_id: string;
  title: string | null;
  added_by: string;
  created_at: number;
  score: number | null;
  my_vote: number | null;
}

function toItem(row: QueueRow): QueueItem {
  return {
    id: row.id,
    roomId: row.room_id,
    youtubeId: row.youtube_id,
    title: row.title,
    addedBy: row.added_by,
    createdAt: row.created_at,
    score: row.score ?? 0,
    myVote: (row.my_vote ?? 0) as -1 | 0 | 1,
  };
}

// `forUserId` is whoever's asking — only used to also report their own vote
// on each item (myVote), not stored state of its own. Only ever handed back
// to the one requester it was computed for (a GET, or a mutation's own HTTP
// response) — never broadcast room-wide, since myVote is specific to one
// person and every other room member's own vote would be wrong to receive
// as "mine". Room-wide broadcasts use listQueueForBroadcast instead.
export function listQueue(db: DatabaseSync, roomId: string, forUserId: string): QueueItem[] {
  const rows = db
    .prepare(
      `SELECT
         items.id as id, items.room_id as room_id, items.youtube_id as youtube_id,
         items.title as title, items.added_by as added_by, items.created_at as created_at,
         COALESCE(scores.score, 0) as score,
         COALESCE(mine.value, 0) as my_vote
       FROM video_queue_items items
       LEFT JOIN (
         SELECT item_id, SUM(value) as score FROM video_queue_votes GROUP BY item_id
       ) scores ON scores.item_id = items.id
       LEFT JOIN video_queue_votes mine ON mine.item_id = items.id AND mine.user_id = ?
       WHERE items.room_id = ?
       ORDER BY score DESC, items.created_at ASC`,
    )
    .all(forUserId, roomId) as unknown as QueueRow[];
  return rows.map(toItem);
}

// The room-wide broadcast shape: score and content are shared truth, but
// myVote is always 0 here (never any one person's vote) — each client
// merges this with whatever myVote it already knows locally for an item,
// rather than trusting a per-user field that can't be correct for everyone
// receiving the same broadcast.
export function listQueueForBroadcast(db: DatabaseSync, roomId: string): QueueItem[] {
  return listQueue(db, roomId, "");
}

export function addToQueue(
  db: DatabaseSync,
  roomId: string,
  youtubeId: string,
  title: string | null,
  userId: string,
): QueueItem {
  const id = randomUUID();
  const createdAt = Date.now();
  db.prepare(
    `INSERT INTO video_queue_items (id, room_id, youtube_id, title, added_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, roomId, youtubeId, title, userId, createdAt);
  return { id, roomId, youtubeId, title, addedBy: userId, createdAt, score: 0, myVote: 0 };
}

// A second click in the same direction is a toggle-off (delete the vote), not
// a no-op or a second upvote — clicking the opposite direction flips it via
// the same upsert. Returns false if the item isn't in this room (stale id,
// or a cross-room guess).
export function castVote(db: DatabaseSync, roomId: string, itemId: string, userId: string, value: 1 | -1): boolean {
  const item = db.prepare("SELECT id FROM video_queue_items WHERE id = ? AND room_id = ?").get(itemId, roomId);
  if (!item) return false;

  const existing = db.prepare("SELECT value FROM video_queue_votes WHERE item_id = ? AND user_id = ?").get(itemId, userId) as
    | { value: number }
    | undefined;

  if (existing?.value === value) {
    db.prepare("DELETE FROM video_queue_votes WHERE item_id = ? AND user_id = ?").run(itemId, userId);
  } else {
    db.prepare(
      `INSERT INTO video_queue_votes (item_id, user_id, value, voted_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(item_id, user_id) DO UPDATE SET value = excluded.value, voted_at = excluded.voted_at`,
    ).run(itemId, userId, value, Date.now());
  }
  return true;
}

// Returns false if the item isn't in this room — same guard as castVote.
export function removeFromQueue(db: DatabaseSync, roomId: string, itemId: string): boolean {
  const result = db.prepare("DELETE FROM video_queue_items WHERE id = ? AND room_id = ?").run(itemId, roomId);
  return result.changes > 0;
}

// Reads the top-ordered item and deletes it in one call, so two callers
// racing to advance the same room (e.g. two clients both reporting
// video.ended) can't both grab the same item — node:sqlite is synchronous,
// so this function body can't interleave with another call to it.
export function popNext(db: DatabaseSync, roomId: string): QueueItem | null {
  const row = db
    .prepare(
      `SELECT
         items.id as id, items.room_id as room_id, items.youtube_id as youtube_id,
         items.title as title, items.added_by as added_by, items.created_at as created_at,
         COALESCE(scores.score, 0) as score, 0 as my_vote
       FROM video_queue_items items
       LEFT JOIN (
         SELECT item_id, SUM(value) as score FROM video_queue_votes GROUP BY item_id
       ) scores ON scores.item_id = items.id
       WHERE items.room_id = ?
       ORDER BY score DESC, items.created_at ASC
       LIMIT 1`,
    )
    .get(roomId) as QueueRow | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM video_queue_items WHERE id = ?").run(row.id);
  return toItem(row);
}
