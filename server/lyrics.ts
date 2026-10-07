import type { DatabaseSync } from "node:sqlite";
import { type LyricLine, parseLyrics } from "../shared/lyrics.ts";

export interface LyricsDocument {
  title: string;
  lines: LyricLine[];
}

interface LyricsRow {
  title: string;
  lines: string;
}

export function getLyrics(db: DatabaseSync, roomId: string): LyricsDocument | null {
  const row = db.prepare("SELECT title, lines FROM lyrics WHERE room_id = ?").get(roomId) as LyricsRow | undefined;
  if (!row) return null;
  try {
    return { title: row.title, lines: JSON.parse(row.lines) as LyricLine[] };
  } catch {
    return { title: row.title, lines: [] };
  }
}

export function saveLyrics(db: DatabaseSync, roomId: string, title: string, raw: string): LyricsDocument {
  const trimmedTitle = title.trim().length > 0 ? title.trim() : "Untitled";
  const lines = parseLyrics(raw);
  db.prepare(
    `INSERT INTO lyrics (room_id, title, lines, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET title = excluded.title, lines = excluded.lines, updated_at = excluded.updated_at`,
  ).run(roomId, trimmedTitle, JSON.stringify(lines), Date.now());
  return { title: trimmedTitle, lines };
}
