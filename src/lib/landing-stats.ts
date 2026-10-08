// Real numbers only — server/routes/stats.ts serves aggregate counts with no
// room names or other identifying content, so this is honest to show
// publicly even though (for a brand-new course project) the numbers are
// small. No fabricated "10K+" placeholders standing in for real traffic.
interface Stats {
  rooms: number;
  notesComposed: number;
  lyricsSheets: number;
}

function setStat(id: string, value: number): void {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

export function initLandingStats(): void {
  fetch("/api/stats")
    .then((res) => res.json())
    .then((stats: Stats) => {
      setStat("stat-rooms", stats.rooms);
      setStat("stat-notes", stats.notesComposed);
      setStat("stat-lyrics", stats.lyricsSheets);
    })
    .catch(() => {
      // leave the dashes in place rather than show a broken-looking zero
    });
}
