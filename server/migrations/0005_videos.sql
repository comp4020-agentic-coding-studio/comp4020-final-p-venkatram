-- One shared karaoke video per room, like compositions and lyrics — the
-- room is the single thing being worked on, not a library or a search tool.
CREATE TABLE videos (
  room_id TEXT PRIMARY KEY REFERENCES rooms (id) ON DELETE CASCADE,
  youtube_id TEXT,
  updated_at INTEGER NOT NULL
);
