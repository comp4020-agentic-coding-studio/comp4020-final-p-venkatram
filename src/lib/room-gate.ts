// The password + organizer-lobby gate a non-owner goes through before a
// room's media-consent step even runs (src/lib/media-consent.ts). The
// organizer never sees any of this (room-page.ts skips straight past it for
// them) — see server/routes/rooms.ts's join-request route and
// server/realtime/lobby.ts for the server half this calls into.
export interface GateResult {
  admitted: boolean;
}

interface JoinRequestResponse {
  ok: boolean;
  admitted?: boolean;
  error?: string;
}

async function submitJoinRequest(roomId: string, password: string): Promise<JoinRequestResponse> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/join-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ password }),
    });
    const data = (await res.json()) as { admitted?: boolean; error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? "Couldn't join this room." };
    return { ok: true, admitted: Boolean(data.admitted) };
  } catch {
    return { ok: false, error: "Couldn't reach the server — try again." };
  }
}

function renderWaiting(container: HTMLElement): { setOffline: () => void; setDenied: () => void } {
  container.innerHTML = "";
  container.removeAttribute("hidden");
  const card = document.createElement("div");
  card.className = "card";
  card.style.maxWidth = "28rem";
  const heading = document.createElement("h2");
  heading.style.marginTop = "0";
  heading.textContent = "Waiting for the host to let you in...";
  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = "Hang tight — the room's organizer needs to admit you.";
  card.append(heading, note);
  container.append(card);

  return {
    setOffline: () => {
      note.textContent = "The host isn't online right now, but your request is still waiting.";
    },
    setDenied: () => {
      heading.textContent = "The host didn't let you in";
      note.textContent = "";
      const backLink = document.createElement("a");
      backLink.href = "/rooms/";
      backLink.textContent = "Back to your rooms";
      card.append(backLink);
    },
  };
}

export function askForRoomGate(
  passwordContainer: HTMLElement,
  waitContainer: HTMLElement,
  roomId: string,
): Promise<GateResult> {
  return new Promise((resolve) => {
    passwordContainer.innerHTML = "";
    passwordContainer.removeAttribute("hidden");
    const card = document.createElement("div");
    card.className = "card";
    card.style.maxWidth = "28rem";
    card.innerHTML = `
      <h2 style="margin-top:0;">This room needs a password</h2>
      <p class="muted">Ask the organizer for it, then enter it below.</p>
      <form novalidate>
        <div class="field">
          <label for="room-gate-password">Room password</label>
          <input id="room-gate-password" name="password" type="password" required autocomplete="off" />
        </div>
        <p class="error-text" role="alert"></p>
        <button type="submit" class="btn">Request to join</button>
      </form>
    `;
    passwordContainer.append(card);

    const form = card.querySelector("form");
    const errorEl = card.querySelector(".error-text");
    const submitBtn = card.querySelector("button[type=submit]");

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (errorEl) errorEl.textContent = "";
      const passwordInput = form.elements.namedItem("password") as HTMLInputElement;
      if (submitBtn instanceof HTMLButtonElement) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Requesting...";
      }

      const requestPromise = submitJoinRequest(roomId, passwordInput.value);

      // The request can block for a long time waiting on the organizer
      // (server/realtime/lobby.ts) — give immediate feedback rather than a
      // frozen form, but only once we know the password itself was
      // accepted (a wrong password resolves almost instantly, and in that
      // case the form should just show the error and let them retry).
      let waitingShown = false;
      const showWaitingTimer = window.setTimeout(() => {
        passwordContainer.innerHTML = "";
        passwordContainer.setAttribute("hidden", "");
        const { setOffline } = renderWaiting(waitContainer);
        waitingShown = true;
        window.setTimeout(setOffline, 5000);
      }, 400);

      void requestPromise.then((result) => {
        window.clearTimeout(showWaitingTimer);

        if (!result.ok) {
          if (waitingShown) {
            // Shouldn't happen (a failed request resolves fast, before the
            // waiting screen would show) but handle it defensively: go back
            // to the password form with the error.
            waitContainer.setAttribute("hidden", "");
            passwordContainer.removeAttribute("hidden");
          }
          if (errorEl) errorEl.textContent = result.error ?? "Couldn't join this room.";
          if (submitBtn instanceof HTMLButtonElement) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Request to join";
          }
          return;
        }

        if (!waitingShown) {
          passwordContainer.innerHTML = "";
          passwordContainer.setAttribute("hidden", "");
        }

        if (result.admitted) {
          waitContainer.setAttribute("hidden", "");
          resolve({ admitted: true });
        } else {
          const { setDenied } = renderWaiting(waitContainer);
          setDenied();
          resolve({ admitted: false });
        }
      });
    });
  });
}
