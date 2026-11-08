import { requireSession } from "./session";
import { connectToRoom, type PresentUser, type RoomConnection, type RoomMessage } from "./room-connection";
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
import { initVideoQueue, type QueueItemClient } from "./video-queue";
import { makeDraggable } from "./draggable-tile";
import { colorForUserId } from "./user-color";

interface Room {
  id: string;
  name: string;
  ownerId: string;
}

function renderPresence(target: HTMLElement, users: PresentUser[], selfId: string): void {
  target.innerHTML = "";
  if (users.length === 0) {
    target.textContent = "just you, so far";
    return;
  }
  users.forEach((user, index) => {
    if (index > 0) target.append(document.createTextNode(", "));
    const span = document.createElement("span");
    span.style.color = colorForUserId(user.userId);
    span.textContent = user.userId === selfId ? `${user.displayName} (you)` : user.displayName;
    target.append(span);
  });
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

// The lyrics panel is a floating chat widget (#lyrics-widget in room/index.astro):
// collapsed to a launcher bubble, expanding into the panel on click, closable
// from either the launcher (toggle) or the panel's own close button. Stays
// mounted and fixed to the viewport regardless of which room panel is open.
function initLyricsWidget(): { close: () => void } {
  const widget = document.getElementById("lyrics-widget");
  const toggle = document.getElementById("lyrics-widget-toggle");
  const panel = document.getElementById("lyrics-root");

  function setOpen(open: boolean): void {
    widget?.classList.toggle("is-open", open);
    panel?.toggleAttribute("hidden", !open);
    toggle?.setAttribute("aria-expanded", String(open));
  }

  toggle?.addEventListener("click", () => {
    setOpen(!widget?.classList.contains("is-open"));
  });

  return { close: () => setOpen(false) };
}

// A tiny SVG icon per status, drawn inline rather than pulled in as a font —
// kept small and square so three of them always fit within a tile's own
// width regardless of how narrow the grid packs tiles.
const ICON_PATHS: Record<"mic" | "mic-off" | "cam" | "cam-off" | "screen", string> = {
  mic: "M8 1a2 2 0 0 1 2 2v4a2 2 0 1 1-4 0V3a2 2 0 0 1 2-2zm-3.5 5.5a.5.5 0 0 1 1 0 2.5 2.5 0 0 0 5 0 .5.5 0 0 1 1 0 3.5 3.5 0 0 1-3 3.46V12h1.5a.5.5 0 0 1 0 1h-4a.5.5 0 0 1 0-1H8v-2.04a3.5 3.5 0 0 1-3-3.46z",
  "mic-off": "M8 1a2 2 0 0 1 2 2v3.3l-4-4V3a2 2 0 0 1 2-2zm5.5 5.5a.5.5 0 0 0-1 0 2.5 2.5 0 0 1-.5 1.5l.73.73A3.48 3.48 0 0 0 13.5 6.5zM2.7 2l11.3 11.3-.7.7-2.2-2.2A3.48 3.48 0 0 1 9 12.96V13h1.5a.5.5 0 0 1 0 1h-4a.5.5 0 0 1 0-1H8v-2.04a3.5 3.5 0 0 1-3-3.46.5.5 0 0 1 1 0 2.5 2.5 0 0 0 3.1 2.43l-1.1-1.1A2 2 0 0 1 6 8V5.4L2 1.4z",
  cam: "M1 4.5A1.5 1.5 0 0 1 2.5 3h6A1.5 1.5 0 0 1 10 4.5v7A1.5 1.5 0 0 1 8.5 13h-6A1.5 1.5 0 0 1 1 11.5zm10.2 1.6 2.6-1.8a.5.5 0 0 1 .8.4v6.6a.5.5 0 0 1-.8.4l-2.6-1.8z",
  "cam-off": "M2.4 1.7 14.3 13.6l-.7.7-2-2H2.5A1.5 1.5 0 0 1 1 10.8v-7c0-.5.2-.9.6-1.2L1.7 2.4zM3.4 4 10 10.6V4.5A1.5 1.5 0 0 0 8.5 3H3.3zm8.8 2.1 2.6-1.8a.5.5 0 0 1 .8.4v6.6a.5.5 0 0 1-.1.3l-3.3-3.3z",
  screen: "M1.5 3A1.5 1.5 0 0 0 0 4.5v6A1.5 1.5 0 0 0 1.5 12H6v1H5a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1h-1v-1h4.5a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 14.5 3zM1 4.5a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 .5.5V10H1z",
};

function statusIconSvg(kind: keyof typeof ICON_PATHS, label: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "video-tile-status-icon-glyph");
  svg.setAttribute("role", "img");
  const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
  title.textContent = label;
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICON_PATHS[kind]);
  path.setAttribute("fill", "currentColor");
  svg.append(title, path);
  return svg;
}

