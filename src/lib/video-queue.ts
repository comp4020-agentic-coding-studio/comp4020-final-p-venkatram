// The karaoke room's "up next" list: add a link or a search result, vote,
// skip. Server-authoritative — a vote/add/remove button never updates its
// own row locally; it waits for the room-wide "queue.update" broadcast to
// re-render, the same posture composition and lyrics already use, so
// there's exactly one render path regardless of who triggered the change.
export interface QueueItemClient {
  id: string;
  youtubeId: string;
  title: string | null;
  addedBy: string;
  score: number;
  myVote: -1 | 0 | 1;
}

export interface VideoQueueController {
  // `trusted` distinguishes the two sources of a queue list: a per-user
  // sync (initial "queue.sync", or this user's own vote/add/remove HTTP
  // response) carries a real myVote computed for this specific user, so it
  // fully replaces what's known locally. A room-wide "queue.update"
  // broadcast carries myVote: 0 for every item (server/video-queue.ts's
  // listQueueForBroadcast — a single broadcast payload can't be correct for
  // every recipient's own vote), so it must NOT be trusted for myVote: only
  // score/title/order are taken from it, myVote is carried over from
  // whatever was last known for that item.
  applyQueue: (items: QueueItemClient[], trusted: boolean) => void;
}

export function initVideoQueue(container: HTMLElement, roomId: string): VideoQueueController {
  container.innerHTML = "";

  let knownVotes = new Map<string, -1 | 0 | 1>();

  const heading = document.createElement("h3");
  heading.textContent = "Up next";
  const list = document.createElement("div");
  list.className = "video-queue-list";
  const empty = document.createElement("p");
  empty.className = "muted";
  empty.textContent = "Nothing queued yet, add a link below.";

  const addForm = document.createElement("form");
  addForm.className = "video-queue-add-form";
  addForm.innerHTML = `
    <div class="field">
      <label for="queue-url">Add to queue</label>
      <input id="queue-url" name="url" type="text" placeholder="https://www.youtube.com/watch?v=..." />
    </div>
  `;
  const addBtn = document.createElement("button");
  addBtn.type = "submit";
  addBtn.className = "btn secondary";
  addBtn.textContent = "Add to queue";
  const addError = document.createElement("p");
  addError.className = "error-text";
  addError.setAttribute("role", "alert");
  addForm.append(addBtn, addError);

  container.append(heading, list, empty, addForm);

  // Vote/remove button clicks are disabled until the next queue.update
  // round-trip finishes — otherwise a fast double-click could fire two
  // requests for the same toggle before either has landed.
  let pending = false;

  async function postJson(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<{ error?: string; items?: QueueItemClient[] }> {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      credentials: "same-origin",
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; items?: QueueItemClient[] };
    if (!res.ok) return { error: data.error ?? "Something went wrong." };
    return data;
  }

  addForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addError.textContent = "";
    const url = (addForm.elements.namedItem("url") as HTMLInputElement).value;
    addBtn.disabled = true;
    void postJson(`/api/rooms/${encodeURIComponent(roomId)}/queue`, "POST", { url })
      .then((result) => {
        if (result?.error) {
          addError.textContent = result.error;
          return;
        }
        (addForm.elements.namedItem("url") as HTMLInputElement).value = "";
      })
      .finally(() => {
        addBtn.disabled = false;
      });
  });

  function renderItem(item: QueueItemClient): HTMLElement {
    const row = document.createElement("div");
    row.className = "video-queue-item card";

    const title = document.createElement("strong");
    title.textContent = item.title ?? item.youtubeId;
    row.append(title);

    const controls = document.createElement("div");
    controls.className = "video-queue-item-controls";

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "btn secondary video-queue-vote-btn";
    upBtn.setAttribute("aria-pressed", String(item.myVote === 1));
    upBtn.textContent = "▲";

    const score = document.createElement("span");
    score.className = "video-queue-score";
    score.textContent = String(item.score);

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "btn secondary video-queue-vote-btn";
    downBtn.setAttribute("aria-pressed", String(item.myVote === -1));
    downBtn.textContent = "▼";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn secondary";
    removeBtn.textContent = "Remove";

    function castVote(value: 1 | -1): void {
      if (pending) return;
      pending = true;
      void postJson(`/api/queue/${encodeURIComponent(item.id)}/vote`, "POST", { value })
        .then((result) => {
          // The vote endpoint's own response carries this user's real
          // myVote for every item (server/routes/video-queue.ts) — applied
          // as trusted immediately, rather than waiting for the room-wide
          // broadcast, which carries myVote: 0 for everyone.
          if (result.items) applyQueue(result.items, true);
        })
        .finally(() => {
          pending = false;
        });
    }

    upBtn.addEventListener("click", () => castVote(1));
    downBtn.addEventListener("click", () => castVote(-1));
    removeBtn.addEventListener("click", () => {
      if (pending) return;
      pending = true;
      void postJson(`/api/queue/${encodeURIComponent(item.id)}`, "DELETE").finally(() => {
        pending = false;
      });
    });

    controls.append(upBtn, score, downBtn, removeBtn);
    row.append(controls);
    return row;
  }

  function applyQueue(items: QueueItemClient[], trusted: boolean): void {
    if (trusted) {
      knownVotes = new Map(items.map((item) => [item.id, item.myVote]));
    }
    list.innerHTML = "";
    empty.hidden = items.length > 0;
    for (const item of items) {
      const myVote = trusted ? item.myVote : (knownVotes.get(item.id) ?? 0);
      list.append(renderItem({ ...item, myVote }));
    }
  }

  empty.hidden = false;

  return { applyQueue };
}
