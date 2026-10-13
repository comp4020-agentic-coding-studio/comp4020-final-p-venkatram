// The organizer-only panel that lists people waiting at the door
// (server/realtime/lobby.ts's `lobby.sync`/`lobby.request` messages) and
// lets them be let in or turned away over the same room WebSocket
// (`lobby.admit`/`lobby.deny`, handled in server/ws.ts).
export interface PendingRequest {
  userId: string;
  displayName: string;
  requestedAt: number;
}

export interface LobbyAdminController {
  setPending: (requests: PendingRequest[]) => void;
  addPending: (request: PendingRequest) => void;
  removePending: (userId: string) => void;
}

export function initLobbyAdmin(container: HTMLElement, send: (msg: { type: string; [field: string]: unknown }) => void): LobbyAdminController {
  const requests = new Map<string, PendingRequest>();

  function render(): void {
    container.innerHTML = "";
    if (requests.size === 0) {
      container.setAttribute("hidden", "");
      return;
    }
    container.removeAttribute("hidden");
    const card = document.createElement("div");
    card.className = "card lobby-admin-card";
    const heading = document.createElement("h2");
    heading.style.marginTop = "0";
    heading.textContent = "Waiting to join";
    card.append(heading);

    for (const request of requests.values()) {
      const row = document.createElement("div");
      row.className = "lobby-admin-row";
      const name = document.createElement("span");
      name.textContent = request.displayName;
      const admitBtn = document.createElement("button");
      admitBtn.type = "button";
      admitBtn.className = "btn";
      admitBtn.textContent = "Admit";
      admitBtn.addEventListener("click", () => {
        send({ type: "lobby.admit", userId: request.userId });
        requests.delete(request.userId);
        render();
      });
      const denyBtn = document.createElement("button");
      denyBtn.type = "button";
      denyBtn.className = "btn secondary";
      denyBtn.textContent = "Deny";
      denyBtn.addEventListener("click", () => {
        send({ type: "lobby.deny", userId: request.userId });
        requests.delete(request.userId);
        render();
      });
      row.append(name, admitBtn, denyBtn);
      card.append(row);
    }
    container.append(card);
  }

  render();

  return {
    setPending: (incoming) => {
      requests.clear();
      for (const request of incoming) requests.set(request.userId, request);
      render();
    },
    addPending: (request) => {
      requests.set(request.userId, request);
      render();
    },
    removePending: (userId) => {
      requests.delete(userId);
      render();
    },
  };
}
