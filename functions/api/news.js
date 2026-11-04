// GET /api/news?q=Politik%20Österreich&when=7d
// Holt aktuelle Schlagzeilen aus dem Google-News-RSS-Feed und liefert sie als JSON.

const ALLOWED_WHEN = new Set(["1d", "7d", "30d", "1y"]);

function decodeEntities(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]).trim() : "";
}

export function parseRss(xml, limit = 40) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) && items.length < limit) {
    const block = m[1];
    const source = tag(block, "source");
    let title = tag(block, "title");
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
    const link = tag(block, "link");
    const pub = tag(block, "pubDate");
    const date = pub ? new Date(pub) : null;
    if (!title || !/^https?:\/\//.test(link)) continue;
    items.push({
      title,
      link,
      source,
      date: date && !isNaN(date) ? date.toISOString() : null,
    });
  }
  items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return items;
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
  const when = ALLOWED_WHEN.has(url.searchParams.get("when")) ? url.searchParams.get("when") : "7d";
  if (!q) return Response.json({ error: "Parameter q fehlt." }, { status: 400 });

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.truescope/news?q=${encodeURIComponent(q)}&when=${when}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const feed = `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:" + when)}&hl=de&gl=AT&ceid=AT:de`;
  let res;
  try {
    res = await fetch(feed, { headers: { "User-Agent": "TrueScope/1.0 (news reader)" } });
  } catch (e) {
    return Response.json({ error: "Nachrichtenquelle nicht erreichbar." }, { status: 502 });
  }
  if (!res.ok) return Response.json({ error: `Nachrichtenquelle antwortet mit ${res.status}.` }, { status: 502 });

  const items = parseRss(await res.text());
  const out = Response.json(
    { query: q, when, fetchedAt: new Date().toISOString(), items },
    { headers: { "Cache-Control": "public, max-age=600" } }
  );
  await cache.put(cacheKey, out.clone());
  return out;
}
