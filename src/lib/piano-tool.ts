// A standalone virtual piano for live accompaniment — immediate note-on
// (press)/note-off (release), not the Composition grid's fixed-duration
// sequencer. Local-only: this app never syncs playback across people, only
// the shared grid's data (composition-player.ts's own comment on this,
// PROCESS.md's crit 9 ADR) — a practice instrument on its own Tools page has
// no room/call to broadcast into anyway.
import { startHeldNote } from "./composition-player";
import { INSTRUMENTS, DEFAULT_INSTRUMENT, type InstrumentId } from "../../shared/composition";
import { midiToFrequency } from "../../shared/theory";

// Two octaves, C3-B4 — low enough to anchor against a bass line, high enough
// for a melody, without the keyboard growing too wide to fit one screen.
const START_MIDI = 48; // C3
const OCTAVES = 2;
const BLACK_OFFSETS = new Set([1, 3, 6, 8, 10]);

// One row of a QWERTY keyboard mapped left-to-right across the two octaves —
// same idea as a DAW's "computer keyboard as MIDI input", just fixed rather
// than configurable, since this is a practice tool, not a performance one.
const KEY_BINDINGS = "zsxdcvgbhnjmq2w3er5t6y7ui9o0p".split("");

interface PianoKey {
  midi: number;
  isBlack: boolean;
}

function buildKeys(): PianoKey[] {
  const keys: PianoKey[] = [];
  for (let i = 0; i < OCTAVES * 12 + 1; i++) {
    const midi = START_MIDI + i;
    keys.push({ midi, isBlack: BLACK_OFFSETS.has(i % 12) });
  }
  return keys;
}

export function initPianoTool(container: HTMLElement): void {
  container.innerHTML = "";

  const controls = document.createElement("div");
  controls.className = "field";
  controls.style.maxWidth = "16rem";
  const label = document.createElement("label");
  label.textContent = "Instrument";
  const select = document.createElement("select");
  for (const { id, label: optLabel } of INSTRUMENTS) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = optLabel;
    select.append(opt);
  }
  select.value = DEFAULT_INSTRUMENT;
  controls.append(label, select);

  const keyboard = document.createElement("div");
  keyboard.className = "piano-keyboard";

  const keys = buildKeys();
  const whiteKeys = keys.filter((k) => !k.isBlack);
  const whiteKeyWidth = 100 / whiteKeys.length;

  let ctx: AudioContext | null = null;
  const activeNotes = new Map<number, { release: () => void }>();

  function instrument(): InstrumentId {
    return select.value as InstrumentId;
  }

  function noteOn(midi: number, el: HTMLElement): void {
    if (activeNotes.has(midi)) return;
    if (!ctx) ctx = new AudioContext();
    void ctx.resume();
    const held = startHeldNote(ctx, midiToFrequency(midi), instrument());
    activeNotes.set(midi, held);
    el.classList.add("is-active");
  }

  function noteOff(midi: number, el: HTMLElement): void {
    const held = activeNotes.get(midi);
    if (!held) return;
    held.release();
    activeNotes.delete(midi);
    el.classList.remove("is-active");
  }

  let whiteIndex = 0;
  for (const key of keys) {
    const el = document.createElement("div");
    el.className = key.isBlack ? "piano-key piano-key-black" : "piano-key piano-key-white";
    el.dataset.midi = String(key.midi);
    if (key.isBlack) {
      // Centered on the boundary between the two white keys straddling it —
      // whiteIndex hasn't advanced past the white key to its left yet, so
      // this lands the black key between whiteIndex and whiteIndex+1.
      el.style.left = `${whiteIndex * whiteKeyWidth - whiteKeyWidth * 0.3}%`;
      el.style.width = `${whiteKeyWidth * 0.6}%`;
    } else {
      el.style.left = `${whiteIndex * whiteKeyWidth}%`;
      el.style.width = `${whiteKeyWidth}%`;
      whiteIndex += 1;
    }

    el.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      el.setPointerCapture(event.pointerId);
      noteOn(key.midi, el);
    });
    el.addEventListener("pointerup", () => noteOff(key.midi, el));
    el.addEventListener("pointerleave", () => noteOff(key.midi, el));
    el.addEventListener("pointercancel", () => noteOff(key.midi, el));

    keyboard.append(el);
  }

  // Physical-keyboard binding: keydown/keyup on the fixed QWERTY row above,
  // guarded against OS key-repeat re-triggering noteOn for a key already held.
  const midiForBindingKey = new Map<string, number>();
  KEY_BINDINGS.forEach((char, i) => {
    if (i < keys.length) midiForBindingKey.set(char, keys[i]!.midi);
  });

  function keyElFor(midi: number): HTMLElement | null {
    return keyboard.querySelector(`[data-midi="${midi}"]`);
  }

  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    const midi = midiForBindingKey.get(event.key.toLowerCase());
    if (midi === undefined) return;
    const el = keyElFor(midi);
    if (el) noteOn(midi, el);
  });
  window.addEventListener("keyup", (event) => {
    const midi = midiForBindingKey.get(event.key.toLowerCase());
    if (midi === undefined) return;
    const el = keyElFor(midi);
    if (el) noteOff(midi, el);
  });

  const hint = document.createElement("p");
  hint.className = "muted";
  hint.textContent = "Click and hold a key, or play with your computer keyboard (bottom-left row up to the number keys).";

  container.append(controls, keyboard, hint);
}
