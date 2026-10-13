// Email + password auth, scrypt-hashed via node:crypto (no bcrypt native
// dependency), sessions in SQLite. Deliberately minimal: this app doesn't
// need password reset or email verification to satisfy the brief, and adding
// either now would be scope the spec never asked for.
import type { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

export interface User {
  id: string;
  email: string;
  displayName: string;
}

const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SCRYPT_KEYLEN = 64;

// Exported so room passwords (server/rooms.ts) use this exact scheme too,
// rather than a second hand-rolled hashing path for a second kind of secret.
export function hashSecret(secret: string, salt: string): string {
  return scryptSync(secret, salt, SCRYPT_KEYLEN).toString("hex");
}

export function verifySecret(secret: string, salt: string, expectedHex: string): boolean {
  const candidate = Buffer.from(hashSecret(secret, salt), "hex");
  const actual = Buffer.from(expectedHex, "hex");
  return candidate.length === actual.length && timingSafeEqual(candidate, actual);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export class AuthError extends Error {}

export function createUser(db: DatabaseSync, email: string, displayName: string, password: string): User {
  const normalisedEmail = email.trim().toLowerCase();
  if (!isValidEmail(normalisedEmail)) throw new AuthError("That doesn't look like an email address.");
  if (displayName.trim().length === 0) throw new AuthError("A display name is required.");
  if (password.length < 8) throw new AuthError("Password must be at least 8 characters.");

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalisedEmail);
  if (existing) throw new AuthError("An account with that email already exists.");

  const id = randomUUID();
  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashSecret(password, salt);
  db.prepare(
    "INSERT INTO users (id, email, display_name, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, normalisedEmail, displayName.trim(), passwordHash, salt, Date.now());

  return { id, email: normalisedEmail, displayName: displayName.trim() };
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
}

export function verifyLogin(db: DatabaseSync, email: string, password: string): User {
  const normalisedEmail = email.trim().toLowerCase();
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(normalisedEmail) as UserRow | undefined;
  if (!row) throw new AuthError("Incorrect email or password.");

  if (!verifySecret(password, row.password_salt, row.password_hash)) {
    throw new AuthError("Incorrect email or password.");
  }
  return { id: row.id, email: row.email, displayName: row.display_name };
}

export function createSession(db: DatabaseSync, userId: string): string {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    token,
    userId,
    now,
    now + SESSION_TTL_MS,
  );
  return token;
}

export function destroySession(db: DatabaseSync, token: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(token);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function sessionTokenFromRequest(req: IncomingMessage): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

interface SessionRow {
  id: string;
  display_name: string;
  email: string;
  expires_at: number;
}

export function userForToken(db: DatabaseSync, token: string | undefined): User | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT users.id as id, users.email as email, users.display_name as display_name, sessions.expires_at as expires_at
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ?`,
    )
    .get(token) as SessionRow | undefined;
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, email: row.email, displayName: row.display_name };
}

export function setSessionCookie(res: ServerResponse, token: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`,
  );
}

export function clearSessionCookie(res: ServerResponse): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}
