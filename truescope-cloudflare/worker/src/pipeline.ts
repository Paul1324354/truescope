// TSIE pipeline for Cron Triggers, built for the 10 ms CPU budget of the free plan:
// every run (once per minute) does ONE small step (fetch 2 feeds OR analyse a few articles),
// commits after each step, and self-tunes its batch size if a run was cut off.
import { addUsage, decide, getUsage } from "./budget.ts";
import { J, type Db } from "./db.ts";
import { cfg, type Env } from "./env.ts";
import { aiSummary } from "./ai.ts";
import { ENGINE_VERSION, analyze, assessEvent, buildContent, buildIndex, eventCountries, indexAdd, matchEvent, relevantCountries, vec, type Candidate } from "./engine/engine.ts";
import { registerPlaces } from "./engine/entities.ts";
import { centroid, contentHash } from "./engine/text.ts";
import type { Analysis, ArticleInput, SourceProfile } from "./engine/types.ts";
import { parseFeed, robotsAllows } from "./rss.ts";

const H = 3_600_000;
const MAX_EVENT_ARTICLES = 20;

export async function logError(db: Db, component: string, message: string, details: unknown = {}) {
  try { await db.run("INSERT INTO errors (component, message, details, created_at) VALUES (?, ?, ?, ?)", component, message.slice(0, 2000), JSON.stringify(details).slice(0, 4000), Date.now()); } catch { /* never throw from logging */ }
}

async function loadKeywords(db: Db) {
  for (const c of await db.all<{ code: string; extra_keywords: string }>("SELECT code, extra_keywords FROM countries WHERE extra_keywords != '[]'")) {
    registerPlaces(c.code, J<string[]>(c.extra_keywords, []));
  }
}

// ------------------------------------------------------------------ entry
export async function runCron(env: Env, db: Db, now = Date.now()) {
  const u = await getUsage(db, now);
  const paused = (await db.first<{ value: string }>("SELECT value FROM settings WHERE key = 'ingest_paused'"))?.value === "1";
  const g = decide(env, u, paused);
  const stats: Record<string, unknown> = { guard: g.reason };
  let kind = "skipped";
  try {
    if (new Date(now).getUTCHours() === 3 && (await maintenanceDue(db, now))) {
      kind = "maintenance";
      Object.assign(stats, await maintenance(db, env, now));
    } else if (g.analyze || g.fetch) {
      const pending = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM (SELECT 1 FROM articles WHERE processed = 0 AND attempts < 3 LIMIT 50)"))?.n ?? 0;
      const flagged = (await db.first<{ id: number }>("SELECT id FROM events WHERE needs_assessment = 1 LIMIT 1")) !== null;
      const slot = Math.floor(now / 60_000) % 2; // cron runs every minute: even minute = fetch, odd = analyse
      // alternate fetch/analyse; skip a phase that has nothing to do
      const doFetch = g.fetch && (slot === 0 || (!pending && !flagged));
      if (doFetch) { kind = "fetch"; Object.assign(stats, await fetchPhase(db, env, now)); }
      else if (g.analyze) { kind = "analyze"; Object.assign(stats, await analyzePhase(db, env, now, g.ai)); }
    }
  } catch (e) {
    await logError(db, `cron.${kind}`, String((e as Error)?.stack ?? e));
    stats.error = String(e);
  } finally {
    await addUsage(db, { cron_runs: 1, rows_written: db.writes + 2, rows_read: db.reads, articles_new: Number(stats.new ?? 0), ai_calls: Number(stats.ai_calls ?? 0) }, now);
  }
  return { kind, ...stats };
}

// ------------------------------------------------------------------ fetch
interface SourceRow { id: number; name: string; feed_url: string; etag: string | null; last_modified: string | null; robots_checked_at: number | null; robots_allowed: number; consecutive_errors: number }

