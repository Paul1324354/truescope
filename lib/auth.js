// Konten: Passwörter, Sitzungen, Einmal-Links (Bestätigung, Passwort zurücksetzen), Missbrauchsschutz und E-Mail-Versand.
//
// Sicherheit in Kürze:
// - Passwörter werden nie gespeichert, nur ein PBKDF2-SHA-256-Hash mit zufälligem Salz (100.000 Runden, mehr erlaubt Workers nicht).
// - Sitzung = zufälliger Schlüssel in einem HttpOnly-, Secure-, SameSite=Lax-Cookie; in der Datenbank steht nur sein SHA-256-Hash.
// - Bestätigungs- und Rücksetz-Links sind zufällig, nur einmal gültig und laufen ab; gespeichert wird nur ihr Hash.
// - Anfragen werden je IP-Adresse und je E-Mail-Adresse begrenzt; Antworten verraten nicht, ob eine Adresse registriert ist.

export const SESSION_COOKIE = "ts_session";
const SESSION_DAYS = 30;
const VERIFY_HOURS = 48;
const RESET_HOURS = 1;
const PBKDF2_ITER = 100_000;

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
export const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

// ---------- Antworten ----------

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
export const fail = (msg, status = 400, extra = {}) => json({ error: msg, ...extra }, status);

// ---------- Eingaben ----------

export const normEmail = (s) => String(s || "").trim().toLowerCase();
export const validEmail = (s) => s.length <= 254 && /^[^\s@<>"']{1,64}@[^\s@<>"']+\.[a-z]{2,}$/i.test(s);
export const cleanName = (s) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
export function passwordProblem(pw) {
  pw = String(pw || "");
  if (pw.length < 8) return "Das Passwort muss mindestens 8 Zeichen lang sein.";
  if (pw.length > 200) return "Das Passwort ist zu lang.";
  return null;
}

// ---------- Passwörter ----------

async function pbkdf2(pw, salt, iter) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: iter }, key, 256));
}
export async function hashPassword(pw) {
  const salt = randomToken(16);
  return { hash: await pbkdf2(pw, salt, PBKDF2_ITER), salt, iter: PBKDF2_ITER };
}
const sameStr = (a, b) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
export async function checkPassword(pw, user) {
  if (!user) { await pbkdf2(String(pw || ""), "x", PBKDF2_ITER); return false; } // gleiche Rechenzeit, auch ohne Konto
  return sameStr(await pbkdf2(String(pw || ""), user.pw_salt, user.pw_iter), user.pw_hash);
}

// ---------- Sitzungen ----------

function readCookie(request, name) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : null;
}
const cookieHeader = (value, maxAge) =>
  `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export async function createSession(env, userId) {
  const token = randomToken(32), now = Date.now();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), userId, now, now + SESSION_DAYS * 864e5).run();
  // nebenbei abgelaufene Sitzungen und Links aufräumen
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM auth_tokens WHERE expires_at < ?").bind(now - 864e5),
    env.DB.prepare("DELETE FROM auth_limits WHERE window_start < ?").bind(now - 864e5),
  ]);
  return cookieHeader(token, SESSION_DAYS * 86400);
}
export const clearCookie = () => cookieHeader("", 0);

export async function currentUser(env, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`
  ).bind(await sha256(token), Date.now()).first();
  return row || null;
}
export async function endSession(env, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

// ---------- Einmal-Links ----------

// Löst einen Link ein (danach ungültig). Liefert die user_id oder null.
export async function useToken(env, token, kind) {
  if (!token || token.length > 100) return null;
  const h = await sha256(token);
  const row = await env.DB.prepare("SELECT user_id, expires_at FROM auth_tokens WHERE token_hash = ? AND kind = ?").bind(h, kind).first();
  if (!row) return null;
  await env.DB.prepare("DELETE FROM auth_tokens WHERE token_hash = ?").bind(h).run();
  return row.expires_at > Date.now() ? row.user_id : null;
}

// ---------- Missbrauchsschutz ----------

// true = erlaubt. Zählt Versuche je Schlüssel in einem Zeitfenster.
export async function allow(env, key, max, windowMs) {
  const now = Date.now();
  const row = await env.DB.prepare("SELECT count, window_start FROM auth_limits WHERE key = ?").bind(key).first();
  if (!row || now - row.window_start > windowMs) {
    await env.DB.prepare("INSERT INTO auth_limits (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start").bind(key, now).run();
    return true;
  }
  if (row.count >= max) return false;
  await env.DB.prepare("UPDATE auth_limits SET count = count + 1 WHERE key = ?").bind(key).run();
  return true;
}
export const ipOf = (request) => request.headers.get("CF-Connecting-IP") || "0";

// Nur Anfragen von der eigenen Seite (Schutz vor fremden Formularen)
export function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // manche Browser senden bei gleicher Herkunft keinen Origin-Header
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

// ---------- E-Mail ----------

// Versand über Cloudflare Email Service (REST-API). Eingerichtet, sobald EMAIL_FROM, CF_ACCOUNT_ID und EMAIL_API_TOKEN gesetzt sind.
export const emailReady = (env) => !!(env.EMAIL_FROM && env.CF_ACCOUNT_ID && env.EMAIL_API_TOKEN);

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function mailBody({ hello, intro, button, link, outro }) {
  const text = `${hello}\n\n${intro}\n\n${button}:\n${link}\n\n${outro}\n\n– TrueScope`;
  const html = `<!doctype html><html lang="de"><body style="margin:0;background:#F1F5F3;font-family:Arial,Helvetica,sans-serif;color:#10242A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F3;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #D3DDD9;border-radius:12px">
<tr><td style="background:#0C2A2E;border-radius:12px 12px 0 0;padding:18px 24px;font-size:20px;font-weight:bold;color:#E8F3F1">True<span style="color:#4FD1C5">Scope</span></td></tr>
<tr><td style="padding:26px 24px 8px;font-size:16px;line-height:1.55">
<p style="margin:0 0 14px">${escHtml(hello)}</p><p style="margin:0 0 22px">${escHtml(intro)}</p>
<p style="margin:0 0 22px"><a href="${escHtml(link)}" style="display:inline-block;background:#0B7A75;color:#FFFFFF;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:999px">${escHtml(button)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#586C71">Falls der Knopf nicht funktioniert, kopiere diesen Link in deinen Browser:<br><a href="${escHtml(link)}" style="color:#0B7A75;word-break:break-all">${escHtml(link)}</a></p>
<p style="margin:16px 0 20px;font-size:13px;color:#586C71">${escHtml(outro)}</p></td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}

export async function sendMail(env, to, subject, body) {
  if (!emailReady(env)) throw new Error("E-Mail-Versand ist nicht eingerichtet.");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/email/sending/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.EMAIL_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: { address: env.EMAIL_FROM, name: "TrueScope" }, to, subject, text: body.text, html: body.html }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error("E-Mail-Versand fehlgeschlagen (" + res.status + "): " + (await res.text()).slice(0, 300));
}
