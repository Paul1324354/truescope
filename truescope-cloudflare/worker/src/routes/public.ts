// Public, read-only endpoints. All queries are index-backed (D1 "rows read" stays small).
import { J, type Db } from "../db.ts";
import { HttpError, iso, json } from "../http.ts";
import { STATUSES } from "../engine/types.ts";

const H = 3_600_000;
const WINDOWS: Record<string, number> = { "1h": H, "24h": 24 * H, "7d": 168 * H, "30d": 720 * H };
const EVENT_COLS = "id, title, summary, first_seen, last_updated, status, score, last_verified, breaking, article_count, independent_count, categories, countries, relevant, source_names, image_url, manual_override, is_demo, generated_by";

export interface EventRow { id: number; title: string; summary: string; first_seen: number; last_updated: number; status: string; score: number | null; last_verified: number | null;
  breaking: number; article_count: number; independent_count: number; categories: string; countries: string; relevant: string; source_names: string; image_url: string | null;
  manual_override: number; is_demo: number; generated_by: string; facts?: string; archived?: number }

export function card(e: EventRow) {
  const rel = J<Record<string, string>>(e.countries, {});
  return {
    id: e.id, title: e.title, summary: (e.summary || "").slice(0, 320), image_url: e.image_url, event_date: iso(e.first_seen), last_updated_at: iso(e.last_updated),
    status: e.status, score: e.score, independent_sources: e.independent_count, article_count: e.article_count, is_breaking: !!e.breaking,
    countries: Object.entries(rel).map(([code, relation]) => ({ code, relation })), categories: (e.categories || "").split(",").filter((c) => c && c !== "breaking"),
    sources: (e.source_names || "").split(",").filter(Boolean).slice(0, 5), manual_override: !!e.manual_override, is_demo: !!e.is_demo,
  };
}

