// Google-Docs-style comments on the lyrics panel: select a run of text inside
// one rendered line, attach a note to it. Scoped deliberately to a single
// line per comment (not a selection spanning multiple lines) — see
// server/lyrics-comments.ts for the matching server-side bounds check. This
// module owns comment state, the marked-up line rendering, and the
// selection-to-"add a comment" UI; src/lib/lyrics.ts owns everything else
// about the panel (upload, line list) and calls back into this for both.
export interface LyricsComment {
  id: string;
  lineIndex: number;
  startOffset: number;
  endOffset: number;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: number;
}

export interface LyricsCommentsApi {
  setComments: (comments: LyricsComment[]) => void;
  addComment: (comment: LyricsComment) => void;
  // Builds the line's content as plain text interleaved with <mark> spans
  // for every comment anchored to it, appending the result to `target`.
  renderLineContent: (target: HTMLElement, lineIndex: number, text: string) => void;
}

interface Options {
  linesContainer: HTMLElement;
  panelContainer: HTMLElement;
  send: (msg: { type: string; [field: string]: unknown }) => void;
}

// Walks `root`'s text nodes in document order, summing lengths, to turn a
// DOM (node, offset) pair from a Selection/Range into a plain character
// offset into the line's own textContent — needed because once a line has
// marks, it's no longer one text node but several.
function textOffsetWithin(root: Node, targetNode: Node, targetOffset: number): number {
  let total = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node === targetNode) return total + targetOffset;
    total += node.textContent?.length ?? 0;
  }
  return total;
}

