// Lightweight RSS 2.0 / RDF / Atom parser (regex based, low CPU, no dependencies).
// Only title, teaser, link, date, categories and image are extracted — never the
// full article body (content:encoded is ignored on purpose).
import { cleanText, decodeEntities, safeUrl } from "./engine/sanitize.ts";

export interface FeedItem { url: string; title: string; summary: string; published_at: number; image_url: string | null; categories: string[] }

const TRACKING = /^(utm_|at_|wt_|ref$|fbclid|gclid|ns_|xtor|cmp|mc_)/i;

export function canonicalUrl(raw: string): string | null {
  const s = safeUrl(decodeEntities(raw.trim()));
  if (!s) return null;
  try {
    const u = new URL(s);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase();
    let out = u.toString();
    if (out.endsWith("/") && u.pathname !== "/") out = out.slice(0, -1);
    return out;
  } catch {
    return null;
  }
}

function tag(block: string, names: string[]): string | null {
  for (const n of names) {
    const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i").exec(block);
    if (m) return m[1];
  }
  return null;
}

function attr(block: string, tagName: string, attrName: string, filter?: RegExp): string | null {
  const re = new RegExp(`<${tagName}\\b([^>]*)/?>`, "gi");
  for (const m of block.matchAll(re)) {
    if (filter && !filter.test(m[1])) continue;
    const a = new RegExp(`\\b${attrName}\\s*=\\s*["']([^"']+)["']`, "i").exec(m[1]);
    if (a) return a[1];
  }
  return null;
}

function parseDate(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(cleanText(s, 80));
  return Number.isFinite(t) ? t : null;
}

export function parseFeed(xml: string, maxItems = 20, now = Date.now()): FeedItem[] {
  const doc = xml.length > 600_000 ? xml.slice(0, 600_000) : xml; // CPU cap
  const isAtom = /<feed\b[^>]*xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(doc.slice(0, 2000)) && !/<item\b/i.test(doc.slice(0, 20000));
  const re = isAtom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi;
  const out: FeedItem[] = [];
  for (const m of doc.matchAll(re)) {
    if (out.length >= maxItems) break;
    const b = m[0];
    const title = cleanText(tag(b, ["title"]), 480);
    let link = isAtom ? attr(b, "link", "href", /rel=["']alternate["']|^(?![\s\S]*rel=)/i) ?? attr(b, "link", "href") : tag(b, ["link"]);
    if (!link) link = tag(b, ["guid"]);
    const url = link ? canonicalUrl(cleanText(link, 1500)) : null;
    if (!url || !title) continue;
    const summary = cleanText(tag(b, ["description", "summary", "media:description", "dc:description"]), 1200);
    let published = parseDate(tag(b, ["pubDate", "published", "updated", "dc:date"])) ?? now;
    if (published > now + 3_600_000) published = now; // clock skew / bad feed data
    const image = safeUrl(attr(b, "media:content", "url") ?? attr(b, "media:thumbnail", "url") ?? attr(b, "enclosure", "url", /type=["']image/i));
    const cats: string[] = [];
    for (const c of b.matchAll(/<(?:category|dc:subject)\b([^>]*)>([\s\S]*?)<\/(?:category|dc:subject)>/gi)) cats.push(cleanText(c[2], 60));
    for (const c of b.matchAll(/<category\b[^>]*\bterm=["']([^"']+)["'][^>]*\/?>/gi)) cats.push(cleanText(c[1], 60));
    out.push({ url, title, summary, published_at: published, image_url: image, categories: [...new Set(cats.filter(Boolean))].slice(0, 6) });
  }
  return out;
}

/** Minimal robots.txt evaluation for our user agent (Disallow prefixes, `*` group). */
export function robotsAllows(robots: string, path: string, agent = "truescopebot"): boolean {
  const groups: { agents: string[]; rules: [boolean, string][] }[] = [];
  let cur: { agents: string[]; rules: [boolean, string][] } | null = null;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
    } else if (cur && (k === "disallow" || k === "allow")) {
      cur.rules.push([k === "allow", v]);
    }
  }
  const g = groups.find((x) => x.agents.some((a) => a !== "*" && agent.includes(a))) ?? groups.find((x) => x.agents.includes("*"));
  if (!g) return true;
  let best: [boolean, string] | null = null;
  for (const r of g.rules) if (r[1] && path.startsWith(r[1].replace(/\*.*$/, "")) && (!best || r[1].length > best[1].length)) best = r;
  return best ? best[0] : true;
}
