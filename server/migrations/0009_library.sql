-- A room's saved reference material: PDFs exported from the lyrics or
-- composition panels (stored as real blobs — small, text-based, nothing
-- close to the 1GB volume), and recordings (metadata plus an external_url
-- the organizer pastes in after manually uploading to their own Drive/
-- OneDrive, since this app has no spare 256MB-process capacity to receive,
-- store, or transcode media). warned_at/archived_at back the monthly
-- archive sweep (server/library-sweep.ts): archived means hidden from the
-- default view, not deleted.
CREATE TABLE library_items (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('recording', 'pdf')),
  title TEXT NOT NULL,
  external_url TEXT,
  file_blob BLOB,
  file_mime TEXT,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  warned_at INTEGER,
  archived_at INTEGER
);
CREATE INDEX library_items_room_idx ON library_items (room_id, created_at);
