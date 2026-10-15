import type { RoomMedia } from "./webrtc";

export interface MediaState {
  micOn: boolean;
  cameraOn: boolean;
  sharingScreen: boolean;
}

export interface MediaControlsOptions {
  media: RoomMedia;
  // Lets room-page.ts keep the self video tile in sync with what's actually
  // being sent — the camera, or (while sharing) the screen — since that
  // tile lives in the video grid, not here.
  onLocalVideoChanged?: (stream: MediaStream | null) => void;
  // Reports every mic/camera/share change so room-page.ts can broadcast it
  // (media.state, server/ws.ts) and drive this tile's own status icons —
  // there's no other way to tell "muted on purpose" from "just quiet" over
  // WebRTC, which only carries the resulting silence/black frame, not why.
  onStateChange?: (state: MediaState) => void;
}

export interface MediaControls {
  // Whether each toggle is actually available — no audio/video track to
  // mute means there's nothing for that control to do (room-page.ts uses
  // this to decide whether the self tile's icon is clickable at all).
  hasMic: boolean;
  hasCamera: boolean;
  toggleMic: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => void;
}

// Mute mic / turn camera off, locally — toggles MediaStreamTrack.enabled
// rather than stopping the track, so turning it back on needs no
// renegotiation and no re-acquiring getUserMedia: the same tracks stay
// attached to every peer connection the whole time (webrtc.ts never sees
// this happen — a disabled track just sends silence/a black frame).
//
// Screen sharing is available even to someone who joined mic-only or with
// no media at all — attendees shouldn't need a camera to present their
// screen. No UI of its own: the three actions here are driven by clicking
// the status icons on the self video tile (room-page.ts), not a separate
// button row.
export function initMediaControls(stream: MediaStream | null, opts: MediaControlsOptions): MediaControls {
  const audioTrack = stream?.getAudioTracks()[0];
  const videoTrack = stream?.getVideoTracks()[0];
  let screenStream: MediaStream | null = null;

  function reportState(): void {
    opts.onStateChange?.({
      micOn: audioTrack?.enabled ?? false,
      cameraOn: videoTrack?.enabled ?? false,
      sharingScreen: screenStream !== null,
    });
  }

  function stopSharing(): void {
    if (!screenStream) return;
    for (const track of screenStream.getTracks()) track.stop();
    screenStream = null;
    void opts.media.replaceVideoTrack(videoTrack ?? null);
    opts.onLocalVideoChanged?.(videoTrack && stream ? stream : null);
    reportState();
  }

  // No initial reportState() call here — the caller already knows the
  // starting mic/camera state before this even runs (it's exactly what
  // acquired the stream), and calling it synchronously during construction
  // would fire onStateChange before the caller has anywhere to route it
  // (room-page.ts's `conn` doesn't exist yet at this point in setup).
  return {
    hasMic: Boolean(audioTrack),
    hasCamera: Boolean(videoTrack),
    toggleMic: () => {
      if (!audioTrack) return;
      audioTrack.enabled = !audioTrack.enabled;
      reportState();
    },
    toggleCamera: () => {
      if (!videoTrack) return;
      videoTrack.enabled = !videoTrack.enabled;
      reportState();
    },
    toggleScreenShare: () => {
      if (screenStream) {
        stopSharing();
        return;
      }
      navigator.mediaDevices
        .getDisplayMedia({ video: true })
        .then((captured) => {
          const screenTrack = captured.getVideoTracks()[0];
          if (!screenTrack) return;
          screenStream = captured;
          void opts.media.replaceVideoTrack(screenTrack);
          opts.onLocalVideoChanged?.(captured);
          reportState();
          // The browser's own "Stop sharing" bar (or closing the shared
          // window/tab) ends the track directly — listen for that too, not
          // just our own button, so the UI can't go stale behind it.
          screenTrack.addEventListener("ended", stopSharing);
        })
        .catch(() => {
          // the picker was cancelled, or permission was denied — nothing
          // changed, so there's nothing to revert
        });
    },
  };
}
