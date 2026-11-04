// Lesezeit eines Artikels messen – höflich und ohne Inhalte zu speichern.
//
// Ablauf: Vor jedem Abruf wird die robots.txt des Mediums geprüft (und 24 Stunden zwischengespeichert).
// Ist der Abruf dort nicht erlaubt, ist die Seite nicht erreichbar oder meldet sie einen Text-und-Data-Mining-
// Vorbehalt (tdm-reservation, noai), wird NICHT gelesen. Sonst werden nur die Wörter der Absätze gezählt;
// gespeichert wird allein diese Zahl (und ob eine Bezahlschranke erkannt wurde), nie ein Text.

export const UA = "TrueScope/1.0 (+https://truescope-49p.pages.dev/; Lesezeit-Messung)";
export const WPM = 200;                 // Lesegeschwindigkeit für die Minutenangabe
const AGENT = "truescope";
const ROBOTS_TTL = 24 * 36e5;           // robots.txt einen Tag behalten
const ROBOTS_FAIL_TTL = 36e5;           // nicht abrufbare robots.txt nach einer Stunde erneut versuchen
const PAGE_MAX = 1_500_000;             // höchstens so viele Bytes je Seite lesen
const MAX_HOPS = 3;

export const minutesOf = (words) => (words > 0 ? Math.max(1, Math.round(words / WPM)) : null);

// ---------- robots.txt ----------

// Liefert nur die Regeln, die für uns gelten (Gruppe „TrueScope“, sonst „*“): [{ allow, path }]
export function parseRobots(text) {
  const groups = [];
  let cur = null, lastUA = false;
  for (let line of String(text || "").slice(0, 500_000).split(/\r?\n/)) {
    line = line.replace(/#.*$/, "").trim();
    const i = line.indexOf(":");
    if (i < 1) continue;
    const key = line.slice(0, i).trim().toLowerCase(), val = line.slice(i + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastUA) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastUA = true;
    } else if (key === "allow" || key === "disallow") {
      if (cur) cur.rules.push({ allow: key === "allow", path: val });
      lastUA = false;
    } else if (key !== "sitemap") lastUA = false;
  }
  const mine = groups.filter((g) => g.agents.includes(AGENT));
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return use.flatMap((g) => g.rules).filter((r) => r.path !== "").slice(0, 2000);
}

function matches(rule, path) {
  const p = rule.path;
  if (!/[*$]/.test(p)) return path.startsWith(p);       // häufigster Fall: reines Präfix, ohne Regex
  if (!rule.re) {
    const end = p.endsWith("$");
    const body = (end ? p.slice(0, -1) : p).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    rule.re = new RegExp("^" + body + (end ? "$" : ""));
  }
  return rule.re.test(path);
}

// Längste passende Regel gewinnt, bei Gleichstand „erlaubt“ (so legt es RFC 9309 fest).
export function robotsAllows(rules, path) {
  let best = null;
  for (const r of rules) {
    if (r.path.length < (best ? best.path.length : 0)) continue;
    if (!matches(r, path)) continue;
    if (!best || r.path.length > best.path.length || r.allow) best = r;
  }
  return best ? best.allow : true;
}

// null = nicht erlaubt bzw. nicht feststellbar (dann wird nichts abgerufen)
async function robotsFor(env, origin) {
  const now = Date.now();
  let row = null;
  try { row = await env.DB.prepare("SELECT body, fetched_at FROM robots WHERE host = ?").bind(origin).first(); } catch {}
  if (row && now - row.fetched_at < (row.body == null ? ROBOTS_FAIL_TTL : ROBOTS_TTL)) {
    if (row.body == null) return null;
    try { const r = JSON.parse(row.body); if (Array.isArray(r)) return r; } catch {}
  }
  let body = null; // gespeichert wird nur die Regelliste für uns, nicht die ganze Datei
  try {
    const res = await fetch(origin + "/robots.txt", {
      headers: { "User-Agent": UA, Accept: "text/plain,*/*;q=0.5" },
      redirect: "follow", signal: AbortSignal.timeout(4000),
    });
    if (res.status === 404 || res.status === 410) body = "[]";
    else if (res.ok) body = JSON.stringify(parseRobots(await res.text()));
    // alle anderen Antworten (401, 403, 429, 5xx …): im Zweifel nicht abrufen
  } catch { body = null; }
  try {
    await env.DB.prepare(
      "INSERT INTO robots (host, body, fetched_at) VALUES (?, ?, ?) ON CONFLICT(host) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at"
    ).bind(origin, body, now).run();
  } catch {}
  return body == null ? null : JSON.parse(body);
}

// ---------- Seite lesen: nur Wörter zählen ----------

