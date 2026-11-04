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

const DAYS = { "1d": 1, "7d": 7, "30d": 30, "1y": 365 };

// Bing verpackt den Artikel-Link in eine Weiterleitung: echte Adresse aus dem url-Parameter holen.
function realLink(link) {
  try {
    const u = new URL(link);
    if (u.hostname.endsWith("bing.com")) {
      const inner = u.searchParams.get("url");
      if (inner && /^https?:\/\//.test(inner)) return inner;
    }
  } catch {}
  return link;
}

export function parseRss(xml, limit = 40) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) && items.length < limit) {
    const block = m[1];
    const source = tag(block, "source") || tag(block, "News:Source");
    let title = tag(block, "title");
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
    const link = realLink(tag(block, "link"));
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

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fromGoogle(q, when) {
  const feed = `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:" + when)}&hl=de&gl=AT&ceid=AT:de`;
  const res = await fetch(feed, { headers: { "User-Agent": BROWSER_UA, "Accept-Language": "de-AT,de;q=0.9" } });
  if (!res.ok) throw new Error(`Google News ${res.status}`);
  return parseRss(await res.text());
}

async function fromBing(q, when) {
  const freshness = { "1d": "Day", "7d": "Week", "30d": "Month" }[when];
  const feed = `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setmkt=de-AT&setlang=de${freshness ? "&qft=interval%3d%22" + { Day: 7, Week: 8, Month: 9 }[freshness] + "%22" : ""}`;
  const res = await fetch(feed, { headers: { "User-Agent": BROWSER_UA, "Accept-Language": "de-AT,de;q=0.9" } });
  if (!res.ok) throw new Error(`Bing News ${res.status}`);
  const since = Date.now() - DAYS[when] * 864e5;
  return parseRss(await res.text()).filter((i) => !i.date || Date.parse(i.date) >= since);
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

  const errors = [];
  let items = null, provider = null;
  for (const [name, fn] of [["Google News", fromGoogle], ["Bing News", fromBing]]) {
    try {
      const r = await fn(q, when);
      if (r.length) { items = r; provider = name; break; }
      errors.push(`${name}: keine Treffer`);
      if (!items) items = r;
    } catch (e) {
      errors.push(String(e.message || e));
    }
  }
  if (items === null) {
    return Response.json({ error: "Nachrichtenquellen nicht erreichbar (" + errors.join(", ") + ")." }, { status: 502 });
  }

  const out = Response.json(
    { query: q, when, provider, notes: errors, fetchedAt: new Date().toISOString(), items },
    { headers: { "Cache-Control": "public, max-age=600" } }
  );
  if (items.length) await cache.put(cacheKey, out.clone());
  return out;
}
