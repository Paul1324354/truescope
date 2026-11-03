// Registration, login, profile, preferences, bookmarks, history, notifications, GDPR.
import { checkAttempts, createSession, currentUser, hashPassword, iterations, randomToken, recordAttempt, requireUser, sessionCookie, sha256, timingSafeEqual, type User } from "../auth.ts";
import { J, type Db } from "../db.ts";
import type { Env } from "../env.ts";
import { HttpError, body, iso, json, str } from "../http.ts";
import { card, type EventRow } from "./public.ts";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const USERNAME = /^[A-Za-z0-9_.-]{3,40}$/;

export function userOut(u: User) {
  const p = J<Record<string, any>>(u.preferences, {});
  return { id: u.id, username: u.username, email: u.email, role: u.role, created_at: iso(u.created_at),
    preferences: { preferred_countries: p.preferred_countries ?? [], preferred_categories: p.preferred_categories ?? [], notification_settings: p.notification_settings ?? { enabled: true, breaking: true, countries: [], categories: [], min_status: "STRONGLY_CORROBORATED" }, theme: p.theme ?? "system" } };
}

function validPassword(pw: unknown): string {
  const s = str(pw, 128, 10);
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) throw new HttpError(422, "Passwort muss Buchstaben und Ziffern enthalten (mind. 10 Zeichen)");
  return s;
}

const ip = (req: Request) => req.headers.get("cf-connecting-ip") ?? "local";
const secure = (req: Request) => new URL(req.url).protocol === "https:";

