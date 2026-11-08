// Embeds YouTube's own official player — playback only. There's no song
// search or download here: that would mean extracting YouTube's content
// outside their player, which their Terms of Service don't allow regardless
// of how it's implemented. Pasting a link (or picking a search result,
// video-queue.ts) plays it, the same way pasting a Spotify or SoundCloud
// embed link would; nothing about the video's audio is otherwise accessible
// to this app (an embedded iframe is sandboxed from the page around it), so
// this is a shared "watch together" video, not an input to the lyrics
// cursor or anything else.
//
// Uses YouTube's IFrame Player API (not a plain <iframe src=...>) so the
// client can detect when a video ends and report it — the only way to
// trigger the queue's auto-advance (server/ws.ts's "video.ended" handler),
// since the server never talks to YouTube's player and has no way to know
// a video's position or duration on its own.
import type { RoomMessage } from "./room-connection";

export interface KaraokeController {
  applyVideo: (state: { youtubeId: string | null }) => void;
}

export interface KaraokeRoom {
  send: (msg: RoomMessage) => void;
}

// Minimal surface of the global `YT` object this file actually touches —
// the full typings ship as a separate @types package this app doesn't
// depend on, and pulling one in for three members isn't worth it.
interface YTPlayerEvent {
  data: number;
}
interface YTPlayer {
  loadVideoById: (id: string) => void;
  destroy: () => void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId?: string;
      host?: string;
      playerVars?: Record<string, number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: YTPlayerEvent) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: { ENDED: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiReadyPromise: Promise<YTNamespace> | null = null;

// Loads https://www.youtube.com/iframe_api once per page load (guarded
// against double injection — initKaraoke only ever runs once per room page
// today, but this keeps the guarantee explicit rather than incidental) and
// resolves once window.YT.Player actually exists.
function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (apiReadyPromise) return apiReadyPromise;
  apiReadyPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT as YTNamespace);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.append(script);
  });
  return apiReadyPromise;
}

export function initKaraoke(container: HTMLElement, roomId: string, room: KaraokeRoom): KaraokeController {
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
  submitBtn.textContent = "Set video now";
  const errorEl = document.createElement("p");
  errorEl.className = "error-text";
  errorEl.setAttribute("role", "alert");
  form.append(submitBtn, errorEl);

  const playerWrap = document.createElement("div");
  playerWrap.className = "karaoke-player";
  const emptyState = document.createElement("p");
  emptyState.className = "muted";
  emptyState.textContent = "No video set for this room yet.";
  // The IFrame API replaces whatever element it's given with its own
  // <iframe>, in place — so this wrapper (never replaced itself) is what
  // visibility toggles against, not the inner div passed to `new YT.Player`,
  // whose node identity doesn't survive that replacement.
  const playerSlot = document.createElement("div");
  const playerHost = document.createElement("div");
  playerSlot.append(playerHost);
  playerWrap.append(emptyState, playerSlot);

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

  let player: YTPlayer | null = null;
  let pendingYoutubeId: string | null = null;
  let currentYoutubeId: string | null = null;

  function ensurePlayer(): void {
    if (player) return;
    void loadYouTubeIframeApi().then((YT) => {
      if (player) return; // guard against a second resolution racing this
      player = new YT.Player(playerHost, {
        playerVars: { autoplay: 1, playsinline: 1 },
        events: {
          onReady: () => {
            if (pendingYoutubeId) {
              player?.loadVideoById(pendingYoutubeId);
              pendingYoutubeId = null;
            }
          },
          onStateChange: (event) => {
            if (event.data === YT.PlayerState.ENDED && currentYoutubeId) {
              room.send({ type: "video.ended", youtubeId: currentYoutubeId });
            }
          },
        },
      });
    });
  }

  function render(youtubeId: string | null): void {
    currentYoutubeId = youtubeId;
    emptyState.hidden = youtubeId !== null;
    playerSlot.hidden = youtubeId === null;
    if (!youtubeId) return;

    ensurePlayer();
    if (player) player.loadVideoById(youtubeId);
    else pendingYoutubeId = youtubeId;
  }

  emptyState.hidden = false;
  playerSlot.hidden = true;

  return {
    applyVideo: (state) => render(state.youtubeId),
  };
}
