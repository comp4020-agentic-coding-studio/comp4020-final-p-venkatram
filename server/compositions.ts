// The server is the one source of truth for a room's composition: a client
// sends intent (toggle this cell, add/rename/remove a voice, set this
// tempo), the server applies it to SQLite and broadcasts the resulting state
// to everyone, including whoever sent the change. No client-side optimistic
// update to reconcile later — see PROCESS.md's crit 9 ADR for why
// last-writer-wins without locking is the right shape for a small,
// low-conflict room. Multiple voices share one tempo (composition_rooms) but
// each has its own independently-edited grid (composition_voices),
// validated and scoped by room_id so a stale or forged voice id from
// another room can never be read or written.
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { clampBpm, DEFAULT_BPM, GRID_STEPS, type Cell, isValidCell } from "../shared/grid.ts";
import {
  DEFAULT_BARS,
  DEFAULT_INSTRUMENT,
  defaultVoiceName,
  type InstrumentId,
  isValidInstrument,
  MAX_BARS_PER_VOICE,
  MAX_VOICE_NAME_LENGTH,
  MAX_VOICES,
  type CompositionState,
  type Voice,
} from "../shared/composition.ts";

interface VoiceRow {
  id: string;
  name: string;
  sort_order: number;
  grid: string;
  bars: number;
  instrument: string;
}

function toVoice(row: VoiceRow): Voice {
  let cells: Cell[] = [];
  try {
    const parsed: unknown = JSON.parse(row.grid);
    if (Array.isArray(parsed)) cells = parsed as Cell[];
  } catch {
    cells = [];
  }
  const instrument: InstrumentId = isValidInstrument(row.instrument) ? row.instrument : DEFAULT_INSTRUMENT;
  return { id: row.id, name: row.name, order: row.sort_order, cells, bars: row.bars, instrument };
}

function listVoices(db: DatabaseSync, roomId: string): Voice[] {
  const rows = db
    .prepare(
      "SELECT id, name, sort_order, grid, bars, instrument FROM composition_voices WHERE room_id = ? ORDER BY sort_order ASC",
    )
    .all(roomId) as unknown as VoiceRow[];
  return rows.map(toVoice);
}

function getBpm(db: DatabaseSync, roomId: string): number {
  const row = db.prepare("SELECT bpm FROM composition_rooms WHERE room_id = ?").get(roomId) as { bpm: number } | undefined;
  return row ? row.bpm : DEFAULT_BPM;
}

function saveBpm(db: DatabaseSync, roomId: string, bpm: number): void {
  db.prepare(
    `INSERT INTO composition_rooms (room_id, bpm, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET bpm = excluded.bpm, updated_at = excluded.updated_at`,
  ).run(roomId, bpm, Date.now());
}

function voiceExists(db: DatabaseSync, roomId: string, voiceId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM composition_voices WHERE id = ? AND room_id = ?").get(voiceId, roomId));
}

function saveVoiceGrid(db: DatabaseSync, roomId: string, voiceId: string, cells: Cell[]): void {
  db.prepare("UPDATE composition_voices SET grid = ?, updated_at = ? WHERE id = ? AND room_id = ?").run(
    JSON.stringify(cells),
    Date.now(),
    voiceId,
    roomId,
  );
}

export function getComposition(db: DatabaseSync, roomId: string): CompositionState {
  return { bpm: getBpm(db, roomId), voices: listVoices(db, roomId) };
}

