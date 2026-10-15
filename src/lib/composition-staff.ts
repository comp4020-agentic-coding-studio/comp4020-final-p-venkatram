// Renders the shared composition as N stacked real treble staves (SVG,
// adapted from crit4's staff-svg.ts) — one per voice, each independently
// editable with its own click-where-it-goes interaction, all playing
// together on the one shared tempo. Same server-authoritative model as
// before: no optimistic local update, every click just sends intent and
// waits for the broadcast.
import {
  type Cell,
  clampBpm,
  DEFAULT_BPM,
  DEFAULT_DURATION,
  type DurationCategory,
  GRID_PITCHES,
  GRID_STEPS,
} from "../../shared/grid";
import { INSTRUMENTS, MAX_BARS_PER_VOICE, MAX_VOICES, type Voice } from "../../shared/composition";
import { CompositionPlayer } from "./composition-player";
import { diatonicIndexToY, DURATION_LABELS, pitchToStaffNote } from "./staff-notation";
import { exportCompositionPdf } from "./staff-pdf";
import type { SignalSender } from "./webrtc";

export interface CompositionController {
  applyState: (state: { bpm: number; voices: Voice[] }) => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
// Twice the original size: each (step, pitch) click target is exactly
// HALF_LINE_SPACING tall, and at the original 8px that was too thin to
// reliably click — doubling makes every target a comfortable 16px, with the
// SVG's own width/height attributes (not CSS) set to these units 1:1, so
// there's no further scaling to lose precision to.
const STEP_WIDTH = 68;
const NOTE_AREA_X = 96;
const NOTE_AREA_WIDTH = GRID_STEPS * STEP_WIDTH;
const BOTTOM_LINE_Y = 208;
const HALF_LINE_SPACING = 16;
const TOP_LINE_Y = BOTTOM_LINE_Y - 4 * HALF_LINE_SPACING * 2;
const NOTEHEAD_RX = 11;
const NOTEHEAD_RY = 8.6;
const STEM_HEIGHT = 54;
// Tight bounds, derived (not guessed) from the geometry below: the highest
// pitch's stem top sits at y=26 (BOTTOM_LINE_Y - 4*HALF_LINE_SPACING*2 -
// STEM_HEIGHT, i.e. the top staff line minus a stem), and the lowest pitch's
// notehead bottom sits at y≈280.6 (two ledger lines below the staff, plus
// the notehead's own radius). VIEW_Y_OFFSET=28 keeps the viewBox top just
// above y=26; VIEW_HEIGHT=310 keeps the bottom just below y=280.6. Changing
// either constant below this comment (BOTTOM_LINE_Y, HALF_LINE_SPACING,
// STEM_HEIGHT, NOTEHEAD_RY) means recomputing both of these, not just
// shrinking them further — verified against pitch 1 and pitch 10 (the
// extremes) programmatically, not just by eye, since clipping here doesn't
// always show up as a visual artifact: it shows up as an unclickable target.
const VIEW_Y_OFFSET = 28;
const VIEW_HEIGHT = 310;
const VIEW_WIDTH = NOTE_AREA_X + NOTE_AREA_WIDTH + 40;

const DURATION_ORDER: DurationCategory[] = [4, 3, 2, 1, 0];
const DURATION_SYMBOLS: Record<DurationCategory, string> = { 4: "𝅝", 3: "𝅗𝅥", 2: "♩", 1: "♪", 0: "𝅘𝅥𝅯" };

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

interface VoiceStaff {
  element: HTMLElement;
  setPlayheadStep: (step: number | null) => void;
}

// One bar's staff (a single GRID_STEPS-wide line) — the exact click-
// target/rendering mechanics that worked for the original single-bar grid,
// just taking a `stepOffset` so a voice's second, third, or fourth bar sends
// the right flat step (shared/composition.ts's Voice.bars: a cell's `step`
// is a flat index across every bar a voice has, not reset per bar) and reads
// the right slice of `cells` back.
function buildBarStaff(
  voice: Voice,
  stepOffset: number,
  getSelectedDuration: () => DurationCategory,
  conn: SignalSender,
): { svg: SVGSVGElement; renderNotes: (cells: Cell[]) => void; setPlayheadStep: (localStep: number | null) => void } {
  const svg = svgEl("svg");
  svg.setAttribute("width", String(VIEW_WIDTH));
  svg.setAttribute("height", String(VIEW_HEIGHT));
  svg.setAttribute("viewBox", `0 -${VIEW_Y_OFFSET} ${VIEW_WIDTH} ${VIEW_HEIGHT}`);
  svg.setAttribute("class", "staff-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${voice.name}, bar ${stepOffset / GRID_STEPS + 1} — click a position to add, change, or remove a note`,
  );

  for (let line = 0; line < 5; line++) {
    const y = TOP_LINE_Y + line * HALF_LINE_SPACING * 2;
    const el = svgEl("line");
    el.setAttribute("class", "staff-line");
    el.setAttribute("x1", "72");
    el.setAttribute("x2", String(VIEW_WIDTH - 20));
    el.setAttribute("y1", String(y));
    el.setAttribute("y2", String(y));
    svg.append(el);
  }

  const clef = svgEl("text");
  clef.setAttribute("class", "staff-clef");
  clef.setAttribute("x", "16");
  clef.setAttribute("y", "184");
  clef.textContent = "𝄞";
  svg.append(clef);

  const playhead = svgEl("rect");
  playhead.setAttribute("class", "staff-playhead");
  playhead.setAttribute("y", String(-VIEW_Y_OFFSET));
  playhead.setAttribute("width", String(STEP_WIDTH));
  playhead.setAttribute("height", String(VIEW_HEIGHT));
  playhead.setAttribute("x", String(NOTE_AREA_X));
  playhead.style.display = "none";

  // One invisible click target per (step, pitch) — below the notes layer, so
  // a rendered note always sits visually on top but every click (on a note
  // or on empty space) reaches the same target and sends the same intent;
  // the server decides add, replace, or remove by what's already there and
  // which duration is currently selected (server/compositions.ts's
  // toggleCell).
  const targets = svgEl("g");
  targets.setAttribute("class", "staff-click-targets");
  for (let pitch = 0; pitch < GRID_PITCHES; pitch++) {
    const { diatonicIndex } = pitchToStaffNote(pitch, DEFAULT_DURATION);
    const y = diatonicIndexToY(diatonicIndex, BOTTOM_LINE_Y, HALF_LINE_SPACING);
    for (let localStep = 0; localStep < GRID_STEPS; localStep++) {
      const step = stepOffset + localStep;
      const x = NOTE_AREA_X + localStep * STEP_WIDTH;
      const target = svgEl("rect");
      target.setAttribute("class", "staff-click-target");
      target.setAttribute("x", String(x));
      target.setAttribute("y", String(y - HALF_LINE_SPACING / 2));
      target.setAttribute("width", String(STEP_WIDTH));
      target.setAttribute("height", String(HALF_LINE_SPACING));
      target.setAttribute("aria-label", `step ${step + 1}, pitch ${pitch + 1}`);
      target.addEventListener("click", () => {
        conn.send({ type: "composition.toggle", voiceId: voice.id, step, pitch, duration: getSelectedDuration() });
      });
      targets.append(target);
    }
  }

  const notesLayer = svgEl("g");
  notesLayer.setAttribute("class", "staff-notes");

  svg.append(playhead, targets, notesLayer);

  function renderNotes(cells: Cell[]): void {
    notesLayer.innerHTML = "";
    for (const [step, pitch, duration] of cells) {
      const localStep = step - stepOffset;
      if (localStep < 0 || localStep >= GRID_STEPS) continue; // belongs to a different bar
      const note = pitchToStaffNote(pitch, duration);
      const x = NOTE_AREA_X + (localStep + 0.5) * STEP_WIDTH;
      const y = diatonicIndexToY(note.diatonicIndex, BOTTOM_LINE_Y, HALF_LINE_SPACING);

      const group = svgEl("g");
      group.setAttribute("class", "staff-note");

      for (let k = 1; k <= note.ledgerLines; k++) {
        const ledgerY =
          note.ledgerSide === "below" ? BOTTOM_LINE_Y + k * HALF_LINE_SPACING * 2 : TOP_LINE_Y - k * HALF_LINE_SPACING * 2;
        const ledger = svgEl("line");
        ledger.setAttribute("class", "staff-ledger");
        ledger.setAttribute("x1", String(x - NOTEHEAD_RX - 6));
        ledger.setAttribute("x2", String(x + NOTEHEAD_RX + 6));
        ledger.setAttribute("y1", String(ledgerY));
        ledger.setAttribute("y2", String(ledgerY));
        group.append(ledger);
      }

      if (note.sharp) {
        const sharp = svgEl("text");
        sharp.setAttribute("class", "staff-note-sharp");
        sharp.setAttribute("x", String(x - NOTEHEAD_RX - 16));
        sharp.setAttribute("y", String(y + 3));
        sharp.textContent = "♯";
        group.append(sharp);
      }

      if (note.glyph.stem) {
        const stem = svgEl("line");
        stem.setAttribute("class", "staff-stem");
        const stemX = x + NOTEHEAD_RX - 1;
        stem.setAttribute("x1", String(stemX));
        stem.setAttribute("x2", String(stemX));
        stem.setAttribute("y1", String(y));
        stem.setAttribute("y2", String(y - STEM_HEIGHT));
        group.append(stem);

        for (let f = 0; f < note.glyph.flags; f++) {
          const flag = svgEl("path");
          flag.setAttribute("class", "staff-flag");
          const flagY = y - STEM_HEIGHT + f * 14;
          flag.setAttribute("d", `M ${stemX} ${flagY} q 16 4 16 20 q -8 -8 -16 -6 Z`);
          group.append(flag);
        }
      }

      const notehead = svgEl("ellipse");
      notehead.setAttribute("class", note.glyph.open ? "staff-notehead is-open" : "staff-notehead");
      notehead.setAttribute("cx", String(x));
      notehead.setAttribute("cy", String(y));
      notehead.setAttribute("rx", String(NOTEHEAD_RX));
      notehead.setAttribute("ry", String(NOTEHEAD_RY));
      group.append(notehead);

      notesLayer.append(group);
    }
  }

  return {
    svg,
    renderNotes,
    setPlayheadStep: (localStep) => {
      if (localStep === null) {
        playhead.style.display = "none";
        return;
      }
      playhead.style.display = "block";
      playhead.setAttribute("x", String(NOTE_AREA_X + localStep * STEP_WIDTH));
    },
  };
}

// One voice's staff: one or more stacked bars (each its own staff line,
// buildBarStaff above), plus the name/rename/remove header and an "Add bar"
// control once there's somewhere for a longer voice to grow.
function buildVoiceStaff(
  voice: Voice,
  getSelectedDuration: () => DurationCategory,
  conn: SignalSender,
  onRemove: () => void,
  onRename: (name: string) => void,
  onAddBar: () => void,
  onInstrumentChange: (instrument: string) => void,
): VoiceStaff {
  const wrapper = document.createElement("div");
  wrapper.className = "composition-voice";

  const header = document.createElement("div");
  header.className = "composition-voice-header";
  const nameLabel = document.createElement("span");
  nameLabel.className = "composition-voice-name";
  nameLabel.textContent = voice.name;
  nameLabel.title = "Click to rename";
  nameLabel.tabIndex = 0;
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn secondary composition-voice-remove";
  removeBtn.textContent = "Remove voice";
  removeBtn.addEventListener("click", onRemove);

  // Playback here is Web Audio oscillators, not sampled instruments
  // (shared/composition.ts's INSTRUMENTS comment) — the dropdown's own
  // labels say so ("Flute (sine)") rather than letting the option read as a
  // real instrument it isn't.
  const instrumentSelect = document.createElement("select");
  instrumentSelect.className = "composition-voice-instrument";
  instrumentSelect.setAttribute("aria-label", `${voice.name}'s instrument`);
  for (const { id, label } of INSTRUMENTS) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label;
    option.selected = id === voice.instrument;
    instrumentSelect.append(option);
  }
  instrumentSelect.addEventListener("change", () => onInstrumentChange(instrumentSelect.value));

