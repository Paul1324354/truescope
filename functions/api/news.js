// GET /api/news?country=AT|EU&cat=politik&when=7d
// Recherche-Bot: liest die offiziellen RSS-Feeds europäischer Medien, bündelt Artikel verschiedener
// Medien zum selben Ereignis (Doppelcheck) und lässt eine KI eine eigene, neutrale deutsche Schlagzeile
// schreiben. Angezeigt werden nur diese KI-Schlagzeile und Links zu den Originalartikeln.

import { FEEDS } from "../../lib/feeds.js";
import { parseFeed } from "../../lib/rss.js";

const UA = "TrueScope/1.0 (+https://truescope-49p.pages.dev; RSS-Leser)";
const FEED_TTL = 15 * 60 * 1000;          // Feeds höchstens alle 15 Minuten abrufen
const KEEP_MS = 4 * 864e5;                // nur Artikel der letzten 4 Tage aufnehmen
const STORY_WINDOW = 3 * 864e5;           // neue Artikel mit Ereignissen der letzten 3 Tage vergleichen
const AI_BATCH = 35;
const AI_ROUNDS = 2;
const MODELS = ["@cf/google/gemma-4-26b-a4b-it", "@cf/zai-org/glm-4.7-flash", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
const CATS = ["politik", "wirtschaft", "sport", "kultur", "wissenschaft", "technik", "gesundheit", "umwelt", "chronik"];
const DAYS = { "1d": 1, "7d": 7, "30d": 30, "1y": 365 };
const COUNTRY_DE = {
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
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// 1) Feeds des Landes abrufen und neue Artikel speichern
async function ingest(env, country) {
  const feeds = FEEDS.filter(([c]) => c === country);
  if (!feeds.length) return;
  const state = new Map((await env.DB.prepare(
    `SELECT url, fetched_at FROM feed_state WHERE url IN (${feeds.map(() => "?").join(",")})`
  ).bind(...feeds.map((f) => f[2])).all()).results.map((r) => [r.url, r.fetched_at]));
  const due = feeds.filter((f) => Date.now() - (state.get(f[2]) || 0) > FEED_TTL);
  if (!due.length) return;

  const results = await Promise.allSettled(due.map(async ([c, outlet, url]) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" }, signal: ctl.signal });
      if (!r.ok) throw new Error(String(r.status));
      const xml = (await r.text()).slice(0, 400000);
      return parseFeed(xml, 40).map((a) => ({ ...a, outlet, country: c }));
    } finally { clearTimeout(t); }
  }));

  const now = Date.now();
  const items = [];
  results.forEach((r) => { if (r.status === "fulfilled") items.push(...r.value); });
  const fresh = items.filter((a) => !a.published || now - a.published < KEEP_MS);
  const withIds = await Promise.all(fresh.map(async (a) => ({ ...a, id: await hashId(a.link) })));
  const stmts = withIds.map((a) => env.DB.prepare(
    "INSERT OR IGNORE INTO articles (id, country, outlet, title, link, published, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(a.id, a.country, a.outlet, a.title, a.link, Math.min(a.published || now, now), now));
  due.forEach((f) => stmts.push(env.DB.prepare(
    "INSERT INTO feed_state (url, fetched_at) VALUES (?, ?) ON CONFLICT(url) DO UPDATE SET fetched_at = excluded.fetched_at"
  ).bind(f[2], now)));
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
}

function aiText(out) {
  if (!out) return "";
  if (typeof out === "string") return out;
  if (typeof out.response === "string") return out.response;
  if (out.response && typeof out.response === "object") return JSON.stringify(out.response);
  const c = out.choices?.[0]?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => p.text || "").join("");
  return "";
}
function parseJson(txt) {
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// 2) Doppelcheck: neue Artikel bekannten Ereignissen zuordnen oder neue Ereignisse anlegen
const DEBUG = [];
async function assign(env, country) {
  if (!env.AI) { DEBUG.push("keine KI-Bindung"); return 0; }
  let done = 0;
  for (let round = 0; round < AI_ROUNDS; round++) {
    const arts = (await env.DB.prepare(
      "SELECT id, outlet, title, published FROM articles WHERE country = ? AND story_id IS NULL ORDER BY published DESC LIMIT ?"
    ).bind(country, AI_BATCH).all()).results;
    if (!arts.length) break;
    const stories = (await env.DB.prepare(
      "SELECT id, headline FROM stories WHERE country = ? AND last_seen > ? ORDER BY outlets DESC, last_seen DESC LIMIT 90"
    ).bind(country, Date.now() - STORY_WINDOW).all()).results;

    const prompt = {
      land: COUNTRY_DE[country],
      bekannte_ereignisse: stories.map((s) => ({ id: s.id, titel: s.headline })),
      neue_artikel: arts.map((a, i) => ({ n: i + 1, medium: a.outlet, titel: a.title })),
    };
    const messages = [
      {
        role: "system",
        content:
          "Du bist ein sorgfältiger Nachrichtenredakteur und prüfst Meldungen gegen andere Medien. " +
          "Ordne jeden neuen Artikel einem bekannten Ereignis zu, wenn er eindeutig über dasselbe konkrete Ereignis berichtet " +
          "(nicht nur dasselbe Thema). Artikel, die zu keinem bekannten Ereignis passen, fasst du zu neuen Ereignissen zusammen; " +
          "mehrere neue Artikel über dasselbe Ereignis bekommen dieselbe Gruppe. Für jede neue Gruppe schreibst du eine eigene, " +
          "neutrale deutsche Schlagzeile (höchstens 12 Wörter, keine wörtliche Übersetzung, keine Wertung), einen sachlichen Satz " +
          "(höchstens 30 Wörter) nur mit Fakten aus den Titeln, und ein Ressort aus: " + CATS.join(", ") + ". " +
          "Werbung, Horoskope, Rätsel, Liveticker-Hinweise, Rezepte und reine Service-Texte markierst du mit \"skip\". " +
          "Antworte nur mit JSON in dieser Form: " +
          "{\"zuordnung\":[{\"n\":1,\"id\":\"<bekannte id>\"},{\"n\":2,\"neu\":\"A\"},{\"n\":3,\"skip\":true}]," +
          "\"neu\":{\"A\":{\"titel\":\"…\",\"satz\":\"…\",\"ressort\":\"politik\"}}}",
      },
      { role: "user", content: JSON.stringify(prompt) },
    ];

    let res = null;
    for (const model of MODELS) {
      try {
        const out = await env.AI.run(model, { messages, max_tokens: 4000, temperature: 0.1, chat_template_kwargs: { enable_thinking: false } });
        const txt = aiText(out);
        res = parseJson(txt);
        if (res && Array.isArray(res.zuordnung)) break;
        DEBUG.push(model + ": " + (txt ? txt.slice(0, 300) + " … " + txt.slice(-200) : JSON.stringify(out).slice(0, 400)));
        res = null;
      } catch (e) { DEBUG.push(model + " Fehler: " + String(e).slice(0, 200)); res = null; }
    }
    if (!res) break;

    const known = new Set(stories.map((s) => s.id));
    const groups = {};
    const stmts = [];
    const now = Date.now();
    for (const [key, g] of Object.entries(res.neu || {})) {
      const title = String(g?.titel || "").replace(/\s+/g, " ").trim().slice(0, 160);
      if (!title) continue;
      const id = rid() + key.toString().slice(0, 3).replace(/\W/g, "");
      groups[key] = id;
      stmts.push(env.DB.prepare(
        "INSERT INTO stories (id, country, cat, headline, summary, first_seen, last_seen, outlets) VALUES (?, ?, ?, ?, ?, ?, ?, 0)"
      ).bind(id, country, CATS.includes(g.ressort) ? g.ressort : "chronik", title,
        String(g.satz || "").replace(/\s+/g, " ").trim().slice(0, 300), now, now));
    }
    const touched = new Set();
    const handled = new Set();
    for (const z of res.zuordnung) {
      const a = arts[Number(z.n) - 1];
      if (!a || handled.has(a.id)) continue;
      let sid = null;
      if (z.skip) sid = "-";
      else if (z.id && known.has(z.id)) sid = z.id;
      else if (z.neu && groups[z.neu]) sid = groups[z.neu];
      if (!sid) continue;
      handled.add(a.id);
      stmts.push(env.DB.prepare("UPDATE articles SET story_id = ? WHERE id = ?").bind(sid, a.id));
      if (sid !== "-") touched.add(sid);
    }
    // Artikel, die die KI ausgelassen hat, nicht endlos erneut prüfen
    if (handled.size === 0) break;
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

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const country = url.searchParams.get("country") || "EU";
  const cat = CATS.includes(url.searchParams.get("cat")) ? url.searchParams.get("cat") : "politik";
  const when = DAYS[url.searchParams.get("when")] ? url.searchParams.get("when") : "7d";
  if (!COUNTRY_DE[country]) return Response.json({ error: "Dieses Land wird nicht unterstützt." }, { status: 400 });

  try { await ingest(env, country); } catch (e) { /* Feeds nicht erreichbar: Gespeichertes zeigen */ }
  DEBUG.length = 0;
  try { await assign(env, country); } catch (e) { DEBUG.push("assign: " + String(e).slice(0, 200)); }

  const since = Date.now() - DAYS[when] * 864e5;
  const where = country === "EU" ? "" : "country = ? AND";
  const binds = country === "EU" ? [cat, since] : [country, cat, since];
  const stories = (await env.DB.prepare(
    `SELECT * FROM stories WHERE ${where} cat = ? AND last_seen >= ? AND outlets > 0
     ORDER BY last_seen DESC LIMIT ${country === "EU" ? 80 : 60}`
  ).bind(...binds).all()).results;

  let articles = [];
  if (stories.length) {
    articles = (await env.DB.prepare(
      `SELECT story_id, outlet, link, published FROM articles WHERE story_id IN (${stories.map(() => "?").join(",")}) ORDER BY published ASC`
    ).bind(...stories.map((s) => s.id)).all()).results;
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
    summary: s.summary,
    day: new Date(s.first_seen).toISOString().slice(0, 10),
    first: s.first_seen,
    last: s.last_seen,
    confirmed: s.outlets >= 2,
    sources: bySt[s.id] || [],
  }));
  // Top-Meldung: am meisten bestätigt
  items.sort((a, b) => b.last - a.last);
  return Response.json(
    { country, cat, when, items, pending, debug: url.searchParams.get("debug") ? DEBUG : undefined, feeds: FEEDS.filter(([c]) => c === country).map((f) => f[1]) },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}
