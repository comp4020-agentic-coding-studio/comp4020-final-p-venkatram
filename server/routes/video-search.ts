import type { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sessionTokenFromRequest, userForToken } from "../auth.ts";
import { searchYoutube, YoutubeSearchFailedError, YoutubeSearchNotConfiguredError } from "../youtube-search.ts";
import { sendJson } from "../http-util.ts";

const SEARCH_RE = /^\/api\/youtube-search$/;

// Session-gated (so an anonymous caller can't spend the server's YouTube
// quota for free) but not room-scoped — a search isn't room data, and which
// room's queue a result gets added to is decided client-side by which
// room's "Add to queue" the user is looking at.
export async function handleVideoSearchApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  db: DatabaseSync,
): Promise<boolean> {
  if (!SEARCH_RE.test(path) || req.method !== "GET") return false;

  const user = userForToken(db, sessionTokenFromRequest(req));
  if (!user) {
    sendJson(res, 401, { error: "Log in first." });
    return true;
  }

  const url = new URL(req.url ?? "/", "http://internal");
  const q = url.searchParams.get("q") ?? "";
  if (q.trim().length === 0) {
    sendJson(res, 400, { error: "Type something to search for." });
    return true;
  }

  try {
    const results = await searchYoutube(q);
    sendJson(res, 200, { results });
  } catch (err) {
    if (err instanceof YoutubeSearchNotConfiguredError) {
      sendJson(res, 503, { error: "YouTube search isn't available right now." });
    } else if (err instanceof YoutubeSearchFailedError) {
      sendJson(res, 502, { error: "YouTube search failed. Try again." });
    } else {
      throw err;
    }
  }
  return true;
}