export interface VideoTileState {
  micOn: boolean;
  cameraOn: boolean;
  sharingScreen: boolean;
}

export interface VideoTileActions {
  onToggleMic?: () => void;
  onToggleCamera?: () => void;
  onToggleScreenShare?: () => void;
}

// On the self tile these double as the mic/camera/share-screen controls —
// clicking the icon itself toggles that control, replacing the old separate
// "Mute mic" / "Turn camera off" / "Share screen" button row entirely. A
// remote peer's tile passes no actions, so its icons render as plain,
// unclickable status (there's nothing for a click there to do — you can't
// mute someone else's mic).
function renderStatusIcons(container: HTMLElement, state: VideoTileState, actions?: VideoTileActions): void {
  container.innerHTML = "";

  function addIcon(onKind: keyof typeof ICON_PATHS, offKind: keyof typeof ICON_PATHS, on: boolean, onLabel: string, offLabel: string, onToggle?: () => void): void {
    const kind = on ? onKind : offKind;
    const label = on ? onLabel : offLabel;
    if (onToggle) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "video-tile-status-icon";
      btn.setAttribute("aria-label", label);
      btn.setAttribute("aria-pressed", String(!on));
      btn.append(statusIconSvg(kind, label));
      btn.addEventListener("click", onToggle);
      container.append(btn);
    } else {
      const span = document.createElement("span");
      span.className = "video-tile-status-icon";
      span.append(statusIconSvg(kind, label));
      container.append(span);
    }
  }

  const micLabel = actions?.onToggleMic
    ? state.micOn
      ? "Mic on, click to mute"
      : "Mic off, click to unmute"
    : state.micOn
      ? "Mic on"
      : "Mic off";
  addIcon("mic", "mic-off", state.micOn, micLabel, micLabel, actions?.onToggleMic);

  const camLabel = actions?.onToggleCamera
    ? state.cameraOn
      ? "Camera on, click to turn off"
      : "Camera off, click to turn on"
    : state.cameraOn
      ? "Camera on"
      : "Camera off";
  addIcon("cam", "cam-off", state.cameraOn, camLabel, camLabel, actions?.onToggleCamera);

  // The self tile always offers the screen-share icon (even while not
  // sharing, so there's a way to start) — a remote tile only shows it while
  // that peer is actually sharing, since otherwise there's nothing to
  // indicate and no action a click there could take.
  if (actions?.onToggleScreenShare) {
    const label = state.sharingScreen ? "Sharing screen, click to stop" : "Share your screen";
    addIcon("screen", "screen", true, label, label, actions.onToggleScreenShare);
  } else if (state.sharingScreen) {
    addIcon("screen", "screen", true, "Sharing screen", "Sharing screen");
  }
}

// Shown in place of the video element when the camera is off (by consent
// choice or by the "Turn camera off" toggle) — a tile with a dark frame and
// nothing moving in it reads as broken or frozen; this is deliberately inert
// instead, so "no camera" reads as a state, not a fault.
function buildCameraOffPlaceholder(label: string): HTMLElement {
  const placeholder = document.createElement("div");
  placeholder.className = "video-tile-placeholder";
  const initial = document.createElement("span");
  initial.className = "video-tile-placeholder-initial";
  initial.textContent = (label.trim()[0] ?? "?").toUpperCase();
  placeholder.append(initial);
  return placeholder;
}

// Remembers each tile's click actions (if any) across updateVideoTileState's
// icon re-renders — only the self tile has these; a WeakMap rather than a
// dataset field since the actions are closures, not serializable strings.
const tileActions = new WeakMap<HTMLElement, VideoTileActions>();

