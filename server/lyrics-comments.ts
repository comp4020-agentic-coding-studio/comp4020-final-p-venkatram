import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { getLyrics } from "./lyrics.ts";

export interface LyricsComment {
  id: string;
  lineIndex: number;
  startOffset: number;
  endOffset: number;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: number;
}

interface LyricsCommentRow {
  id: string;
  line_index: number;
  start_offset: number;
  end_offset: number;
  author_id: string;
  author_name: string;
  text: string;
  created_at: number;
}

function toComment(row: LyricsCommentRow): LyricsComment {
  return {
    id: row.id,
    lineIndex: row.line_index,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    authorId: row.author_id,
    authorName: row.author_name,
    text: row.text,
    createdAt: row.created_at,
  };
}

export function listComments(db: DatabaseSync, roomId: string): LyricsComment[] {
  const rows = db
    .prepare("SELECT * FROM lyrics_comments WHERE room_id = ? ORDER BY created_at ASC")
    .all(roomId) as unknown as LyricsCommentRow[];
  return rows.map(toComment);
}

export function clearComments(db: DatabaseSync, roomId: string): void {
  db.prepare("DELETE FROM lyrics_comments WHERE room_id = ?").run(roomId);
}

// A comment must anchor inside the room's current lyrics — a stale line
// index or an out-of-range offset (the lyrics changed since the client last
// saw them) is silently ignored, the same "don't trust the client, just
// don't apply an invalid intent" posture as server/compositions.ts's
// isValidCell check.
export function addComment(
  db: DatabaseSync,
  roomId: string,
  lineIndex: number,
  startOffset: number,
  endOffset: number,
  authorId: string,
  authorName: string,
  text: string,
): LyricsComment | null {
  const trimmedText = text.trim();
  if (trimmedText.length === 0 || trimmedText.length > 2000) return null;

  const lyrics = getLyrics(db, roomId);
  const line = lyrics?.lines[lineIndex];
  if (!line) return null;
  if (
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endOffset) ||
    startOffset < 0 ||
    endOffset <= startOffset ||
    endOffset > line.text.length
  ) {
    return null;
  }

  const comment: LyricsComment = {
    id: randomUUID(),
    lineIndex,
    startOffset,
    endOffset,
    authorId,
    authorName,
    text: trimmedText,
    createdAt: Date.now(),
  };
  db.prepare(
    `INSERT INTO lyrics_comments
       (id, room_id, line_index, start_offset, end_offset, author_id, author_name, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    comment.id,
    roomId,
    comment.lineIndex,
    comment.startOffset,
    comment.endOffset,
    comment.authorId,
    comment.authorName,
    comment.text,
    comment.createdAt,
  );
  return comment;
}
