-- Multiple independently-editable voices per room, sharing one tempo clock
-- (bpm moves to composition_rooms, one row per room). Replaces compositions'
-- single-grid shape: the room now composes N staves, not one.
CREATE TABLE composition_rooms (
  room_id TEXT PRIMARY KEY REFERENCES rooms (id) ON DELETE CASCADE,
  bpm INTEGER NOT NULL DEFAULT 96,
  updated_at INTEGER NOT NULL
);

CREATE TABLE composition_voices (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  grid TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
CREATE INDEX composition_voices_room_idx ON composition_voices (room_id, sort_order);

-- Backfill: every existing single-grid room becomes "Voice 1" so no
-- in-progress composition is lost.
INSERT INTO composition_rooms (room_id, bpm, updated_at)
  SELECT room_id, bpm, updated_at FROM compositions;

INSERT INTO composition_voices (id, room_id, name, sort_order, grid, updated_at)
  SELECT room_id || '-v1', room_id, 'Voice 1', 0, grid, updated_at FROM compositions;

-- Safe to drop here: migrations apply once each, in order, never replayed
-- (server/db.ts) — nothing else reads this table after this file runs
-- (server/routes/stats.ts is updated in this same commit to read
-- composition_voices instead).
DROP TABLE compositions;
