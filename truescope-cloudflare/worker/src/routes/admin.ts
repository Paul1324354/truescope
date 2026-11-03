// Admin dashboard API. Roles: editor (events, logs) and admin (everything). All manual changes are audited.
import { hashPassword, iterations, randomToken, requireRole, type User } from "../auth.ts";
import { getUsage } from "../budget.ts";
import { J, type Db } from "../db.ts";
import { cfg, type Env } from "../env.ts";
import { SOURCE_TYPES, STATUSES } from "../engine/types.ts";
import { HttpError, body, iso, json, num, optStr, str } from "../http.ts";
import { analyzePhase, assessAndStore, fetchPhase } from "../pipeline.ts";
import { card, eventDetail, type EventRow } from "./public.ts";

const audit = (db: Db, admin: User, action: string, type: string, id: number | null, details: unknown) =>
  db.run("INSERT INTO audit_log (admin_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)", admin.id, action, type, id, JSON.stringify(details).slice(0, 8000), Date.now());

const sourceOut = (s: Record<string, any>) => ({ ...s, active: !!s.active, requires_license: !!s.requires_license, last_fetched_at: iso(s.last_fetched_at), last_success_at: iso(s.last_success_at),
  reliability_metadata: { rationale: s.rationale, corrections_90d: s.corrections_90d }, fetch_interval_minutes: s.fetch_interval_min });

