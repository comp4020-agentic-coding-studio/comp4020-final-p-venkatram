// Recording controls, now living in the Collaboration panel itself (not
// behind a separate view) so they're reachable without switching away from
// the call. Recording stays entirely client-side — neither variant ever
// sends media to the server, which has no spare capacity on a 256MB machine
// to receive, store, or transcode it. What DOES reach the server is a
// library row: a lightweight "a recording named X happened" record
// (server/library.ts), so it shows up in the room's Library panel even
// though the file itself only ever lived on this device.
import { downloadBlob, mixAudioForGroupRecording, StreamRecorder } from "./recorder";

export interface RecordingPanelOptions {
  roomId: string;
  getLocalStream: () => MediaStream | null;
  getRemoteStreams: () => MediaStream[];
  onSaved?: () => void;
}

function saveRecordingToLibrary(roomId: string, title: string): void {
  void fetch(`/api/rooms/${encodeURIComponent(roomId)}/library`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ title }),
  }).catch(() => {
    // the local download already happened; a failed library row just means
    // this session isn't listed for reference, nothing to reconcile
  });
}

export function initRecordingPanel(container: HTMLElement, opts: RecordingPanelOptions): void {
  container.innerHTML = "";

  const note = document.createElement("p");
  note.className = "muted";
  note.textContent =
    "Recordings download straight to this device, and a reference to them appears in the room's Library. Uploading to Google Drive or OneDrive is a stretch goal — not built yet; paste a link in from the Library panel after you upload it yourself.";

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.gap = "0.75rem";
  row.style.flexWrap = "wrap";

  const personalRecorder = new StreamRecorder();
  const personalBtn = document.createElement("button");
  personalBtn.type = "button";
  personalBtn.className = "btn secondary";
  personalBtn.textContent = "Record myself";

  personalBtn.addEventListener("click", () => {
    if (personalRecorder.isRecording) {
      personalRecorder.stop().then((blob) => {
        const filename = `waveforge-personal-${Date.now()}.webm`;
        downloadBlob(blob, filename);
        saveRecordingToLibrary(opts.roomId, filename);
        opts.onSaved?.();
      });
      personalBtn.textContent = "Record myself";
      return;
    }
    const stream = opts.getLocalStream();
    if (!stream) {
      note.textContent = "No camera or mic to record — you joined this room without one.";
      return;
    }
    personalRecorder.start(stream);
    personalBtn.textContent = "Stop recording myself";
  });

  const groupRecorder = new StreamRecorder();
  const groupBtn = document.createElement("button");
  groupBtn.type = "button";
  groupBtn.className = "btn secondary";
  groupBtn.textContent = "Record the group";

  groupBtn.addEventListener("click", () => {
    if (groupRecorder.isRecording) {
      groupRecorder.stop().then((blob) => {
        const filename = `waveforge-group-${Date.now()}.webm`;
        downloadBlob(blob, filename);
        saveRecordingToLibrary(opts.roomId, filename);
        opts.onSaved?.();
      });
      groupBtn.textContent = "Record the group";
      return;
    }
    const local = opts.getLocalStream();
    const sources = [local, ...opts.getRemoteStreams()].filter((s): s is MediaStream => Boolean(s));
    if (sources.length === 0) {
      note.textContent = "Nobody's audio is available to record yet.";
      return;
    }
    groupRecorder.start(mixAudioForGroupRecording(sources));
    groupBtn.textContent = "Stop recording the group";
  });

  row.append(personalBtn, groupBtn);
  container.append(note, row);
}