  header.append(nameLabel, instrumentSelect);

  function startRename(): void {
    const input = document.createElement("input");
    input.type = "text";
    input.value = nameLabel.textContent ?? "";
    input.maxLength = 40;
    input.className = "composition-voice-name-input";
    nameLabel.replaceWith(input);
    input.focus();
    input.select();
    const commit = (): void => {
      const value = input.value.trim();
      input.replaceWith(nameLabel);
      if (value.length > 0 && value !== nameLabel.textContent) onRename(value);
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
      if (event.key === "Escape") {
        input.value = nameLabel.textContent ?? "";
        input.blur();
      }
    });
  }
  nameLabel.addEventListener("click", startRename);
  nameLabel.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      startRename();
    }
  });

  const addBarBtn = document.createElement("button");
  addBarBtn.type = "button";
  addBarBtn.className = "btn secondary composition-voice-add-bar";
  addBarBtn.textContent = "+ Add bar";
  addBarBtn.disabled = voice.bars >= MAX_BARS_PER_VOICE;
  addBarBtn.title = addBarBtn.disabled ? `Up to ${MAX_BARS_PER_VOICE} bars per voice` : "";
  addBarBtn.addEventListener("click", onAddBar);
  // Add bar and Remove voice sit together on the right, Add bar first —
  // grouping the voice's two structural actions apart from its name/rename
  // control on the left.
  header.append(addBarBtn, removeBtn);

  const scroll = document.createElement("div");
  scroll.className = "staff-scroll";

  // One buildBarStaff per bar this voice currently has, stacked top to
  // bottom in the same wrapper — a voice with more than one line of music
  // reads as an actual turn-the-page continuation, not a single staff
  // squeezed wider. bars[] is rebuilt (not diffed) on every applyState the
  // same way the rest of this file already treats every update as a full
  // re-render — rooms are small and edits infrequent, so there's no real
  // cost to it.
  let bars: ReturnType<typeof buildBarStaff>[] = [];

  function rebuildBars(barCount: number): void {
    scroll.innerHTML = "";
    bars = Array.from({ length: barCount }, (_, barIndex) =>
      buildBarStaff(voice, barIndex * GRID_STEPS, getSelectedDuration, conn),
    );
    for (const bar of bars) scroll.append(bar.svg);
  }

  rebuildBars(voice.bars);
  for (const bar of bars) bar.renderNotes(voice.cells);

  wrapper.append(header, scroll);

  return {
    element: wrapper,
    setPlayheadStep: (step) => {
      if (step === null) {
        for (const bar of bars) bar.setPlayheadStep(null);
        return;
      }
      // Only the bar the playhead is actually inside shows it — a step past
      // a shorter voice's own bar count means this voice isn't sounding
      // anything right now, so nothing lights up for it rather than
      // guessing which bar to clamp to.
      const activeBarIndex = Math.floor(step / GRID_STEPS);
      bars.forEach((bar, index) => {
        bar.setPlayheadStep(index === activeBarIndex ? step % GRID_STEPS : null);
      });
    },
  };
}

