// Real numbers only — server/routes/stats.ts serves aggregate counts with no
// room names or other identifying content. Shown only to signed-in visitors
// (a "welcome back" strip, not a public vanity metric for anonymous
// visitors) — hidden entirely rather than left to render while empty, and
// every value falls back to 0 rather than ever printing "undefined" if a
// field is missing from the response.
import { fetchSession } from "./session";

interface Stats {
  rooms?: number;
  notesComposed?: number;
  lyricsSheets?: number;
}

function setStat(id: string, value: number | undefined): void {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value ?? 0);
}

export function initLandingStats(): void {
  const strip = document.getElementById("stats-strip");
  if (!strip) return;

  fetchSession()
    .then((user) => {
      if (!user) return; // stays hidden for anonymous visitors
      return fetch("/api/stats")
        .then((res) => (res.ok ? (res.json() as Promise<Stats>) : Promise.reject(new Error("stats request failed"))))
        .then((stats) => {
          setStat("stat-rooms", stats.rooms);
          setStat("stat-notes", stats.notesComposed);
          setStat("stat-lyrics", stats.lyricsSheets);
          strip.removeAttribute("hidden");
        });
    })
    .catch(() => {
      // leave the strip hidden rather than show zeroes that might not be real
    });
}
