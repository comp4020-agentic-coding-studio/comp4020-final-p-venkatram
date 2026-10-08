// The karaoke cursor: line-level, not word-level — a real LRC upload
// (`[mm:ss.xx]text` per line) gets accurate timing, a plain paste gets
// evenly-spaced fallback lines (shared/lyrics.ts), either way there's a
// cursor to follow. Position is leader-driven: whoever presses play
// broadcasts a transport update (server/realtime/lyrics-transport.ts), and
// every client — including the leader's own — derives "where's the cursor
// now" from its own monotonic clock (performance.now()) anchored to the
// position at the moment that update arrived, never from comparing wall
// clocks across machines.
import type { LyricLine } from "../../shared/lyrics";
import type { SignalSender } from "./webrtc";

export interface LyricsController {
  applySync: (doc: { title: string | null; lines: LyricLine[]; playing: boolean; positionMs: number }) => void;
  applyContent: (doc: { title: string | null; lines: LyricLine[] }) => void;
  applyTransport: (transport: { playing: boolean; positionMs: number }) => void;
}

export function initLyrics(container: HTMLElement, roomId: string, conn: SignalSender): LyricsController {
  let lines: LyricLine[] = [];
  let playing = false;
  let anchorPerfMs = performance.now();
  let anchorPositionMs = 0;

  container.innerHTML = "";

  const uploadForm = document.createElement("form");
  uploadForm.innerHTML = `
    <div class="field">
      <label for="lyrics-title">Title</label>
      <input id="lyrics-title" name="title" type="text" maxlength="120" />
    </div>
    <div class="field">
      <label for="lyrics-raw">Lyrics (LRC "[mm:ss.xx]text" per line for timed sync, or just paste plain lines)</label>
      <textarea id="lyrics-raw" name="raw" rows="6"></textarea>
    </div>
  `;
  const uploadBtn = document.createElement("button");
  uploadBtn.type = "submit";
  uploadBtn.className = "btn secondary";
  uploadBtn.textContent = "Upload lyrics";
  uploadForm.append(uploadBtn);

  const titleEl = document.createElement("h3");
  titleEl.style.marginBottom = "0.25rem";

  const transportRow = document.createElement("div");
  transportRow.style.display = "flex";
  transportRow.style.alignItems = "center";
  transportRow.style.gap = "0.5rem";
  transportRow.style.margin = "0.5rem 0";
  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "btn";
  playBtn.textContent = "Play";
  const restartBtn = document.createElement("button");
  restartBtn.type = "button";
  restartBtn.className = "btn secondary";
  restartBtn.textContent = "Restart";
  const emptyHint = document.createElement("span");
  emptyHint.className = "muted";
  emptyHint.textContent = "Upload lyrics above to enable playback.";
  transportRow.append(playBtn, restartBtn, emptyHint);

  const linesEl = document.createElement("div");
  linesEl.className = "lyrics-lines";

  container.append(uploadForm, titleEl, transportRow, linesEl);

  // Pressing play with nothing uploaded yet silently starts a transport
  // clock with no lines to highlight — indistinguishable from the button
  // just not working. Disable it instead of leaving that to be discovered.
  function updateTransportAvailability(): void {
    const hasLines = lines.length > 0;
    playBtn.disabled = !hasLines;
    restartBtn.disabled = !hasLines;
    emptyHint.hidden = hasLines;
  }
  updateTransportAvailability();

  uploadForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = (uploadForm.elements.namedItem("title") as HTMLInputElement).value;
    const raw = (uploadForm.elements.namedItem("raw") as HTMLTextAreaElement).value;
    fetch(`/api/rooms/${encodeURIComponent(roomId)}/lyrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ title, raw }),
    }).catch(() => {
      // the room's WS broadcast is the real source of truth here; a failed
      // POST just means this upload didn't take, nothing to reconcile
    });
  });

  playBtn.addEventListener("click", () => conn.send({ type: playing ? "lyrics.pause" : "lyrics.play" }));
  restartBtn.addEventListener("click", () => conn.send({ type: "lyrics.seek", positionMs: 0 }));

  function renderLines(): void {
    linesEl.innerHTML = "";
    lines.forEach((line, index) => {
      const p = document.createElement("p");
      p.className = "lyrics-line";
      p.textContent = line.text;
      p.dataset.index = String(index);
      p.addEventListener("click", () => conn.send({ type: "lyrics.seek", positionMs: line.time }));
      linesEl.append(p);
    });
  }

  function currentPositionMs(): number {
    return playing ? anchorPositionMs + (performance.now() - anchorPerfMs) : anchorPositionMs;
  }

  function currentLineIndex(): number {
    const position = currentPositionMs();
    let index = -1;
    for (let i = 0; i < lines.length; i++) {
      if ((lines[i]?.time ?? 0) <= position) index = i;
      else break;
    }
    return index;
  }

  function tick(): void {
    const active = currentLineIndex();
    for (const el of linesEl.querySelectorAll<HTMLParagraphElement>(".lyrics-line")) {
      const isActive = Number(el.dataset.index) === active;
      el.classList.toggle("lyrics-line-active", isActive);
      if (isActive) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    requestAnimationFrame(tick);
  }
  // Left running for the room page's lifetime — navigating away tears down
  // the whole page, which stops this along with everything else.
  requestAnimationFrame(tick);

  return {
    applySync: (doc) => {
      lines = doc.lines;
      titleEl.textContent = doc.title ?? "No lyrics uploaded yet";
      playing = doc.playing;
      anchorPositionMs = doc.positionMs;
      anchorPerfMs = performance.now();
      playBtn.textContent = playing ? "Pause" : "Play";
      updateTransportAvailability();
      renderLines();
    },
    applyContent: (doc) => {
      // A fresh upload mid-session: new words, but the room's current
      // playback position isn't this message's to touch.
      lines = doc.lines;
      titleEl.textContent = doc.title ?? "No lyrics uploaded yet";
      updateTransportAvailability();
      renderLines();
    },
    applyTransport: (transport) => {
      playing = transport.playing;
      anchorPositionMs = transport.positionMs;
      anchorPerfMs = performance.now();
      playBtn.textContent = playing ? "Pause" : "Play";
    },
  };
}