export function initCompositionGrid(
  container: HTMLElement,
  conn: SignalSender,
  roomId: string,
  roomName: string,
): CompositionController {
  let voices: Voice[] = [];
  let bpm = DEFAULT_BPM;
  let selectedDuration: DurationCategory = DEFAULT_DURATION;
  const staves = new Map<string, VoiceStaff>();

  container.innerHTML = "";

  // --- Toolbar: play/stop, tempo, duration picker ---
  const toolbar = document.createElement("div");
  toolbar.className = "composition-toolbar";

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "btn";
  playBtn.textContent = "Play";

  // Tempo's own labeled group — the slider, its label, and the live bpm
  // readout belong together visually, not loose in the same row as every
  // other toolbar control.
  const tempoGroup = document.createElement("div");
  tempoGroup.className = "composition-toolbar-group";
  const tempoLabel = document.createElement("label");
  tempoLabel.className = "muted";
  tempoLabel.textContent = "Tempo";
  const tempoInput = document.createElement("input");
  tempoInput.type = "range";
  tempoInput.min = "40";
  tempoInput.max = "220";
  tempoInput.value = String(DEFAULT_BPM);
  const tempoValue = document.createElement("span");
  tempoValue.className = "muted";
  tempoValue.textContent = `${DEFAULT_BPM} bpm`;
  tempoLabel.append(tempoInput);
  tempoGroup.append(tempoLabel, tempoValue);

  const durationPicker = document.createElement("div");
  durationPicker.className = "duration-picker";
  durationPicker.setAttribute("role", "radiogroup");
  durationPicker.setAttribute("aria-label", "Note duration to place");
  const durationButtons = new Map<DurationCategory, HTMLButtonElement>();
  for (const duration of DURATION_ORDER) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "duration-btn";
    btn.textContent = DURATION_SYMBOLS[duration];
    btn.title = `${DURATION_LABELS[duration]} note`;
    btn.setAttribute("aria-label", `${DURATION_LABELS[duration]} note`);
    btn.addEventListener("click", () => {
      selectedDuration = duration;
      for (const [d, b] of durationButtons) b.classList.toggle("duration-btn-active", d === duration);
    });
    durationButtons.set(duration, btn);
    durationPicker.append(btn);
  }
  durationButtons.get(selectedDuration)?.classList.add("duration-btn-active");

  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn secondary";
  exportBtn.textContent = "Export PDF";
  const exportError = document.createElement("span");
  exportError.className = "error-text";

  exportBtn.addEventListener("click", () => {
    exportError.textContent = "";
    exportBtn.disabled = true;
    exportBtn.textContent = "Exporting...";
    // One PDF per voice rather than teaching staff-pdf.ts a new multi-staff
    // layout — it's a plain, hand-kept-in-sync print duplicate of this
    // file's geometry, not worth complicating for this.
    Promise.all(
      voices.map((voice) => exportCompositionPdf(roomId, `${roomName} — ${voice.name}`, voice.cells, bpm, voice.bars)),
    )
      .catch(() => {
        exportError.textContent = "Couldn't export the PDF — try again.";
      })
      .finally(() => {
        exportBtn.disabled = false;
        exportBtn.textContent = "Export PDF";
      });
  });

  const addVoiceBtn = document.createElement("button");
  addVoiceBtn.type = "button";
  addVoiceBtn.className = "btn secondary composition-add-voice";
  addVoiceBtn.textContent = "+ Add voice";
  addVoiceBtn.addEventListener("click", () => {
    conn.send({ type: "composition.add-voice" });
  });

  // Three visually distinct clusters — transport (Play), tempo, and the
  // duration picker — with Export PDF set apart on the far right rather than
  // sitting in the same flat row as the controls that actually drive playing
  // and placing notes.
  toolbar.append(playBtn, tempoGroup, durationPicker, exportBtn, exportError);

  const voicesContainer = document.createElement("div");
  voicesContainer.className = "composition-voices";

  container.append(toolbar, voicesContainer, addVoiceBtn);

  function rebuildVoices(): void {
    voicesContainer.innerHTML = "";
    staves.clear();
    for (const voice of [...voices].sort((a, b) => a.order - b.order)) {
      const staff = buildVoiceStaff(
        voice,
        () => selectedDuration,
        conn,
        () => conn.send({ type: "composition.remove-voice", voiceId: voice.id }),
        (name) => conn.send({ type: "composition.rename-voice", voiceId: voice.id, name }),
        () => conn.send({ type: "composition.add-bar", voiceId: voice.id }),
        (instrument) => conn.send({ type: "composition.set-instrument", voiceId: voice.id, instrument }),
      );
      staves.set(voice.id, staff);
      voicesContainer.append(staff.element);
    }
    if (voices.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No voices yet — add one to start composing.";
      voicesContainer.append(empty);
    }
    addVoiceBtn.disabled = voices.length >= MAX_VOICES;
    addVoiceBtn.title = addVoiceBtn.disabled ? `Up to ${MAX_VOICES} voices per room` : "";
  }

  const player = new CompositionPlayer(
    () => voices.map((voice) => ({ cells: voice.cells, instrument: voice.instrument })),
    () => bpm,
    // The loop runs as long as the longest voice's bars — a voice with
    // fewer bars than that just has nothing left to play once the step
    // passes its own length, rather than the whole room being capped at one
    // bar the moment any voice is still that short.
    () => Math.max(GRID_STEPS, ...voices.map((voice) => voice.bars * GRID_STEPS)),
    (step) => {
      for (const staff of staves.values()) staff.setPlayheadStep(step);
    },
  );

  playBtn.addEventListener("click", () => {
    player.toggle();
    playBtn.textContent = player.isPlaying ? "Stop" : "Play";
    if (!player.isPlaying) for (const staff of staves.values()) staff.setPlayheadStep(null);
  });

  let tempoDebounce: number | undefined;
  tempoInput.addEventListener("input", () => {
    const value = clampBpm(Number(tempoInput.value));
    tempoValue.textContent = `${value} bpm`;
    window.clearTimeout(tempoDebounce);
    tempoDebounce = window.setTimeout(() => conn.send({ type: "composition.tempo", bpm: value }), 150);
  });

  return {
    applyState: (state) => {
      voices = state.voices;
      bpm = clampBpm(state.bpm);
      tempoInput.value = String(bpm);
      tempoValue.textContent = `${bpm} bpm`;
      // Consistent with the single-voice version's own full-rebuild-per-
      // update style (renderNotes always cleared and redrew everything) —
      // rooms are small and updates infrequent, so there's no real cost to
      // rebuilding the whole voice stack rather than diffing it.
      rebuildVoices();
    },
  };
}
