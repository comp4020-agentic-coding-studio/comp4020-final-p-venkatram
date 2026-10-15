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

// Same five categories as crit4's audio.ts, sixteenth..whole — a note's
// duration is which of these it was placed as, not a free time value, so
// there's a fixed, known set of release lengths (composition-player.ts) and
// glyphs (staff-notation.ts) to draw from.
export const DURATION_CATEGORIES = [0, 1, 2, 3, 4] as const;
export type DurationCategory = (typeof DURATION_CATEGORIES)[number];
export const DEFAULT_DURATION: DurationCategory = 2; // quarter

// How much longer a note rings for each duration category, relative to the
// base (quarter) release — ported from crit4's audio.ts
// DURATION_RELEASE_MULTIPLIERS. Index 2 (quarter) is 1.0, the unscaled sound.
export const DURATION_RELEASE_MULTIPLIERS: Record<DurationCategory, number> = {
  0: 0.4, // sixteenth
  1: 0.65, // eighth
  2: 1.0, // quarter
  3: 1.5, // half
  4: 2.2, // whole
};

export type Cell = [step: number, pitch: number, duration: DurationCategory];

export function pitchIndexToMidi(pitchIndex: number): number {
  const clamped = Math.max(0, Math.min(GRID_PITCHES - 1, pitchIndex));
  const octave = Math.floor(clamped / PENTATONIC.length);
  const degree = PENTATONIC[clamped % PENTATONIC.length] ?? 0;
  return BASE_MIDI + octave * 12 + degree;
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function isValidDuration(duration: number): duration is DurationCategory {
  return (DURATION_CATEGORIES as readonly number[]).includes(duration);
}

// `maxStep` defaults to one bar (GRID_STEPS) but a voice with more bars
// (shared/composition.ts's Voice.bars) passes its real total — a cell's
// `step` is a flat index across every bar that voice has, not reset per bar.
export function isValidCell(step: number, pitch: number, duration: number, maxStep: number = GRID_STEPS): boolean {
  return (
    Number.isInteger(step) &&
    Number.isInteger(pitch) &&
    step >= 0 &&
    step < maxStep &&
    pitch >= 0 &&
    pitch < GRID_PITCHES &&
    isValidDuration(duration)
  );
}

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return DEFAULT_BPM;
  return Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm)));
}
