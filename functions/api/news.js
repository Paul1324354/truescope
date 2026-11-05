// GET /api/news?country=AT|EU&cat=politik&when=7d   (bot=1: Bot-Lauf für den Zeitplan)
// Recherche-Bot: liest die offiziellen RSS-Feeds europäischer Medien, bündelt Artikel verschiedener
// Medien zum selben Ereignis (Doppelcheck) und lässt eine KI eine eigene, neutrale deutsche Schlagzeile
// schreiben. Angezeigt werden nur diese KI-Schlagzeile und Links zu den Originalartikeln.

import { FEEDS } from "../../lib/feeds.js";
import { parseFeed } from "../../lib/rss.js";
import { ask, clean, lock, unlock } from "../../lib/bot.js";

const UA = "TrueScope/1.0 (+https://truescope.dev/; RSS-Leser)";
const FEED_TTL = 4 * 60 * 1000;           // Feeds höchstens alle 4 Minuten abrufen (Bot läuft alle 5 Minuten)
const KEEP_MS = 4 * 864e5;                // nur Artikel der letzten 4 Tage aufnehmen
const STALE_MS = 864e5;                   // nicht zugeordnete Artikel nach 24 Stunden verwerfen statt nachzuarbeiten
// KI erst fragen, wenn sich genug angesammelt hat oder der älteste neue Artikel lange genug wartet –
// sonst würde bei Läufen alle 5 Minuten jedes Mal die ganze Liste bekannter Meldungen mitgeschickt (teuer).
const BATCH_MIN = 8;
const BATCH_WAIT = 15 * 60 * 1000;
const LIST_DEFAULT = 80, LIST_MAX = 400;     // Meldungen je Abruf; „Mehr anzeigen“ fordert mehr an
const STORY_WINDOW = 3 * 864e5;           // neue Artikel mit Ereignissen der letzten 3 Tage vergleichen
const AI_BATCH = 40;
const MIN_PER_CAT = 10;
const CATS = ["politik", "wirtschaft", "sport", "kultur", "wissenschaft", "technik", "gesundheit", "umwelt", "chronik"];
const STRICT = new Set(["politik", "wirtschaft", "chronik"]); // hier zählen zuerst nur Inlandsmeldungen
const DAYS = { "1d": 1, "7d": 7, "30d": 30 };
export const COUNTRY_DE = {
  AT: "Österreich", DE: "Deutschland", CH: "Schweiz", FR: "Frankreich", IT: "Italien", ES: "Spanien", GB: "Vereinigtes Königreich",
  NL: "Niederlande", BE: "Belgien", LU: "Luxemburg", PL: "Polen", CZ: "Tschechien", SK: "Slowakei", HU: "Ungarn", SI: "Slowenien",
  HR: "Kroatien", RS: "Serbien", BA: "Bosnien und Herzegowina", RO: "Rumänien", BG: "Bulgarien", GR: "Griechenland", PT: "Portugal",
  IE: "Irland", DK: "Dänemark", SE: "Schweden", NO: "Norwegen", FI: "Finnland", EE: "Estland", LV: "Lettland", LT: "Litauen",
  UA: "Ukraine", EU: "Europa",
};