// The wrapper (not the inner .video-tile) carries data-peer and is what
// every [data-peer="..."] lookup below finds — it holds the tile itself plus
// the status row underneath it, so "find this peer's tile" and "find this
// peer's status row" both resolve from the one element.
// `stream` is optional: a peer who joined with no camera or mic (an
// explicit media-consent choice, src/lib/media-consent.ts) sends no WebRTC
// track at all, so there's nothing for `ontrack` to ever fire with — but
// they're still in the room and everyone else must still see a tile for
// them (just the placeholder, same as anyone with their camera off), not no
// tile at all. The tile is created from presence (room-page.ts's
// onPresenceSync/onPresenceJoin), and attachStream fills in the <video>
// later if that peer's track ever does arrive (mid-call "turn camera on",
// screen share from a no-media start).
function makeVideoTile(
  id: string,
  label: string,
  stream: MediaStream | null,
  muted: boolean,
  initialState: VideoTileState,
  actions?: VideoTileActions,
  mirrored = false,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "video-tile-wrap";
  wrap.dataset.peer = id;

  const tile = document.createElement("div");
  tile.className = "video-tile";
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = muted;
  if (stream) video.srcObject = stream;
  // Only the self tile mirrors (the "looking in a mirror" convention a
  // webcam preview is expected to follow) — a remote peer's video is never
  // mirrored, since what they send is what everyone else, and the recording
  // (recording-panel.ts), should see: their actual left and right, not
  // flipped. A screen share is never mirrored either way (see
  // onLocalVideoChanged below, which turns this off for one).
  video.classList.toggle("video-tile-mirrored", mirrored);

  const placeholder = buildCameraOffPlaceholder(label);
  placeholder.hidden = Boolean(stream) && (initialState.cameraOn || initialState.sharingScreen);

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

  tile.append(video, placeholder, caption, fullscreenBtn);

  if (actions) tileActions.set(wrap, actions);
  const statusRow = document.createElement("div");
  statusRow.className = "video-tile-status";
  renderStatusIcons(statusRow, initialState, actions);

  wrap.append(tile, statusRow);
  makeDraggable(wrap, { ignoreSelector: ".video-tile-fullscreen, .video-tile-status-icon" });
  return wrap;
}

// Tiles float independently (decision: not a single grid moved as a unit),
// so each one's starting spot is computed here rather than left to CSS Grid
// auto-flow — a simple incrementing row/col offset, just enough to start
// looking roughly grid-like before the first drag moves anything. Resets
// every page load (positions are never persisted or synced), so this only
// needs to avoid stacking new tiles directly on top of existing ones.
let nextTileSlot = 0;
const TILE_WIDTH = 192; // matches .video-tile-wrap's 12rem width (16px/rem default)
const TILE_HEIGHT = 170; // 4:3 video + label + status row, approximate
const TILE_GAP = 12;
const TILES_PER_ROW = 4;

function placeTile(wrap: HTMLElement): void {
  const col = nextTileSlot % TILES_PER_ROW;
  const row = Math.floor(nextTileSlot / TILES_PER_ROW);
  nextTileSlot += 1;
  wrap.style.left = `${col * (TILE_WIDTH + TILE_GAP) + TILE_GAP}px`;
  wrap.style.top = `${row * (TILE_HEIGHT + TILE_GAP) + TILE_GAP}px`;
}

// Fills in a tile that was created without a stream (the no-media-at-all
// case above) once that peer's track actually arrives over WebRTC.
function attachStreamToTile(wrap: HTMLElement, stream: MediaStream): void {
  const video = wrap.querySelector("video");
  if (video) video.srcObject = stream;
}

