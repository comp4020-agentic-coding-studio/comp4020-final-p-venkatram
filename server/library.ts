// A room's saved reference material. PDFs are stored as real blobs (small,
// text-based — fits this app's storage budget easily). Recordings are never
// stored here (audio/video can be multi-MB, and this process has no spare
// capacity to receive or hold media) — a recording's row is metadata plus an
// external_url the organizer fills in after manually uploading to their own
// Drive/OneDrive (server/routes/library.ts's PATCH route).
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export type LibraryItemType = "recording" | "pdf";

export interface LibraryItem {
  id: string;
  roomId: string;
  type: LibraryItemType;
  title: string;
  externalUrl: string | null;
  hasFile: boolean;
  createdBy: string;
  createdAt: number;
  archivedAt: number | null;
}

interface LibraryItemRow {
  id: string;
  room_id: string;
  type: LibraryItemType;
  title: string;
  external_url: string | null;
  file_blob: Buffer | null;
  created_by: string;
  created_at: number;
  archived_at: number | null;
}

function toItem(row: LibraryItemRow): LibraryItem {
  return {
    id: row.id,
    roomId: row.room_id,
    type: row.type,
    title: row.title,
    externalUrl: row.external_url,
    hasFile: row.file_blob !== null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  };
}

const MAX_TITLE_LENGTH = 160;

export function listLibraryItems(db: DatabaseSync, roomId: string, includeArchived = false): LibraryItem[] {
  const rows = db
    .prepare(
      `SELECT id, room_id, type, title, external_url, file_blob, created_by, created_at, archived_at
       FROM library_items
       WHERE room_id = ? ${includeArchived ? "" : "AND archived_at IS NULL"}
       ORDER BY created_at DESC`,
    )
    .all(roomId) as unknown as LibraryItemRow[];
  return rows.map(toItem);
}

export function addRecordingItem(db: DatabaseSync, roomId: string, title: string, createdBy: string): LibraryItem {
  const id = randomUUID();
  const createdAt = Date.now();
  const trimmedTitle = title.trim().slice(0, MAX_TITLE_LENGTH) || "Untitled recording";
  db.prepare(
    `INSERT INTO library_items (id, room_id, type, title, external_url, created_by, created_at)
     VALUES (?, ?, 'recording', ?, NULL, ?, ?)`,
  ).run(id, roomId, trimmedTitle, createdBy, createdAt);
  return {
    id,
    roomId,
    type: "recording",
    title: trimmedTitle,
    externalUrl: null,
    hasFile: false,
    createdBy,
    createdAt,
    archivedAt: null,
  };
}

export function addPdfItem(
  db: DatabaseSync,
  roomId: string,
  title: string,
  fileBlob: Buffer,
  fileMime: string,
  createdBy: string,
): LibraryItem {
  const id = randomUUID();
  const createdAt = Date.now();
  const trimmedTitle = title.trim().slice(0, MAX_TITLE_LENGTH) || "Untitled document";
  db.prepare(
    `INSERT INTO library_items (id, room_id, type, title, file_blob, file_mime, created_by, created_at)
     VALUES (?, ?, 'pdf', ?, ?, ?, ?, ?)`,
  ).run(id, roomId, trimmedTitle, fileBlob, fileMime, createdBy, createdAt);
  return {
    id,
    roomId,
    type: "pdf",
    title: trimmedTitle,
    externalUrl: null,
    hasFile: true,
    createdBy,
    createdAt,
    archivedAt: null,
  };
}

// Owner-only: paste in the external link after manually uploading a
// recording to Drive/OneDrive. Scoped by joining to the room's own_id so
// only that room's organizer — not just anyone with a session — can set it.
export function setLibraryItemLink(db: DatabaseSync, itemId: string, requesterId: string, externalUrl: string): boolean {
  const result = db
    .prepare(
      `UPDATE library_items SET external_url = ?
       WHERE id = ? AND type = 'recording'
         AND room_id IN (SELECT id FROM rooms WHERE owner_id = ?)`,
    )
    .run(externalUrl.trim(), itemId, requesterId);
  return result.changes > 0;
}

export function getLibraryFile(db: DatabaseSync, itemId: string): { blob: Buffer; mime: string; title: string } | null {
  const row = db.prepare("SELECT file_blob, file_mime, title FROM library_items WHERE id = ? AND type = 'pdf'").get(itemId) as
    | { file_blob: Buffer | null; file_mime: string | null; title: string }
    | undefined;
  if (!row || !row.file_blob || !row.file_mime) return null;
  return { blob: row.file_blob, mime: row.file_mime, title: row.title };
}
