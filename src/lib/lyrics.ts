// The lyrics panel: upload a sheet (LRC timestamps or plain text,
// shared/lyrics.ts), read it, and comment on any stretch of it, Google-Docs
// style (src/lib/lyrics-comments.ts owns the selection-to-comment UI and the
// marked-up line rendering). There's no leader-driven playback cursor here
// anymore — this panel is a shared, commentable document, not a transport.
import type { LyricLine } from "../../shared/lyrics";
import { exportLyricsPdf } from "./lyrics-pdf";
import { initLyricsComments, type LyricsComment, type LyricsCommentsApi } from "./lyrics-comments";
import type { SignalSender } from "./webrtc";

export interface LyricsController {
  applySync: (doc: { title: string | null; lines: LyricLine[]; comments: LyricsComment[] }) => void;
  applyContent: (doc: { title: string | null; lines: LyricLine[]; comments: LyricsComment[] }) => void;
  applyCommentAdd: (comment: LyricsComment) => void;
}

export function initLyrics(container: HTMLElement, roomId: string, roomName: string, conn: SignalSender): LyricsController {
  let title: string | null = null;
  let lines: LyricLine[] = [];

  container.innerHTML = "";

  const uploadForm = document.createElement("form");
  uploadForm.innerHTML = `
    <div class="field">
      <label for="lyrics-title">Title</label>
      <input id="lyrics-title" name="title" type="text" maxlength="120" />
    </div>
    <div class="field">
      <label for="lyrics-raw">Lyrics (LRC "[mm:ss.xx]text" per line for timed reference, or just paste plain lines)</label>
      <textarea id="lyrics-raw" name="raw" rows="6"></textarea>
    </div>
  `;
  const uploadBtn = document.createElement("button");
  uploadBtn.type = "submit";
  uploadBtn.className = "btn secondary";
  uploadBtn.textContent = "Upload lyrics";
  uploadForm.append(uploadBtn);

  const titleInput = uploadForm.elements.namedItem("title") as HTMLInputElement;
  const rawInput = uploadForm.elements.namedItem("raw") as HTMLTextAreaElement;

  const titleEl = document.createElement("h3");
  titleEl.style.marginBottom = "0.25rem";

  const exportRow = document.createElement("div");
  exportRow.style.display = "flex";
  exportRow.style.alignItems = "center";
  exportRow.style.gap = "0.5rem";
  exportRow.style.margin = "0.5rem 0";
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn secondary";
  exportBtn.textContent = "Export PDF";
  const exportError = document.createElement("span");
  exportError.className = "error-text";
  exportRow.append(exportBtn, exportError);

  const linesEl = document.createElement("div");
  linesEl.className = "lyrics-lines";

  const commentsPanel = document.createElement("aside");
  commentsPanel.className = "lyrics-comments-panel";

  container.append(uploadForm, titleEl, exportRow, linesEl, commentsPanel);

  const comments: LyricsCommentsApi = initLyricsComments({
    linesContainer: linesEl,
    panelContainer: commentsPanel,
    send: (msg) => conn.send(msg),
  });

  function uploadLyrics(): Promise<void> {
    return fetch(`/api/rooms/${encodeURIComponent(roomId)}/lyrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ title: titleInput.value, raw: rawInput.value }),
    })
      .then(() => undefined)
      .catch(() => {
        // the room's WS broadcast is the real source of truth here; a failed
        // POST just means this upload didn't take, nothing to reconcile
      });
  }

  uploadForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void uploadLyrics();
  });

  // Export needs the flat comment list; comments.ts owns per-line lookups
  // for rendering, so this panel keeps its own parallel flat copy just for
  // the PDF.
  let lastRenderedComments: LyricsComment[] = [];

  exportBtn.addEventListener("click", () => {
    exportError.textContent = "";
    exportBtn.disabled = true;
    exportBtn.textContent = "Exporting...";
    void exportLyricsPdf(roomId, roomName, title, lines, lastRenderedComments)
      .catch(() => {
        exportError.textContent = "Couldn't export the PDF — try again.";
      })
      .finally(() => {
        exportBtn.disabled = false;
        exportBtn.textContent = "Export PDF";
      });
  });

  function renderLines(): void {
    linesEl.innerHTML = "";
    lines.forEach((line, index) => {
      const p = document.createElement("p");
      p.className = "lyrics-line";
      p.dataset.index = String(index);
      comments.renderLineContent(p, index, line.text);
      linesEl.append(p);
    });
  }

  return {
    applySync: (doc) => {
      title = doc.title;
      lines = doc.lines;
      lastRenderedComments = doc.comments;
      titleEl.textContent = title ?? "No lyrics uploaded yet";
      comments.setComments(doc.comments);
      renderLines();
    },
    applyContent: (doc) => {
      title = doc.title;
      lines = doc.lines;
      lastRenderedComments = doc.comments;
      titleEl.textContent = title ?? "No lyrics uploaded yet";
      comments.setComments(doc.comments);
      renderLines();
    },
    applyCommentAdd: (comment) => {
      lastRenderedComments = [...lastRenderedComments, comment];
      comments.addComment(comment);
      renderLines();
    },
  };
}
