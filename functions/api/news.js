// GET /api/news?country=AT|INT&cat=politik&when=7d
// Holt Schlagzeilen über die offizielle Schnittstelle von The Guardian (Open Platform).
// Der Schlüssel liegt als geheime Variable GUARDIAN_API_KEY in Cloudflare.
// Die App zeigt nur Überschrift, Rubrik und Link zum Originalartikel, mit Quellenangabe.

const DAYS = { "1d": 1, "7d": 7, "30d": 30, "1y": 365 };
const FRESH_MS = 30 * 60 * 1000;   // 30 Minuten frisch (Schont das Tageslimit)
const KEEP_S = 2 * 24 * 60 * 60;   // ältere Kopie 2 Tage als Reserve

const COUNTRY_EN = {
  AT: "Austria", DE: "Germany", CH: "Switzerland", FR: "France", IT: "Italy", ES: "Spain",
  GB: "UK", US: "US", NL: "Netherlands", BE: "Belgium", LU: "Luxembourg", PL: "Poland",
  CZ: "Czech", SK: "Slovakia", HU: "Hungary", SI: "Slovenia", HR: "Croatia", RS: "Serbia",
  BA: "Bosnia", RO: "Romania", BG: "Bulgaria", GR: "Greece", TR: "Turkey", PT: "Portugal",
  IE: "Ireland", DK: "Denmark", SE: "Sweden", NO: "Norway", FI: "Finland", EE: "Estonia",
  LV: "Latvia", LT: "Lithuania", UA: "Ukraine", RU: "Russia", IL: "Israel", CA: "Canada",
  MX: "Mexico", BR: "Brazil", AR: "Argentina", CN: "China", JP: "Japan", KR: "South Korea",
  IN: "India", AU: "Australia", ZA: "South Africa", EG: "Egypt", NG: "Nigeria", IR: "Iran",
};

// Rubriken der App -> Guardian-Bereiche (section) bzw. Schlagwörter (tag)
const CATS = {
  politik:      { section: "world|politics|us-news|uk-news|australia-news" },
  wirtschaft:   { section: "business|money" },
  sport:        { section: "sport|football" },
  kultur:       { section: "culture|music|film|books|stage|artanddesign|tv-and-radio" },
  wissenschaft: { section: "science" },
  technik:      { section: "technology" },
  gesundheit:   { tag: "society/health" },
  umwelt:       { section: "environment" },
  chronik:      { section: "world|uk-news|us-news|australia-news|global-development" },
};

export function parseGuardian(data) {
  const results = data?.response?.results || [];
  return results
    .filter((r) => r.type === "article" || r.type === "liveblog")
    .map((r) => ({
      title: String(r.webTitle || "").trim().slice(0, 220),
      link: String(r.webUrl || ""),
      source: "The Guardian" + (r.sectionName ? " · " + r.sectionName : ""),
      date: r.webPublicationDate || null,
    }))
    .filter((i) => i.title && /^https:\/\/www\.theguardian\.com\//.test(i.link));
}

export function buildQuery({ country, cat, when, key }) {
  const from = new Date(Date.now() - DAYS[when] * 864e5).toISOString().slice(0, 10);
  const p = new URLSearchParams({
    "from-date": from,
    "order-by": "newest",
    "page-size": "50",
    "api-key": key,
  });
  const c = CATS[cat];
  if (c.section) p.set("section", c.section);
  if (c.tag) p.set("tag", c.tag);
  if (country !== "INT") p.set("q", `"${COUNTRY_EN[country]}"`);
  return "https://content.guardianapis.com/search?" + p.toString();
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const country = url.searchParams.get("country") === "INT" ? "INT"
    : COUNTRY_EN[url.searchParams.get("country")] ? url.searchParams.get("country") : null;
  const cat = CATS[url.searchParams.get("cat")] ? url.searchParams.get("cat") : "politik";
  const when = DAYS[url.searchParams.get("when")] ? url.searchParams.get("when") : "7d";
  if (!country) return Response.json({ error: "Unbekanntes Land." }, { status: 400 });
  if (!env.GUARDIAN_API_KEY) {
    return Response.json({ error: "Die Nachrichtenquelle ist noch nicht eingerichtet (GUARDIAN_API_KEY fehlt)." }, { status: 503 });
  }

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.truescope/guardian?c=${country}&k=${cat}&w=${when}`);
  const hit = await cache.match(cacheKey);
  const cached = hit ? await hit.json() : null;
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < FRESH_MS) {
    return Response.json(cached, { headers: { "Cache-Control": "public, max-age=300" } });
  }

  try {
    const res = await fetch(buildQuery({ country, cat, when, key: env.GUARDIAN_API_KEY }), {
      headers: { "User-Agent": "TrueScope (https://truescope-49p.pages.dev)" },
    });
    if (res.status === 401 || res.status === 403) throw new Error("Der Guardian-Schlüssel ist ungültig.");
    if (res.status === 429) throw new Error("Das Tageslimit der Nachrichtenquelle ist erreicht.");
    if (!res.ok) throw new Error(`Die Nachrichtenquelle antwortet mit ${res.status}.`);
    const items = parseGuardian(await res.json());
    const body = {
      country, cat, when, fetchedAt: new Date().toISOString(), items,
      attribution: { name: "The Guardian", url: "https://www.theguardian.com" },
    };
    await cache.put(cacheKey, Response.json(body, { headers: { "Cache-Control": `public, max-age=${KEEP_S}` } }));
    return Response.json(body, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (e) {
    if (cached) return Response.json({ ...cached, stale: true }, { headers: { "Cache-Control": "no-store" } });
    return Response.json({ error: String(e.message || e) }, { status: 502 });
  }
}
