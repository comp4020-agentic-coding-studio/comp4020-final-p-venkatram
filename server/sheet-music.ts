// The Sheet Music Hub's data access: a user's uploaded MusicXML scores.
// Unlike library.ts's PDFs (small, text-only, stored as real blobs), a
// MusicXML/.mxl file can run several MB — stored as a real file under
// /data instead, with the DB row holding just metadata and the path,
// mirroring db.ts's own /data-vs-./.data fallback so this works the same
// in CI (tmpfs /data) and local dev (no /data at all).
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function storageDir(): string {
  const dir = existsSync("/data") ? "/data/sheet-music" : "./.data/sheet-music";
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface SheetMusicItem {
  id: string;
  title: string;
  mime: string;
  createdAt: number;
}

interface SheetMusicRow {
  id: string;
  title: string;
  file_path: string;
  mime: string;
  created_at: number;
}

const MAX_TITLE_LENGTH = 160;

function toItem(row: SheetMusicRow): SheetMusicItem {
  return { id: row.id, title: row.title, mime: row.mime, createdAt: row.created_at };
}

export function listSheetMusicItems(db: DatabaseSync, userId: string): SheetMusicItem[] {
  const rows = db
    .prepare("SELECT id, title, file_path, mime, created_at FROM sheet_music_items WHERE created_by = ? ORDER BY created_at DESC")
    .all(userId) as unknown as SheetMusicRow[];
  return rows.map(toItem);
}

export function addSheetMusicItem(
  db: DatabaseSync,
  userId: string,
  title: string,
  fileBuffer: Buffer,
  mime: string,
): SheetMusicItem {
  const id = randomUUID();
  const createdAt = Date.now();
  const trimmedTitle = title.trim().slice(0, MAX_TITLE_LENGTH) || "Untitled score";
  const filePath = join(storageDir(), `${id}.musicxml`);
  writeFileSync(filePath, fileBuffer);
  db.prepare(
    `INSERT INTO sheet_music_items (id, created_by, title, file_path, mime, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, trimmedTitle, filePath, mime, createdAt);
  return { id, title: trimmedTitle, mime, createdAt };
}

export function getSheetMusicFilePath(db: DatabaseSync, itemId: string, userId: string): { path: string; mime: string; title: string } | null {
  const row = db
    .prepare("SELECT file_path, mime, title FROM sheet_music_items WHERE id = ? AND created_by = ?")
    .get(itemId, userId) as { file_path: string; mime: string; title: string } | undefined;
  if (!row) return null;
  return { path: row.file_path, mime: row.mime, title: row.title };
}

export function deleteSheetMusicItem(db: DatabaseSync, itemId: string, userId: string): boolean {
  const row = db
    .prepare("SELECT file_path FROM sheet_music_items WHERE id = ? AND created_by = ?")
    .get(itemId, userId) as { file_path: string } | undefined;
  if (!row) return false;
  const result = db.prepare("DELETE FROM sheet_music_items WHERE id = ? AND created_by = ?").run(itemId, userId);
  if (result.changes > 0 && existsSync(row.file_path)) unlinkSync(row.file_path);
  return result.changes > 0;
}