export function parseCountries(raw: string | null): string[] {
  const codes = (raw ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  return !codes.length || codes.includes("GLOBAL") ? [] : codes.filter((c) => /^[A-Z]{2,8}$/.test(c)).slice(0, 20);
}

async function byIds(db: Db, ids: number[]): Promise<EventRow[]> {
  if (!ids.length) return [];
  const rows = await db.all<EventRow>(`SELECT ${EVENT_COLS} FROM events WHERE archived = 0 AND id IN (${ids.map(() => "?").join(",")})`, ...ids);
  const pos = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
}

/** Event ids for index keys, newest first, optionally before a cursor. */
async function idsForKeys(db: Db, keys: string[], since: number, before: number, limit: number): Promise<{ id: number; t: number }[]> {
  return db.all<{ id: number; t: number }>(`SELECT event_id AS id, MAX(last_updated) AS t FROM event_index WHERE key IN (${keys.map(() => "?").join(",")})
    AND last_updated >= ? AND last_updated < ? GROUP BY event_id ORDER BY t DESC LIMIT ?`, ...keys, since, before, limit);
}

function ftsQuery(q: string): string | null {
  const terms = q.replace(/["*:^()]/g, " ").split(/\s+/).filter((t) => t.length >= 2).slice(0, 8);
  return terms.length ? terms.map((t) => `"${t}"*`).join(" AND ") : null;
}

const rank = (e: EventRow) => e.independent_count * 10 + Math.min(e.article_count, 20) + (e.breaking ? 5 : 0) - (e.status === "FALSE" || e.status === "RETRACTED" ? 50 : 0);
const sorters: Record<string, (a: EventRow, b: EventRow) => number> = {
  latest: (a, b) => b.last_updated - a.last_updated,
  top: (a, b) => rank(b) - rank(a) || b.last_updated - a.last_updated,
  verified: (a, b) => (b.score ?? -1) - (a.score ?? -1) || b.last_updated - a.last_updated,
};

export async function home(db: Db, url: URL) {
  const codes = parseCountries(url.searchParams.get("countries"));
  const since = Date.now() - 48 * H;
  const keys = codes.length ? codes.map((c) => `c:${c}`) : ["all"];
  const ids = (await idsForKeys(db, keys, since, Number.MAX_SAFE_INTEGER, 160)).map((x) => x.id);
  const evs = await byIds(db, ids);
  const pick = (f: (e: EventRow) => boolean, sort: keyof typeof sorters, n: number) => evs.filter(f).sort(sorters[sort]).slice(0, n).map(card);
  const notBad = (e: EventRow) => e.status !== "FALSE" && e.status !== "RETRACTED";
  const hasCat = (e: EventRow, c: string) => `,${e.categories},`.includes(`,${c},`);
  const multi = (e: EventRow) => Object.values(J<Record<string, string>>(e.countries, {})).filter((r) => r === "location").length >= 2;
  const by_category: Record<string, unknown[]> = {};
  for (const c of ["politik", "wirtschaft", "technologie", "wissenschaft", "umwelt", "sport"]) by_category[c] = pick((e) => hasCat(e, c), "top", 4);
  const counts: Record<string, number> = {};
  for (const e of evs) counts[e.status] = (counts[e.status] ?? 0) + 1;
  return {
    top: pick(notBad, "top", 7), latest: pick(() => true, "latest", 12),
    verified: pick((e) => e.status === "VERIFIED" || e.status === "STRONGLY_CORROBORATED", "verified", 6),
    breaking: pick((e) => !!e.breaking, "latest", 5), international: pick(multi, "top", 6), by_category,
    developing: pick((e) => e.status === "DEVELOPING" || e.status === "DISPUTED", "latest", 6),
    trending: pick((e) => e.last_updated >= Date.now() - 12 * H, "top", 6), verification_overview: counts, generated_at: iso(Date.now()),
  };
}

export async function listEvents(db: Db, url: URL) {
  const p = url.searchParams;
  const codes = parseCountries(p.get("countries"));
  const category = p.get("category") && p.get("category") !== "all" ? p.get("category")! : null;
  const statuses = (p.get("status") ?? "").split(",").filter((s) => (STATUSES as readonly string[]).includes(s));
  const window = WINDOWS[p.get("window") ?? ""];
  const from = p.get("date_from") ? Date.parse(p.get("date_from")!) : NaN;
  const to = p.get("date_to") ? Date.parse(p.get("date_to")!) : NaN;
  const since = window ? Date.now() - window : Number.isFinite(from) ? from : 0;
  const source = (p.get("source") ?? "").trim().toLowerCase().slice(0, 120);
  const breaking = p.get("breaking") === "true";
  const sort = (p.get("sort") ?? "latest") in sorters ? p.get("sort") ?? "latest" : "latest";
  const size = Math.min(Math.max(Number(p.get("page_size")) || 20, 1), 50);
  const cursor = Number(p.get("cursor")) || Number.MAX_SAFE_INTEGER;
  const q = (p.get("q") ?? "").slice(0, 200);

  const keep = (e: EventRow) =>
    (!codes.length || codes.some((c) => `,${e.relevant},`.includes(`,${c},`))) &&
    (!category || `,${e.categories},`.includes(`,${category},`)) &&
    (!statuses.length || statuses.includes(e.status)) &&
    (!breaking || !!e.breaking) &&
    e.last_updated >= since && (!Number.isFinite(to) || e.first_seen <= to) &&
    (!source || e.source_names.toLowerCase().includes(source));

  if (q) {
    const fq = ftsQuery(q);
    if (!fq) return { items: [], next_cursor: null };
    const ids = (await db.all<{ id: number }>("SELECT rowid AS id FROM events_fts WHERE events_fts MATCH ? ORDER BY rank LIMIT 100", fq)).map((x) => x.id);
    const evs = (await byIds(db, ids)).filter(keep);
    if (sort !== "top") evs.sort(sorters[sort]);
    return { items: evs.slice(0, size).map(card), next_cursor: null, total: evs.length };
  }
  const keys = breaking ? ["k:breaking"] : codes.length ? codes.map((c) => `c:${c}`) : category ? [`k:${category}`] : ["all"];
  const scan = await idsForKeys(db, keys, since, cursor, 150);
  const evs = (await byIds(db, scan.map((x) => x.id))).filter(keep);
  const items = evs.slice(0, size);
  const exhausted = scan.length < 150 && items.length === evs.length;
  const next = items.length === size ? items[items.length - 1].last_updated : exhausted ? null : scan[scan.length - 1]?.t ?? null;
  if (sort !== "latest") items.sort(sorters[sort]);
  return { items: items.map(card), next_cursor: next };
}

export async function eventDetail(db: Db, id: number) {
  const e = await db.first<EventRow>(`SELECT ${EVENT_COLS}, facts, archived FROM events WHERE id = ?`, id);
  if (!e || e.archived) throw new HttpError(404, "Nachricht nicht gefunden");
  const facts = J<Record<string, any>>(e.facts, {});
  const arts = await db.all<Record<string, any>>(`SELECT a.id, a.title, a.url, a.summary, a.published_at, a.analysis, a.similarity, s.name, s.source_type, s.country_code, s.website, s.owner_group
    FROM articles a JOIN sources s ON s.id = a.source_id WHERE a.event_id = ? ORDER BY a.published_at LIMIT 60`, id);
  const groupOf = new Map<number, string>();
  for (const [g, ids] of Object.entries((facts.groups ?? {}) as Record<string, number[]>)) for (const x of ids) groupOf.set(x, g);
  const groups: Record<string, unknown[]> = {};
  for (const a of arts) {
    const an = J<Record<string, any>>(a.analysis, {});
    (groups[groupOf.get(a.id) ?? `source:${a.name}`] ??= []).push({
      article_id: a.id, title: a.title, url: a.url, teaser: (a.summary || "").slice(0, 300), published_at: iso(a.published_at), source: a.name,
      source_type: a.source_type, source_country: a.country_code, source_website: a.website, owner_group: a.owner_group, wire_origin: an.wire ?? null,
      is_opinion: !!an.opinion, hedged: !!an.hedged, claims: an.claims ?? [],
    });
  }
  const reports = await db.all<Record<string, any>>("SELECT status, score, trigger, explanation, created_at FROM verification_reports WHERE event_id = ? ORDER BY created_at DESC LIMIT 20", id);
  return {
    ...card(e), summary: e.summary,
    facts: { what: facts.what ?? null, where: facts.where ?? [], when: facts.when ?? null, who: facts.who ?? [] },
    confirmed: facts.confirmed ?? [], unclear: facts.unclear ?? [], contradictions: facts.contradictions ?? [], explanation: facts.explanation ?? "",
    factors: facts.factors ?? [], last_verified_at: iso(e.last_verified), generated_by: e.generated_by,
    source_groups: Object.entries(groups).map(([group, articles]) => ({ group, articles })),
    history: reports.map((r) => ({ status: r.status, score: r.score, trigger: r.trigger, explanation: r.explanation, created_at: iso(r.created_at) })),
  };
}

export async function publicRoute(db: Db, req: Request, url: URL): Promise<Response | null> {
  if (req.method !== "GET") return null;
  const path = url.pathname;
  if (path === "/api/health") return json({ status: "ok", time: iso(Date.now()) });
  if (path === "/api/countries") return json((await db.all("SELECT code, name, name_en, flag FROM countries WHERE enabled = 1 ORDER BY sort_order")));
  if (path === "/api/categories") return json(await db.all("SELECT slug, name, name_en FROM categories ORDER BY sort_order"));
  if (path === "/api/sources") {
    const rows = await db.all<Record<string, any>>("SELECT id, name, website, source_type, country_code, owner_group, base_reliability, rationale, active, requires_license FROM sources ORDER BY name");
    return json(rows.map((s) => ({ id: s.id, name: s.name, website: s.website, type: s.source_type, country: s.country_code, owner_group: s.owner_group,
      base_reliability: s.base_reliability, rationale: s.rationale, active: !!s.active, requires_license: !!s.requires_license })));
  }
  if (path === "/api/home") return json(await home(db, url));
  if (path === "/api/events") return json(await listEvents(db, url));
  const m = /^\/api\/events\/(\d+)$/.exec(path);
  if (m) return json(await eventDetail(db, Number(m[1])));
  return null;
}

/** Paths whose GET responses are identical for every visitor (safe to edge-cache). */
export const CACHEABLE = /^\/api\/(home|events|events\/\d+|countries|categories|sources)$/;
