-- A voice can now span more than one 16-step bar, each rendered as its own
-- staff line (shared/composition.ts's MAX_BARS_PER_VOICE, DEFAULT_BARS).
-- Every existing voice already fits in its original one bar, so it backfills
-- to 1 rather than needing any grid data to move.
ALTER TABLE composition_voices ADD COLUMN bars INTEGER NOT NULL DEFAULT 1;