export async function fetchPhase(db: Db, env: Env, now = Date.now(), onlySourceId?: number) {
  const c = cfg(env);
  const due = onlySourceId
    ? await db.all<SourceRow>("SELECT * FROM sources WHERE id = ? AND feed_url IS NOT NULL", onlySourceId)
    : await db.all<SourceRow>(`SELECT * FROM sources WHERE active = 1 AND requires_license = 0 AND feed_url IS NOT NULL
        AND (last_fetched_at IS NULL OR last_fetched_at < ? - fetch_interval_min * 60000 * (1 << MIN(consecutive_errors, 5)))
        ORDER BY COALESCE(last_fetched_at, 0) LIMIT ?`, now, c.maxFeedsPerRun);
  if (!due.length) return { feeds: 0, new: 0 };
  await db.run(`UPDATE sources SET last_fetched_at = ? WHERE id IN (${due.map(() => "?").join(",")})`, now, ...due.map((s) => s.id));
  const results = await Promise.all(due.map((s) => fetchOne(s, c.userAgent, c.maxItemsPerFeed, now).catch((e: Error) => ({ source: s, error: e.message, items: [] as ReturnType<typeof parseFeed>, robots: undefined as boolean | undefined, etag: undefined as string | undefined, lastModified: undefined as string | undefined }))));

  let inserted = 0;
  const stmts = [];
  for (const r of results) {
    const s = r.source;
    if ("error" in r && r.error) {
      const errs = s.consecutive_errors + 1;
      stmts.push(db.stmt("UPDATE sources SET last_error = ?, consecutive_errors = ?, active = CASE WHEN ? >= 10 THEN 0 ELSE active END WHERE id = ?", r.error.slice(0, 500), errs, errs, s.id));
      stmts.push(db.stmt("INSERT INTO errors (component, message, details, created_at) VALUES ('ingest', ?, ?, ?)", `${s.name}: ${r.error}`.slice(0, 600), JSON.stringify({ source_id: s.id, auto_deactivated: errs >= 10 }), now));
      continue;
    }
    if (r.items.length) {
      const urls = r.items.map((i) => i.url);
      const known = new Set((await db.all<{ url: string }>(`SELECT url FROM articles WHERE url IN (${urls.map(() => "?").join(",")})`, ...urls)).map((x) => x.url));
      const fresh = r.items.filter((i) => !known.has(i.url));
      const hashes = await Promise.all(fresh.map((i) => contentHash(i.title, i.summary)));
      const knownH = hashes.length ? new Set((await db.all<{ content_hash: string }>(`SELECT content_hash FROM articles WHERE source_id = ? AND content_hash IN (${hashes.map(() => "?").join(",")})`, s.id, ...hashes)).map((x) => x.content_hash)) : new Set<string>();
      const seen = new Set<string>();
      fresh.forEach((it, i) => {
        if (knownH.has(hashes[i]) || seen.has(hashes[i])) return; // same story re-published under a new URL
        seen.add(hashes[i]);
        stmts.push(db.stmt(`INSERT OR IGNORE INTO articles (title, summary, url, source_id, published_at, collected_at, content_hash, feed_categories, image_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, it.title, it.summary, it.url, s.id, it.published_at, now, hashes[i], JSON.stringify(it.categories), it.image_url));
        inserted++;
      });
    }
    stmts.push(db.stmt(`UPDATE sources SET last_success_at = ?, last_error = NULL, consecutive_errors = 0, etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified),
      robots_checked_at = CASE WHEN ? IS NULL THEN robots_checked_at ELSE ? END, robots_allowed = COALESCE(?, robots_allowed) WHERE id = ?`,
      now, r.etag ?? null, r.lastModified ?? null, r.robots === undefined ? null : 1, now, r.robots === undefined ? null : r.robots ? 1 : 0, s.id));
  }
  await db.batch(stmts);
  return { feeds: due.length, new: inserted, failed: results.filter((r) => "error" in r && r.error).length };
}

async function fetchOne(s: SourceRow, ua: string, maxItems: number, now: number) {
  const url = new URL(s.feed_url);
  let robots: boolean | undefined;
  if (!s.robots_checked_at || now - s.robots_checked_at > 7 * 24 * H) {
    try {
      const r = await fetch(`${url.origin}/robots.txt`, { headers: { "User-Agent": ua }, signal: AbortSignal.timeout(8000) });
      robots = r.ok ? robotsAllows(await r.text(), url.pathname + url.search) : true;
    } catch { robots = true; }
  }
  if ((robots ?? s.robots_allowed === 1) === false) return { source: s, error: "robots.txt untersagt den Abruf dieses Feeds", items: [], robots, etag: undefined, lastModified: undefined };
  const headers: Record<string, string> = { "User-Agent": ua, Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5" };
  if (s.etag) headers["If-None-Match"] = s.etag;
  if (s.last_modified) headers["If-Modified-Since"] = s.last_modified;
  const res = await fetch(s.feed_url, { headers, redirect: "follow", signal: AbortSignal.timeout(10000) });
  if (res.status === 304) return { source: s, items: [], robots, etag: undefined, lastModified: undefined };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return { source: s, items: parseFeed(text, maxItems, now), robots, etag: res.headers.get("etag") ?? undefined, lastModified: res.headers.get("last-modified") ?? undefined };
}

// ------------------------------------------------------------------ analyse
interface ArticleRow { id: number; title: string; summary: string; url: string; published_at: number; feed_categories: string; image_url: string | null; analysis: string | null; source_id: number;
  s_name: string; s_type: string; s_cc: string | null; s_owner: string | null; s_rel: number; s_corr: number; s_wire: string | null; is_demo: number }

const ART_SELECT = `SELECT a.id, a.title, a.summary, a.url, a.published_at, a.feed_categories, a.image_url, a.analysis, a.source_id, a.is_demo,
  s.name AS s_name, s.source_type AS s_type, s.country_code AS s_cc, s.owner_group AS s_owner, s.base_reliability AS s_rel, s.corrections_90d AS s_corr, s.wire_key AS s_wire
  FROM articles a JOIN sources s ON s.id = a.source_id`;

const toInput = (r: ArticleRow): ArticleInput => ({
  id: r.id, title: r.title, summary: r.summary, url: r.url, published_at: r.published_at, feed_categories: J<string[]>(r.feed_categories, []),
  source: { id: r.source_id, name: r.s_name, source_type: r.s_type, country_code: r.s_cc, owner_group: r.s_owner, base_reliability: r.s_rel, corrections_90d: r.s_corr, wire_key: r.s_wire } as SourceProfile,
});

async function batchSize(db: Db, max: number): Promise<number> {
  const last = await db.first<{ status: string; batch: number }>("SELECT status, batch FROM job_runs WHERE kind = 'analyze' ORDER BY started_at DESC LIMIT 1");
  if (!last || !last.batch) return Math.min(2, max);
  if (last.status === "running") return Math.max(1, Math.floor(last.batch / 2)); // previous run was cut off (CPU limit)
  return Math.min(max, last.batch + 1);
}

export async function analyzePhase(db: Db, env: Env, now = Date.now(), aiAllowed = false) {
  const c = cfg(env);
  const batch = await batchSize(db, c.maxAnalyzePerRun);
  const job = await db.run("INSERT INTO job_runs (kind, started_at, batch) VALUES ('analyze', ?, ?)", now, batch);
  await loadKeywords(db);
  const rows = await db.all<ArticleRow>(`${ART_SELECT} WHERE a.processed = 0 AND a.attempts < 3 ORDER BY a.published_at LIMIT ?`, batch);
  let analyzed = 0;
  const touched = new Set<number>();
  if (rows.length) {
    await db.run(`UPDATE articles SET attempts = attempts + 1 WHERE id IN (${rows.map(() => "?").join(",")})`, ...rows.map((r) => r.id));
    const cands: Candidate[] = (await db.all<{ id: number; centroid: string; entities: string; countries: string; last_updated: number }>(
      "SELECT id, centroid, entities, countries, last_updated FROM events WHERE archived = 0 AND last_updated >= ? ORDER BY last_updated DESC LIMIT 150", now - 72 * H))
      .map((e) => ({ id: e.id, centroid: J(e.centroid, {}), entities: new Set(J<string[]>(e.entities, [])), countries: new Set(Object.entries(J<Record<string, string>>(e.countries, {})).filter(([, r]) => r !== "source").map(([k]) => k)), lastSeen: e.last_updated }));
    const index = buildIndex(cands);
    for (const r of rows) {
      const input = toInput(r);
      const an = analyze(input);
      let [eid, sim] = matchEvent(an, r.published_at, cands, index);
      if (eid === null) {
        const ins = await db.run(`INSERT INTO events (title, first_seen, last_updated, centroid, entities, image_url, needs_assessment, is_demo) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
          r.title.slice(0, 400), r.published_at, r.published_at, JSON.stringify(centroid([vec(an)])), JSON.stringify(an.entities), r.image_url, r.is_demo);
        eid = ins.id;
        const nc = { id: eid, centroid: centroid([vec(an)]), entities: new Set(an.entities), countries: new Set(an.countries), lastSeen: r.published_at };
        cands.push(nc);
        indexAdd(index, nc, cands.length - 1);
      } else {
        const cd = cands.find((x) => x.id === eid)!;
        cd.lastSeen = Math.max(cd.lastSeen, r.published_at);
        an.entities.forEach((e) => cd.entities.add(e));
        cd.centroid = centroid([cd.centroid, vec(an)]);
      }
      await db.batch([
        db.stmt("UPDATE articles SET analysis = ?, event_id = ?, similarity = ?, processed = 1 WHERE id = ?", JSON.stringify(an), eid, Math.round(sim * 1000) / 1000, r.id),
        db.stmt("UPDATE events SET needs_assessment = 1 WHERE id = ?", eid),
      ]);
      touched.add(eid);
      analyzed++;
    }
  }
  // assess: events touched in this run first, then flagged ones, then a time-based sweep
  let ids = [...touched];
  if (ids.length < 3) ids.push(...(await db.all<{ id: number }>("SELECT id FROM events WHERE needs_assessment = 1 ORDER BY last_updated DESC LIMIT 3")).map((x) => x.id));
  if (!rows.length && ids.length < 2) ids.push(...(await db.all<{ id: number }>("SELECT id FROM events WHERE archived = 0 AND manual_override = 0 AND last_updated >= ? ORDER BY COALESCE(last_verified, 0) LIMIT 2", now - 48 * H)).map((x) => x.id));
  ids = [...new Set(ids)].slice(0, Math.max(1, Math.min(3, Math.ceil(batch / 2))));
  let aiCalls = 0;
  for (const id of ids) {
    const useAi = aiAllowed && aiCalls < 1;
    const r = await assessAndStore(db, env, id, "pipeline", now, useAi);
    if (r?.ai) aiCalls++;
  }
  await db.run("UPDATE job_runs SET status = 'ok', finished_at = ?, stats = ? WHERE id = ?", Date.now(), JSON.stringify({ analyzed, assessed: ids.length, ai_calls: aiCalls }), job.id);
  return { analyzed, assessed: ids.length, ai_calls: aiCalls, batch };
}

export async function assessAndStore(db: Db, env: Env, eventId: number, trigger: string, now = Date.now(), useAi = false) {
  const ev = await db.first<{ id: number; status: string; score: number | null; manual_override: number; relevant: string; categories: string; generated_by: string; summary: string; title: string; facts: string; article_count: number }>(
    "SELECT id, status, score, manual_override, relevant, categories, generated_by, summary, title, facts, article_count FROM events WHERE id = ?", eventId);
  if (!ev) return null;
  const rows = await db.all<ArticleRow>(`${ART_SELECT} WHERE a.event_id = ? AND a.processed = 1 ORDER BY a.published_at DESC LIMIT ?`, eventId, MAX_EVENT_ARTICLES);
  if (!rows.length) { await db.run("UPDATE events SET needs_assessment = 0 WHERE id = ?", eventId); return null; }
  const items = rows.map((r) => [toInput(r), J<Analysis>(r.analysis, null as unknown as Analysis)] as [ArticleInput, Analysis]).filter(([, an]) => an);
  const a = assessEvent(items, now);
  const content = buildContent(items, a);
  let title = content.title, summary = content.summary, generatedBy = "tsie-extractive";
  const facts = { ...content.facts } as Record<string, unknown>;
  let ai = false;
  const prevFacts = J<Record<string, unknown>>(ev.facts, {});
  if (useAi && a.credible >= 2 && (ev.generated_by !== "tsie-ai" || rows.length >= ev.article_count + 3)) {
    const out = await aiSummary(env, items.filter(([, an]) => !an.opinion).map(([x]) => `${x.title}. ${x.summary}`));
    ai = true;
    if (out) { title = out.title || title; summary = out.summary; facts.what = out.what || facts.what; generatedBy = "tsie-ai"; }
  } else if (ev.generated_by === "tsie-ai" && rows.length < ev.article_count + 3) {
    title = ev.title; summary = ev.summary; facts.what = prevFacts.what ?? facts.what; generatedBy = "tsie-ai"; // keep the AI text until material changes
  }
  const rel = eventCountries(items);
  const relevant = relevantCountries(rel);
  const cats = [...content.categories, ...(a.breaking ? ["breaking"] : [])];
  const status = ev.manual_override ? ev.status : a.status;
  const score = ev.manual_override ? ev.score : a.score;
  const lastUpdated = Math.max(...rows.map((r) => r.published_at));
  const sources = [...new Set(rows.map((r) => r.s_name))].sort();
  const allFacts = { ...facts, confirmed: a.confirmed, unclear: a.unclear, contradictions: a.contradictions, explanation: ev.manual_override ? prevFacts.explanation ?? a.explanation : a.explanation, factors: a.factors, groups: a.groups };

  const stmts = [
    db.stmt(`UPDATE events SET title = ?, summary = ?, first_seen = MIN(first_seen, ?), last_updated = ?, status = ?, score = ?, last_verified = ?, breaking = ?,
      article_count = ?, independent_count = ?, categories = ?, countries = ?, relevant = ?, source_names = ?, facts = ?, entities = ?, centroid = ?,
      image_url = COALESCE(image_url, ?), generated_by = ?, needs_assessment = 0 WHERE id = ?`,
      title.slice(0, 400), summary, Math.min(...rows.map((r) => r.published_at)), lastUpdated, status, score, now, a.breaking ? 1 : 0,
      rows.length, a.credible, cats.join(","), JSON.stringify(rel), relevant.join(","), sources.join(","), JSON.stringify(allFacts), JSON.stringify(content.entities),
      JSON.stringify(content.centroid), rows.find((r) => r.image_url)?.image_url ?? null, generatedBy, eventId),
  ];
  const newKeys = [...relevant.map((c) => `c:${c}`), ...cats.map((k) => `k:${k}`), "all"].sort().join("|");
  const oldKeys = [...(ev.relevant ? ev.relevant.split(",").map((c) => `c:${c}`) : []), ...(ev.categories ? ev.categories.split(",").map((k) => `k:${k}`) : []), "all"].sort().join("|");
  const hasIndex = newKeys === oldKeys && !!(await db.first("SELECT 1 AS x FROM event_index WHERE event_id = ? LIMIT 1", eventId));
  if (hasIndex) {
    stmts.push(db.stmt("UPDATE event_index SET last_updated = ? WHERE event_id = ?", lastUpdated, eventId));
  } else {
    stmts.push(db.stmt("DELETE FROM event_index WHERE event_id = ?", eventId));
    for (const k of newKeys.split("|")) stmts.push(db.stmt("INSERT INTO event_index (event_id, key, last_updated) VALUES (?, ?, ?)", eventId, k, lastUpdated));
  }
  stmts.push(db.stmt("DELETE FROM events_fts WHERE rowid = ?", eventId));
  stmts.push(db.stmt("INSERT INTO events_fts (rowid, title, summary, entities, sources) VALUES (?, ?, ?, ?, ?)", eventId, title, summary,
    content.entities.join(" "), `${sources.join(" ")} ${rows.map((r) => r.title).join(" ")}`.slice(0, 8000)));
  if (status !== ev.status || score !== ev.score || trigger !== "pipeline") {
    stmts.push(db.stmt("INSERT INTO verification_reports (event_id, status, score, explanation, details, trigger, engine_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      eventId, status, score, a.explanation, JSON.stringify({ previous_status: ev.status, previous_score: ev.score, factors: a.factors, contradictions: a.contradictions, manual_override: !!ev.manual_override }),
      trigger, ENGINE_VERSION, now));
  }
  await db.batch(stmts);
  return { status, score, ai };
}

// ------------------------------------------------------------------ maintenance (daily, 03:xx UTC)
async function maintenanceDue(db: Db, now: number) {
  const last = await db.first<{ started_at: number }>("SELECT started_at FROM job_runs WHERE kind = 'maintenance' AND status = 'ok' ORDER BY started_at DESC LIMIT 1");
  return !last || now - last.started_at > 20 * H;
}

export async function maintenance(db: Db, env: Env, now = Date.now()) {
  const c = cfg(env);
  const job = await db.run("INSERT INTO job_runs (kind, started_at) VALUES ('maintenance', ?)", now);
  const cutoff = now - c.retentionDays * 24 * H;
  const oldEvents = (await db.all<{ id: number }>("SELECT id FROM events WHERE last_updated < ? LIMIT 300", cutoff)).map((x) => x.id);
  const ph = oldEvents.map(() => "?").join(",");
  const stmts = [
    db.stmt("DELETE FROM articles WHERE id IN (SELECT id FROM articles WHERE collected_at < ? LIMIT 1000)", cutoff),
    db.stmt("DELETE FROM login_attempts WHERE at < ?", now - 24 * H),
    db.stmt("DELETE FROM sessions WHERE expires_at < ?", now),
    db.stmt("DELETE FROM errors WHERE id IN (SELECT id FROM errors WHERE created_at < ? LIMIT 2000)", now - 14 * 24 * H),
    db.stmt("DELETE FROM job_runs WHERE id IN (SELECT id FROM job_runs WHERE started_at < ? LIMIT 3000)", now - 7 * 24 * H),
    db.stmt("DELETE FROM usage_daily WHERE day < ?", new Date(now - 60 * 24 * H).toISOString().slice(0, 10)),
  ];
  if (oldEvents.length) {
    stmts.push(db.stmt(`DELETE FROM events_fts WHERE rowid IN (${ph})`, ...oldEvents));
    stmts.push(db.stmt(`DELETE FROM events WHERE id IN (${ph})`, ...oldEvents));
  }
  await db.batch(stmts);
  await db.run("UPDATE job_runs SET status = 'ok', finished_at = ?, stats = ? WHERE id = ?", Date.now(), JSON.stringify({ events_removed: oldEvents.length }), job.id);
  return { events_removed: oldEvents.length };
}
