// GET /api/news?country=AT|INT&cat=politik&when=7d
// Schlagzeilen-Bot: liest die Tagesseiten "Portal:Current events" der Wikipedia (CC BY-SA 4.0),
// ordnet Ereignisse Ländern und Ressorts zu und lässt eine KI (Workers AI) daraus eigene, kurze
// deutsche Schlagzeilen schreiben. Kein Schlüssel nötig. Die Schlagzeilen werden als KI-formuliert
// gekennzeichnet (Art. 50 KI-Verordnung) und stehen ebenfalls unter CC BY-SA 4.0.

import { fetchDay, pageUrl } from "../../lib/wiki.js";

const DAYS = { "1d": 2, "7d": 7, "30d": 30, "1y": 365 };
const RECENT_REFRESH_MS = 30 * 60 * 1000; // heutige/gestrige Seiten alle 30 Min. neu lesen
const MAX_NEW_DAYS_PER_REQUEST = 8;       // ältere Tage werden nach und nach nachgeladen
const MAX_AI_PER_REQUEST = 25;
const MODELS = ["@cf/google/gemma-4-26b-a4b-it", "@cf/zai-org/glm-4.7-flash", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
const CATS = ["politik", "wirtschaft", "sport", "kultur", "wissenschaft", "technik", "gesundheit", "umwelt", "chronik"];

const isoDay = (d) => d.toISOString().slice(0, 10);
const dayList = (n) => Array.from({ length: n }, (_, i) => isoDay(new Date(Date.now() - i * 864e5)));

async function hashId(s) {
  const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Sorgt dafür, dass die benötigten Tage in der Datenbank sind.
async function ensureDays(env, days) {
  const known = new Map(
    (await env.DB.prepare(`SELECT day, fetched_at FROM wiki_days WHERE day IN (${days.map(() => "?").join(",")})`)
      .bind(...days).all()).results.map((r) => [r.day, r.fetched_at])
  );
  const recent = new Set(days.slice(0, 2));
  const todo = days.filter((d) => !known.has(d) || (recent.has(d) && Date.now() - known.get(d) > RECENT_REFRESH_MS));
  const batch = todo.slice(0, MAX_NEW_DAYS_PER_REQUEST);
  const results = await Promise.allSettled(batch.map((d) => fetchDay(d).then((ev) => [d, ev])));
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const [day, events] = r.value;
    const stmts = [];
    const ids = [];
    for (const e of events || []) {
      const id = await hashId(day + "|" + e.text);
      ids.push(id);
      stmts.push(env.DB.prepare(
        `INSERT INTO events (id, day, ord, section, cats, countries, context, text_en, source_url, source_label, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET ord = excluded.ord`
      ).bind(id, day, e.ord, e.section, "," + e.cats.join(",") + ",", "," + e.countries.join(",") + ",",
        e.context, e.text, e.source?.url || null, e.source?.label || null, Date.now()));
    }
    // Einträge, die auf Wikipedia inzwischen geändert oder entfernt wurden, löschen
    stmts.push(ids.length
      ? env.DB.prepare(`DELETE FROM events WHERE day = ? AND id NOT IN (${ids.map(() => "?").join(",")})`).bind(day, ...ids)
      : env.DB.prepare("DELETE FROM events WHERE day = ?").bind(day));
    stmts.push(env.DB.prepare(
      "INSERT INTO wiki_days (day, fetched_at, n) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET fetched_at = excluded.fetched_at, n = excluded.n"
    ).bind(day, Date.now(), (events || []).length));
    await env.DB.batch(stmts);
  }
  return { pending: todo.length - batch.length };
}

function aiText(out) {
  if (!out) return "";
  if (typeof out === "string") return out;
  if (typeof out.response === "string") return out.response;
  const c = out.choices?.[0]?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => p.text || "").join("");
  return JSON.stringify(out);
}

