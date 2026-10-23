-- A user's uploaded MusicXML scores (the Sheet Music Hub). The first table
-- scoped by created_by rather than room_id: this is a personal library, not
-- room state, since it's a standalone top-level page, not a room feature.
-- The file itself lives on /data (server/sheet-music.ts), not as a blob here
-- — MusicXML/.mxl files run several MB, unlike library_items' deliberately
-- small, text-only PDFs (0009_library.sql's own blob-vs-file reasoning).
CREATE TABLE sheet_music_items (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL REFERENCES users (id),
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sheet_music_items_created_by_idx ON sheet_music_items (created_by, created_at);