// A click toggles by (step, pitch), with the currently-selected duration
// deciding what "toggle" means on an occupied cell: the same duration as
// what's already there removes the note (click it off), any other duration
// replaces it in place — so changing a note's length is one click, not
// delete-then-reclick. An empty cell always places a new note. `step` is a
// flat index across every bar this voice has (shared/composition.ts's
// Voice.bars), so the valid range grows with the voice, not fixed at one
// bar. Scoped to one voice; an invalid cell or a voice id that doesn't
// belong to this room is just ignored.
export function toggleCell(
  db: DatabaseSync,
  roomId: string,
  voiceId: string,
  step: number,
  pitch: number,
  duration: number,
): CompositionState | null {
  if (!voiceExists(db, roomId, voiceId)) return null;
  const voices = listVoices(db, roomId);
  const voice = voices.find((v) => v.id === voiceId);
  if (!voice) return null;
  if (!isValidCell(step, pitch, duration, voice.bars * GRID_STEPS)) return null;

  const existingIndex = voice.cells.findIndex(([s, p]) => s === step && p === pitch);
  let cells: Cell[];
  if (existingIndex === -1) {
    cells = [...voice.cells, [step, pitch, duration as Cell[2]]];
  } else if (voice.cells[existingIndex]![2] === duration) {
    cells = voice.cells.filter((_, i) => i !== existingIndex);
  } else {
    cells = voice.cells.map((cell, i) => (i === existingIndex ? [step, pitch, duration as Cell[2]] : cell));
  }
  saveVoiceGrid(db, roomId, voiceId, cells);
  return getComposition(db, roomId);
}

export function setTempo(db: DatabaseSync, roomId: string, bpm: number): CompositionState {
  saveBpm(db, roomId, clampBpm(bpm));
  return getComposition(db, roomId);
}

export function addVoice(db: DatabaseSync, roomId: string, name?: string): CompositionState | null {
  const existing = listVoices(db, roomId);
  if (existing.length >= MAX_VOICES) return null;
  const trimmedName = (name ?? "").trim();
  const finalName =
    trimmedName.length > 0 ? trimmedName.slice(0, MAX_VOICE_NAME_LENGTH) : defaultVoiceName(existing.length);
  const order = existing.length === 0 ? 0 : Math.max(...existing.map((v) => v.order)) + 1;
  db.prepare(
    "INSERT INTO composition_voices (id, room_id, name, sort_order, grid, bars, updated_at) VALUES (?, ?, ?, ?, '[]', ?, ?)",
  ).run(randomUUID(), roomId, finalName, order, DEFAULT_BARS, Date.now());
  return getComposition(db, roomId);
}

export function removeVoice(db: DatabaseSync, roomId: string, voiceId: string): CompositionState {
  db.prepare("DELETE FROM composition_voices WHERE id = ? AND room_id = ?").run(voiceId, roomId);
  return getComposition(db, roomId);
}

// Extends a voice by one more 16-step bar — a second staff line underneath
// the first, the flat `step` range it accepts growing to match (toggleCell's
// own bounds check reads this same column). Existing notes keep their exact
// step, so nothing already placed moves when a bar is added. A no-op past
// MAX_BARS_PER_VOICE or for an unknown/foreign voice id, same as every other
// composition edit here.
export function addBar(db: DatabaseSync, roomId: string, voiceId: string): CompositionState | null {
  const voices = listVoices(db, roomId);
  const voice = voices.find((v) => v.id === voiceId);
  if (!voice || voice.bars >= MAX_BARS_PER_VOICE) return null;
  db.prepare("UPDATE composition_voices SET bars = bars + 1, updated_at = ? WHERE id = ? AND room_id = ?").run(
    Date.now(),
    voiceId,
    roomId,
  );
  return getComposition(db, roomId);
}

export function renameVoice(db: DatabaseSync, roomId: string, voiceId: string, name: string): CompositionState | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || !voiceExists(db, roomId, voiceId)) return null;
  db.prepare("UPDATE composition_voices SET name = ?, updated_at = ? WHERE id = ? AND room_id = ?").run(
    trimmed.slice(0, MAX_VOICE_NAME_LENGTH),
    Date.now(),
    voiceId,
    roomId,
  );
  return getComposition(db, roomId);
}

// A voice's instrument is purely a playback choice (which oscillator
// waveform composition-player.ts uses for it) — doesn't touch the grid, so
// there's nothing to validate beyond the id itself being one of the four
// shared/composition.ts actually defines.
export function setVoiceInstrument(
  db: DatabaseSync,
  roomId: string,
  voiceId: string,
  instrument: string,
): CompositionState | null {
  if (!isValidInstrument(instrument) || !voiceExists(db, roomId, voiceId)) return null;
  db.prepare("UPDATE composition_voices SET instrument = ?, updated_at = ? WHERE id = ? AND room_id = ?").run(
    instrument,
    Date.now(),
    voiceId,
    roomId,
  );
  return getComposition(db, roomId);
}
