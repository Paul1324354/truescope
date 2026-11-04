// Kleiner RSS/Atom-Leser für Cloudflare (ohne Abhängigkeiten).

function decode(str) {
  return String(str || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

function tag(block, names) {
  for (const name of names) {
    const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
    if (m) return m[1];
  }
  return "";
}

export function parseFeed(xml, max = 40) {
  const out = [];
  const re = /<(item|entry)[\s>]([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(xml)) && out.length < max) {
    const b = m[2];
    const title = decode(tag(b, ["title"]));
    let link = decode(tag(b, ["link"]));
    if (!/^https?:\/\//.test(link)) {
      const href = b.match(/<link[^>]*href="([^"]+)"/i);
      link = href ? href[1].replace(/&amp;/g, "&") : "";
    }
    if (!/^https?:\/\//.test(link)) link = decode(tag(b, ["guid"]));
    const dateRaw = decode(tag(b, ["pubDate", "published", "updated", "dc:date"]));
    const t = Date.parse(dateRaw);
    if (title && /^https?:\/\//.test(link)) out.push({ title: title.slice(0, 300), link, published: isNaN(t) ? null : t });
  }
  return out;
}
