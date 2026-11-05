// GET /api/search?q=…&country=AT|EU   – Meldungen der letzten 30 Tage durchsuchen
//
// Gesucht wird in der KI-Schlagzeile, der Kurzfassung und den Originalschlagzeilen der Medien (die in der
// Landessprache sind). Mehrere Wörter müssen alle vorkommen. country=EU durchsucht ganz Europa.
// Die Antwort hat dieselbe Form wie /api/news, damit die Seite die Treffer gleich darstellen kann.

import { COUNTRY_DE } from "./news.js";

const DAYS = 30;
const MAX_RESULTS = 60;
const MAX_TERMS = 3;

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
  const country = url.searchParams.get("country") || "EU";
  if (!COUNTRY_DE[country]) return Response.json({ error: "Dieses Land wird nicht unterstützt." }, { status: 400 });

  const terms = [...new Set(q.split(" ").map((t) => t.replace(/^["„“'(]+|["„“'),.!?:;]+$/g, "")).filter((t) => t.length >= 2))].slice(0, MAX_TERMS);
  if (!terms.length) return Response.json({ q, items: [], total: 0 }, { headers: { "Cache-Control": "no-store" } });

  const where = ["s.outlets > 0", "s.last_seen >= ?"];
  const params = [Date.now() - DAYS * 864e5];
  if (country !== "EU") { where.push("s.country = ?"); params.push(country); }
  for (const t of terms) {
    const ors = [];
    for (const v of variants(t)) {
      const p = "%" + likeEsc(v) + "%";
      ors.push("s.headline LIKE ? ESCAPE '\\'", "s.summary LIKE ? ESCAPE '\\'",
        "EXISTS (SELECT 1 FROM articles a WHERE a.story_id = s.id AND a.title LIKE ? ESCAPE '\\')");
      params.push(p, p, p);
    }
    where.push("(" + ors.join(" OR ") + ")");
  }

  const stories = (await env.DB.prepare(
    `SELECT s.* FROM stories s WHERE ${where.join(" AND ")} ORDER BY s.last_seen DESC LIMIT ${MAX_RESULTS + 1}`
  ).bind(...params).all()).results;
  const more = stories.length > MAX_RESULTS;
  const list = stories.slice(0, MAX_RESULTS);

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
  return Response.json({ q, country, days: DAYS, items, more }, { headers: { "Cache-Control": "public, max-age=60" } });
}