export async function accountRoute(db: Db, env: Env, req: Request, url: URL): Promise<Response | null> {
  const path = url.pathname, m = req.method;

  if (path === "/api/auth/register" && m === "POST") {
    await checkAttempts(db, `reg:${ip(req)}`, 5, 60 * 60_000);
    const b = await body(req);
    const username = str(b.username, 40, 3);
    if (!USERNAME.test(username)) throw new HttpError(422, "Benutzername: nur Buchstaben, Ziffern, Punkt, Unterstrich, Bindestrich");
    const email = str(b.email, 254, 5).toLowerCase();
    if (!EMAIL.test(email)) throw new HttpError(422, "Ungültige E-Mail-Adresse");
    const password = validPassword(b.password);
    if (await db.first("SELECT id FROM users WHERE email = ? OR username = ?", email, username)) throw new HttpError(409, "E-Mail oder Benutzername bereits vergeben");
    await recordAttempt(db, `reg:${ip(req)}`);
    const isAdmin = !!env.ADMIN_EMAIL && email === env.ADMIN_EMAIL.toLowerCase() && !(await db.first("SELECT id FROM users WHERE role = 'admin' LIMIT 1"));
    const salt = randomToken(16), it = iterations(env);
    const r = await db.run("INSERT INTO users (username, email, pw_hash, pw_salt, pw_iterations, role, preferences, created_at) VALUES (?, ?, ?, ?, ?, ?, '{}', ?)",
      username, email, await hashPassword(env, password, salt, it), salt, it, isAdmin ? "admin" : "user", Date.now());
    const u = (await db.first<User>("SELECT * FROM users WHERE id = ?", r.id))!;
    if (isAdmin) await db.run("INSERT INTO audit_log (admin_id, action, entity_type, entity_id, details, created_at) VALUES (?, 'admin.bootstrap', 'user', ?, '{}', ?)", u.id, u.id, Date.now());
    return json(userOut(u), 201, { "Set-Cookie": sessionCookie(await createSession(db, u), secure(req)) });
  }

  if (path === "/api/auth/login" && m === "POST") {
    const b = await body(req);
    const email = str(b.email, 254, 3).toLowerCase();
    const password = str(b.password, 128, 1);
    await checkAttempts(db, `ip:${ip(req)}`, 20);
    await checkAttempts(db, `mail:${email}`, 8);
    const u = await db.first<User>("SELECT * FROM users WHERE email = ?", email);
    // hash even for unknown e-mails so response time does not reveal which accounts exist
    const hash = await hashPassword(env, password, u?.pw_salt ?? "no-such-user-salt", u?.pw_iterations ?? iterations(env));
    const ok = !!u && u.is_active === 1 && timingSafeEqual(hash, u.pw_hash!);
    if (!ok) {
      await db.batch([db.stmt("INSERT INTO login_attempts (key, at) VALUES (?, ?)", `ip:${ip(req)}`, Date.now()), db.stmt("INSERT INTO login_attempts (key, at) VALUES (?, ?)", `mail:${email}`, Date.now())]);
      throw new HttpError(401, "E-Mail oder Passwort falsch");
    }
    return json(userOut(u!), 200, { "Set-Cookie": sessionCookie(await createSession(db, u!), secure(req)) });
  }

  if (path === "/api/auth/logout" && m === "POST") {
    const t = req.headers.get("cookie")?.match(/ts_session=([^;]+)/)?.[1];
    if (t) await db.run("DELETE FROM sessions WHERE token_hash = ?", await sha256(decodeURIComponent(t)));
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(null, secure(req)) });
  }

  if (path === "/api/auth/me" && m === "GET") {
    const u = await currentUser(db, req);
    if (!u) throw new HttpError(401, "Nicht angemeldet");
    return json(userOut(u));
  }

  if (path === "/api/auth/forgot" && m === "POST") {
    // No free e-mail service is bundled: password resets are done by an admin (see README).
    return json({ ok: true, message: "Bitte wende dich an die Administration dieser TrueScope-Instanz; sie kann dir ein temporäres Passwort setzen." });
  }

  if (!path.startsWith("/api/me")) return null;
  const user = await requireUser(db, req);

  if (path === "/api/me/preferences" && m === "PUT") {
    const b = await body(req);
    const arr = (v: unknown, max: number, re: RegExp) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && re.test(x)).slice(0, max) : []);
    const ns = (b.notification_settings ?? {}) as Record<string, unknown>;
    const prefs = {
      preferred_countries: arr(b.preferred_countries, 30, /^[A-Z]{2,8}$/), preferred_categories: arr(b.preferred_categories, 20, /^[a-z]{2,20}$/),
      notification_settings: { enabled: ns.enabled !== false, breaking: ns.breaking !== false, countries: arr(ns.countries, 30, /^[A-Z]{2,8}$/),
        categories: arr(ns.categories, 20, /^[a-z]{2,20}$/), min_status: ["VERIFIED", "STRONGLY_CORROBORATED", "DEVELOPING"].includes(String(ns.min_status)) ? ns.min_status : "STRONGLY_CORROBORATED" },
      theme: ["system", "light", "dark"].includes(String(b.theme)) ? b.theme : "system",
    };
    await db.run("UPDATE users SET preferences = ? WHERE id = ?", JSON.stringify(prefs), user.id);
    return json(userOut({ ...user, preferences: JSON.stringify(prefs) }));
  }

  if (path === "/api/me/profile" && m === "PATCH") {
    const b = await body(req);
    if (b.username && b.username !== user.username) {
      const un = str(b.username, 40, 3);
      if (!USERNAME.test(un)) throw new HttpError(422, "Ungültiger Benutzername");
      if (await db.first("SELECT id FROM users WHERE username = ?", un)) throw new HttpError(409, "Benutzername bereits vergeben");
      await db.run("UPDATE users SET username = ? WHERE id = ?", un, user.id);
    }
    if (b.new_password) {
      const full = (await db.first<User>("SELECT * FROM users WHERE id = ?", user.id))!;
      if (!timingSafeEqual(await hashPassword(env, String(b.current_password ?? ""), full.pw_salt!, full.pw_iterations!), full.pw_hash!)) throw new HttpError(403, "Aktuelles Passwort falsch");
      const salt = randomToken(16), it = iterations(env);
      // bump token_version: all other sessions end
      await db.run("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iterations = ?, token_version = token_version + 1 WHERE id = ?", await hashPassword(env, validPassword(b.new_password), salt, it), salt, it, user.id);
      const fresh = (await db.first<User>("SELECT * FROM users WHERE id = ?", user.id))!;
      return json(userOut(fresh), 200, { "Set-Cookie": sessionCookie(await createSession(db, fresh), secure(req)) });
    }
    return json(userOut((await db.first<User>("SELECT * FROM users WHERE id = ?", user.id))!));
  }

  const listCards = async (sql: string) => (await db.all<EventRow>(sql, user.id)).map(card);
  const EV = "e.id, e.title, e.summary, e.first_seen, e.last_updated, e.status, e.score, e.breaking, e.article_count, e.independent_count, e.categories, e.countries, e.relevant, e.source_names, e.image_url, e.manual_override, e.is_demo, e.generated_by";
  if (path === "/api/me/saved" && m === "GET") return json(await listCards(`SELECT ${EV} FROM saved s JOIN events e ON e.id = s.event_id WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 200`));
  if (path === "/api/me/history" && m === "GET") return json(await listCards(`SELECT ${EV} FROM history h JOIN events e ON e.id = h.event_id WHERE h.user_id = ? ORDER BY h.read_at DESC LIMIT 100`));
  if (path === "/api/me/history" && m === "DELETE") { await db.run("DELETE FROM history WHERE user_id = ?", user.id); return json({ ok: true }); }

  const sm = /^\/api\/me\/(saved|history)\/(\d+)$/.exec(path);
  if (sm) {
    const eid = Number(sm[2]);
    if (m === "DELETE" && sm[1] === "saved") { await db.run("DELETE FROM saved WHERE user_id = ? AND event_id = ?", user.id, eid); return json({ ok: true }); }
    if (m === "POST") {
      if (!(await db.first("SELECT id FROM events WHERE id = ?", eid))) throw new HttpError(404, "Nicht gefunden");
      if (sm[1] === "saved") await db.run("INSERT OR IGNORE INTO saved (user_id, event_id, created_at) VALUES (?, ?, ?)", user.id, eid, Date.now());
      else await db.run("INSERT INTO history (user_id, event_id, read_at) VALUES (?, ?, ?) ON CONFLICT(user_id, event_id) DO UPDATE SET read_at = excluded.read_at WHERE read_at < excluded.read_at - 600000", user.id, eid, Date.now());
      return json({ ok: true }, 201);
    }
  }

  if (path === "/api/me/notifications" && m === "GET") {
    // Computed on read (zero D1 writes): events since the last 3 days matching the user's settings.
    const p = J<Record<string, any>>(user.preferences, {});
    const ns = p.notification_settings ?? { enabled: true, breaking: true };
    if (ns.enabled === false) return json([]);
    const rank: Record<string, number> = { VERIFIED: 4, STRONGLY_CORROBORATED: 3, DEVELOPING: 2, DISPUTED: 2, UNCONFIRMED: 1, FALSE: 0, RETRACTED: 0 };
    const min = rank[ns.min_status ?? "STRONGLY_CORROBORATED"] ?? 3;
    const keys = [...(ns.breaking !== false ? ["k:breaking"] : []), ...(ns.countries ?? []).map((c: string) => `c:${c}`), ...(ns.categories ?? []).map((k: string) => `k:${k}`)];
    if (!keys.length) return json([]);
    const rows = await db.all<EventRow & { key: string }>(`SELECT ${EV}, i.key FROM event_index i JOIN events e ON e.id = i.event_id
      WHERE i.key IN (${keys.map(() => "?").join(",")}) AND i.last_updated >= ? AND e.archived = 0 ORDER BY i.last_updated DESC LIMIT 80`, ...keys, Math.max(Date.now() - 3 * 86_400_000, user.created_at));
    const seen = new Set<number>();
    const out = [];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      const isBreaking = r.key === "k:breaking";
      if (!isBreaking && (rank[r.status] ?? 0) < min) continue;
      if (isBreaking && (rank[r.status] ?? 0) < 2) continue;
      seen.add(r.id);
      const label = isBreaking ? "Breaking" : r.key.startsWith("c:") ? `Neu aus ${r.key.slice(2)}` : r.key.slice(2).replace(/^./, (c) => c.toUpperCase());
      out.push({ id: r.id, event_id: r.id, kind: isBreaking ? "breaking" : r.key.startsWith("c:") ? "country" : "category", message: `${label}: ${r.title}`,
        read: r.last_updated <= user.notifications_seen_at, created_at: iso(r.last_updated) });
      if (out.length >= 25) break; // anti-spam cap
    }
    return json(out);
  }
  if (path === "/api/me/notifications/read" && m === "POST") { await db.run("UPDATE users SET notifications_seen_at = ? WHERE id = ?", Date.now(), user.id); return json({ ok: true }); }

  if (path === "/api/me/export" && m === "GET") {
    return json({
      user: userOut(user),
      saved: await db.all("SELECT event_id, created_at FROM saved WHERE user_id = ?", user.id),
      history: await db.all("SELECT event_id, read_at FROM history WHERE user_id = ?", user.id),
    }, 200, { "Content-Disposition": 'attachment; filename="truescope-daten.json"' });
  }
  if (path === "/api/me" && m === "DELETE") {
    await db.batch([db.stmt("DELETE FROM sessions WHERE user_id = ?", user.id), db.stmt("DELETE FROM saved WHERE user_id = ?", user.id),
      db.stmt("DELETE FROM history WHERE user_id = ?", user.id), db.stmt("UPDATE audit_log SET admin_id = NULL WHERE admin_id = ?", user.id),
      db.stmt("UPDATE misratings SET reporter_id = NULL WHERE reporter_id = ?", user.id), db.stmt("DELETE FROM users WHERE id = ?", user.id)]);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(null, secure(req)) });
  }
  return null;
}
