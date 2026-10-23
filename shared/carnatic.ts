// The 16 Carnatic swarasthanas, mapped to the 12-note chromatic scale
// relative to a chosen tonic (Sa) — standard Carnatic theory, where several
// swara names are enharmonic (R2=G1, R3=G2, D2=N1, D3=N2: the same pitch
// has two names depending on which raga/context it's read in). Kept in
// shared/ alongside shared/theory.ts's Western tables since both describe
// "note name <-> semitone offset", just in two different naming systems.
export type Swara = "S" | "R1" | "R2" | "R3" | "G1" | "G2" | "G3" | "M1" | "M2" | "P" | "D1" | "D2" | "D3" | "N1" | "N2" | "N3";

export const SWARAS: Swara[] = ["S", "R1", "R2", "R3", "G1", "G2", "G3", "M1", "M2", "P", "D1", "D2", "D3", "N1", "N2", "N3"];

// Semitone offset from Sa (0-11) for each of the 16 names.
export const SWARA_SEMITONES: Record<Swara, number> = {
  S: 0,
  R1: 1,
  R2: 2,
  R3: 3,
  G1: 2, // enharmonic with R2
  G2: 3, // enharmonic with R3
  G3: 4,
  M1: 5,
  M2: 6,
  P: 7,
  D1: 8,
  D2: 9,
  D3: 10,
  N1: 9, // enharmonic with D2
  N2: 10, // enharmonic with D3
  N3: 11,
};

// The one canonical (most commonly used) swara name for each semitone offset
// — used when converting a Western note back to a single Carnatic name,
// since several names share a semitone (the enharmonic pairs above).
const SEMITONE_TO_SWARA: Swara[] = ["S", "R1", "R2", "G2", "G3", "M1", "M2", "P", "D1", "D2", "N2", "N3"];

export function swaraToSemitone(swara: Swara): number {
  return SWARA_SEMITONES[swara];
}

export function semitoneToSwara(semitoneFromSa: number): Swara {
  const idx = ((semitoneFromSa % 12) + 12) % 12;
  return SEMITONE_TO_SWARA[idx] as Swara;
}

// A swara's absolute MIDI pitch given which MIDI note is Sa (the tonic) and
// which octave span the swara sits in relative to Sa (0 = same octave,
// 1 = an octave above, -1 = an octave below) — kept separate from the
// semitone-offset math above since playback needs an absolute pitch, not
// just a position within one octave.
export function swaraToMidi(swara: Swara, saMidi: number, octaveOffset = 0): number {
  return saMidi + SWARA_SEMITONES[swara] + octaveOffset * 12;
}
