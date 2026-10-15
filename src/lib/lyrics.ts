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

export function initLyrics(
  container: HTMLElement,
  roomId: string,
  roomName: string,
  conn: SignalSender,
  onClose: () => void,
): LyricsController {
  let title: string | null = null;
  let lines: LyricLine[] = [];

  // The container (#lyrics-root) already carries .lyrics-widget-panel and
  // `hidden` from the Astro markup — room-page.ts's widget toggle owns that
  // visibility, so this only clears and rebuilds the panel's own content.
  container.innerHTML = "";

  // Chat-style layout: a header bar (title + export + close), a scrolling
  // message area for the lines themselves, a comment thread underneath, and
  // the upload form reworked as a composer pinned to the bottom — the same
  // shape as any chat app's expanded window, just with "send" replaced by
  // "upload lyrics".
  const header = document.createElement("div");
  header.className = "lyrics-chat-header";

  const titleEl = document.createElement("h3");
  titleEl.className = "lyrics-chat-title";

  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn secondary";
  exportBtn.textContent = "Export PDF";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "lyrics-widget-close";
  closeBtn.setAttribute("aria-label", "Close lyrics");
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", onClose);

  header.append(titleEl, exportBtn, closeBtn);

  const exportError = document.createElement("p");
  exportError.className = "error-text";

  const linesEl = document.createElement("div");
  linesEl.className = "lyrics-chat-messages";

  const commentsPanel = document.createElement("aside");
  commentsPanel.className = "lyrics-comments-panel";

  const uploadForm = document.createElement("form");
  uploadForm.className = "lyrics-chat-composer";
  uploadForm.innerHTML = `
    <input id="lyrics-title" name="title" type="text" maxlength="120" placeholder="Title (optional)" />
    <div class="lyrics-chat-composer-row">
      <textarea
        id="lyrics-raw"
        name="raw"
        rows="6"
        placeholder='Paste lyrics — "[mm:ss.xx]text" per line for timed reference, or just plain lines'
      ></textarea>
      <button type="submit" class="btn">Upload</button>
    </div>
  `;

  const titleInput = uploadForm.elements.namedItem("title") as HTMLInputElement;
  const rawInput = uploadForm.elements.namedItem("raw") as HTMLTextAreaElement;

  container.append(header, exportError, linesEl, commentsPanel, uploadForm);

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
      const bubble = document.createElement("p");
      bubble.className = "lyrics-line lyrics-chat-bubble";
      bubble.dataset.index = String(index);
      comments.renderLineContent(bubble, index, line.text);
      linesEl.append(bubble);
    });
    linesEl.scrollTop = linesEl.scrollHeight;
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
