// The Library panel: a read-only (mostly) list of what the room has saved —
// exported PDFs (downloadable, since the file itself lives in SQLite) and
// recordings (a title plus, once the organizer uploads it themselves to
// Drive/OneDrive and pastes the link back in, an external link). Nothing
// here captures or uploads media — that's recording-panel.ts, in the
// Collaboration panel.
export interface LibraryItem {
  id: string;
  type: "recording" | "pdf";
  title: string;
  externalUrl: string | null;
  hasFile: boolean;
  createdAt: number;
}

export interface LibraryPanelController {
  reload: () => void;
}

export function initLibraryPanel(container: HTMLElement, roomId: string, isOwner: boolean): LibraryPanelController {
  async function load(): Promise<void> {
    container.innerHTML = "";
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/library`, { credentials: "same-origin" });
    if (!res.ok) {
      const error = document.createElement("p");
      error.className = "error-text";
      error.textContent = "Couldn't load the library.";
      container.append(error);
      return;
    }
    const data = (await res.json()) as { items: LibraryItem[] };
    if (data.items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Nothing saved here yet — export a PDF or make a recording to see it here.";
      container.append(empty);
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
      meta.textContent = `${item.type === "pdf" ? "Document" : "Recording"} · ${new Date(item.createdAt).toLocaleString()}`;
      row.append(title, meta);

      if (item.type === "pdf" && item.hasFile) {
        const downloadLink = document.createElement("a");
        downloadLink.className = "btn secondary";
        downloadLink.href = `/api/library/${encodeURIComponent(item.id)}/file`;
        downloadLink.textContent = "Download";
        row.append(downloadLink);
      }

      if (item.type === "recording") {
        if (item.externalUrl) {
          const link = document.createElement("a");
          link.href = item.externalUrl;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "Open in Drive/OneDrive";
          row.append(link);
        } else if (isOwner) {
          const form = document.createElement("form");
          form.style.display = "flex";
          form.style.gap = "0.4rem";
          form.innerHTML = `
            <input type="url" placeholder="Paste the Drive/OneDrive link once you've uploaded it" style="flex:1;" required />
            <button type="submit" class="btn secondary">Save link</button>
          `;
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            const input = form.querySelector("input");
            if (!(input instanceof HTMLInputElement) || input.value.trim().length === 0) return;
            void fetch(`/api/library/${encodeURIComponent(item.id)}/link`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ externalUrl: input.value.trim() }),
            }).then(() => load());
          });
          row.append(form);
        } else {
          const note = document.createElement("p");
          note.className = "muted";
          note.textContent = "Not uploaded to Drive/OneDrive yet.";
          row.append(note);
        }
      }

      container.append(row);
    }
  }

  void load();

  return { reload: () => void load() };
}
