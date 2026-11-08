// Note / Interval / Chord / Scale finders — pure client-side music theory
// (shared/theory.ts), each a small independent form that shows a result and
// can play it back via composition-player.ts's shared oscillator envelope
// (the same fix that corrected note sustain for the Composition grid).
import { scheduleOscillatorNote } from "./composition-player";
import { DEFAULT_INSTRUMENT } from "../../shared/composition";
import {
  CHORDS,
  intervalName,
  midiToFrequency,
  midiToNoteName,
  NOTE_NAMES,
  noteNameToMidi,
  notesFromFormula,
  type NoteName,
  SCALES,
} from "../../shared/theory";

let sharedCtx: AudioContext | null = null;
function audioCtx(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  void sharedCtx.resume();
  return sharedCtx;
}

// Plays a set of MIDI notes one after another (ascending runs, like a scale)
// or together (a chord strum) — `gapSec` of 0 means "together".
function playSequence(midiNotes: number[], gapSec: number): void {
  const ctx = audioCtx();
  const noteLen = 0.5;
  midiNotes.forEach((midi, i) => {
    const onTime = ctx.currentTime + i * gapSec;
    scheduleOscillatorNote(ctx, midiToFrequency(midi), DEFAULT_INSTRUMENT, onTime, noteLen, 0.2);
  });
}

function noteSelect(): HTMLSelectElement {
  const select = document.createElement("select");
  for (const name of NOTE_NAMES) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.append(opt);
  }
  return select;
}

function labeledField(labelText: string, input: HTMLElement): HTMLDivElement {
  const field = document.createElement("div");
  field.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  field.append(label, input);
  return field;
}

function section(title: string): { root: HTMLDivElement; body: HTMLDivElement } {
  const root = document.createElement("div");
  root.className = "card";
  root.style.marginBottom = "1rem";
  const heading = document.createElement("h3");
  heading.style.marginTop = "0";
  heading.textContent = title;
  const body = document.createElement("div");
  root.append(heading, body);
  return { root, body };
}

function initNoteFinder(): HTMLElement {
  const { root, body } = section("Note finder");
  const midiInput = document.createElement("input");
  midiInput.type = "number";
  midiInput.value = "60";
  midiInput.min = "0";
  midiInput.max = "127";
  const result = document.createElement("p");

  function update(): void {
    const midi = Number(midiInput.value);
    if (!Number.isFinite(midi)) return;
    const { name, octave } = midiToNoteName(midi);
    result.textContent = `${name}${octave}, ${midiToFrequency(midi).toFixed(1)} Hz`;
  }
  midiInput.addEventListener("input", update);

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "btn secondary";
  playBtn.textContent = "Play";
  playBtn.addEventListener("click", () => playSequence([Number(midiInput.value)], 0));

  update();
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.gap = "0.5rem";
  row.style.alignItems = "flex-end";
  row.style.flexWrap = "wrap";
  row.append(labeledField("MIDI note number", midiInput), playBtn);
  body.append(row, result);
  return root;
}

function initIntervalFinder(): HTMLElement {
  const { root, body } = section("Interval finder");
  const firstMidi = document.createElement("input");
  firstMidi.type = "number";
  firstMidi.value = "60";
  const secondMidi = document.createElement("input");
  secondMidi.type = "number";
  secondMidi.value = "67";
  const result = document.createElement("p");

  function update(): void {
    const a = Number(firstMidi.value);
    const b = Number(secondMidi.value);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    result.textContent = `${intervalName(b - a)} (${Math.abs(b - a)} semitones)`;
  }
  firstMidi.addEventListener("input", update);
  secondMidi.addEventListener("input", update);

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "btn secondary";
  playBtn.textContent = "Play both";
  playBtn.addEventListener("click", () => playSequence([Number(firstMidi.value), Number(secondMidi.value)], 0.5));

  update();
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.gap = "0.5rem";
  row.style.alignItems = "flex-end";
  row.style.flexWrap = "wrap";
  row.append(labeledField("First note (MIDI)", firstMidi), labeledField("Second note (MIDI)", secondMidi), playBtn);
  body.append(row, result);
  return root;
}

function initChordFinder(): HTMLElement {
  const { root, body } = section("Chord finder");
  const rootSelect = noteSelect();
  const qualitySelect = document.createElement("select");
  for (const chord of CHORDS) {
    const opt = document.createElement("option");
    opt.value = chord.id;
    opt.textContent = chord.label;
    qualitySelect.append(opt);
  }
  const result = document.createElement("p");

  function currentNotes(): number[] {
    const rootMidi = noteNameToMidi(rootSelect.value as NoteName, 4);
    const chord = CHORDS.find((c) => c.id === qualitySelect.value) ?? CHORDS[0]!;
    return notesFromFormula(rootMidi, chord.intervals);
  }

  function update(): void {
    const notes = currentNotes();
    result.textContent = notes.map((m) => `${midiToNoteName(m).name}${midiToNoteName(m).octave}`).join(" – ");
  }
  rootSelect.addEventListener("change", update);
  qualitySelect.addEventListener("change", update);

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "btn secondary";
  playBtn.textContent = "Play";
  playBtn.addEventListener("click", () => playSequence(currentNotes(), 0));

  update();
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.gap = "0.5rem";
  row.style.alignItems = "flex-end";
  row.style.flexWrap = "wrap";
  row.append(labeledField("Root", rootSelect), labeledField("Quality", qualitySelect), playBtn);
  body.append(row, result);
  return root;
}

function initScaleFinder(): HTMLElement {
  const { root, body } = section("Scale finder");
  const rootSelect = noteSelect();
  const scaleSelect = document.createElement("select");
  for (const scale of SCALES) {
    const opt = document.createElement("option");
    opt.value = scale.id;
    opt.textContent = scale.label;
    scaleSelect.append(opt);
  }
  const result = document.createElement("p");

  function currentNotes(): number[] {
    const rootMidi = noteNameToMidi(rootSelect.value as NoteName, 4);
    const scale = SCALES.find((s) => s.id === scaleSelect.value) ?? SCALES[0]!;
    return notesFromFormula(rootMidi, scale.intervals);
  }

  function update(): void {
    const notes = currentNotes();
    result.textContent = notes.map((m) => `${midiToNoteName(m).name}${midiToNoteName(m).octave}`).join(" – ");
  }
  rootSelect.addEventListener("change", update);
  scaleSelect.addEventListener("change", update);

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "btn secondary";
  playBtn.textContent = "Play ascending";
  playBtn.addEventListener("click", () => playSequence(currentNotes(), 0.35));

  update();
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.gap = "0.5rem";
  row.style.alignItems = "flex-end";
  row.style.flexWrap = "wrap";
  row.append(labeledField("Root", rootSelect), labeledField("Scale", scaleSelect), playBtn);
  body.append(row, result);
  return root;
}

export function initFinderTool(container: HTMLElement): void {
  container.innerHTML = "";
  container.append(initNoteFinder(), initIntervalFinder(), initChordFinder(), initScaleFinder());
}
