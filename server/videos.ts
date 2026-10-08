import type { DatabaseSync } from "node:sqlite";
import { extractYouTubeId } from "../shared/youtube.ts";

export interface VideoState {
  youtubeId: string | null;
}

interface VideoRow {
  youtube_id: string | null;
}

export function getVideo(db: DatabaseSync, roomId: string): VideoState {
  const row = db.prepare("SELECT youtube_id FROM videos WHERE room_id = ?").get(roomId) as VideoRow | undefined;
  return { youtubeId: row?.youtube_id ?? null };
}

// Returns null for input that isn't a recognizable YouTube URL or bare video
// id — the caller treats that as a validation failure, not a valid "no
// video" state (that's only ever the stored value being genuinely empty).
export function setVideo(db: DatabaseSync, roomId: string, rawInput: string): VideoState | null {
  const youtubeId = extractYouTubeId(rawInput);
  if (!youtubeId) return null;
  db.prepare(
    `INSERT INTO videos (room_id, youtube_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET youtube_id = excluded.youtube_id, updated_at = excluded.updated_at`,
  ).run(roomId, youtubeId, Date.now());
  return { youtubeId };
}
