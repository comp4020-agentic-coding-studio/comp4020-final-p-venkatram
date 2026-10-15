// Shared between server (validating edits) and client (rendering/playing
// them) — same reasoning as shared/grid.ts. A voice is just a named, ordered
// grid of cells; tempo stays room-wide (one shared clock for every voice).
import type { Cell } from "./grid.ts";

// Playback here is Web Audio oscillators, not sampled instruments — there's
// no audio asset pipeline on a 256MB machine with no spare capacity for it
// (the same reasoning CLAUDE.md gives for not reintroducing any kind of
// audio processing nobody asked for). So "choice of instrument" is honestly
// a choice of oscillator waveform, each labeled by the instrument its timbre
// most resembles rather than claiming to BE that instrument.
export const INSTRUMENTS = [
  { id: "sine", label: "Flute (sine)" },
  { id: "triangle", label: "Clarinet (triangle)" },
  { id: "sawtooth", label: "Strings (sawtooth)" },
  { id: "square", label: "Synth (square)" },
] as const;
export type InstrumentId = (typeof INSTRUMENTS)[number]["id"];
export const DEFAULT_INSTRUMENT: InstrumentId = "sine";

export function isValidInstrument(value: string): value is InstrumentId {
  return INSTRUMENTS.some((i) => i.id === value);
}

export interface Voice {
  id: string;
  name: string;
  order: number;
  cells: Cell[];
  // How many 16-step bars this voice currently has — each one renders as its
  // own staff line stacked under the voice's name, the same way a line of
  // sheet music turns into two once there's more to write. A cell's `step`
  // is a flat index across every bar (bar 1 is steps 0-15, bar 2 is 16-31,
  // and so on), not reset per bar.
  bars: number;
  instrument: InstrumentId;
}

export interface CompositionState {
  bpm: number;
  voices: Voice[];
}

export const MAX_VOICES = 8;
export const MAX_VOICE_NAME_LENGTH = 40;
export const DEFAULT_BARS = 1;
export const MAX_BARS_PER_VOICE = 4;

export function defaultVoiceName(order: number): string {
  return `Voice ${order + 1}`;
}
