// The server is the one source of truth for a room's composition: a client
// sends intent (toggle this cell, set this tempo), the server applies it to
// SQLite and broadcasts the resulting state to everyone in the room,
// including whoever sent the change. No client-side optimistic update to
// reconcile later — see PROCESS.md's crit 9 ADR for why last-writer-wins
// without locking is the right shape for a small, low-conflict room.
import type { DatabaseSync } from "node:sqlite";
import { clampBpm, DEFAULT_BPM, type Cell, type DurationCategory, isValidCell } from "../shared/grid.ts";

export interface CompositionState {
  bpm: number;
  cells: Cell[];
}

interface CompositionRow {
  bpm: number;
  grid: string;
}

export function getComposition(db: DatabaseSync, roomId: string): CompositionState {
  const row = db.prepare("SELECT bpm, grid FROM compositions WHERE room_id = ?").get(roomId) as
    | CompositionRow
    | undefined;
  if (!row) return { bpm: DEFAULT_BPM, cells: [] };
  try {
    const cells = JSON.parse(row.grid) as Cell[];
    return { bpm: row.bpm, cells: Array.isArray(cells) ? cells : [] };
  } catch {
    return { bpm: row.bpm, cells: [] };
  }
}

function save(db: DatabaseSync, roomId: string, state: CompositionState): void {
  db.prepare(
    `INSERT INTO compositions (room_id, bpm, grid, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET bpm = excluded.bpm, grid = excluded.grid, updated_at = excluded.updated_at`,
  ).run(roomId, state.bpm, JSON.stringify(state.cells), Date.now());
}

// A click always toggles by (step, pitch) alone, duration included: clicking
// an occupied slot removes whatever note is there regardless of its
// duration, clicking an empty one places a note at the duration the client
// currently has selected in its toolbar.
export function toggleCell(
  db: DatabaseSync,
  roomId: string,
  step: number,
  pitch: number,
  duration: number,
): CompositionState | null {
  if (!isValidCell(step, pitch, duration)) return null;
  const current = getComposition(db, roomId);
  const exists = current.cells.some(([s, p]) => s === step && p === pitch);
  const cells: Cell[] = exists
    ? current.cells.filter(([s, p]) => !(s === step && p === pitch))
    : [...current.cells, [step, pitch, duration as DurationCategory]];
  const next = { bpm: current.bpm, cells };
  save(db, roomId, next);
  return next;
}

export function setTempo(db: DatabaseSync, roomId: string, bpm: number): CompositionState {
  const current = getComposition(db, roomId);
  const next = { bpm: clampBpm(bpm), cells: current.cells };
  save(db, roomId, next);
  return next;
}
