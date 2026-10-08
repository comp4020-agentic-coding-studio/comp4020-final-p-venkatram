// Mute mic / turn camera off, locally — toggles MediaStreamTrack.enabled
// rather than stopping the track, so turning it back on needs no
// renegotiation and no re-acquiring getUserMedia: the same tracks stay
// attached to every peer connection the whole time (webrtc.ts never sees
// this happen — a disabled track just sends silence/a black frame).
export function initMediaControls(container: HTMLElement, stream: MediaStream): void {
  const audioTrack = stream.getAudioTracks()[0];
  const videoTrack = stream.getVideoTracks()[0];
  if (!audioTrack && !videoTrack) return; // joined without any media — nothing here to control

  container.innerHTML = "";
  const row = document.createElement("div");
  row.className = "media-controls";

  if (audioTrack) {
    const micBtn = document.createElement("button");
    micBtn.type = "button";
    micBtn.className = "btn secondary";
    const render = (): void => {
      micBtn.textContent = audioTrack.enabled ? "Mute mic" : "Unmute mic";
      micBtn.setAttribute("aria-pressed", String(!audioTrack.enabled));
    };
    render();
    micBtn.addEventListener("click", () => {
      audioTrack.enabled = !audioTrack.enabled;
      render();
    });
    row.append(micBtn);
  }

  if (videoTrack) {
    const camBtn = document.createElement("button");
    camBtn.type = "button";
    camBtn.className = "btn secondary";
    const render = (): void => {
      camBtn.textContent = videoTrack.enabled ? "Turn camera off" : "Turn camera on";
      camBtn.setAttribute("aria-pressed", String(!videoTrack.enabled));
    };
    render();
    camBtn.addEventListener("click", () => {
      videoTrack.enabled = !videoTrack.enabled;
      render();
    });
    row.append(camBtn);
  }

  container.append(row);
}
