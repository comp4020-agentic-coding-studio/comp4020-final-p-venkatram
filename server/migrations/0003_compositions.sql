-- One shared composition per room, not a library of named ones — the room
-- itself is the composing space, in keeping with "small, single-purpose."
CREATE TABLE compositions (
  room_id TEXT PRIMARY KEY REFERENCES rooms (id) ON DELETE CASCADE,
  bpm INTEGER NOT NULL DEFAULT 96,
  grid TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
