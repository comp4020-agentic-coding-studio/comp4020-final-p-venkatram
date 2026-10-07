import type { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AuthError,
  clearSessionCookie,
  createSession,
  createUser,
  destroySession,
  sessionTokenFromRequest,
  setSessionCookie,
  userForToken,
  verifyLogin,
} from "../auth.ts";
import { BadRequestError, readJsonBody, sendJson } from "../http-util.ts";
import { logEvent } from "../log.ts";

interface SignupBody {
  email?: string;
  displayName?: string;
  password?: string;
}

interface LoginBody {
  email?: string;
  password?: string;
}

export async function handleAuthApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  db: DatabaseSync,
): Promise<boolean> {
  if (path === "/api/signup" && req.method === "POST") {
    try {
      const body = await readJsonBody<SignupBody>(req);
      const user = createUser(db, body.email ?? "", body.displayName ?? "", body.password ?? "");
      const token = createSession(db, user.id);
      setSessionCookie(res, token);
      logEvent("auth.signup", { userId: user.id });
      sendJson(res, 201, { user });
    } catch (err) {
      if (err instanceof AuthError) sendJson(res, 400, { error: err.message });
      else if (err instanceof BadRequestError) sendJson(res, 400, { error: err.message });
      else throw err;
    }
    return true;
  }

  if (path === "/api/login" && req.method === "POST") {
    try {
      const body = await readJsonBody<LoginBody>(req);
      const user = verifyLogin(db, body.email ?? "", body.password ?? "");
      const token = createSession(db, user.id);
      setSessionCookie(res, token);
      logEvent("auth.login", { userId: user.id });
      sendJson(res, 200, { user });
    } catch (err) {
      if (err instanceof AuthError) sendJson(res, 401, { error: err.message });
      else if (err instanceof BadRequestError) sendJson(res, 400, { error: err.message });
      else throw err;
    }
    return true;
  }

  if (path === "/api/logout" && req.method === "POST") {
    const token = sessionTokenFromRequest(req);
    if (token) {
      destroySession(db, token);
      logEvent("auth.logout", {});
    }
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (path === "/api/me" && req.method === "GET") {
    const token = sessionTokenFromRequest(req);
    const user = userForToken(db, token);
    sendJson(res, 200, { user });
    return true;
  }

  return false;
}
