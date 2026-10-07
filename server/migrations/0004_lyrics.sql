-- One shared lyrics sheet per room, like compositions: the room is the
-- single piece being worked on, not a library.
CREATE TABLE lyrics (
  room_id TEXT PRIMARY KEY REFERENCES rooms (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  lines TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
