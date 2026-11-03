// Accounts & sessions with WebCrypto only.
// Password hashing: PBKDF2-SHA256 + per-user salt + optional server-side PEPPER secret.
// The iteration count is limited by the free plan's 10 ms CPU budget (see README);
// the PEPPER makes a leaked database useless for offline cracking.
import { type Db } from "./db.ts";
import { cfg, type Env } from "./env.ts";
import { HttpError } from "./http.ts";

const enc = new TextEncoder();
export const COOKIE = "ts_session";
const SESSION_DAYS = 30;

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const randomToken = (bytes = 32) => b64(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256(s: string): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
}

export async function hashPassword(env: Env, password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(`${password}\u0000${env.PEPPER ?? ""}`), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations }, key, 256);
  return b64(new Uint8Array(bits));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export interface User { id: number; username: string; email: string; role: string; is_active: number; token_version: number; preferences: string; notifications_seen_at: number; created_at: number; pw_hash?: string; pw_salt?: string; pw_iterations?: number }

export function cookieValue(req: Request, name = COOKIE): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function sessionCookie(token: string | null, secure: boolean): string {
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax", secure ? "Secure" : ""].filter(Boolean).join("; ");
  return token ? `${COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}; ${attrs}` : `${COOKIE}=; Max-Age=0; ${attrs}`;
}

export async function createSession(db: Db, user: User): Promise<string> {
  const token = randomToken();
  await db.run("INSERT INTO sessions (token_hash, user_id, token_version, expires_at) VALUES (?, ?, ?, ?)", await sha256(token), user.id, user.token_version, Date.now() + SESSION_DAYS * 86_400_000);
  return token;
}

export async function currentUser(db: Db, req: Request): Promise<User | null> {
  const token = cookieValue(req);
  if (!token || token.length > 100) return null;
  const u = await db.first<User & { s_tv: number; expires_at: number }>(
    `SELECT u.id, u.username, u.email, u.role, u.is_active, u.token_version, u.preferences, u.notifications_seen_at, u.created_at, s.token_version AS s_tv, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, await sha256(token));
  if (!u || !u.is_active || u.s_tv !== u.token_version || u.expires_at < Date.now()) return null;
  return u;
}

export async function requireUser(db: Db, req: Request): Promise<User> {
  const u = await currentUser(db, req);
  if (!u) throw new HttpError(401, "Nicht angemeldet");
  return u;
}

export async function requireRole(db: Db, req: Request, roles: string[]): Promise<User> {
  const u = await requireUser(db, req);
  if (!roles.includes(u.role)) throw new HttpError(403, "Keine Berechtigung");
  return u;
}

/** Brute-force protection backed by D1 (failed attempts only, pruned daily). */
export async function checkAttempts(db: Db, key: string, max = 8, windowMs = 15 * 60_000): Promise<void> {
  const n = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND at > ?", key, Date.now() - windowMs))?.n ?? 0;
  if (n >= max) throw new HttpError(429, "Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.");
}
export const recordAttempt = (db: Db, key: string) => db.run("INSERT INTO login_attempts (key, at) VALUES (?, ?)", key, Date.now());

export const iterations = (env: Env) => cfg(env).pbkdf2;
