import { requireSession } from "./session";
import { connectToRoom, type PresentUser, type RoomConnection } from "./room-connection";
import { askForMediaConsent } from "./media-consent";
import { askForRoomGate } from "./room-gate";
import { initLobbyAdmin, type LobbyAdminController, type PendingRequest } from "./lobby-admin";
import { RoomMedia } from "./webrtc";
import { initCompositionGrid } from "./composition-staff";
import type { Voice } from "../../shared/composition";
import { initLyrics } from "./lyrics";
import type { LyricLine } from "../../shared/lyrics";
import type { LyricsComment } from "./lyrics-comments";
import { initRecordingPanel } from "./recording-panel";
import { initLibraryPanel } from "./library-panel";
import { initMediaControls } from "./media-controls";
import { initKaraoke } from "./karaoke";

interface Room {
  id: string;
  name: string;
  ownerId: string;
}

function renderPresence(list: HTMLElement, users: PresentUser[], selfId: string): void {
  list.textContent = "";
  for (const user of users) {
    const li = document.createElement("li");
    li.textContent = user.userId === selfId ? `${user.displayName} (you)` : user.displayName;
    list.append(li);
  }
}

// Switches which room panel is visible — never tears anything down. The
// WebSocket, WebRTC peers and local media keep running underneath whichever
// panel is hidden, since re-establishing any of them is expensive and the
// whole point of a room is that they don't drop just because you're reading
// the score. A hidden <video> keeps its audio playing, so you still hear the
// room from the Recording or Composition panel.
//
// The three switches themselves live in the site-wide hamburger menu
// (Layout.astro's #room-nav-section), not a room-local sidebar — this just
// reveals that section and wires it up; site-nav.ts closes the menu on
// click.
function initRoomNav(): void {
  document.getElementById("room-nav-section")?.removeAttribute("hidden");
  const buttons = document.querySelectorAll<HTMLButtonElement>(".room-nav-btn");
  const panels = document.querySelectorAll<HTMLElement>(".room-panel");
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const target = button.dataset.panel;
      for (const panel of panels) panel.toggleAttribute("hidden", panel.id !== `panel-${target}`);
      for (const other of buttons) other.setAttribute("aria-selected", String(other === button));
    });
  }
}

function makeVideoTile(id: string, label: string, stream: MediaStream, muted: boolean): HTMLElement {
  const tile = document.createElement("div");
  tile.className = "video-tile";
  tile.dataset.peer = id;
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = muted;
  video.srcObject = stream;
  const caption = document.createElement("span");
  caption.className = "video-tile-label";
  caption.textContent = label;

  const fullscreenBtn = document.createElement("button");
  fullscreenBtn.type = "button";
  fullscreenBtn.className = "video-tile-fullscreen";
  fullscreenBtn.setAttribute("aria-label", `Fullscreen ${label}`);
  fullscreenBtn.textContent = "⛶";
  fullscreenBtn.addEventListener("click", () => {
    if (document.fullscreenElement === tile) void document.exitFullscreen();
    else void tile.requestFullscreen();
  });

  tile.append(video, caption, fullscreenBtn);
  return tile;
}

