// CPU probe for ONE default cron step, in a fresh process (cold JIT, like a new isolate).
// Run: node test/cpu-probe.ts   — compare with the 10 ms CPU limit of the free plan.
import { analyze, assessEvent, buildContent, matchEvent, vec } from "../src/engine/engine.ts";
import { centroid } from "../src/engine/text.ts";
import { parseFeed } from "../src/rss.ts";

const W = ("Regierung Wien Budget Nationalrat Minister Parlament beschließt neue Maßnahmen Familien Wirtschaft Polizei Berlin London Texas " +
  "said officials people killed Hochwasser Steiermark Bahn Streik Gewerkschaft Klima Gipfel Präsident Wahl Kongress Senat Zinsen Börse Inflation " +
  "Fußball Bundesliga Tennis Forscher Studie Universität Krankenhaus Impfung Gericht Urteil Anklage Ukraine Russland Israel Gaza China Japan").split(" ");
let seed = 7;
const r = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
// realistic vocabulary: a few shared topic words + many distinct ones (news text has thousands of distinct words)
const V = [...W, ...Array.from({ length: 3000 }, (_, i) => `wort${i.toString(36)}x`)];
const rnd = (n: number) => Array.from({ length: n }, () => (r() < 0.25 ? W[Math.floor(r() * W.length)] : V[Math.floor(r() * V.length)])).join(" ");
const feed = () => `<rss><channel>${Array.from({ length: 60 }, (_, i) => `<item><title>${rnd(9)}</title><link>https://x.test/${r()}/${i}</link><description><![CDATA[<p>${rnd(45)}</p>]]></description><pubDate>${new Date().toUTCString()}</pubDate><category>Politik</category></item>`).join("")}</channel></rss>`;
const t = () => performance.now();
const f1 = feed(), f2 = feed();

let s = t();
const items = [...parseFeed(f1, 20), ...parseFeed(f2, 20)];
console.log(`FETCH step (2 feeds × 20 items): ${(t() - s).toFixed(1)} ms`);

const src = { id: 1, name: "A", source_type: "public_broadcaster", country_code: "AT", owner_group: null, base_reliability: 0.88, corrections_90d: 0, wire_key: null };
const art = (i: number) => ({ id: i, title: rnd(9), summary: rnd(45), url: `u${i}`, published_at: Date.now() - i * 6e4, feed_categories: [], source: { ...src, id: i % 6, name: `S${i % 6}` } });
// 250 open events with realistic, diverse centroids (stored as JSON in D1)
const stored = JSON.stringify(Array.from({ length: 150 }, (_, i) => ({ id: i, centroid: centroid([vec(analyze(art(1000 + i)))]), entities: [], countries: { AT: "location" }, last_updated: Date.now() })));
// two events with 12 stored analyses each
const evJson = [0, 1].map(() => JSON.stringify(Array.from({ length: 12 }, (_, i) => { const a = art(2000 + i); return { a, an: analyze(a) }; })));

for (const run of [1, 2, 3]) {
s = t();
const cands = (JSON.parse(stored) as { id: number; centroid: Record<string, number>; last_updated: number }[]).map((e) => ({ id: e.id, centroid: e.centroid, entities: new Set<string>(), countries: new Set(["AT"]), lastSeen: e.last_updated }));
for (let i = 0; i < 4; i++) { const an = analyze(art(i)); matchEvent(an, Date.now(), cands); JSON.stringify(an); }
const m1 = t() - s;
for (const j of evJson) {
  const pairs = (JSON.parse(j) as { a: ReturnType<typeof art>; an: ReturnType<typeof analyze> }[]).map((x) => [x.a, x.an]);
  const a = assessEvent(pairs as never);
  JSON.stringify(buildContent(pairs as never, a));
}
console.log(`run ${run} ANALYZE step: total ${(t() - s).toFixed(1)} ms (analyse+match ${m1.toFixed(1)} ms, 2 assessments ${(t() - s - m1).toFixed(1)} ms)`);
}
