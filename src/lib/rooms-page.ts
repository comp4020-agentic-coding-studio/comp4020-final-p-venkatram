import { requireSession } from "./session";

interface Room {
  id: string;
  name: string;
}

async function loadRooms(): Promise<void> {
  const list = document.getElementById("room-list");
  if (!list) return;
  const res = await fetch("/api/rooms", { credentials: "same-origin" });
  const data = (await res.json()) as { rooms: Room[] };
  list.textContent = "";
  if (data.rooms.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No rooms yet — create one below.";
    list.append(empty);
    return;
  }
  for (const room of data.rooms) {
    const link = document.createElement("a");
    link.className = "card";
    link.style.display = "block";
    link.style.marginBottom = "0.75rem";
    link.style.textDecoration = "none";
    link.style.color = "var(--text)";
    link.href = `/room/?id=${encodeURIComponent(room.id)}`;
    link.textContent = room.name;
    list.append(link);
  }
}

export function initRoomsPage(): void {
  requireSession()
    .then(() => {
      document.getElementById("rooms-root")?.removeAttribute("hidden");
      void loadRooms();

      const form = document.getElementById("create-room-form");
      const errorEl = document.getElementById("create-room-error");
      if (form instanceof HTMLFormElement) {
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          if (errorEl) errorEl.textContent = "";
          const name = (form.elements.namedItem("name") as HTMLInputElement).value;
          fetch("/api/rooms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ name }),
          })
            .then(async (res) => {
              const data = (await res.json()) as { room?: Room; error?: string };
              if (!res.ok || !data.room) throw new Error(data.error ?? "Couldn't create the room.");
              window.location.href = `/room/?id=${encodeURIComponent(data.room.id)}`;
            })
            .catch((err: Error) => {
              if (errorEl) errorEl.textContent = err.message;
            });
        });
      }
    })
    .catch(() => {
      // requireSession already redirected to /login/
    });
}
