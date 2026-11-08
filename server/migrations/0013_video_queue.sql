-- "Up next" list for a room's karaoke video — the videos table (0005) stays
-- the single "now playing" slot; this is purely what's queued behind it.
-- Net score (upvotes - downvotes) orders the queue, ties broken by
-- created_at, so what's next never disagrees between a manual skip and an
-- end-of-video auto-advance (both read video-queue.ts's listQueue/popNext,
-- which use this same ordering).
CREATE TABLE video_queue_items (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  youtube_id TEXT NOT NULL,
  title TEXT,
  added_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL
);
CREATE INDEX video_queue_items_room_idx ON video_queue_items (room_id, created_at);

-- One vote per (item, user) — casting again just changes the row via an
-- upsert; a second click of the same direction deletes the row instead
-- (toggle off), handled in video-queue.ts's castVote.
CREATE TABLE video_queue_votes (
  item_id TEXT NOT NULL REFERENCES video_queue_items (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  voted_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, user_id)
);
