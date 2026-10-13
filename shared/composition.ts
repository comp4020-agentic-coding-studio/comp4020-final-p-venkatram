// Shared between server (validating edits) and client (rendering/playing
// them) — same reasoning as shared/grid.ts. A voice is just a named, ordered
// grid of cells; tempo stays room-wide (one shared clock for every voice).
import type { Cell } from "./grid.ts";

export interface Voice {
  id: string;
  name: string;
  order: number;
  cells: Cell[];
}

export interface CompositionState {
  bpm: number;
  voices: Voice[];
}

export const MAX_VOICES = 8;
export const MAX_VOICE_NAME_LENGTH = 40;

export function defaultVoiceName(order: number): string {
  return `Voice ${order + 1}`;
}
