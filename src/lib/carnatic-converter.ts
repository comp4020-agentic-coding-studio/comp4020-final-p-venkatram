// Carnatic <-> Western note converter: type a sequence in either system
// (space-separated), see it mirrored in the other, and play it back —
// shared/carnatic.ts owns the 16-swara <-> semitone mapping, this owns the
// form and playback. "Play" reuses the same oscillator envelope as every
// other tool here (composition-player.ts's scheduleOscillatorNote).
import { scheduleOscillatorNote } from "./composition-player";
import { DEFAULT_INSTRUMENT } from "../../shared/composition";
import { semitoneToSwara, SWARAS, swaraToSemitone, type Swara } from "../../shared/carnatic";
import { midiToFrequency, midiToNoteName, NOTE_NAMES, noteNameToMidi, type NoteName } from "../../shared/theory";

const DEFAULT_SA_OCTAVE = 4; // Sa defaults to C4 unless the tonic picker says otherwise

function parseSwaraSequence(raw: string): Swara[] {
  const known = new Set(SWARAS);
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toUpperCase())
    .filter((token): token is Swara => known.has(token as Swara));
}

function parseWesternSequence(raw: string): NoteName[] {
  const known = new Set(NOTE_NAMES);
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1)) // "c#" -> "C#"
    .filter((token): token is NoteName => known.has(token as NoteName));
}

export function initCarnaticConverter(container: HTMLElement): void {
  container.innerHTML = "";

  const card = document.createElement("div");
  card.className = "card";

  const heading = document.createElement("h3");
  heading.style.marginTop = "0";
  heading.textContent = "Carnatic ↔ Western converter";

  const intro = document.createElement("p");
  intro.className = "muted";
  intro.textContent =
    "Type a swara sequence (e.g. \"S R2 G3 M1 P D2 N3 S\") or a Western note sequence (e.g. \"C D E F G A B C\"), space-separated.";

  const tonicField = document.createElement("div");
  tonicField.className = "field";
  const tonicLabel = document.createElement("label");
  tonicLabel.textContent = "Tonic (Sa)";
  const tonicSelect = document.createElement("select");
  for (const name of NOTE_NAMES) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    tonicSelect.append(opt);
  }
  tonicSelect.value = "C";
  tonicField.append(tonicLabel, tonicSelect);

  const carnaticField = document.createElement("div");
  carnaticField.className = "field";
  const carnaticLabel = document.createElement("label");
  carnaticLabel.textContent = "Carnatic (swaras)";
  const carnaticInput = document.createElement("textarea");
  carnaticInput.rows = 2;
  carnaticInput.placeholder = "S R2 G3 M1 P D2 N3 S";
  carnaticField.append(carnaticLabel, carnaticInput);

  const westernField = document.createElement("div");
  westernField.className = "field";
  const westernLabel = document.createElement("label");
  westernLabel.textContent = "Western";
  const westernInput = document.createElement("textarea");
  westernInput.rows = 2;
  westernInput.placeholder = "C D E F G A B C";
  westernField.append(westernLabel, westernInput);

  const playCarnaticBtn = document.createElement("button");
  playCarnaticBtn.type = "button";
  playCarnaticBtn.className = "btn secondary";
  playCarnaticBtn.textContent = "Play Carnatic sequence";

  const playWesternBtn = document.createElement("button");
  playWesternBtn.type = "button";
  playWesternBtn.className = "btn secondary";
  playWesternBtn.textContent = "Play Western sequence";

  let ctx: AudioContext | null = null;
  function play(midiNotes: number[]): void {
    if (midiNotes.length === 0) return;
    if (!ctx) ctx = new AudioContext();
    void ctx.resume();
    const gapSec = 0.4;
    midiNotes.forEach((midi, i) => {
      const onTime = ctx!.currentTime + i * gapSec;
      scheduleOscillatorNote(ctx!, midiToFrequency(midi), DEFAULT_INSTRUMENT, onTime, 0.35, 0.2);
    });
  }

  function saMidi(): number {
    return noteNameToMidi(tonicSelect.value as NoteName, DEFAULT_SA_OCTAVE);
  }

  // Carnatic -> Western: fills the Western field from what's typed in the
  // Carnatic one, keyed off the chosen tonic.
  function syncFromCarnatic(): void {
    const swaras = parseSwaraSequence(carnaticInput.value);
    if (swaras.length === 0) return;
    const sa = saMidi();
    const midiNotes = swaras.map((s) => sa + swaraToSemitone(s));
    westernInput.value = midiNotes.map((m) => midiToNoteName(m).name).join(" ");
  }

  // Western -> Carnatic: the inverse, using the same tonic.
  function syncFromWestern(): void {
    const names = parseWesternSequence(westernInput.value);
    if (names.length === 0) return;
    const sa = saMidi();
    const semitonesFromSa = names.map((name) => noteNameToMidi(name, DEFAULT_SA_OCTAVE) - sa);
    carnaticInput.value = semitonesFromSa.map((s) => semitoneToSwara(s)).join(" ");
  }

  carnaticInput.addEventListener("input", syncFromCarnatic);
  westernInput.addEventListener("input", syncFromWestern);
  tonicSelect.addEventListener("change", () => {
    // Re-derive from whichever field has content, so the other side updates
    // for the new tonic too.
    if (carnaticInput.value.trim()) syncFromCarnatic();
    else if (westernInput.value.trim()) syncFromWestern();
  });

  playCarnaticBtn.addEventListener("click", () => {
    const swaras = parseSwaraSequence(carnaticInput.value);
    const sa = saMidi();
    play(swaras.map((s) => sa + swaraToSemitone(s)));
  });
  playWesternBtn.addEventListener("click", () => {
    const names = parseWesternSequence(westernInput.value);
    play(names.map((name) => noteNameToMidi(name, DEFAULT_SA_OCTAVE)));
  });

  const buttonRow = document.createElement("div");
  buttonRow.style.display = "flex";
  buttonRow.style.gap = "0.5rem";
  buttonRow.append(playCarnaticBtn, playWesternBtn);

  card.append(heading, intro, tonicField, carnaticField, westernField, buttonRow);
  container.append(card);
}
