// Vorübergehender Test: Erreichbarkeit der Feeds von Cloudflare aus. Wird wieder entfernt.
import { FEEDS, CANDIDATES } from "../../lib/feeds.js";
const UA = "TrueScope/1.0 (+https://truescope-49p.pages.dev; RSS-Leser)";

export async function onRequestGet({ request }) {
  const part = Number(new URL(request.url).searchParams.get("part") || 0);
  const src = new URL(request.url).searchParams.get("c") ? CANDIDATES : FEEDS;
  const slice = src.slice(part * 40, part * 40 + 40);
  const out = await Promise.all(slice.map(async ([c, name, url]) => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" }, signal: ctl.signal, redirect: "follow" });
      clearTimeout(t);
      const txt = await r.text();
      const n = (txt.match(/<item[\s>]/g) || []).length + (txt.match(/<entry[\s>]/g) || []).length;
      return [c, name, r.status, n];
    } catch (e) {
      return [c, name, "err", String(e).slice(0, 40)];
    }
  }));
  return Response.json(out);
}
