// The Sheet Music Hub: upload a MusicXML file, see it rendered, hear it
// auto-play. Rendering and note/timing data both come from
// OpenSheetMusicDisplay (the only mainstream library that does both) — this
// module owns the upload form, the score list, and walking OSMD's cursor to
// schedule playback through composition-player.ts's shared oscillator
// envelope (the same fix that corrected note sustain for the Composition
// grid and every other tool on this site).
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { scheduleOscillatorNote } from "./composition-player";
import { DEFAULT_INSTRUMENT } from "../../shared/composition";

interface SheetMusicItem {
  id: string;
  title: string;
  mime: string;
  createdAt: number;
}

const SECONDS_PER_WHOLE_NOTE_AT_120BPM = 2; // a whole note is 4 beats; 120bpm = 0.5s/beat

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function initSheetMusicHub(container: HTMLElement): void {
  container.innerHTML = "";

  const uploadCard = document.createElement("div");
  uploadCard.className = "card";
  const uploadHeading = document.createElement("h2");
  uploadHeading.style.marginTop = "0";
  uploadHeading.textContent = "Upload a score";
  const uploadForm = document.createElement("form");
  uploadForm.innerHTML = `
    <div class="field">
      <label for="sheet-music-title">Title (optional)</label>
      <input id="sheet-music-title" name="title" type="text" maxlength="160" />
    </div>
    <div class="field">
      <label for="sheet-music-file">MusicXML file (.xml, .musicxml, .mxl)</label>
      <input id="sheet-music-file" name="file" type="file" accept=".xml,.musicxml,.mxl" required />
    </div>
    <p id="sheet-music-error" class="error-text" role="alert"></p>
    <button type="submit" class="btn">Upload and play</button>
  `;
  uploadCard.append(uploadHeading, uploadForm);

  const listCard = document.createElement("div");
  listCard.className = "card";
  listCard.style.marginTop = "1rem";
  const listHeading = document.createElement("h2");
  listHeading.style.marginTop = "0";
  listHeading.textContent = "Your scores";
  const listEl = document.createElement("div");
  listCard.append(listHeading, listEl);

  const displayCard = document.createElement("div");
  displayCard.className = "card";
  displayCard.style.marginTop = "1rem";
  displayCard.hidden = true;
  const displayHeading = document.createElement("div");
  displayHeading.style.display = "flex";
  displayHeading.style.justifyContent = "space-between";
  displayHeading.style.alignItems = "center";
  const displayTitle = document.createElement("h2");
  displayTitle.style.margin = "0";
  const stopBtn = document.createElement("button");
  stopBtn.type = "button";
  stopBtn.className = "btn secondary";
  stopBtn.textContent = "Stop";
  displayHeading.append(displayTitle, stopBtn);
  const scoreContainer = document.createElement("div");
  scoreContainer.id = "sheet-music-render-target";
  displayCard.append(displayHeading, scoreContainer);

  container.append(uploadCard, listCard, displayCard);

  let osmd: OpenSheetMusicDisplay | null = null;
  let stopPlayback: (() => void) | null = null;

  async function loadList(): Promise<void> {
    listEl.innerHTML = "";
    const res = await fetch("/api/sheet-music", { credentials: "same-origin" });
    if (!res.ok) {
      const error = document.createElement("p");
      error.className = "error-text";
      error.textContent = "Couldn't load your scores.";
      listEl.append(error);
      return;
    }
    const data = (await res.json()) as { items: SheetMusicItem[] };
    if (data.items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Nothing uploaded yet.";
      listEl.append(empty);
      return;
    }
    for (const item of data.items) {
      const row = document.createElement("div");
      row.className = "library-item card";
      const title = document.createElement("strong");
      title.textContent = item.title;
      const meta = document.createElement("p");
      meta.className = "muted";
      meta.style.margin = "0.2rem 0 0.5rem";
      meta.textContent = new Date(item.createdAt).toLocaleString();
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "btn secondary";
      openBtn.textContent = "Open and play";
      openBtn.addEventListener("click", () => void openScore(item));
      row.append(title, meta, openBtn);
      listEl.append(row);
    }
  }

  // Walks the cursor through every voice/note in the score, scheduling each
  // one's onset relative to the first note at a fixed 120bpm (OSMD doesn't
  // expose a simple wall-clock playback API — reading its tempo expressions
  // reliably across arbitrary scores is its own rabbit hole — so this reads
  // the note's own written duration, the one thing every score agrees on,
  // and sequences it at a constant speed rather than claiming tempo
  // fidelity it can't back up).
  function scheduleAutoPlay(display: OpenSheetMusicDisplay): () => void {
    const ctx = new AudioContext();
    let cancelled = false;
    let cursorTime = ctx.currentTime + 0.3;

    display.cursor.reset();
    display.cursor.show();
    while (!display.cursor.Iterator.EndReached && !cancelled) {
      const notes = display.cursor.NotesUnderCursor();
      let longest = 0;
      for (const note of notes) {
        if (note.isRest()) continue;
        const durationSec = note.Length.RealValue * 4 * SECONDS_PER_WHOLE_NOTE_AT_120BPM;
        longest = Math.max(longest, durationSec);
        scheduleOscillatorNote(ctx, note.Pitch.Frequency, DEFAULT_INSTRUMENT, cursorTime, durationSec * 0.9, 0.15);
      }
      cursorTime += longest > 0 ? longest : 0.5 * SECONDS_PER_WHOLE_NOTE_AT_120BPM;
      display.cursor.next();
    }
    display.cursor.hide();

    return () => {
      cancelled = true;
      void ctx.close();
    };
  }

  async function openScore(item: SheetMusicItem): Promise<void> {
    stopPlayback?.();
    stopPlayback = null;
    displayCard.hidden = false;
    displayTitle.textContent = item.title;
    scoreContainer.innerHTML = "";
    if (!osmd) osmd = new OpenSheetMusicDisplay(scoreContainer, { autoResize: true, backend: "svg" });
    const res = await fetch(`/api/sheet-music/${encodeURIComponent(item.id)}/file`, { credentials: "same-origin" });
    if (!res.ok) return;
    const xml = await res.text();
    await osmd.load(xml);
    osmd.render();
    stopPlayback = scheduleAutoPlay(osmd);
  }

  stopBtn.addEventListener("click", () => {
    stopPlayback?.();
    stopPlayback = null;
  });

  uploadForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const errorEl = document.getElementById("sheet-music-error");
    if (errorEl) errorEl.textContent = "";
    const titleInput = uploadForm.elements.namedItem("title") as HTMLInputElement;
    const fileInput = uploadForm.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    fileToBase64(file)
      .then((dataBase64) =>
        fetch("/api/sheet-music", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ title: titleInput.value, dataBase64 }),
        }),
      )
      .then(async (res) => {
        const data = (await res.json()) as { item?: SheetMusicItem; error?: string };
        if (!res.ok || !data.item) throw new Error(data.error ?? "Couldn't upload that file.");
        uploadForm.reset();
        await loadList();
        await openScore(data.item);
      })
      .catch((err: Error) => {
        if (errorEl) errorEl.textContent = err.message;
      });
  });

  void loadList();
}
