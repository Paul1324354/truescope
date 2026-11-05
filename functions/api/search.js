// GET /api/search?q=…&country=AT|EU&offset=0   – Meldungen der letzten 30 Tage durchsuchen
//
// Gesucht wird in der KI-Schlagzeile, der Kurzfassung und den Originalschlagzeilen der Medien (die in der
// Landessprache sind) – und nach Medien: „ORF“ findet alle Meldungen, zu denen der ORF einen Artikel hat.
// Mehrere Wörter müssen alle vorkommen („ORF Wien“). country=EU durchsucht ganz Europa.
// Die Antwort hat dieselbe Form wie /api/news, damit die Seite die Treffer gleich darstellen kann.

import { COUNTRY_DE } from "./news.js";
import { FEEDS } from "../../lib/feeds.js";

const DAYS = 30;
const PAGE = 60;
const MAX_TERMS = 4;

// ---------- Medien erkennen ----------
// Name eines Mediums → { name, country }. Auch ohne Artikel („Standard“ für „Der Standard“), wenn der Rest lang genug ist.
const norm = (s) => s.toLowerCase().replace(/[.„“"'’]/g, "").replace(/\s+/g, " ").trim();
const OUTLETS = new Map();
for (const [country, name] of FEEDS) {
  const keys = [norm(name)];
  const m = norm(name).match(/^(der|die|das|the|le|la|el|il|de|het) (.+)$/);
  if (m && m[2].length >= 5) keys.push(m[2]);
  for (const k of keys) {
    const cur = OUTLETS.get(k);
    if (!cur) OUTLETS.set(k, { name, countries: new Set([country]) });
    else if (cur.name === name) cur.countries.add(country);
  }
}
const MAX_OUTLET_WORDS = 4;

// Zerlegt die Eingabe in Suchbegriffe; zusammenhängende Wörter, die ein Medium ergeben, werden ein Begriff.
export function parseQuery(q) {
  const words = q.split(" ").map((t) => t.replace(/^["„“'(]+|["„“'),!?:;]+$/g, "")).filter(Boolean);
  const terms = [];
  for (let i = 0; i < words.length;) {
    let hit = null;
    for (let n = Math.min(MAX_OUTLET_WORDS, words.length - i); n >= 1 && !hit; n--) {
      const phrase = words.slice(i, i + n).join(" ");
      const o = OUTLETS.get(norm(phrase));
      if (o) hit = { text: phrase, outlet: o.name, countries: [...o.countries], n };
    }
    if (hit) { terms.push(hit); i += hit.n; continue; }
    if (words[i].length >= 2) terms.push({ text: words[i] });
    i++;
  }
  const seen = new Set();
  return terms.filter((t) => { const k = norm(t.text); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, MAX_TERMS);
}

// LIKE-Platzhalter im Suchwort entschärfen
const likeEsc = (s) => s.replace(/[\\%_]/g, (c) => "\\" + c);

// SQLite vergleicht bei LIKE nur A–Z ohne Rücksicht auf Groß/Klein – Umlaute nicht.
// Darum je Wort bis zu drei Schreibweisen: wie eingegeben, klein, mit großem Anfangsbuchstaben.
function variants(term) {
  const low = term.toLowerCase();
  return [...new Set([term, low, low.charAt(0).toUpperCase() + low.slice(1)])];
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").replace(/\s+/g, " ").trim().slice(0, 80);
  let country = url.searchParams.get("country") || "EU";
  const offset = Math.min(600, Math.max(0, Number(url.searchParams.get("offset")) || 0));
  if (!COUNTRY_DE[country]) return Response.json({ error: "Dieses Land wird nicht unterstützt." }, { status: 400 });

  const terms = parseQuery(q);
  if (!terms.length) return Response.json({ q, items: [], more: false }, { headers: { "Cache-Control": "no-store" } });

  // Gesucht wird nach einem Medium aus einem anderen Land? Dann in dessen Land suchen statt nichts zu finden.
  const outletTerms = terms.filter((t) => t.outlet);
  if (country !== "EU" && outletTerms.length && outletTerms.every((t) => !t.countries.includes(country))) {
    const c = outletTerms[0].countries;
    country = c.length === 1 && outletTerms.every((t) => t.countries.includes(c[0])) ? c[0] : "EU";
  }

  const where = ["s.outlets > 0", "s.last_seen >= ?"];
  const params = [Date.now() - DAYS * 864e5];
  if (country !== "EU") { where.push("s.country = ?"); params.push(country); }
  for (const t of terms) {
    const ors = [];
    if (t.outlet) { ors.push("s.id IN (SELECT story_id FROM articles WHERE outlet = ?)"); params.push(t.outlet); }
    for (const v of variants(t.text)) {
      const p = "%" + likeEsc(v) + "%";
      ors.push("s.headline LIKE ? ESCAPE '\\'", "s.summary LIKE ? ESCAPE '\\'",
        "EXISTS (SELECT 1 FROM articles a WHERE a.story_id = s.id AND a.title LIKE ? ESCAPE '\\')");
      params.push(p, p, p);
    }
    where.push("(" + ors.join(" OR ") + ")");
  }

  const stories = (await env.DB.prepare(
    `SELECT s.* FROM stories s WHERE ${where.join(" AND ")} ORDER BY s.last_seen DESC LIMIT ${PAGE + 1} OFFSET ${offset}`
  ).bind(...params).all()).results;
  const more = stories.length > PAGE;
  const list = stories.slice(0, PAGE);

  const bySt = {};
  for (let i = 0; i < list.length; i += 90) { // D1 erlaubt höchstens 100 Parameter je Abfrage
    const part = list.slice(i, i + 90);
    const rows = (await env.DB.prepare(
      `SELECT story_id, outlet, link FROM articles WHERE story_id IN (${part.map(() => "?").join(",")}) ORDER BY published ASC`
    ).bind(...part.map((s) => s.id)).all()).results;
    for (const a of rows) {
      (bySt[a.story_id] ||= []);
      if (!bySt[a.story_id].some((x) => x.outlet === a.outlet)) bySt[a.story_id].push({ outlet: a.outlet, link: a.link });
    }
  }

  const items = list.map((s) => ({
    id: s.id,
    country: s.country,
    title: s.headline,
    summary: s.summary || "",
    first: s.first_seen,
    last: s.last_seen,
    confirmed: s.outlets >= 2,
    sources: bySt[s.id] || [],
  }));
  return Response.json(
    { q, country, days: DAYS, offset, items, more, outlets: [...new Set(outletTerms.map((t) => t.outlet))] },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}