export async function adminRoute(db: Db, env: Env, req: Request, url: URL): Promise<Response | null> {
  const path = url.pathname, m = req.method;
  if (!path.startsWith("/api/admin/")) return null;
  const admin = await requireRole(db, req, ["admin", "editor"]);
  const onlyAdmin = () => { if (admin.role !== "admin") throw new HttpError(403, "Nur für Administratoren"); };
  const c = cfg(env);

  if (path === "/api/admin/stats" && m === "GET") {
    const day = Date.now() - 86_400_000;
    const u = await getUsage(db);
    const one = async (sql: string, ...p: unknown[]) => Number(Object.values((await db.first(sql, ...p)) ?? { n: 0 })[0] ?? 0);
    const byStatus = Object.fromEntries((await db.all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM events WHERE archived = 0 GROUP BY status")).map((r) => [r.status, r.n]));
    const lastAnalyze = await db.first<{ started_at: number; status: string; batch: number }>("SELECT started_at, status, batch FROM job_runs WHERE kind = 'analyze' ORDER BY started_at DESC LIMIT 1");
    const paused = (await db.first<{ value: string }>("SELECT value FROM settings WHERE key = 'ingest_paused'"))?.value === "1";
    return json({
      articles_total: await one("SELECT COUNT(*) FROM articles"), articles_24h: await one("SELECT COUNT(*) FROM articles WHERE collected_at >= ?", day),
      events_total: await one("SELECT COUNT(*) FROM events"), events_by_status: byStatus, verified: byStatus.VERIFIED ?? 0, unconfirmed: byStatus.UNCONFIRMED ?? 0,
      sources_active: await one("SELECT COUNT(*) FROM sources WHERE active = 1"), sources_failing: await one("SELECT COUNT(*) FROM sources WHERE consecutive_errors > 0"),
      pending_articles: await one("SELECT COUNT(*) FROM articles WHERE processed = 0 AND attempts < 3"), errors_24h: await one("SELECT COUNT(*) FROM errors WHERE created_at >= ?", day),
      open_misratings: await one("SELECT COUNT(*) FROM misratings WHERE resolved = 0"),
      processing: { last_analyze_run: iso(lastAnalyze?.started_at), last_analyze_status: lastAnalyze?.status ?? null, current_batch: lastAnalyze?.batch ?? null },
      usage_today: { ...u, write_budget: c.dailyWriteBudget, read_budget: c.dailyReadBudget, free_limit_writes: 100_000, free_limit_reads: 5_000_000,
        max_new_articles: c.maxNewArticlesPerDay, ai_enabled: c.aiEnabled, ai_daily_calls: c.aiDailyCalls },
      system: { database: "ok", bot: lastAnalyze && Date.now() - lastAnalyze.started_at < 30 * 60_000 ? "running" : "idle/stopped", ingest_paused: paused,
        pepper_configured: !!env.PEPPER, pbkdf2_iterations: c.pbkdf2 },
    });
  }

  if (path === "/api/admin/settings" && m === "PUT") {
    onlyAdmin();
    const b = await body(req);
    const paused = b.ingest_paused ? "1" : "0";
    await db.run("INSERT INTO settings (key, value) VALUES ('ingest_paused', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", paused);
    await audit(db, admin, "settings.update", "settings", null, { ingest_paused: paused });
    return json({ ok: true });
  }

  // ---------------- sources
  if (path === "/api/admin/sources" && m === "GET") return json((await db.all("SELECT * FROM sources ORDER BY name")).map(sourceOut));
  if (path === "/api/admin/sources" && m === "POST") {
    onlyAdmin();
    const b = await body(req);
    const type = String(b.source_type ?? "other");
    if (!(SOURCE_TYPES as readonly string[]).includes(type)) throw new HttpError(422, "Ungültiger Quellentyp");
    const website = str(b.website, 500, 8), feed = optStr(b.feed_url, 1000);
    if (!/^https?:\/\//.test(website) || (feed && !/^https?:\/\//.test(feed))) throw new HttpError(422, "URLs müssen mit http(s):// beginnen");
    const cc = optStr(b.country_code, 8)?.toUpperCase() ?? null;
    if (cc && !(await db.first("SELECT code FROM countries WHERE code = ?", cc))) throw new HttpError(422, "Unbekanntes Land");
    const lic = !!b.requires_license;
    const r = await db.run(`INSERT INTO sources (name, website, feed_url, country_code, source_type, owner_group, language, base_reliability, rationale, wire_key, requires_license, active, fetch_interval_min)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, str(b.name, 120, 2), website, feed, cc, type, optStr(b.owner_group, 120), optStr(b.language, 8) ?? "en",
      num(b.base_reliability ?? 0.6, 0, 1), optStr(b.rationale, 2000) ?? "", optStr(b.wire_key, 40), lic, !lic && b.active !== false, num(b.fetch_interval_minutes ?? 60, 15, 1440));
    await audit(db, admin, "source.create", "source", r.id, b);
    return json(sourceOut((await db.first("SELECT * FROM sources WHERE id = ?", r.id))!), 201);
  }
  let mm = /^\/api\/admin\/sources\/(\d+)(\/fetch)?$/.exec(path);
  if (mm) {
    onlyAdmin();
    const id = Number(mm[1]);
    const s = await db.first("SELECT * FROM sources WHERE id = ?", id);
    if (!s) throw new HttpError(404, "Quelle nicht gefunden");
    if (mm[2] && m === "POST") {
      await audit(db, admin, "source.fetch_now", "source", id, {});
      return json(await fetchPhase(db, env, Date.now(), id));
    }
    if (!mm[2] && m === "PATCH") {
      const b = await body(req);
      const sets: string[] = [], vals: unknown[] = [];
      const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); };
      if (b.name !== undefined) set("name", str(b.name, 120, 2));
      if (b.feed_url !== undefined) set("feed_url", optStr(b.feed_url, 1000));
      if (b.country_code !== undefined) set("country_code", optStr(b.country_code, 8)?.toUpperCase() ?? null);
      if (b.source_type !== undefined) { if (!(SOURCE_TYPES as readonly string[]).includes(b.source_type)) throw new HttpError(422, "Ungültiger Quellentyp"); set("source_type", b.source_type); }
      if (b.owner_group !== undefined) set("owner_group", optStr(b.owner_group, 120));
      if (b.base_reliability !== undefined) set("base_reliability", num(b.base_reliability, 0, 1));
      if (b.wire_key !== undefined) set("wire_key", optStr(b.wire_key, 40));
      if (b.rationale !== undefined) set("rationale", optStr(b.rationale, 2000) ?? "");
      if (b.corrections_90d !== undefined) set("corrections_90d", num(b.corrections_90d, 0, 1000));
      if (b.fetch_interval_minutes !== undefined) set("fetch_interval_min", num(b.fetch_interval_minutes, 15, 1440));
      if (b.active !== undefined) { set("active", !!b.active); if (b.active) set("consecutive_errors", 0); }
      if (!sets.length) throw new HttpError(422, "Keine Änderungen");
      await db.run(`UPDATE sources SET ${sets.join(", ")} WHERE id = ?`, ...vals, id);
      await audit(db, admin, "source.update", "source", id, { changes: b, before: s });
      return json(sourceOut((await db.first("SELECT * FROM sources WHERE id = ?", id))!));
    }
  }
  if (path === "/api/admin/run-analysis" && m === "POST") {
    onlyAdmin();
    await audit(db, admin, "pipeline.run_analysis", "pipeline", null, {});
    return json(await analyzePhase(db, env, Date.now(), false));
  }

  // ---------------- events
  const EV = "id, title, summary, first_seen, last_updated, status, score, breaking, article_count, independent_count, categories, countries, relevant, source_names, image_url, manual_override, is_demo, generated_by, archived";
  if (path === "/api/admin/events" && m === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim();
    const rows = q
      ? await db.all<EventRow>(`SELECT ${EV} FROM events WHERE id IN (SELECT rowid FROM events_fts WHERE events_fts MATCH ? LIMIT 50) ORDER BY last_updated DESC`, `"${q.replace(/"/g, "")}"*`)
      : await db.all<EventRow>(`SELECT ${EV} FROM events ORDER BY last_updated DESC LIMIT 50`);
    return json(rows.map(card));
  }
  mm = /^\/api\/admin\/events\/(\d+)(\/reanalyze|\/misrating)?$/.exec(path);
  if (mm) {
    const id = Number(mm[1]);
    const ev = await db.first<Record<string, any>>("SELECT * FROM events WHERE id = ?", id);
    if (!ev) throw new HttpError(404, "Nicht gefunden");
    const full = async () => {
      const d = ev.archived ? { ...card(ev as EventRow), summary: ev.summary, source_groups: [], history: [], explanation: J<any>(ev.facts, {}).explanation ?? "" } : await eventDetail(db, id);
      const mis = await db.all<Record<string, any>>("SELECT id, reason, resolved, created_at FROM misratings WHERE event_id = ? ORDER BY created_at DESC", id);
      const cur = await db.first<Record<string, any>>("SELECT archived, manual_override FROM events WHERE id = ?", id);
      return { ...d, archived: !!cur?.archived, manual_override: !!cur?.manual_override, misratings: mis.map((x) => ({ ...x, resolved: !!x.resolved, created_at: iso(x.created_at) })) };
    };
    if (!mm[2] && m === "GET") return json(await full());
    if (mm[2] === "/reanalyze" && m === "POST") {
      await audit(db, admin, "event.reanalyze", "event", id, {});
      await assessAndStore(db, env, id, "reanalysis");
      return json(await full());
    }
    if (mm[2] === "/misrating" && m === "POST") {
      const b = await body(req);
      const reason = str(b.reason, 2000, 5);
      await db.run("INSERT INTO misratings (event_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?)", id, admin.id, reason, Date.now());
      await audit(db, admin, "event.misrating", "event", id, { reason });
      return json({ ok: true }, 201);
    }
    if (!mm[2] && m === "PATCH") {
      const b = await body(req);
      const reason = str(b.reason, 2000, 5); // mandatory for the audit log
      const before = { title: ev.title, summary: ev.summary, status: ev.status, score: ev.score, archived: !!ev.archived, manual_override: !!ev.manual_override };
      const stmts = [];
      if (typeof b.title === "string") stmts.push(db.stmt("UPDATE events SET title = ? WHERE id = ?", str(b.title, 400, 3), id));
      if (typeof b.description === "string") stmts.push(db.stmt("UPDATE events SET summary = ? WHERE id = ?", str(b.description, 5000), id));
      if (typeof b.archived === "boolean") {
        stmts.push(db.stmt("UPDATE events SET archived = ? WHERE id = ?", b.archived ? 1 : 0, id));
        if (b.archived) stmts.push(db.stmt("DELETE FROM event_index WHERE event_id = ?", id));
      }
      if (b.status !== undefined && b.status !== null) {
        if (!(STATUSES as readonly string[]).includes(b.status)) throw new HttpError(422, "Ungültiger Status");
        const score = b.score === null || b.score === undefined || b.score === "" ? null : num(b.score, 0, 100);
        const facts = { ...J<Record<string, unknown>>(ev.facts, {}), explanation: `Manuell festgelegt durch die Redaktion: ${reason}` };
        stmts.push(db.stmt("UPDATE events SET status = ?, score = ?, manual_override = 1, facts = ? WHERE id = ?", b.status, score, JSON.stringify(facts), id));
        stmts.push(db.stmt("INSERT INTO verification_reports (event_id, status, score, explanation, details, trigger, created_at) VALUES (?, ?, ?, ?, ?, 'admin', ?)",
          id, b.status, score, `Manuelle Korrektur durch die Redaktion: ${reason}`, JSON.stringify({ before, admin_id: admin.id }), Date.now()));
      }
      if (b.release_override) stmts.push(db.stmt("UPDATE events SET manual_override = 0 WHERE id = ?", id));
      await db.batch(stmts);
      await audit(db, admin, "event.update", "event", id, { changes: b, before });
      if (b.release_override || b.archived === false) await assessAndStore(db, env, id, "admin");
      return json(await full());
    }
  }
  mm = /^\/api\/admin\/misratings\/(\d+)\/resolve$/.exec(path);
  if (mm && m === "POST") {
    await db.run("UPDATE misratings SET resolved = 1 WHERE id = ?", Number(mm[1]));
    await audit(db, admin, "misrating.resolve", "misrating", Number(mm[1]), {});
    return json({ ok: true });
  }

  // ---------------- logs
  if (path === "/api/admin/errors" && m === "GET") return json((await db.all<Record<string, any>>("SELECT * FROM errors ORDER BY created_at DESC LIMIT 200")).map((e) => ({ ...e, details: J(e.details, {}), created_at: iso(e.created_at) })));
  if (path === "/api/admin/jobs" && m === "GET") return json((await db.all<Record<string, any>>("SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 200")).map((j) => ({ ...j, type: j.kind, stats: J(j.stats, {}), started_at: iso(j.started_at), finished_at: iso(j.finished_at) })));
  if (path === "/api/admin/usage" && m === "GET") return json(await db.all("SELECT * FROM usage_daily ORDER BY day DESC LIMIT 30"));
  if (path === "/api/admin/audit" && m === "GET") {
    onlyAdmin();
    return json((await db.all<Record<string, any>>("SELECT a.*, u.username AS admin FROM audit_log a LEFT JOIN users u ON u.id = a.admin_id ORDER BY a.created_at DESC LIMIT 300"))
      .map((a) => ({ ...a, details: J(a.details, {}), created_at: iso(a.created_at) })));
  }

  // ---------------- countries & users
  if (path === "/api/admin/countries" && m === "GET") { onlyAdmin(); return json((await db.all<Record<string, any>>("SELECT * FROM countries ORDER BY sort_order")).map((c) => ({ ...c, id: c.code, enabled: !!c.enabled, extra_keywords: J(c.extra_keywords, []) }))); }
  if (path === "/api/admin/countries" && m === "POST") {
    onlyAdmin();
    const b = await body(req);
    const code = str(b.country_code, 8, 2).toUpperCase();
    if (!/^[A-Z]{2,8}$/.test(code)) throw new HttpError(422, "Ungültiger Ländercode");
    await db.run("INSERT INTO countries (code, name, name_en, flag, enabled, sort_order, extra_keywords) VALUES (?, ?, ?, ?, ?, ?, ?)", code, str(b.name, 80, 2), optStr(b.name_en, 80) ?? "",
      optStr(b.flag, 16) ?? "", b.enabled !== false, num(b.sort_order ?? 100, 0, 10000), JSON.stringify(Array.isArray(b.extra_keywords) ? b.extra_keywords.map(String).slice(0, 100) : []));
    await audit(db, admin, "country.create", "country", null, b);
    return json({ ok: true }, 201);
  }
  mm = /^\/api\/admin\/countries\/([A-Z]{2,8})$/.exec(path);
  if (mm && m === "PATCH") {
    onlyAdmin();
    const b = await body(req);
    if (typeof b.enabled === "boolean") await db.run("UPDATE countries SET enabled = ? WHERE code = ?", b.enabled, mm[1]);
    if (Array.isArray(b.extra_keywords)) await db.run("UPDATE countries SET extra_keywords = ? WHERE code = ?", JSON.stringify(b.extra_keywords.map(String).slice(0, 100)), mm[1]);
    await audit(db, admin, "country.update", "country", null, { code: mm[1], ...b });
    return json({ ok: true });
  }
  if (path === "/api/admin/users" && m === "GET") { onlyAdmin(); return json((await db.all<Record<string, any>>("SELECT id, username, email, role, is_active, created_at FROM users ORDER BY created_at DESC LIMIT 500")).map((u) => ({ ...u, is_active: !!u.is_active, created_at: iso(u.created_at) }))); }
  mm = /^\/api\/admin\/users\/(\d+)(\/reset-password)?$/.exec(path);
  if (mm) {
    onlyAdmin();
    const uid = Number(mm[1]);
    if (mm[2] && m === "POST") {
      // No free e-mail service: the admin hands the temporary password to the user personally.
      const temp = `${randomToken(9)}7a`;
      const salt = randomToken(16), it = iterations(env);
      await db.run("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iterations = ?, token_version = token_version + 1 WHERE id = ?", await hashPassword(env, temp, salt, it), salt, it, uid);
      await audit(db, admin, "user.reset_password", "user", uid, {});
      return json({ temporary_password: temp });
    }
    if (!mm[2] && m === "PATCH") {
      const b = await body(req);
      if (!["user", "editor", "admin"].includes(b.role)) throw new HttpError(422, "Ungültige Rolle");
      if (uid === admin.id && b.role !== "admin") throw new HttpError(400, "Eigene Admin-Rolle kann nicht entfernt werden");
      await db.run("UPDATE users SET role = ?, is_active = COALESCE(?, is_active), token_version = token_version + 1 WHERE id = ?", b.role, typeof b.is_active === "boolean" ? (b.is_active ? 1 : 0) : null, uid);
      await audit(db, admin, "user.update", "user", uid, b);
      return json({ ok: true });
    }
  }
  return null;
}