function updateVideoTileState(wrap: HTMLElement, state: VideoTileState): void {
  const placeholder = wrap.querySelector<HTMLElement>(".video-tile-placeholder");
  // The video element shows the shared screen while sharing, regardless of
  // the camera's own on/off state — the placeholder should only ever cover
  // for a camera that's actually the thing supposed to be showing there.
  if (placeholder) placeholder.hidden = state.cameraOn || state.sharingScreen;
  const statusRow = wrap.querySelector<HTMLElement>(".video-tile-status");
  if (statusRow) renderStatusIcons(statusRow, state, tileActions.get(wrap));
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

      // The room connects — and, for the organizer, the lobby queue becomes
      // actionable — immediately, before anyone's own camera/mic choice is
      // settled. The join-request flow (server/realtime/lobby.ts) holds each
      // requester's HTTP response open regardless of whether the organizer
      // has a stream yet, so admitting people, chatting, and composing
      // together shouldn't wait on that decision either. A non-owner only
      // ever reaches this point after already being admitted (the gate
      // above), so for them this just means the room underneath their own
      // consent card is live a little sooner, not a security boundary moving.
      let lobbyAdmin: LobbyAdminController | null = null;
      let conn: RoomConnection;
      if (isOwner) {
        const lobbyAdminRoot = document.getElementById("lobby-admin-root");
        if (lobbyAdminRoot) lobbyAdmin = initLobbyAdmin(lobbyAdminRoot, (msg) => conn.send(msg));
      }

      root?.removeAttribute("hidden");

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

      const videoFloatLayer = document.getElementById("video-float-layer");
      const presenceList = document.getElementById("presence-list");
      const presentUsers = new Map<string, PresentUser>();
      const rerenderPresence = () => {
        if (presenceList) renderPresence(presenceList, [...presentUsers.values()], self.id);
      };

      // Everyone present gets a tile the moment they're known (presence
      // join/sync below), whether or not they ever send a WebRTC track —
      // someone who chose "join without media" (media-consent.ts) still
      // needs to be visible to everyone else in the room, the same way their
      // camera-off placeholder would be if they *had* sent a track. Without
      // this, a no-media peer would only ever get a tile via onPeerStream,
      // which never fires for them since they have nothing to send.
      function ensurePeerTile(userId: string, displayName: string): void {
        if (!videoFloatLayer || videoFloatLayer.querySelector(`[data-peer="${userId}"]`)) return;
        const wrap = makeVideoTile(userId, displayName, null, false, {
          micOn: false,
          cameraOn: false,
          sharingScreen: false,
        });
        placeTile(wrap);
        videoFloatLayer.append(wrap);
      }

      const compositionRoot = document.getElementById("composition-root");
      const lyricsRoot = document.getElementById("lyrics-root");
      const lyricsWidget = initLyricsWidget();

      const compositionController = compositionRoot
        ? initCompositionGrid(compositionRoot, { send: (msg) => conn.send(msg) }, roomId, data.room.name)
        : null;
      const lyricsController = lyricsRoot
        ? initLyrics(lyricsRoot, roomId, data.room.name, { send: (msg) => conn.send(msg) }, lyricsWidget.close)
        : null;
      const karaokeRoot = document.getElementById("karaoke-root");
      const karaokeController = karaokeRoot ? initKaraoke(karaokeRoot, roomId, { send: (msg) => conn.send(msg) }) : null;
      const queueRoot = document.getElementById("queue-root");
      const queueController = queueRoot ? initVideoQueue(queueRoot, roomId) : null;
      const remoteStreams = new Map<string, MediaStream>();
      // Starts at "nothing yet" and is corrected the moment this attendee's
      // own consent choice resolves (wireLocalMedia below) — none of this
      // (connecting, the lobby queue, composition, lyrics) should have to
      // wait on that choice, so it can't assume the real value is in yet.
      let lastReportedState: VideoTileState = { micOn: false, cameraOn: false, sharingScreen: false };
      const media = new RoomMedia(
        { send: (msg) => conn.send(msg) },
        {
          onPeerStream: (peer) => {
            remoteStreams.set(peer.userId, peer.stream);
            if (!videoFloatLayer) return;
            // ensurePeerTile (presence join/sync) already created this
            // peer's tile, possibly before their stream existed — attach
            // into it rather than replacing it, so a tile already on screen
            // never flashes or loses its place when the track actually
            // arrives.
            ensurePeerTile(peer.userId, peer.displayName);
            const wrap = videoFloatLayer.querySelector<HTMLElement>(`[data-peer="${peer.userId}"]`);
            if (!wrap) return;
            attachStreamToTile(wrap, peer.stream);
            // Assumed on until this peer's own media.state says otherwise —
            // their track existing at all means they joined with it, and the
            // state broadcast (sent right after media-controls.ts mounts for
            // them) corrects this within moments if it's actually off.
            updateVideoTileState(wrap, { micOn: true, cameraOn: true, sharingScreen: false });
            conn.send({ type: "media.state", ...lastReportedState });
          },
          onPeerLeft: (userId) => {
            remoteStreams.delete(userId);
            videoFloatLayer?.querySelector(`[data-peer="${userId}"]`)?.remove();
          },
        },
      );

      // Nothing may create or negotiate a WebRTC peer connection
      // (connectToExisting, or an incoming offer via handleSignal) before
      // this attendee's own media-consent choice has resolved — doing so
      // and then attaching tracks afterward would mean renegotiating a
      // connection that already exists, which risks two offers racing each
      // other (WebRTC "glare") if the other side renegotiates too. Presence
      // and chat/composition signaling both keep flowing immediately (so
      // the lobby queue, composition and lyrics never wait), but the two
      // things that touch `media` queue here and replay once wireLocalMedia
      // runs below, so every peer connection is created exactly once, with
      // its final track state already decided.
      let localMediaReady = false;
      const pendingConnectUsers = new Map<string, { userId: string; displayName: string }>();
      const pendingSignals: RoomMessage[] = [];

      function queueOrConnectToExisting(users: { userId: string; displayName: string }[]): void {
        if (localMediaReady) {
          void media.connectToExisting(users);
          return;
        }
        for (const user of users) pendingConnectUsers.set(user.userId, user);
      }

      function queueOrHandleSignal(message: RoomMessage): void {
        if (localMediaReady) void media.handleSignal(message);
        else pendingSignals.push(message);
      }

      // Runs once this attendee's own media-consent choice resolves — never
      // blocks on it. Builds the self tile, mic/camera/screen-share controls,
      // and the two localStream-dependent panels, then flushes any peer
      // connections that were waiting on this, so each one is created
      // exactly once, already with its final track state — never created
      // first and renegotiated afterward.
      let localStream: MediaStream | null = null;
      function wireLocalMedia(stream: MediaStream | null): void {
        localStream = stream;
        media.setLocalStream(stream);

        const initialSelfState: VideoTileState = {
          micOn: Boolean(stream?.getAudioTracks().length),
          cameraOn: Boolean(stream?.getVideoTracks().length),
          sharingScreen: false,
        };
        lastReportedState = initialSelfState;

        // Built before the self tile exists — its toggle functions become
        // that tile's clickable status icons (room-page.ts no longer has a
        // separate "Mute mic" / "Turn camera off" / "Share screen" button
        // row; those three actions live on the tile itself now).
        const controls = initMediaControls(stream, {
          media,
          // Swaps the self tile's video source between the camera and the
          // shared screen — the same tile, not a second one, since there's
          // only ever one outgoing video track at a time either way. Someone
          // who joined mic-only or with no media has no self tile yet (none
          // is created without a camera stream) — sharing a screen gives
          // them their first one.
          onLocalVideoChanged: (videoStream) => {
            if (!videoFloatLayer) return;
            const existingTile = videoFloatLayer.querySelector<HTMLElement>('[data-peer="self"]');
            if (videoStream) {
              const video = existingTile?.querySelector("video");
              if (video) {
                video.srcObject = videoStream;
                // A shared screen is never mirrored — only the camera is,
                // matching the "looking in a mirror" convention a webcam
                // preview is expected to follow.
                video.classList.toggle("video-tile-mirrored", videoStream === stream);
              } else {
                const wrap = makeSelfTile(videoStream);
                placeTile(wrap);
                videoFloatLayer.append(wrap);
              }
            } else if (existingTile && !stream) {
              // No camera to fall back to (this attendee joined mic-only or
              // with no media) — the tile only ever existed for the screen
              // share, so it goes away with it instead of sitting there black.
              existingTile.remove();
            }
          },
          onStateChange: (state) => {
            lastReportedState = state;
            const selfTile = videoFloatLayer?.querySelector<HTMLElement>('[data-peer="self"]');
            if (selfTile) updateVideoTileState(selfTile, state);
            conn.send({ type: "media.state", ...state });
          },
        });

        function makeSelfTile(tileStream: MediaStream): HTMLElement {
          return makeVideoTile(
            "self",
            `${self.displayName} (you)`,
            tileStream,
            true,
            initialSelfState,
            {
              onToggleMic: controls.hasMic ? controls.toggleMic : undefined,
              onToggleCamera: controls.hasCamera ? controls.toggleCamera : undefined,
              onToggleScreenShare: controls.toggleScreenShare,
            },
            true,
          );
        }

        if (stream && videoFloatLayer) {
          // ensurePeerTile may already have run for other peers by now, but
          // never for "self" — the self tile is only ever built here.
          const wrap = makeSelfTile(stream);
          placeTile(wrap);
          videoFloatLayer.append(wrap);
        }

        const originalSoundToggle = document.getElementById("original-sound-toggle");
        if (originalSoundToggle instanceof HTMLInputElement) {
          if (!stream?.getAudioTracks().length) {
            originalSoundToggle.disabled = true;
          } else {
            originalSoundToggle.addEventListener("change", () => {
              void media.setOriginalSound(originalSoundToggle.checked);
            });
          }
        }

        localMediaReady = true;
        // Peers we're the newcomer to (we initiate) before peers who sent us
        // something (we only ever answer, never initiate) — a connect can
        // never have a reply waiting on it yet, since nothing was sent until
        // this point, so the order between the two groups can't matter for
        // correctness, but connects first keeps the one trace of ordering
        // (presence before signaling) that existed before buffering.
        if (pendingConnectUsers.size > 0) void media.connectToExisting([...pendingConnectUsers.values()]);
        pendingConnectUsers.clear();
        const signals = pendingSignals.splice(0, pendingSignals.length);
        for (const message of signals) void media.handleSignal(message);
      }

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

      conn = connectToRoom(roomId, {
        onPresenceSync: (users) => {
          presentUsers.clear();
          for (const user of users) presentUsers.set(user.userId, user);
          rerenderPresence();
          const others = users.filter((u) => u.userId !== self.id);
          for (const user of others) ensurePeerTile(user.userId, user.displayName);
          queueOrConnectToExisting(others);
        },
        onPresenceJoin: (user) => {
          presentUsers.set(user.userId, user);
          rerenderPresence();
          media.noteDisplayName(user.userId, user.displayName);
          ensurePeerTile(user.userId, user.displayName);
        },
        onPresenceLeave: (userId) => {
          presentUsers.delete(userId);
          rerenderPresence();
          pendingConnectUsers.delete(userId);
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
          } else if (message.type === "queue.sync") {
            queueController?.applyQueue((message.items as QueueItemClient[]) ?? [], true);
          } else if (message.type === "queue.update") {
            queueController?.applyQueue((message.items as QueueItemClient[]) ?? [], false);
          } else if (message.type === "lobby.sync") {
            lobbyAdmin?.setPending((message.pending as PendingRequest[]) ?? []);
          } else if (message.type === "lobby.request") {
            lobbyAdmin?.addPending({
              userId: String(message.userId),
              displayName: String(message.displayName),
              requestedAt: Number(message.requestedAt) || Date.now(),
            });
          } else if (message.type === "media.state") {
            const peerTile = videoFloatLayer?.querySelector<HTMLElement>(`[data-peer="${String(message.from)}"]`);
            if (peerTile) {
              updateVideoTileState(peerTile, {
                micOn: Boolean(message.micOn),
                cameraOn: Boolean(message.cameraOn),
                sharingScreen: Boolean(message.sharingScreen),
              });
            }
          } else {
            queueOrHandleSignal(message);
          }
        },
      });

      window.addEventListener("beforeunload", () => media.closeAll());

      // Run after the room is already live (not awaited above it) — the
      // consent card (#consent-root) still visually sits in front of the
      // room while this is open, so the attendee's own experience is
      // unchanged, but nothing else here had to wait for them to decide.
      const consentRoot = document.getElementById("consent-root");
      if (consentRoot) void askForMediaConsent(consentRoot).then(wireLocalMedia);
      else wireLocalMedia(null);
    })
    .catch(() => {
      // requireSession already redirected to /login/
    });
}
