import { requireSession } from "./session";
import { connectToRoom, type PresentUser, type RoomConnection } from "./room-connection";
import { askForMediaConsent } from "./media-consent";
import { RoomMedia } from "./webrtc";
import { initCompositionGrid } from "./composition-grid";
import type { Cell } from "../../shared/grid";
import { initLyrics } from "./lyrics";
import type { LyricLine } from "../../shared/lyrics";

interface Room {
  id: string;
  name: string;
}

function renderPresence(list: HTMLElement, users: PresentUser[], selfId: string): void {
  list.textContent = "";
  for (const user of users) {
    const li = document.createElement("li");
    li.textContent = user.userId === selfId ? `${user.displayName} (you)` : user.displayName;
    list.append(li);
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
  tile.append(video, caption);
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

      const consentRoot = document.getElementById("consent-root");
      const localStream = consentRoot ? await askForMediaConsent(consentRoot) : null;

      root?.removeAttribute("hidden");
      const videoGrid = document.getElementById("video-grid");
      const presenceList = document.getElementById("presence-list");
      const presentUsers = new Map<string, PresentUser>();
      const rerenderPresence = () => {
        if (presenceList instanceof HTMLUListElement) renderPresence(presenceList, [...presentUsers.values()], self.id);
      };

      if (localStream && videoGrid) {
        videoGrid.append(makeVideoTile("self", `${self.displayName} (you)`, localStream, true));
      }

      const compositionRoot = document.getElementById("composition-root");
      const lyricsRoot = document.getElementById("lyrics-root");

      let conn: RoomConnection;
      const compositionController = compositionRoot
        ? initCompositionGrid(compositionRoot, { send: (msg) => conn.send(msg) })
        : null;
      const lyricsController = lyricsRoot ? initLyrics(lyricsRoot, roomId, { send: (msg) => conn.send(msg) }) : null;
      const media = new RoomMedia(
        { send: (msg) => conn.send(msg) },
        {
          onPeerStream: (peer) => {
            if (!videoGrid) return;
            videoGrid.querySelector(`[data-peer="${peer.userId}"]`)?.remove();
            videoGrid.append(makeVideoTile(peer.userId, peer.displayName, peer.stream, false));
          },
          onPeerLeft: (userId) => {
            videoGrid?.querySelector(`[data-peer="${userId}"]`)?.remove();
          },
        },
      );
      media.setLocalStream(localStream);

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
            compositionController?.applyState({ bpm: Number(message.bpm), cells: (message.cells as Cell[]) ?? [] });
          } else if (message.type === "lyrics.sync") {
            lyricsController?.applySync({
              title: (message.title as string | null) ?? null,
              lines: (message.lines as LyricLine[]) ?? [],
              playing: Boolean(message.playing),
              positionMs: Number(message.positionMs) || 0,
            });
          } else if (message.type === "lyrics.update") {
            lyricsController?.applyContent({
              title: (message.title as string | null) ?? null,
              lines: (message.lines as LyricLine[]) ?? [],
            });
          } else if (message.type === "lyrics.transport") {
            lyricsController?.applyTransport({
              playing: Boolean(message.playing),
              positionMs: Number(message.positionMs) || 0,
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
