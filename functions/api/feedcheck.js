// Vorübergehender Test: welche frei lizenzierten Quellen sind von Cloudflare aus erreichbar? Wird wieder entfernt.
const UA = "TrueScope/1.0 (https://truescope-49p.pages.dev; nicht kommerzielles Nachrichtenprojekt)";
const SOURCES = {
  wiki_en_day: "https://en.wikipedia.org/w/api.php?action=parse&page=Portal:Current_events/2026_November_3&prop=wikitext&format=json&formatversion=2",
  wiki_de_portal: "https://de.wikipedia.org/w/api.php?action=parse&page=Portal:Zeitgeschehen&prop=wikitext&format=json&formatversion=2",
  europarl_de: "https://www.europarl.europa.eu/rss/doc/top-stories/de.xml",
  parlament_at: "https://www.parlament.gv.at/recherchieren/news/rss",
  bundestag_hib: "https://www.bundestag.de/static/appdata/includes/rss/hib.rss",
};

export async function onRequestGet({ env }) {
  const out = {};
  await Promise.all(Object.entries(SOURCES).map(async ([k, u]) => {
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA } });
      const t = await r.text();
      out[k] = [r.status, t.length, (t.match(/<item[\s>]/g) || []).length, t.slice(0, 160)];
    } catch (e) { out[k] = ["err", String(e).slice(0, 80)]; }
  }));
  let ai = "keine KI-Bindung";
  if (env.AI) {
    try {
      const r = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [{ role: "user", content: "Schreibe eine kurze deutsche Schlagzeile zu: The French parliament approved the 2027 budget." }],
        max_tokens: 40,
      });
      ai = r.response;
    } catch (e) { ai = "Fehler: " + String(e).slice(0, 120); }
  }
  return Response.json({ out, ai });
}