export function initRoomPage(): void {
  const roomId = new URLSearchParams(window.location.search).get("id");
  const root = document.getElementById("room-root");
  const notFound = document.getElementById("room-not-found");
  if (!roomId) {
    notFound?.removeAttribute("hidden");
    return;
  }

  initRoomNav();

  requireSession()
    .then(async (self) => {
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, { credentials: "same-origin" });
      if (!res.ok) {
        notFound?.removeAttribute("hidden");
        return;
      }
      const data = (await res.json()) as { room: Room };
      const nameEl = document.getElementById("room-name");
      if (nameEl) nameEl.textContent = data.room.name;

      const isOwner = data.room.ownerId === self.id;
      if (!isOwner) {
        const passwordGateRoot = document.getElementById("password-gate-root");
        const lobbyWaitRoot = document.getElementById("lobby-wait-root");
        if (passwordGateRoot && lobbyWaitRoot) {
          const gate = await askForRoomGate(passwordGateRoot, lobbyWaitRoot, roomId);
          if (!gate.admitted) return; // lobby-wait-root is already showing the "not let in" state
        }
      }

      const consentRoot = document.getElementById("consent-root");
      const localStream = consentRoot ? await askForMediaConsent(consentRoot) : null;

      root?.removeAttribute("hidden");

      let lobbyAdmin: LobbyAdminController | null = null;
      if (isOwner) {
        const lobbyAdminRoot = document.getElementById("lobby-admin-root");
        if (lobbyAdminRoot) lobbyAdmin = initLobbyAdmin(lobbyAdminRoot, (msg) => conn.send(msg));
      }

      const copyLinkBtn = document.getElementById("copy-room-link");
      if (copyLinkBtn instanceof HTMLButtonElement) {
        const defaultLabel = copyLinkBtn.textContent ?? "Copy Link";
        copyLinkBtn.addEventListener("click", () => {
          void navigator.clipboard.writeText(window.location.href).then(() => {
            copyLinkBtn.textContent = "Copied!";
            window.setTimeout(() => {
              copyLinkBtn.textContent = defaultLabel;
            }, 1500);
          });
        });
      }

      const videoGrid = document.getElementById("video-grid");
      const presenceList = document.getElementById("presence-list");
      const presentUsers = new Map<string, PresentUser>();
      const rerenderPresence = () => {
        if (presenceList instanceof HTMLUListElement) renderPresence(presenceList, [...presentUsers.values()], self.id);
      };

      if (localStream && videoGrid) {
        videoGrid.append(makeVideoTile("self", `${self.displayName} (you)`, localStream, true));
      }

      const mediaControlsRoot = document.getElementById("media-controls-root");
      if (localStream && mediaControlsRoot) {
        initMediaControls(mediaControlsRoot, localStream);
      }

      const compositionRoot = document.getElementById("composition-root");
      const lyricsRoot = document.getElementById("lyrics-root");

      let conn: RoomConnection;
      const compositionController = compositionRoot
        ? initCompositionGrid(compositionRoot, { send: (msg) => conn.send(msg) }, roomId, data.room.name)
        : null;
      const lyricsController = lyricsRoot
        ? initLyrics(lyricsRoot, roomId, data.room.name, { send: (msg) => conn.send(msg) })
        : null;
      const karaokeRoot = document.getElementById("karaoke-root");
      const karaokeController = karaokeRoot ? initKaraoke(karaokeRoot, roomId) : null;
      const remoteStreams = new Map<string, MediaStream>();
      const media = new RoomMedia(
        { send: (msg) => conn.send(msg) },
        {
          onPeerStream: (peer) => {
            remoteStreams.set(peer.userId, peer.stream);
            if (!videoGrid) return;
            videoGrid.querySelector(`[data-peer="${peer.userId}"]`)?.remove();
            videoGrid.append(makeVideoTile(peer.userId, peer.displayName, peer.stream, false));
          },
          onPeerLeft: (userId) => {
            remoteStreams.delete(userId);
            videoGrid?.querySelector(`[data-peer="${userId}"]`)?.remove();
          },
        },
      );
      media.setLocalStream(localStream);

      const recordingRoot = document.getElementById("recording-controls-root");
      const libraryRoot = document.getElementById("library-root");
      const libraryPanel = libraryRoot ? initLibraryPanel(libraryRoot, roomId, isOwner) : null;
      if (recordingRoot) {
        initRecordingPanel(recordingRoot, {
          roomId,
          getLocalStream: () => localStream,
          getRemoteStreams: () => [...remoteStreams.values()],
          onSaved: () => libraryPanel?.reload(),
        });
      }

      const originalSoundToggle = document.getElementById("original-sound-toggle");
      if (originalSoundToggle instanceof HTMLInputElement) {
        if (!localStream?.getAudioTracks().length) {
          originalSoundToggle.disabled = true;
        } else {
          originalSoundToggle.addEventListener("change", () => {
            void media.setOriginalSound(originalSoundToggle.checked);
          });
        }
      }

      conn = connectToRoom(roomId, {
        onPresenceSync: (users) => {
          presentUsers.clear();
          for (const user of users) presentUsers.set(user.userId, user);
          rerenderPresence();
          void media.connectToExisting(users.filter((u) => u.userId !== self.id));
        },
        onPresenceJoin: (user) => {
          presentUsers.set(user.userId, user);
          rerenderPresence();
          media.noteDisplayName(user.userId, user.displayName);
        },
        onPresenceLeave: (userId) => {
          presentUsers.delete(userId);
          rerenderPresence();
          media.removePeer(userId);
        },
        onMessage: (message) => {
          if (message.type === "composition.sync" || message.type === "composition.update") {
            compositionController?.applyState({ bpm: Number(message.bpm), voices: (message.voices as Voice[]) ?? [] });
          } else if (message.type === "lyrics.sync") {
            lyricsController?.applySync({
              title: (message.title as string | null) ?? null,
              lines: (message.lines as LyricLine[]) ?? [],
              comments: (message.comments as LyricsComment[]) ?? [],
            });
          } else if (message.type === "lyrics.update") {
            lyricsController?.applyContent({
              title: (message.title as string | null) ?? null,
              lines: (message.lines as LyricLine[]) ?? [],
              comments: (message.comments as LyricsComment[]) ?? [],
            });
          } else if (message.type === "lyrics.comment.add") {
            lyricsController?.applyCommentAdd(message.comment as LyricsComment);
          } else if (message.type === "video.sync" || message.type === "video.update") {
            karaokeController?.applyVideo({ youtubeId: (message.youtubeId as string | null) ?? null });
          } else if (message.type === "lobby.sync") {
            lobbyAdmin?.setPending((message.pending as PendingRequest[]) ?? []);
          } else if (message.type === "lobby.request") {
            lobbyAdmin?.addPending({
              userId: String(message.userId),
              displayName: String(message.displayName),
              requestedAt: Number(message.requestedAt) || Date.now(),
            });
          } else {
            void media.handleSignal(message);
          }
        },
      });

      window.addEventListener("beforeunload", () => media.closeAll());
    })
    .catch(() => {
      // requireSession already redirected to /login/
    });
}