const countWords = (s) => (String(s).replace(/&[#\w]+;/g, " ").match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length;

// Aus den Zählwerten wird das Ergebnis; Absätze in <article> zählen zuerst, dann <main>, dann alle.
export function decide(s) {
  if (s.noai) return { optout: true };
  const main = Math.max(0, s.main - s.noise);
  let words = s.article >= 80 ? s.article : main >= 80 ? main : Math.max(0, s.all - s.noise);
  const paywall = !!(s.ldLocked || s.tierLocked || (s.pwClass && words < 350));
  if (!paywall && words < 60) words = 0; // Ticker, Video-Seiten o. Ä.: keine verlässliche Lesezeit
  return { words: words || null, paywall };
}

const emptyStats = () => ({ article: 0, main: 0, all: 0, noise: 0, ldLocked: false, tierLocked: false, pwClass: false, noai: false });
const LD_LOCKED = /"isAccessibleForFree"\s*:\s*(?:false|"false")/i;
const TIER_LOCKED = /locked|premium|subscriber/i;

// Produktiv: HTMLRewriter von Cloudflare (läuft nativ und streamt, kaum Rechenzeit).
// null, falls die Umgebung ihn nicht kennt oder ein Selektor nicht verstanden wird (dann greift der Ersatz).
function buildRewriter() {
  if (typeof HTMLRewriter === "undefined") return null;
  try {
    const s = emptyStats();
    let ld = "";
    const para = (key) => {
      let cur = 0;
      return {
        element(el) { cur = 0; el.onEndTag(() => { if (cur >= 4) s[key] += cur; cur = 0; }); },
        text(t) { cur += countWords(t.text); },
      };
    };
    const rw = new HTMLRewriter()
      .on("article p", para("article"))
      .on("main p", para("main"))
      .on("p", para("all"))
      .on("nav p, footer p, aside p, header p, form p", para("noise"))
      .on('script[type="application/ld+json"]', { text(t) { if (ld.length < 60_000) ld += t.text; } })
      .on('meta[name="article:content_tier"], meta[property="article:content_tier"]', {
        element(el) { if (TIER_LOCKED.test(el.getAttribute("content") || "")) s.tierLocked = true; },
      })
      .on('meta[name="robots" i], meta[name="tdm-reservation" i]', {
        element(el) {
          const name = (el.getAttribute("name") || "").toLowerCase(), c = el.getAttribute("content") || "";
          if (name === "tdm-reservation" ? c.trim() === "1" : /noai|notdm/i.test(c)) s.noai = true;
        },
      })
      .on('[class*="paywall" i], [id*="paywall" i], [data-paywall]', { element() { s.pwClass = true; } });
    return { rw, s, done: () => { if (LD_LOCKED.test(ld)) s.ldLocked = true; return s; } };
  } catch {
    return null;
  }
}

// Ersatz ohne HTMLRewriter (Tests unter Node): gleiche Zählweise mit einfachen Mustern.
export function statsFromHtml(html) {
  const s = emptyStats();
  const paras = (h) => {
    let n = 0;
    for (const m of h.matchAll(/<p[\s>][\s\S]*?<\/p>/gi)) {
      const w = countWords(m[0].replace(/<[^>]+>/g, " "));
      if (w >= 4) n += w;
    }
    return n;
  };
  const art = html.match(/<article[\s>][\s\S]*<\/article>/i);
  const main = html.match(/<main[\s>][\s\S]*<\/main>/i);
  s.article = art ? paras(art[0]) : 0;
  s.main = main ? paras(main[0]) : 0;
  s.all = paras(html);
  for (const m of html.matchAll(/<(nav|footer|aside|header|form)[\s>][\s\S]*?<\/\1>/gi)) s.noise += paras(m[0]);
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) if (LD_LOCKED.test(m[1])) s.ldLocked = true;
  for (const m of html.matchAll(/<meta[^>]+>/gi)) {
    const t = m[0], name = (t.match(/(?:name|property)\s*=\s*["']([^"']+)/i) || [])[1] || "", c = (t.match(/content\s*=\s*["']([^"']*)/i) || [])[1] || "";
    if (/^article:content_tier$/i.test(name) && TIER_LOCKED.test(c)) s.tierLocked = true;
    if (/^robots$/i.test(name) && /noai|notdm/i.test(c)) s.noai = true;
    if (/^tdm-reservation$/i.test(name) && c.trim() === "1") s.noai = true;
  }
  if (/(?:class|id)\s*=\s*["'][^"']*paywall|data-paywall/i.test(html)) s.pwClass = true;
  return s;
}

function capped(body, max) {
  let n = 0;
  return body.pipeThrough(new TransformStream({
    transform(chunk, c) { n += chunk.byteLength; c.enqueue(chunk); if (n >= max) c.terminate(); },
  }));
}

async function readStats(res) {
  const b = buildRewriter();
  if (!b) return statsFromHtml((await res.text()).slice(0, PAGE_MAX));
  const reader = b.rw.transform(new Response(capped(res.body, PAGE_MAX), { headers: res.headers })).body.getReader();
  while (!(await reader.read()).done);
  return b.done();
}

// ---------- Hauptfunktion ----------

const okHost = (h) => /^[a-z0-9.-]+$/i.test(h) && h.includes(".") && !/^\d+(\.\d+){3}$/.test(h);

// Ergebnis: { state: "ok", words, paywall } | { state: "paywall" } | { state: "blocked" } | { state: "failed" }
export async function measure(env, link) {
  try {
    let u = new URL(link);
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      if (!/^https?:$/.test(u.protocol) || u.username || u.password || (u.port && u.port !== "80" && u.port !== "443") || !okHost(u.hostname)) return { state: "failed" };
      const rules = await robotsFor(env, u.origin);
      if (!rules || !robotsAllows(rules, u.pathname + u.search)) return { state: "blocked" };

      const res = await fetch(u, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml;q=0.9", "Accept-Language": "de,en;q=0.7" },
        redirect: "manual", signal: AbortSignal.timeout(6000),
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel();
        u = new URL(res.headers.get("location"), u);
        continue;
      }
      if (res.status === 401 || res.status === 402) { await res.body?.cancel(); return { state: "paywall" }; }
      const robotsTag = (res.headers.get("x-robots-tag") || "").toLowerCase();
      if (res.headers.get("tdm-reservation") === "1" || /noai|notdm/.test(robotsTag)) { await res.body?.cancel(); return { state: "blocked" }; }
      if (!res.ok || !/html/i.test(res.headers.get("content-type") || "") || !res.body) { await res.body?.cancel(); return { state: "failed" }; }

      const out = decide(await readStats(res));
      if (out.optout) return { state: "blocked" };
      return { state: "ok", words: out.words, paywall: out.paywall };
    }
    return { state: "failed" };
  } catch {
    return { state: "failed" };
  }
}
