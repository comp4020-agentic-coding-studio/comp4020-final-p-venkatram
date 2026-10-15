import { requireSession } from "./session";

interface Room {
  id: string;
  name: string;
  createdAt: number;
}

// The create-room dialog opens centered, by itself, when there are no rooms
// yet — there's nothing else useful on the page to do first. Once a room
// exists, it stays closed behind the "Create Room" button instead, so the
// page isn't interrupted by a modal every visit.
async function loadRooms(): Promise<void> {
  const list = document.getElementById("room-list");
  const dialog = document.getElementById("create-room-dialog");
  const trigger = document.getElementById("create-room-trigger");
  if (!list) return;
  const res = await fetch("/api/rooms", { credentials: "same-origin" });
  const data = (await res.json()) as { rooms: Room[] };
  list.textContent = "";
  if (data.rooms.length === 0) {
    list.className = "";
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No rooms yet — create one below.";
    list.append(empty);
    trigger?.setAttribute("hidden", "");
    if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
    return;
  }
  list.className = "room-grid";
  for (const room of data.rooms) {
    const link = document.createElement("a");
    link.className = "card room-card";
    link.href = `/room/?id=${encodeURIComponent(room.id)}`;

    const name = document.createElement("p");
    name.className = "room-card-name";
    name.textContent = room.name;

    const meta = document.createElement("p");
    meta.className = "room-card-meta";
    meta.textContent = `Created ${new Date(room.createdAt).toLocaleDateString()}`;

    link.append(name, meta);
    list.append(link);
  }
  trigger?.removeAttribute("hidden");
}

export function initRoomsPage(): void {
  requireSession()
    .then(() => {
      document.getElementById("rooms-root")?.removeAttribute("hidden");
      void loadRooms();

      const dialog = document.getElementById("create-room-dialog");
      const trigger = document.getElementById("create-room-trigger");
      const closeBtn = document.getElementById("create-room-close");
      if (dialog instanceof HTMLDialogElement) {
        trigger?.addEventListener("click", () => dialog.showModal());
        // Closing without creating a room (relevant when the dialog opened
        // itself because the list was empty) shouldn't leave the page with
        // no way to reopen it — reveal the trigger button as a fallback.
        closeBtn?.addEventListener("click", () => {
          dialog.close();
          trigger?.removeAttribute("hidden");
        });
      }

      const form = document.getElementById("create-room-form");
      const errorEl = document.getElementById("create-room-error");
      if (form instanceof HTMLFormElement) {
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          if (errorEl) errorEl.textContent = "";
          const name = (form.elements.namedItem("name") as HTMLInputElement).value;
          const password = (form.elements.namedItem("password") as HTMLInputElement).value;
          fetch("/api/rooms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ name, password }),
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
