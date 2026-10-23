import type { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { sessionTokenFromRequest, userForToken } from "../auth.ts";
import { addSheetMusicItem, deleteSheetMusicItem, getSheetMusicFilePath, listSheetMusicItems } from "../sheet-music.ts";
import { BadRequestError, readJsonBody, sendJson } from "../http-util.ts";
import { logEvent } from "../log.ts";

interface UploadBody {
  title?: string;
  dataBase64?: string;
}

// MusicXML is verbose, uncompressed XML — generous relative to the Library
// route's 10MB PDF cap (server/routes/library.ts), and well above
// http-util.ts's 1MB JSON-body default, which this route explicitly raises
// for its own base64 payload rather than loosening the shared default.
const MAX_SHEET_MUSIC_BYTES = 15_000_000;
const MAX_BODY_BYTES = Math.ceil(MAX_SHEET_MUSIC_BYTES * 1.4); // base64 overhead

const ITEM_RE = /^\/api\/sheet-music\/([^/]+)$/;
const FILE_RE = /^\/api\/sheet-music\/([^/]+)\/file$/;

export async function handleSheetMusicApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  db: DatabaseSync,
): Promise<boolean> {
  if (path === "/api/sheet-music" && req.method === "GET") {
    const user = userForToken(db, sessionTokenFromRequest(req));
    if (!user) {
      sendJson(res, 401, { error: "Log in first." });
      return true;
    }
    sendJson(res, 200, { items: listSheetMusicItems(db, user.id) });
    return true;
  }

  if (path === "/api/sheet-music" && req.method === "POST") {
    const user = userForToken(db, sessionTokenFromRequest(req));
    if (!user) {
      sendJson(res, 401, { error: "Log in first." });
      return true;
    }
    try {
      const body = await readJsonBody<UploadBody>(req, MAX_BODY_BYTES);
      if (typeof body.dataBase64 !== "string" || body.dataBase64.length === 0) {
        throw new BadRequestError("No file provided.");
      }
      const buffer = Buffer.from(body.dataBase64, "base64");
      if (buffer.byteLength > MAX_SHEET_MUSIC_BYTES) throw new BadRequestError("File too large.");
      const item = addSheetMusicItem(db, user.id, body.title ?? "", buffer, "application/vnd.recordare.musicxml+xml");
      logEvent("sheet-music.upload", { userId: user.id, itemId: item.id });
      sendJson(res, 201, { item });
    } catch (err) {
      if (err instanceof BadRequestError) sendJson(res, 400, { error: err.message });
      else throw err;
    }
    return true;
  }

  const fileMatch = FILE_RE.exec(path);
  if (fileMatch && req.method === "GET") {
    const itemId = fileMatch[1] as string;
    const user = userForToken(db, sessionTokenFromRequest(req));
    if (!user) {
      sendJson(res, 401, { error: "Log in first." });
      return true;
    }
    const file = getSheetMusicFilePath(db, itemId, user.id);
    if (!file) {
      sendJson(res, 404, { error: "No file for that item." });
      return true;
    }
    res.writeHead(200, { "Content-Type": file.mime });
    createReadStream(file.path).pipe(res);
    return true;
  }

  const itemMatch = ITEM_RE.exec(path);
  if (itemMatch && req.method === "DELETE") {
    const itemId = itemMatch[1] as string;
    const user = userForToken(db, sessionTokenFromRequest(req));
    if (!user) {
      sendJson(res, 401, { error: "Log in first." });
      return true;
    }
    const ok = deleteSheetMusicItem(db, itemId, user.id);
    if (!ok) {
      sendJson(res, 404, { error: "No score with that id." });
      return true;
    }
    logEvent("sheet-music.delete", { userId: user.id, itemId });
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
