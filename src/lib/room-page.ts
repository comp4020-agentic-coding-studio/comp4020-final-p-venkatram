import { requireSession } from "./session";
import { connectToRoom, type PresentUser } from "./room-connection";

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
      root?.removeAttribute("hidden");
      const nameEl = document.getElementById("room-name");
      if (nameEl) nameEl.textContent = data.room.name;

      const presenceList = document.getElementById("presence-list");
      const presentUsers = new Map<string, PresentUser>();
      const rerender = () => {
        if (presenceList instanceof HTMLUListElement) renderPresence(presenceList, [...presentUsers.values()], self.id);
      };

      connectToRoom(roomId, {
        onPresenceSync: (users) => {
          presentUsers.clear();
          for (const user of users) presentUsers.set(user.userId, user);
          rerender();
        },
        onPresenceJoin: (user) => {
          presentUsers.set(user.userId, user);
          rerender();
        },
        onPresenceLeave: (userId) => {
          presentUsers.delete(userId);
          rerender();
        },
      });
    })
    .catch(() => {
      // requireSession already redirected to /login/
    });
}
