// GET /api/news?q=Politik%20Österreich&when=7d
// Holt Schlagzeilen aus der GDELT-Datenbank (https://www.gdeltproject.org).
// GDELT erlaubt die Nutzung ausdrücklich, auch kommerziell, unter der Bedingung,
// dass GDELT genannt und verlinkt wird. Die App zeigt nur Überschrift, Quelle und Link
// zum Originalartikel – keine Artikeltexte.

const TIMESPAN = { "1d": "1d", "7d": "1week", "30d": "1month", "1y": "3months" };
const FRESH_MS = 15 * 60 * 1000; // 15 Minuten frisch
const KEEP_S = 24 * 60 * 60;     // ältere Kopie 24 h als Reserve behalten

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

export function parseGdelt(data) {
  const seen = new Set();
  return (data.articles || []).map((a) => {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(a.seendate || "");
    return {
      title: decodeEntities(String(a.title || "")).replace(/\s+/g, " ").trim().slice(0, 200),
      link: String(a.url || ""),
      source: String(a.domain || ""),
      date: m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null,
    };
  }).filter((i) => {
    const key = i.title.toLowerCase();
    if (!i.title || !/^https?:\/\//.test(i.link) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fromGdelt(q, when) {
  const terms = q.split(/\s+/).filter((w) => w.length >= 3).join(" ");
  const api = "https://api.gdeltproject.org/api/v2/doc/doc?query=" +
    encodeURIComponent(terms + " sourcelang:german") +
    `&mode=artlist&format=json&maxrecords=60&sort=datedesc&timespan=${TIMESPAN[when]}`;
  const res = await fetch(api, { headers: { "User-Agent": "TrueScope (https://truescope-49p.pages.dev)" } });
  if (!res.ok) throw new Error(`GDELT antwortet mit ${res.status}`);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("GDELT ist gerade ausgelastet"); }
  return parseGdelt(data);
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
  const when = TIMESPAN[url.searchParams.get("when")] ? url.searchParams.get("when") : "7d";
  if (!q) return Response.json({ error: "Parameter q fehlt." }, { status: 400 });

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.truescope/gdelt?q=${encodeURIComponent(q)}&when=${when}`);
  const hit = await cache.match(cacheKey);
  const cached = hit ? await hit.json() : null;
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < FRESH_MS) {
    return Response.json(cached, { headers: { "Cache-Control": "public, max-age=300" } });
  }

  try {
    const items = await fromGdelt(q, when);
    const body = {
      query: q, when, fetchedAt: new Date().toISOString(), items,
      coverageNote: when === "1y" ? "Die Datenquelle reicht nur 3 Monate zurück." : null,
      attribution: { name: "The GDELT Project", url: "https://www.gdeltproject.org" },
    };
    if (items.length) {
      await cache.put(cacheKey, Response.json(body, { headers: { "Cache-Control": `public, max-age=${KEEP_S}` } }));
    }
    return Response.json(body, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (e) {
    // Bei Ausfall die letzte gespeicherte Version zeigen, falls vorhanden.
    if (cached) return Response.json({ ...cached, stale: true }, { headers: { "Cache-Control": "no-store" } });
    return Response.json({ error: String(e.message || e) }, { status: 502 });
  }
}
