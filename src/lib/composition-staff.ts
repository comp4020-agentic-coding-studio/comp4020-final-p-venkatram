// Renders the shared grid as a real treble staff (SVG, adapted from crit4's
// staff-svg.ts) instead of a button grid — a duration picker plus
// click-where-it-goes, the way Musescore's own note input works. Same
// server-authoritative model as before: no optimistic local update, every
// click just sends intent and waits for the broadcast.
import {
  type Cell,
  clampBpm,
  DEFAULT_BPM,
  DEFAULT_DURATION,
  type DurationCategory,
  GRID_PITCHES,
  GRID_STEPS,
} from "../../shared/grid";
import { CompositionPlayer } from "./composition-player";
import { diatonicIndexToY, DURATION_LABELS, pitchToStaffNote } from "./staff-notation";
import type { SignalSender } from "./webrtc";

export interface CompositionController {
  applyState: (state: { bpm: number; cells: Cell[] }) => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const STEP_WIDTH = 34;
const NOTE_AREA_X = 48;
const NOTE_AREA_WIDTH = GRID_STEPS * STEP_WIDTH;
const BOTTOM_LINE_Y = 104;
const HALF_LINE_SPACING = 8;
const TOP_LINE_Y = BOTTOM_LINE_Y - 4 * HALF_LINE_SPACING * 2;
const NOTEHEAD_RX = 5.5;
const NOTEHEAD_RY = 4.3;
const STEM_HEIGHT = 27;
const VIEW_Y_OFFSET = 60; // room above the staff for ledger lines and stems
const VIEW_HEIGHT = 200;
const VIEW_WIDTH = NOTE_AREA_X + NOTE_AREA_WIDTH + 20;

const DURATION_ORDER: DurationCategory[] = [4, 3, 2, 1, 0];
const DURATION_SYMBOLS: Record<DurationCategory, string> = { 4: "𝅝", 3: "𝅗𝅥", 2: "♩", 1: "♪", 0: "𝅘𝅥𝅯" };

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

export function initCompositionGrid(container: HTMLElement, conn: SignalSender): CompositionController {
  let cells: Cell[] = [];
  let bpm = DEFAULT_BPM;
  let selectedDuration: DurationCategory = DEFAULT_DURATION;

  container.innerHTML = "";

  // --- Toolbar: play/stop, tempo, duration picker ---
  const toolbar = document.createElement("div");
  toolbar.className = "composition-toolbar";

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "btn";
  playBtn.textContent = "Play";

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

  toolbar.append(playBtn, tempoLabel, tempoValue, durationPicker);

  // --- The staff itself ---
  const scroll = document.createElement("div");
  scroll.className = "staff-scroll";

  const svg = svgEl("svg");
  svg.setAttribute("viewBox", `0 -${VIEW_Y_OFFSET} ${VIEW_WIDTH} ${VIEW_HEIGHT}`);
  svg.setAttribute("class", "staff-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Shared musical staff — click a position to add or remove a note");

  for (const y of [40, 56, 72, 88, 104]) {
    const line = svgEl("line");
    line.setAttribute("class", "staff-line");
    line.setAttribute("x1", "36");
    line.setAttribute("x2", String(VIEW_WIDTH - 10));
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    svg.append(line);
  }

  const clef = svgEl("text");
  clef.setAttribute("class", "staff-clef");
  clef.setAttribute("x", "8");
  clef.setAttribute("y", "92");
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
  // the server decides add vs. remove by what's already there.
  const targets = svgEl("g");
  targets.setAttribute("class", "staff-click-targets");
  for (let pitch = 0; pitch < GRID_PITCHES; pitch++) {
    const { diatonicIndex } = pitchToStaffNote(pitch, DEFAULT_DURATION);
    const y = diatonicIndexToY(diatonicIndex, BOTTOM_LINE_Y, HALF_LINE_SPACING);
    for (let step = 0; step < GRID_STEPS; step++) {
      const x = NOTE_AREA_X + step * STEP_WIDTH;
      const target = svgEl("rect");
      target.setAttribute("class", "staff-click-target");
      target.setAttribute("x", String(x));
      target.setAttribute("y", String(y - HALF_LINE_SPACING / 2));
      target.setAttribute("width", String(STEP_WIDTH));
      target.setAttribute("height", String(HALF_LINE_SPACING));
      target.setAttribute("aria-label", `step ${step + 1}, pitch ${pitch + 1}`);
      target.addEventListener("click", () => {
        conn.send({ type: "composition.toggle", step, pitch, duration: selectedDuration });
      });
      targets.append(target);
    }
  }

  const notesLayer = svgEl("g");
  notesLayer.setAttribute("class", "staff-notes");

  svg.append(playhead, targets, notesLayer);
  scroll.append(svg);
  container.append(toolbar, scroll);

  function renderNotes(): void {
    notesLayer.innerHTML = "";
    for (const [step, pitch, duration] of cells) {
      const note = pitchToStaffNote(pitch, duration);
      const x = NOTE_AREA_X + (step + 0.5) * STEP_WIDTH;
      const y = diatonicIndexToY(note.diatonicIndex, BOTTOM_LINE_Y, HALF_LINE_SPACING);

      const group = svgEl("g");
      group.setAttribute("class", "staff-note");

      for (let k = 1; k <= note.ledgerLines; k++) {
        const ledgerY =
          note.ledgerSide === "below" ? BOTTOM_LINE_Y + k * HALF_LINE_SPACING * 2 : TOP_LINE_Y - k * HALF_LINE_SPACING * 2;
        const ledger = svgEl("line");
        ledger.setAttribute("class", "staff-ledger");
        ledger.setAttribute("x1", String(x - NOTEHEAD_RX - 3));
        ledger.setAttribute("x2", String(x + NOTEHEAD_RX + 3));
        ledger.setAttribute("y1", String(ledgerY));
        ledger.setAttribute("y2", String(ledgerY));
        group.append(ledger);
      }

      if (note.sharp) {
        const sharp = svgEl("text");
        sharp.setAttribute("class", "staff-note-sharp");
        sharp.setAttribute("x", String(x - NOTEHEAD_RX - 8));
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
          const flagY = y - STEM_HEIGHT + f * 7;
          flag.setAttribute("d", `M ${stemX} ${flagY} q 8 2 8 10 q -4 -4 -8 -3 Z`);
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

  const player = new CompositionPlayer(
    () => cells,
    () => bpm,
    (step) => {
      playhead.setAttribute("x", String(NOTE_AREA_X + step * STEP_WIDTH));
    },
  );

  playBtn.addEventListener("click", () => {
    player.toggle();
    playBtn.textContent = player.isPlaying ? "Stop" : "Play";
    playhead.style.display = player.isPlaying ? "block" : "none";
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
      cells = state.cells;
      bpm = clampBpm(state.bpm);
      tempoInput.value = String(bpm);
      tempoValue.textContent = `${bpm} bpm`;
      renderNotes();
    },
  };
}
