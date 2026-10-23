// Western music-theory tables shared by the Tools page's finders
// (src/lib/finder-tool.ts), the virtual piano, and the Sheet Music Hub —
// one definition of note names, intervals, chords and scales so none of
// them can disagree, matching how shared/grid.ts is the one definition the
// composition grid's client and server agree on. Everything here is plain
// data/pure functions — no DOM, no audio — so it's safe to import from
// either a browser module or (if a future feature needs it) the server.
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export type NoteName = (typeof NOTE_NAMES)[number];

export function midiToNoteName(midi: number): { name: NoteName; octave: number } {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12] as NoteName;
  const octave = Math.floor(midi / 12) - 1; // MIDI 60 = C4
  return { name, octave };
}

export function noteNameToMidi(name: NoteName, octave: number): number {
  return (octave + 1) * 12 + NOTE_NAMES.indexOf(name);
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

// Index is the semitone distance (0-24, spanning up to two octaves — enough
// for any interval the finder needs to name between two picked notes).
export const INTERVAL_NAMES: Record<number, string> = {
  0: "Unison",
  1: "Minor 2nd",
  2: "Major 2nd",
  3: "Minor 3rd",
  4: "Major 3rd",
  5: "Perfect 4th",
  6: "Tritone",
  7: "Perfect 5th",
  8: "Minor 6th",
  9: "Major 6th",
  10: "Minor 7th",
  11: "Major 7th",
  12: "Octave",
  13: "Minor 9th",
  14: "Major 9th",
  15: "Minor 10th",
  16: "Major 10th",
  17: "Perfect 11th",
  18: "Augmented 11th",
  19: "Perfect 12th",
  20: "Minor 13th",
  21: "Major 13th",
  22: "Minor 14th",
  23: "Major 14th",
  24: "Double octave",
};

export function intervalName(semitones: number): string {
  const abs = Math.abs(semitones) % 25;
  return INTERVAL_NAMES[abs] ?? `${abs} semitones`;
}

export interface ChordFormula {
  id: string;
  label: string;
  intervals: number[]; // semitone offsets from the root, root always 0
}

export const CHORDS: ChordFormula[] = [
  { id: "major", label: "Major", intervals: [0, 4, 7] },
  { id: "minor", label: "Minor", intervals: [0, 3, 7] },
  { id: "dim", label: "Diminished", intervals: [0, 3, 6] },
  { id: "aug", label: "Augmented", intervals: [0, 4, 8] },
  { id: "sus2", label: "Suspended 2nd", intervals: [0, 2, 7] },
  { id: "sus4", label: "Suspended 4th", intervals: [0, 5, 7] },
  { id: "maj7", label: "Major 7th", intervals: [0, 4, 7, 11] },
  { id: "min7", label: "Minor 7th", intervals: [0, 3, 7, 10] },
  { id: "dom7", label: "Dominant 7th", intervals: [0, 4, 7, 10] },
  { id: "dim7", label: "Diminished 7th", intervals: [0, 3, 6, 9] },
];

export interface ScaleFormula {
  id: string;
  label: string;
  intervals: number[]; // ascending semitone offsets from the tonic, tonic always 0
}

export const SCALES: ScaleFormula[] = [
  { id: "major", label: "Major (Ionian)", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "natural-minor", label: "Natural Minor (Aeolian)", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "harmonic-minor", label: "Harmonic Minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: "melodic-minor", label: "Melodic Minor (ascending)", intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: "dorian", label: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "phrygian", label: "Phrygian", intervals: [0, 1, 3, 5, 7, 8, 10] },
  { id: "lydian", label: "Lydian", intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: "mixolydian", label: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: "locrian", label: "Locrian", intervals: [0, 1, 3, 5, 6, 8, 10] },
  { id: "major-pentatonic", label: "Major Pentatonic", intervals: [0, 2, 4, 7, 9] },
  { id: "minor-pentatonic", label: "Minor Pentatonic", intervals: [0, 3, 5, 7, 10] },
  { id: "chromatic", label: "Chromatic", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

// Returns the MIDI notes of a chord/scale, rooted at `rootMidi`, from a
// formula's semitone offsets — shared by both the chord and scale finders
// since the math is identical (offsets relative to one root note).
export function notesFromFormula(rootMidi: number, intervals: number[]): number[] {
  return intervals.map((offset) => rootMidi + offset);
}
