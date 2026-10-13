-- Google-Docs-style comments anchored to a range of text within a single
-- lyric line (not across lines — see src/lib/lyrics-comments.ts for why that
-- scope cut keeps the anchor model simple). Re-uploading a room's lyrics
-- deletes its comments (server/routes/lyrics.ts) rather than attempting to
-- re-anchor them against a new set of lines.
CREATE TABLE lyrics_comments (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  author_id TEXT NOT NULL REFERENCES users (id),
  author_name TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX lyrics_comments_room_idx ON lyrics_comments (room_id);
