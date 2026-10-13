// Public, aggregate-only counts for the landing page's stats strip — real
// numbers, not the fabricated "10K+ sessions" kind. No room names or any
// other identifying content leaves this endpoint, just totals, so it's safe
// to serve without a session.
import type { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http-util.ts";

export async function handleStatsApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  db: DatabaseSync,
): Promise<boolean> {
  if (path !== "/api/stats" || req.method !== "GET") return false;

  const rooms = (db.prepare("SELECT COUNT(*) AS c FROM rooms").get() as { c: number }).c;
  const lyricsSheets = (db.prepare("SELECT COUNT(*) AS c FROM lyrics").get() as { c: number }).c;

  const compositionGrids = db.prepare("SELECT grid FROM composition_voices").all() as { grid: string }[];
  let notesComposed = 0;
  for (const row of compositionGrids) {
    try {
      const cells: unknown = JSON.parse(row.grid);
      if (Array.isArray(cells)) notesComposed += cells.length;
    } catch {
      // malformed row: contributes nothing rather than failing the whole count
    }
  }

  sendJson(res, 200, { rooms, notesComposed, lyricsSheets });
  return true;
}
