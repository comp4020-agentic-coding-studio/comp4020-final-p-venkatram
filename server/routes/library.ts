import type { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sessionTokenFromRequest, userForToken } from "../auth.ts";
import { getRoom } from "../rooms.ts";
import { addPdfItem, addRecordingItem, getLibraryFile, listLibraryItems, setLibraryItemLink } from "../library.ts";
import { BadRequestError, readJsonBody, sendJson } from "../http-util.ts";
import { logEvent } from "../log.ts";

interface CreateRecordingBody {
  title?: string;
}

interface CreatePdfBody {
  title?: string;
  dataBase64?: string;
}

interface SetLinkBody {
  externalUrl?: string;
}

const MAX_PDF_BYTES = 10_000_000; // 10MB — generous for a text-only export

const ROOM_LIBRARY_RE = /^\/api\/rooms\/([^/]+)\/library$/;
const LIBRARY_LINK_RE = /^\/api\/library\/([^/]+)\/link$/;
const LIBRARY_FILE_RE = /^\/api\/library\/([^/]+)\/file$/;

export async function handleLibraryApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  db: DatabaseSync,
): Promise<boolean> {
  const roomMatch = ROOM_LIBRARY_RE.exec(path);
  if (roomMatch) {
    const roomId = roomMatch[1] as string;
    const user = userForToken(db, sessionTokenFromRequest(req));
    if (!user) {
      sendJson(res, 401, { error: "Log in first." });
      return true;
    }
    const room = getRoom(db, roomId);
    if (!room) {
      sendJson(res, 404, { error: "No room with that id." });
      return true;
    }

    if (req.method === "GET") {
      sendJson(res, 200, { items: listLibraryItems(db, roomId) });
      return true;
    }

    if (req.method === "POST" && path.endsWith("/library")) {
      // Two kinds of item land here: a recording (metadata only, downloaded
      // locally by the browser already — recorder.ts) or a PDF (its bytes,
      // base64-encoded — the only practical way to carry binary data through
      // this app's JSON-body routes). Distinguished by which fields are
      // present rather than a second endpoint, since both are "save this to
      // the room's library" in one step from the caller's point of view.
      try {
        const rawBody = await readJsonBody<CreateRecordingBody & CreatePdfBody>(req);
        if (typeof rawBody.dataBase64 === "string") {
          const buffer = Buffer.from(rawBody.dataBase64, "base64");
          if (buffer.byteLength > MAX_PDF_BYTES) throw new BadRequestError("File too large.");
          const item = addPdfItem(db, roomId, rawBody.title ?? "", buffer, "application/pdf", user.id);
          logEvent("library.add", { roomId, userId: user.id, itemId: item.id, type: "pdf" });
          sendJson(res, 201, { item });
        } else {
          const item = addRecordingItem(db, roomId, rawBody.title ?? "", user.id);
          logEvent("library.add", { roomId, userId: user.id, itemId: item.id, type: "recording" });
          sendJson(res, 201, { item });
        }
      } catch (err) {
        if (err instanceof BadRequestError) sendJson(res, 400, { error: err.message });
        else throw err;
      }
      return true;
    }
  }

  const linkMatch = LIBRARY_LINK_RE.exec(path);
  if (linkMatch && req.method === "PATCH") {
    const itemId = linkMatch[1] as string;
    const user = userForToken(db, sessionTokenFromRequest(req));
    if (!user) {
      sendJson(res, 401, { error: "Log in first." });
      return true;
    }
    const body = await readJsonBody<SetLinkBody>(req);
    const ok = setLibraryItemLink(db, itemId, user.id, body.externalUrl ?? "");
    if (!ok) {
      sendJson(res, 404, { error: "No recording with that id, or you're not its room's organizer." });
      return true;
    }
    logEvent("library.link-set", { userId: user.id, itemId });
    sendJson(res, 200, { ok: true });
    return true;
  }

  const fileMatch = LIBRARY_FILE_RE.exec(path);
  if (fileMatch && req.method === "GET") {
    const itemId = fileMatch[1] as string;
    const user = userForToken(db, sessionTokenFromRequest(req));
    if (!user) {
      sendJson(res, 401, { error: "Log in first." });
      return true;
    }
    const file = getLibraryFile(db, itemId);
    if (!file) {
      sendJson(res, 404, { error: "No file for that item." });
      return true;
    }
    res.writeHead(200, {
      "Content-Type": file.mime,
      "Content-Disposition": `attachment; filename="${file.title.replace(/[^a-zA-Z0-9 _-]/g, "")}.pdf"`,
    });
    res.end(file.blob);
    return true;
  }

  return false;
}
