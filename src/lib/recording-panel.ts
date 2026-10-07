import { downloadBlob, mixAudioForGroupRecording, StreamRecorder } from "./recorder";

export interface RecordingPanelOptions {
  getLocalStream: () => MediaStream | null;
  getRemoteStreams: () => MediaStream[];
}

export function initRecordingPanel(container: HTMLElement, opts: RecordingPanelOptions): void {
  container.innerHTML = "";

  const note = document.createElement("p");
  note.className = "muted";
  note.textContent =
    "Recordings download straight to this device. Uploading to Google Drive or OneDrive is a stretch goal — not built yet.";

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
      personalRecorder.stop().then((blob) => downloadBlob(blob, `roundsong-personal-${Date.now()}.webm`));
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
      groupRecorder.stop().then((blob) => downloadBlob(blob, `roundsong-group-${Date.now()}.webm`));
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
