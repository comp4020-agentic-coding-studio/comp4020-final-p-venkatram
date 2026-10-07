// Recording is entirely client-side: a personal recording captures your own
// camera/mic locally, a group recording mixes your mic with every currently
// connected peer's incoming audio through a Web Audio graph — neither ever
// sends anything to the server, which has no spare capacity on a 256MB
// machine to receive, store, or transcode media anyway. Both end in a local
// download; uploading to Google Drive/OneDrive is a stretch goal, not built
// this pass (flagged in the room UI, not silently missing).
function pickSupportedMimeType(stream: MediaStream): string | undefined {
  const hasVideo = stream.getVideoTracks().length > 0;
  const candidates = hasVideo
    ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["audio/webm;codecs=opus", "audio/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

export class StreamRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  get isRecording(): boolean {
    return this.recorder?.state === "recording";
  }

  start(stream: MediaStream): void {
    if (this.isRecording) return;
    this.chunks = [];
    const mimeType = pickSupportedMimeType(stream);
    this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
    this.recorder.start();
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const recorder = this.recorder;
      if (!recorder) {
        resolve(new Blob());
        return;
      }
      recorder.addEventListener("stop", () => resolve(new Blob(this.chunks, { type: recorder.mimeType })), {
        once: true,
      });
      recorder.stop();
    });
  }
}

// Mixes your own mic (if you have one) with every currently-connected peer's
// incoming audio into one stream — the room's group sound, from wherever
// you're sitting. Video isn't composited (that would mean drawing every tile
// to a canvas and capturing that) — audio-only group recording is the
// honest scope for this pass.
export function mixAudioForGroupRecording(streams: MediaStream[]): MediaStream {
  const ctx = new AudioContext();
  const destination = ctx.createMediaStreamDestination();
  for (const stream of streams) {
    if (stream.getAudioTracks().length === 0) continue;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(destination);
  }
  return destination.stream;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
