// Shared between server (validating edits) and client (playing/rendering
// them) — one definition of the grid's shape so they can't disagree. The
// pentatonic-degree approach is adapted from comp4020-crit4 ("Polyphon")'s
// audio.ts: every pitch row lands on a scale degree, so there's no way to
// place a "wrong" note, the same idea applied to a grid instead of a shape.
export const GRID_STEPS = 16;
export const GRID_PITCHES = 10;
export const DEFAULT_BPM = 96;
export const MIN_BPM = 40;
export const MAX_BPM = 220;

export const PENTATONIC = [0, 2, 4, 7, 9];
const BASE_MIDI = 57; // A3 — a comfortable low register across two octaves

export type Cell = [step: number, pitch: number];

export function pitchIndexToMidi(pitchIndex: number): number {
  const clamped = Math.max(0, Math.min(GRID_PITCHES - 1, pitchIndex));
  const octave = Math.floor(clamped / PENTATONIC.length);
  const degree = PENTATONIC[clamped % PENTATONIC.length] ?? 0;
  return BASE_MIDI + octave * 12 + degree;
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function isValidCell(step: number, pitch: number): boolean {
  return Number.isInteger(step) && Number.isInteger(pitch) && step >= 0 && step < GRID_STEPS && pitch >= 0 && pitch < GRID_PITCHES;
}

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return DEFAULT_BPM;
  return Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm)));
}