export function initLyricsComments(opts: Options): LyricsCommentsApi {
  const commentsByLine = new Map<number, LyricsComment[]>();

  function rerenderPanel(): void {
    opts.panelContainer.innerHTML = "";
    const all = [...commentsByLine.values()].flat().sort((a, b) => a.createdAt - b.createdAt);
    if (all.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No comments yet — select some lyrics to add one.";
      opts.panelContainer.append(empty);
      return;
    }
    for (const comment of all) {
      const row = document.createElement("div");
      row.className = "lyrics-comment-row";
      row.dataset.commentId = comment.id;
      const meta = document.createElement("p");
      meta.className = "muted";
      meta.style.margin = "0";
      meta.textContent = comment.authorName;
      const body = document.createElement("p");
      body.style.margin = "0.15rem 0 0";
      body.textContent = comment.text;
      row.append(meta, body);
      row.addEventListener("click", () => {
        opts.linesContainer
          .querySelector(`mark[data-comment-id="${comment.id}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      opts.panelContainer.append(row);
    }
  }

  function store(comment: LyricsComment): void {
    const list = commentsByLine.get(comment.lineIndex) ?? [];
    if (list.some((c) => c.id === comment.id)) return;
    list.push(comment);
    list.sort((a, b) => a.startOffset - b.startOffset);
    commentsByLine.set(comment.lineIndex, list);
  }

  // --- Selection -> "Add comment" popover ---
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "btn secondary lyrics-comment-add-btn";
  addButton.textContent = "Add comment";
  addButton.style.position = "fixed";
  addButton.style.display = "none";
  addButton.style.zIndex = "60";
  document.body.append(addButton);

  const commentForm = document.createElement("form");
  commentForm.className = "lyrics-comment-form";
  commentForm.style.position = "fixed";
  commentForm.style.display = "none";
  commentForm.style.zIndex = "60";
  commentForm.innerHTML = `
    <textarea rows="2" maxlength="2000" placeholder="Add a comment" required></textarea>
    <div style="display:flex; gap:0.4rem; margin-top:0.4rem;">
      <button type="submit" class="btn">Comment</button>
      <button type="button" class="btn secondary" data-cancel>Cancel</button>
    </div>
  `;
  document.body.append(commentForm);

  let pendingAnchor: { lineIndex: number; startOffset: number; endOffset: number } | null = null;

  function hidePopovers(): void {
    addButton.style.display = "none";
    commentForm.style.display = "none";
    pendingAnchor = null;
  }

  function positionNear(el: HTMLElement, rect: DOMRect): void {
    el.style.left = `${Math.max(8, rect.left)}px`;
    el.style.top = `${rect.bottom + 6}px`;
  }

  document.addEventListener("selectionchange", () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      addButton.style.display = "none";
      return;
    }
    const range = selection.getRangeAt(0);
    const line =
      range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement?.closest(".lyrics-line")
        : (range.startContainer as HTMLElement).closest?.(".lyrics-line");
    const endLine =
      range.endContainer.nodeType === Node.TEXT_NODE
        ? range.endContainer.parentElement?.closest(".lyrics-line")
        : (range.endContainer as HTMLElement).closest?.(".lyrics-line");
    // Only offer a comment when the whole selection sits inside one line
    // that's actually part of this lyrics panel.
    if (!line || line !== endLine || !opts.linesContainer.contains(line)) {
      addButton.style.display = "none";
      return;
    }
    const lineIndex = Number((line as HTMLElement).dataset.index);
    const startOffset = textOffsetWithin(line, range.startContainer, range.startOffset);
    const endOffset = textOffsetWithin(line, range.endContainer, range.endOffset);
    if (endOffset <= startOffset) {
      addButton.style.display = "none";
      return;
    }
    pendingAnchor = { lineIndex, startOffset, endOffset };
    positionNear(addButton, range.getBoundingClientRect());
    addButton.style.display = "inline-block";
    commentForm.style.display = "none";
  });

  addButton.addEventListener("click", () => {
    if (!pendingAnchor) return;
    positionNear(commentForm, addButton.getBoundingClientRect());
    addButton.style.display = "none";
    commentForm.style.display = "block";
    commentForm.querySelector("textarea")?.focus();
  });

  commentForm.querySelector("[data-cancel]")?.addEventListener("click", hidePopovers);

  commentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const textarea = commentForm.querySelector("textarea");
    const text = textarea instanceof HTMLTextAreaElement ? textarea.value.trim() : "";
    if (!pendingAnchor || text.length === 0) return;
    opts.send({ type: "lyrics.comment.add", ...pendingAnchor, text });
    if (textarea instanceof HTMLTextAreaElement) textarea.value = "";
    hidePopovers();
    window.getSelection()?.removeAllRanges();
  });

  document.addEventListener("mousedown", (event) => {
    if (event.target === addButton || commentForm.contains(event.target as Node)) return;
    if (commentForm.style.display === "block" || addButton.style.display === "inline-block") {
      // Let a real text selection inside the lyrics panel keep working;
      // only dismiss the popovers for a click elsewhere.
      if (!(event.target instanceof Node) || !opts.linesContainer.contains(event.target)) hidePopovers();
    }
  });

  rerenderPanel();

  return {
    setComments: (comments) => {
      commentsByLine.clear();
      for (const comment of comments) store(comment);
      rerenderPanel();
    },
    addComment: (comment) => {
      store(comment);
      rerenderPanel();
    },
    renderLineContent: (target, lineIndex, text) => {
      const comments = (commentsByLine.get(lineIndex) ?? []).filter((c) => c.endOffset <= text.length);
      let cursor = 0;
      for (const comment of comments) {
        if (comment.startOffset < cursor) continue; // overlapping — first one wins
        if (comment.startOffset > cursor) target.append(document.createTextNode(text.slice(cursor, comment.startOffset)));
        const mark = document.createElement("mark");
        mark.className = "lyrics-comment-mark";
        mark.dataset.commentId = comment.id;
        mark.title = `${comment.authorName}: ${comment.text}`;
        mark.textContent = text.slice(comment.startOffset, comment.endOffset);
        target.append(mark);
        cursor = comment.endOffset;
      }
      if (cursor < text.length) target.append(document.createTextNode(text.slice(cursor)));
    },
  };
}
