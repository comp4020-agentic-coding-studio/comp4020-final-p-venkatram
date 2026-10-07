// No code path acquires the camera or microphone without this running first,
// every time a room is entered (CLAUDE.md's consent rule). Resolves to the
// stream the visitor agreed to, or null if they chose to join without one —
// a no-media visitor can still watch and listen (see webrtc.ts's recvonly
// transceivers), just not be seen or heard.
export type ConsentChoice = "camera-and-mic" | "mic-only" | "none";

async function acquire(choice: ConsentChoice): Promise<MediaStream | null> {
  if (choice === "none") return null;
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: choice === "camera-and-mic",
    });
  } catch {
    return null; // denied at the browser level, or no device — join silently
  }
}

export function askForMediaConsent(container: HTMLElement): Promise<MediaStream | null> {
  return new Promise((resolve) => {
    container.innerHTML = "";
    const card = document.createElement("div");
    card.className = "card";
    card.style.maxWidth = "28rem";
    card.innerHTML = `
      <h2 style="margin-top:0;">Join with camera and mic?</h2>
      <p class="muted">Nothing turns on until you choose. You can change this later in the room.</p>
    `;

    const choose = (choice: ConsentChoice, btn: HTMLButtonElement): void => {
      for (const b of card.querySelectorAll("button")) (b as HTMLButtonElement).disabled = true;
      btn.textContent = "Connecting...";
      acquire(choice).then((stream) => {
        container.innerHTML = "";
        resolve(stream);
      });
    };

    const cameraBtn = document.createElement("button");
    cameraBtn.type = "button";
    cameraBtn.className = "btn";
    cameraBtn.textContent = "Camera and mic";
    cameraBtn.addEventListener("click", () => choose("camera-and-mic", cameraBtn));

    const micBtn = document.createElement("button");
    micBtn.type = "button";
    micBtn.className = "btn secondary";
    micBtn.textContent = "Mic only";
    micBtn.addEventListener("click", () => choose("mic-only", micBtn));

    const noneBtn = document.createElement("button");
    noneBtn.type = "button";
    noneBtn.className = "btn secondary";
    noneBtn.textContent = "Join without media";
    noneBtn.addEventListener("click", () => choose("none", noneBtn));

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "0.6rem";
    row.style.flexWrap = "wrap";
    row.append(cameraBtn, micBtn, noneBtn);
    card.append(row);
    container.append(card);
  });
}