// Lässt die KI eigene deutsche Schlagzeilen schreiben.
async function writeHeadlines(env, rows) {
  if (!env.AI || !rows.length) return;
  const input = rows.map((r, i) => ({ n: i + 1, kontext: r.context || undefined, ereignis: r.text_en }));
  const messages = [
    {
      role: "system",
      content:
        "Du bist Nachrichtenredakteur:in. Du schreibst zu jedem Ereignis eine eigene, kurze, sachliche deutsche Schlagzeile " +
        "(höchstens 12 Wörter) und einen Satz Zusammenfassung (höchstens 30 Wörter). Verwende ausschließlich Fakten aus dem " +
        "gegebenen Text, erfinde nichts dazu, übernimm keine Formulierungen wörtlich, bleib politisch neutral. " +
        "Antworte nur mit JSON: [{\"n\":1,\"titel\":\"…\",\"satz\":\"…\"}, …]",
    },
    { role: "user", content: JSON.stringify(input) },
  ];
  let parsed = null;
  for (const model of MODELS) {
    try {
      const out = await env.AI.run(model, {
        messages, max_tokens: 3000, temperature: 0.2,
        chat_template_kwargs: { enable_thinking: false },
      });
      const txt = aiText(out);
      const m = txt.match(/\[[\s\S]*\]/);
      parsed = m ? JSON.parse(m[0]) : null;
      if (Array.isArray(parsed)) break;
    } catch (e) {
      parsed = null;
    }
  }
  if (!Array.isArray(parsed)) return;
  const stmts = [];
  for (const p of parsed) {
    const row = rows[Number(p.n) - 1];
    const title = String(p.titel || "").replace(/\s+/g, " ").trim().slice(0, 160);
    const sentence = String(p.satz || "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (row && title) {
      stmts.push(env.DB.prepare("UPDATE events SET headline_de = ?, summary_de = ? WHERE id = ?").bind(title, sentence, row.id));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const country = url.searchParams.get("country") || "INT";
  const cat = CATS.includes(url.searchParams.get("cat")) ? url.searchParams.get("cat") : "politik";
  const when = DAYS[url.searchParams.get("when")] ? url.searchParams.get("when") : "7d";
  if (!/^([A-Z]{2}|INT)$/.test(country)) return Response.json({ error: "Unbekanntes Land." }, { status: 400 });

  const days = dayList(DAYS[when]);
  let pending = 0;
  try {
    ({ pending } = await ensureDays(env, days));
  } catch (e) {
    // Wenn Wikipedia nicht antwortet, zeigen wir, was schon gespeichert ist.
  }

  const where = ["day >= ?", "cats LIKE ?"];
  const args = [days[days.length - 1], `%,${cat},%`];
  if (country !== "INT") { where.push("countries LIKE ?"); args.push(`%,${country},%`); }
  const rows = (await env.DB.prepare(
    `SELECT * FROM events WHERE ${where.join(" AND ")} ORDER BY day DESC, ord ASC LIMIT 60`
  ).bind(...args).all()).results;

  const missing = rows.filter((r) => !r.headline_de).slice(0, MAX_AI_PER_REQUEST);
  if (missing.length) {
    await writeHeadlines(env, missing);
    const fresh = new Map((await env.DB.prepare(
      `SELECT id, headline_de, summary_de FROM events WHERE id IN (${missing.map(() => "?").join(",")})`
    ).bind(...missing.map((r) => r.id)).all()).results.map((r) => [r.id, r]));
    for (const r of rows) if (fresh.has(r.id)) Object.assign(r, fresh.get(r.id));
  }

  const items = rows.map((r) => ({
    id: r.id,
    title: r.headline_de || r.text_en,
    summary: r.headline_de ? r.summary_de : null,
    original: r.text_en,
    aiWritten: !!r.headline_de,
    date: r.day + "T12:00:00.000Z",
    day: r.day,
    source: r.source_label || "",
    link: r.source_url || pageUrl(r.day),
    wiki: pageUrl(r.day),
  }));
  return Response.json(
    {
      country, cat, when, items, pendingDays: pending,
      attribution: {
        text: "Grundlage: Wikipedia, Portal:Current events",
        url: "https://en.wikipedia.org/wiki/Portal:Current_events",
        license: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.de",
      },
    },
    { headers: { "Cache-Control": "public, max-age=120" } }
  );
}