async function hashId(s) {
  const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

// 1) Feeds abrufen und neue Artikel speichern. Feeds: [Land, Medium, URL, Ressort-Hinweis]
async function ingest(env, country, cat, max, log) {
  const feeds = FEEDS.filter((f) => f[0] === country && (!cat || !f[3] || f[3] === cat));
  if (!feeds.length) return 0;
  const state = new Map((await env.DB.prepare(
    `SELECT url, fetched_at FROM feed_state WHERE url IN (${feeds.map(() => "?").join(",")})`
  ).bind(...feeds.map((f) => f[2])).all()).results.map((r) => [r.url, r.fetched_at]));
  const due = feeds
    .filter((f) => Date.now() - (state.get(f[2]) || 0) > FEED_TTL)
    .sort((a, b) => (state.get(a[2]) || 0) - (state.get(b[2]) || 0))
    .slice(0, max);
  if (!due.length) return 0;

  const results = await Promise.allSettled(due.map(async ([c, outlet, url, hint]) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" }, signal: ctl.signal });
      if (!r.ok) throw new Error(String(r.status));
      const xml = (await r.text()).slice(0, 300000);
      return parseFeed(xml, 35).map((a) => ({ ...a, outlet, hint: hint || "", country: c }));
    } finally { clearTimeout(t); }
  }));

  const now = Date.now();
  const items = [];
  results.forEach((r) => { if (r.status === "fulfilled") items.push(...r.value); });
  const fresh = items.filter((a) => !a.published || now - a.published < KEEP_MS);
  const withIds = await Promise.all(fresh.map(async (a) => ({ ...a, id: await hashId(a.link) })));
  const stmts = withIds.map((a) => env.DB.prepare(
    "INSERT OR IGNORE INTO articles (id, country, outlet, title, link, published, created_at, hint, descr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(a.id, a.country, a.outlet, a.title, a.link, Math.min(a.published || now, now), now, a.hint, a.descr || ""));
  due.forEach((f) => stmts.push(env.DB.prepare(
    "INSERT INTO feed_state (url, fetched_at) VALUES (?, ?) ON CONFLICT(url) DO UPDATE SET fetched_at = excluded.fetched_at"
  ).bind(f[2], now)));
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  return due.length;
}

// 2) Doppelcheck: neue Artikel bekannten Ereignissen zuordnen oder neue Ereignisse anlegen.
// Kompaktes Zeilenformat statt JSON spart etwa die Hälfte der KI-Kosten.
const ASSIGN_SYSTEM =
  "Du bist Nachrichtenredakteur und prüfst Meldungen gegen andere Medien.\n" +
  "Eingabe: BEKANNT = bekannte Ereignisse (id|Titel), NEU = neue Artikel (n|Medium|Ressort-Hinweis|Titel).\n" +
  "Ordne jeden neuen Artikel einem bekannten Ereignis zu, wenn er über dasselbe konkrete Ereignis berichtet " +
  "(gleiche Handlung, gleiche Beteiligte, gleicher Anlass – nicht nur dasselbe Thema). Sonst bilde neue Gruppen A, B, C …; " +
  "Artikel verschiedener Medien über dasselbe neue Ereignis bekommen dieselbe Gruppe. " +
  "Werbung, Horoskope, Rätsel, Rezepte, Gewinnspiele und reine Service-Texte bekommen \"-\".\n" +
  "Für jede neue Gruppe: Ressort (" + CATS.join(", ") + "; der Ressort-Hinweis ist meist richtig), " +
  "i wenn das Ereignis im Land LAND stattfindet oder es direkt betrifft, sonst a, " +
  "und eine eigene, neutrale deutsche Schlagzeile (höchstens 12 Wörter, keine wörtliche Übersetzung, keine Wertung, nur Fakten aus den Titeln).\n" +
  "Antworte NUR mit Zeilen in genau diesem Format, ohne weiteren Text. ZUERST alle neuen Gruppen, DANACH die Zuordnung jedes Artikels:\n" +
  "A|politik|i|Schlagzeile\nB|sport|a|Schlagzeile\n1=<bekannte id>\n2=A\n3=B\n4=-";

async function assign(env, country, rounds, log) {
  if (!env.AI) { log.push("keine KI-Bindung"); return 0; }
  let done = 0;
  for (let round = 0; round < rounds; round++) {
    const arts = (await env.DB.prepare(
      "SELECT id, outlet, title, hint FROM articles WHERE country = ? AND story_id IS NULL ORDER BY published DESC LIMIT ?"
    ).bind(country, AI_BATCH).all()).results;
    if (!arts.length) break;
    const stories = (await env.DB.prepare(
      "SELECT id, headline FROM stories WHERE country = ? AND last_seen > ? ORDER BY outlets DESC, last_seen DESC LIMIT 80"
    ).bind(country, Date.now() - STORY_WINDOW).all()).results;

    const user = `LAND: ${COUNTRY_DE[country]}\nBEKANNT:\n` +
      stories.map((s) => `${s.id}|${clean(s.headline, 90)}`).join("\n") +
      `\nNEU:\n` + arts.map((a, i) => `${i + 1}|${a.outlet}|${a.hint || "?"}|${clean(a.title, 140)}`).join("\n");
    const txt = await ask(env, ASSIGN_SYSTEM, user, 3500, log, { kind: "bot" });
    if (!txt) { log.push("keine KI-Antwort"); break; }

    const known = new Set(stories.map((s) => s.id));
    const groups = {};
    const stmts = [];
    const now = Date.now();
    const lines = txt.split(/\r?\n/).map((l) => l.trim().replace(/^[-*•]\s*/, "")).filter(Boolean);
    for (const l of lines) {
      const m = /^([A-Z]{1,2})\s*\|\s*([a-zäöü]+)\s*\|\s*([ia])\s*\|\s*(.+)$/i.exec(l);
      if (!m) continue;
      const key = m[1].toUpperCase();
      const title = clean(m[4].replace(/^["„]|["“]$/g, ""), 160);
      if (!title || groups[key]) continue;
      const id = rid();
      groups[key] = id;
      const cat = CATS.includes(m[2].toLowerCase()) ? m[2].toLowerCase() : "chronik";
      stmts.push(env.DB.prepare(
        "INSERT INTO stories (id, country, cat, headline, summary, first_seen, last_seen, outlets, domestic) VALUES (?, ?, ?, ?, '', ?, ?, 0, ?)"
      ).bind(id, country, cat, title, now, now, m[3].toLowerCase() === "a" ? 0 : 1));
    }
    const touched = new Set();
    const handled = new Set();
    for (const l of lines) {
      const m = /^(\d{1,3})\s*[=:]\s*([\w-]+)/.exec(l);
      if (!m) continue;
      const a = arts[Number(m[1]) - 1];
      if (!a || handled.has(a.id)) continue;
      const v = m[2];
      let sid = null;
      if (v === "-") sid = "-";
      else if (known.has(v)) sid = v;
      else if (groups[v.toUpperCase()]) sid = groups[v.toUpperCase()];
      if (!sid) continue;
      handled.add(a.id);
      stmts.push(env.DB.prepare("UPDATE articles SET story_id = ? WHERE id = ?").bind(sid, a.id));
      if (sid !== "-") touched.add(sid);
    }
    if (handled.size === 0) { log.push("Antwort nicht lesbar: " + txt.slice(0, 200)); break; }
    for (const sid of touched) {
      stmts.push(env.DB.prepare(
        `UPDATE stories SET
           outlets = (SELECT COUNT(DISTINCT outlet) FROM articles WHERE story_id = ?),
           first_seen = (SELECT MIN(published) FROM articles WHERE story_id = ?),
           last_seen = (SELECT MAX(published) FROM articles WHERE story_id = ?)
         WHERE id = ?`
      ).bind(sid, sid, sid, sid));
    }
    for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
    done += handled.size;
    if (arts.length < AI_BATCH) break;
  }
  return done;
}

// 3) Kurzfassung nur für bestätigte Meldungen (spart KI-Kontingent)
async function summarize(env, country, log) {
  if (!env.AI) return;
  const rows = (await env.DB.prepare(
    `SELECT s.id, s.headline, (SELECT group_concat(title, ' / ') FROM (SELECT title FROM articles WHERE story_id = s.id LIMIT 3)) AS titles
       FROM stories s WHERE s.country = ? AND s.outlets >= 2 AND (s.summary IS NULL OR s.summary = '') AND s.last_seen > ?
      ORDER BY s.outlets DESC LIMIT 20`
  ).bind(country, Date.now() - STORY_WINDOW).all()).results;
  if (!rows.length) return;
  const txt = await ask(env,
    "Schreibe zu jeder Meldung einen sachlichen deutschen Satz (höchstens 25 Wörter), nur mit Fakten aus den Titeln, " +
    "ohne Wertung und ohne wörtliche Übernahme. Antworte NUR mit Zeilen: id|Satz",
    rows.map((r) => `${r.id}|${clean(r.headline, 100)}|${clean(r.titles, 300)}`).join("\n"), 1500, log, { kind: "bot" });
  if (!txt) return;
  const ids = new Set(rows.map((r) => r.id));
  const stmts = [];
  for (const l of txt.split(/\r?\n/)) {
    const m = /^\s*([a-z0-9]+)\s*\|\s*(.+)$/i.exec(l);
    if (m && ids.has(m[1])) stmts.push(env.DB.prepare("UPDATE stories SET summary = ? WHERE id = ?").bind(clean(m[2], 300), m[1]));
  }
  if (stmts.length) await env.DB.batch(stmts);
}

export async function work(env, country, { cat = null, maxFeeds = 8, rounds = 2, log = [] } = {}) {
  if (!(await lock(env, "bot:" + country, 120000))) return { busy: true };
  const res = { feeds: 0, assigned: 0 };
  try {
    try { res.feeds = await ingest(env, country, cat, maxFeeds, log); } catch (e) { log.push("ingest: " + String(e).slice(0, 200)); }
    // Rückstau: was nach 24 Stunden noch nicht zugeordnet ist, ist veraltet und kostet nur Kontingent
    try {
      await env.DB.prepare("UPDATE articles SET story_id = '-' WHERE country = ? AND story_id IS NULL AND published < ?").bind(country, Date.now() - STALE_MS).run();
    } catch (e) { log.push("cleanup: " + String(e).slice(0, 200)); }
    try {
      const p = await env.DB.prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM articles WHERE country = ? AND story_id IS NULL").bind(country).first();
      if (p && p.n > 0 && (p.n >= BATCH_MIN || Date.now() - p.oldest >= BATCH_WAIT)) res.assigned = await assign(env, country, rounds, log);
      else if (p && p.n > 0) log.push(`warte: ${p.n} neue Artikel, KI erst ab ${BATCH_MIN} oder nach 15 Minuten`);
    } catch (e) { log.push("assign: " + String(e).slice(0, 200)); }
    try { await summarize(env, country, log); } catch (e) { log.push("summary: " + String(e).slice(0, 200)); }
  } finally { await unlock(env, "bot:" + country); }
  return res;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const country = url.searchParams.get("country") || "EU";
  const cat = CATS.includes(url.searchParams.get("cat")) ? url.searchParams.get("cat") : "politik";
  const when = DAYS[url.searchParams.get("when")] ? url.searchParams.get("when") : "7d";
  const limit = Math.min(LIST_MAX, Math.max(20, Number(url.searchParams.get("limit")) || LIST_DEFAULT));
  if (!COUNTRY_DE[country]) return Response.json({ error: "Dieses Land wird nicht unterstützt." }, { status: 400 });
  const log = [];

  // Bot-Lauf für den Zeitplan: alle Feeds des Landes, mehrere Prüfrunden, synchron
  if (url.searchParams.get("bot") === "1") {
    const res = await work(env, country, { maxFeeds: 14, rounds: 4, log });
    const pending = (await env.DB.prepare("SELECT COUNT(*) AS n FROM articles WHERE country = ? AND story_id IS NULL").bind(country).first())?.n || 0;
    return Response.json({ country, ...res, pending, debug: log }, { headers: { "Cache-Control": "no-store" } });
  }

  // Normale Anfrage: sofort antworten, Bot arbeitet im Hintergrund weiter.
  const has = await env.DB.prepare(
    `SELECT 1 FROM stories WHERE ${country === "EU" ? "" : "country = ? AND"} last_seen > ? LIMIT 1`
  ).bind(...(country === "EU" ? [] : [country]), Date.now() - 864e5).first();
  const job = work(env, country, { cat, log });
  if (has) context.waitUntil(job);
  else await Promise.race([job, new Promise((r) => setTimeout(r, 25000))]).then(() => context.waitUntil(job));

  const since = Date.now() - DAYS[when] * 864e5;
  let stories;
  if (country === "EU") {
    stories = (await env.DB.prepare(
      `SELECT * FROM stories WHERE domestic = 1 AND cat = ? AND last_seen >= ? AND outlets > 0
       ORDER BY outlets DESC, last_seen DESC LIMIT ?`
    ).bind(cat, since, limit + 1).all()).results;
  } else {
    stories = (await env.DB.prepare(
      `SELECT * FROM stories WHERE country = ? AND cat = ? AND last_seen >= ? AND outlets > 0
       ORDER BY domestic DESC, last_seen DESC LIMIT ?`
    ).bind(country, cat, since, Math.round(limit * 1.5) + 1).all()).results;
    const dom = stories.filter((s) => s.domestic);
    if (STRICT.has(cat)) {
      // Inlandsmeldungen zuerst; reichen sie nicht für 10, mit Auslandsmeldungen der Medien des Landes auffüllen
      const foreign = stories.filter((s) => !s.domestic).sort((a, b) => b.outlets - a.outlets || b.last_seen - a.last_seen);
      stories = dom.length >= MIN_PER_CAT ? dom : [...dom, ...foreign.slice(0, Math.max(MIN_PER_CAT - dom.length, 0) + 5)];
    }
    stories = stories.slice(0, limit + 1);
    // Immer noch weniger als 10? Mit Meldungen derselben Kategorie aus anderen Ländern Europas auffüllen.
    if (stories.length < MIN_PER_CAT) {
      const more = (await env.DB.prepare(
        `SELECT * FROM stories WHERE country != ? AND cat = ? AND last_seen >= ? AND outlets > 0 AND domestic = 1
         ORDER BY outlets DESC, last_seen DESC LIMIT ?`
      ).bind(country, cat, since, MIN_PER_CAT - stories.length + 4).all()).results;
      stories = [...stories, ...more.map((s) => ({ ...s, _europe: 1 }))];
    }
  }

  // gibt es mehr als angefordert? Dann zeigt die Seite „Mehr anzeigen“
  const more = stories.filter((s) => !s._europe).length > limit;
  if (more) stories = stories.filter((s) => !s._europe).slice(0, limit);

  let articles = [];
  for (let i = 0; i < stories.length; i += 90) { // D1 erlaubt höchstens 100 Parameter je Abfrage
    const part = stories.slice(i, i + 90);
    articles.push(...(await env.DB.prepare(
      `SELECT story_id, outlet, link, published FROM articles WHERE story_id IN (${part.map(() => "?").join(",")}) ORDER BY published ASC`
    ).bind(...part.map((s) => s.id)).all()).results);
  }
  const bySt = {};
  for (const a of articles) {
    (bySt[a.story_id] ||= []);
    if (!bySt[a.story_id].some((x) => x.outlet === a.outlet)) bySt[a.story_id].push({ outlet: a.outlet, link: a.link });
  }
  const pending = (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM articles WHERE ${country === "EU" ? "" : "country = ? AND"} story_id IS NULL`
  ).bind(...(country === "EU" ? [] : [country])).first())?.n || 0;

  const items = stories.map((s) => ({
    id: s.id,
    country: s.country,
    title: s.headline,
    summary: s.summary || "",
    day: new Date(s.first_seen).toISOString().slice(0, 10),
    first: s.first_seen,
    last: s.last_seen,
    confirmed: s.outlets >= 2,
    foreign: country !== "EU" && STRICT.has(cat) && !s.domestic && !s._europe,
    europe: !!s._europe,
    sources: bySt[s.id] || [],
  }));
  items.sort((a, b) => b.last - a.last);
  const outlets = [...new Set(FEEDS.filter((f) => f[0] === country).map((f) => f[1]))];
  return Response.json(
    { country, cat, when, items, more, limit, pending, debug: url.searchParams.get("debug") ? log : undefined, feeds: outlets },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}
