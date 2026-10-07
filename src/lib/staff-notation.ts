// Ported from comp4020-crit4 ("Polyphon")'s src/scripts/notation.ts — the
// diatonic-index math, ledger-line placement, and note-duration glyphs for
// the exact same 10-degree pentatonic system shared/grid.ts already uses
// (PENTATONIC = [0,2,4,7,9], BASE_MIDI = A3). The one real difference: there,
// a note's duration was derived from the same shape radius as its pitch;
// here duration is its own field on a Cell, chosen independently in the
// toolbar, so it's passed in rather than derived.
import { type DurationCategory, GRID_PITCHES } from "../../shared/grid";

export type StaffLetter = "A" | "B" | "C" | "D" | "E" | "F" | "G";

const LETTER_INDEX: Record<StaffLetter, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

function diatonicIndex(letter: StaffLetter, octave: number): number {
  return octave * 7 + LETTER_INDEX[letter];
}

// Treble clef: bottom line is E4, top line is F5.
const TREBLE_BOTTOM_LINE_INDEX = diatonicIndex("E", 4);
const TREBLE_TOP_LINE_INDEX = diatonicIndex("F", 5);

// This grid only ever produces these 10 exact pentatonic degrees (GRID_PITCHES),
// so a literal letter/octave table is unambiguous, same as crit4.
const DEGREE_TABLE: { letter: StaffLetter; sharp: boolean; octave: number }[] = [
  { letter: "A", sharp: false, octave: 3 }, // 0
  { letter: "B", sharp: false, octave: 3 }, // 1
  { letter: "C", sharp: true, octave: 4 }, // 2
  { letter: "E", sharp: false, octave: 4 }, // 3
  { letter: "F", sharp: true, octave: 4 }, // 4
  { letter: "A", sharp: false, octave: 4 }, // 5
  { letter: "B", sharp: false, octave: 4 }, // 6
  { letter: "C", sharp: true, octave: 5 }, // 7
  { letter: "E", sharp: false, octave: 5 }, // 8
  { letter: "F", sharp: true, octave: 5 }, // 9
];

if (DEGREE_TABLE.length !== GRID_PITCHES) {
  throw new Error("staff-notation's DEGREE_TABLE must have exactly GRID_PITCHES entries");
}

export const DURATION_LABELS = ["sixteenth", "eighth", "quarter", "half", "whole"] as const;

export interface NoteGlyph {
  open: boolean; // hollow notehead (half, whole) vs filled (quarter, eighth, sixteenth)
  stem: boolean; // whole notes have no stem
  flags: 0 | 1 | 2;
}

export function noteGlyph(duration: DurationCategory): NoteGlyph {
  switch (duration) {
    case 4:
      return { open: true, stem: false, flags: 0 };
    case 3:
      return { open: true, stem: true, flags: 0 };
    case 2:
      return { open: false, stem: true, flags: 0 };
    case 1:
      return { open: false, stem: true, flags: 1 };
    default:
      return { open: false, stem: true, flags: 2 };
  }
}

export type LedgerSide = "above" | "below" | "none";

export interface StaffNote {
  pitchIndex: number;
  letter: StaffLetter;
  sharp: boolean;
  octave: number;
  diatonicIndex: number;
  ledgerLines: number;
  ledgerSide: LedgerSide;
  duration: DurationCategory;
  durationLabel: (typeof DURATION_LABELS)[number];
  glyph: NoteGlyph;
}

export function pitchToStaffNote(pitchIndex: number, duration: DurationCategory): StaffNote {
  const entry = DEGREE_TABLE[((pitchIndex % DEGREE_TABLE.length) + DEGREE_TABLE.length) % DEGREE_TABLE.length]!;
  const idx = diatonicIndex(entry.letter, entry.octave);

  let ledgerLines = 0;
  let ledgerSide: LedgerSide = "none";
  if (idx < TREBLE_BOTTOM_LINE_INDEX) {
    ledgerLines = Math.floor((TREBLE_BOTTOM_LINE_INDEX - idx) / 2);
    ledgerSide = "below";
  } else if (idx > TREBLE_TOP_LINE_INDEX) {
    ledgerLines = Math.floor((idx - TREBLE_TOP_LINE_INDEX) / 2);
    ledgerSide = "above";
  }

  return {
    pitchIndex,
    letter: entry.letter,
    sharp: entry.sharp,
    octave: entry.octave,
    diatonicIndex: idx,
    ledgerLines,
    ledgerSide,
    duration,
    durationLabel: DURATION_LABELS[duration],
    glyph: noteGlyph(duration),
  };
}

// Vertical placement on an SVG staff: each diatonic step (one letter) moves
// half a line-spacing, so two steps (a line to the next line) is one full
// spacing, matching how lines and spaces alternate per step.
export function diatonicIndexToY(idx: number, bottomLineY: number, halfLineSpacing: number): number {
  return bottomLineY - (idx - TREBLE_BOTTOM_LINE_INDEX) * halfLineSpacing;
}
