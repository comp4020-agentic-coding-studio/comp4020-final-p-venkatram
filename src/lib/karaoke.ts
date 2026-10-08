// Embeds YouTube's own official player — playback only. There's no song
// search or download here: that would mean extracting YouTube's content
// outside their player, which their Terms of Service don't allow regardless
// of how it's implemented. Pasting a link plays it, the same way pasting a
// Spotify or SoundCloud embed link would; nothing about the video's audio is
// otherwise accessible to this app (an embedded iframe is sandboxed from
// the page around it), so this is a shared "watch together" video, not an
// input to the lyrics cursor or anything else.
export interface KaraokeController {
  applyVideo: (state: { youtubeId: string | null }) => void;
}

export function initKaraoke(container: HTMLElement, roomId: string): KaraokeController {
  container.innerHTML = "";

  const form = document.createElement("form");
  form.innerHTML = `
    <div class="field">
      <label for="youtube-url">YouTube link</label>
      <input id="youtube-url" name="url" type="text" placeholder="https://www.youtube.com/watch?v=..." />
    </div>
  `;
  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "btn secondary";
  submitBtn.textContent = "Set video";
  const errorEl = document.createElement("p");
  errorEl.className = "error-text";
  errorEl.setAttribute("role", "alert");
  form.append(submitBtn, errorEl);

  const playerWrap = document.createElement("div");
  playerWrap.className = "karaoke-player";
  const emptyState = document.createElement("p");
  emptyState.className = "muted";
  emptyState.textContent = "No video set for this room yet.";
  playerWrap.append(emptyState);

  container.append(form, playerWrap);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    errorEl.textContent = "";
    const url = (form.elements.namedItem("url") as HTMLInputElement).value;
    submitBtn.disabled = true;
    fetch(`/api/rooms/${encodeURIComponent(roomId)}/video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ url }),
    })
      .then(async (res) => {
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Couldn't set that video.");
      })
      .catch((err: Error) => {
        errorEl.textContent = err.message;
      })
      .finally(() => {
        submitBtn.disabled = false;
      });
  });

  function render(youtubeId: string | null): void {
    playerWrap.innerHTML = "";
    if (!youtubeId) {
      playerWrap.append(emptyState);
      return;
    }
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}`;
    iframe.title = "Room karaoke video";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allowFullscreen = true;
    playerWrap.append(iframe);
  }

  return {
    applyVideo: (state) => render(state.youtubeId),
  };
}
