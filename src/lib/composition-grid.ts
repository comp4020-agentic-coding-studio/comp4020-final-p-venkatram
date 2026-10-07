// Renders the shared grid and wires it to the room connection. Deliberately
// no local optimistic update on click — the server is authoritative (see
// server/compositions.ts), so every cell always shows what the server last
// confirmed, for everyone, the same way. A click round-trips over the
// already-open WebSocket, typically well under the "about a second" bar.
import { clampBpm, type Cell, DEFAULT_BPM, GRID_PITCHES, GRID_STEPS } from "../../shared/grid";
import { CompositionPlayer } from "./composition-player";
import type { SignalSender } from "./webrtc";

export interface CompositionController {
  applyState: (state: { bpm: number; cells: Cell[] }) => void;
}

function cellKey(step: number, pitch: number): string {
  return `${step}:${pitch}`;
}

export function initCompositionGrid(container: HTMLElement, conn: SignalSender): CompositionController {
  let cells: Cell[] = [];
  let bpm = DEFAULT_BPM;

  container.innerHTML = "";
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

  toolbar.append(playBtn, tempoLabel, tempoValue);

  const grid = document.createElement("div");
  grid.className = "composition-grid";
  grid.style.gridTemplateColumns = `repeat(${GRID_STEPS}, 1fr)`;

  const buttons = new Map<string, HTMLButtonElement>();
  for (let pitch = GRID_PITCHES - 1; pitch >= 0; pitch--) {
    for (let step = 0; step < GRID_STEPS; step++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "composition-cell";
      cell.setAttribute("aria-label", `step ${step + 1}, pitch ${pitch + 1}`);
      cell.addEventListener("click", () => {
        conn.send({ type: "composition.toggle", step, pitch });
      });
      buttons.set(cellKey(step, pitch), cell);
      grid.append(cell);
    }
  }

  container.append(toolbar, grid);

  const player = new CompositionPlayer(
    () => cells,
    () => bpm,
    (step) => {
      for (const btn of buttons.values()) btn.classList.remove("composition-cell-playhead");
      for (let pitch = 0; pitch < GRID_PITCHES; pitch++) {
        buttons.get(cellKey(step, pitch))?.classList.add("composition-cell-playhead");
      }
    },
  );

  playBtn.addEventListener("click", () => {
    player.toggle();
    playBtn.textContent = player.isPlaying ? "Stop" : "Play";
  });

  let tempoDebounce: number | undefined;
  tempoInput.addEventListener("input", () => {
    const value = clampBpm(Number(tempoInput.value));
    tempoValue.textContent = `${value} bpm`;
    window.clearTimeout(tempoDebounce);
    tempoDebounce = window.setTimeout(() => conn.send({ type: "composition.tempo", bpm: value }), 150);
  });

  function render(): void {
    const active = new Set(cells.map(([step, pitch]) => cellKey(step, pitch)));
    for (const [key, btn] of buttons) {
      btn.classList.toggle("composition-cell-active", active.has(key));
    }
  }

  return {
    applyState: (state) => {
      cells = state.cells;
      bpm = clampBpm(state.bpm);
      tempoInput.value = String(bpm);
      tempoValue.textContent = `${bpm} bpm`;
      render();
    },
  };
}
