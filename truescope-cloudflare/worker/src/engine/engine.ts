// Facade: analyse articles, match them to events, assess events, build neutral content.
import { extractClaims } from "./claims.ts";
import { classify, cues } from "./classify.ts";
import { detectCountries, detectPlaces, namedEntities } from "./entities.ts";
import { detectWireOrigin } from "./independence.ts";
import { cleanText, detectInjection } from "./sanitize.ts";
import { centroid, cosine, fold, jaccard, sentences, shingles, tokenize, vector, type Vec } from "./text.ts";
import type { Analysis, ArticleInput, Assessment } from "./types.ts";
import { assess } from "./verification.ts";

export const ENGINE_VERSION = "cf-1.0.0";
export const JOIN_THRESHOLD = 0.3;
export const DUPLICATE_THRESHOLD = 0.85;
const WINDOW = 72 * 3_600_000;

export function analyze(a: ArticleInput): Analysis {
  const title = cleanText(a.title, 300);
  const summary = cleanText(a.summary, 1500);
  const text = `${title}. ${summary}`;
  const c = cues(text);
  const opinion = c.opinion || a.feed_categories.some((f) => ["kommentar", "opinion", "meinung", "commentisfree"].includes(fold(f)));
  return {
    tt: tokenize(title), bt: tokenize(summary), wire: detectWireOrigin(text), opinion, hedged: c.hedged, retraction: c.retraction,
    debunk: c.debunk, official: c.official, countries: detectCountries(text), places: detectPlaces(text),
    entities: namedEntities(text).slice(0, 20), categories: classify(text, a.feed_categories), claims: extractClaims(text, opinion),
    injection: detectInjection(text),
  };
}

export const vec = (an: Analysis): Vec => vector(an.tt, an.bt);

export interface Candidate { id: number; centroid: Vec; entities: Set<string>; countries: Set<string>; lastSeen: number }

/** Inverted index term -> [(candidate position, weight)]. Built once per cron run.
 *  (Property lookups on JSON objects with arbitrary word keys are slow in V8;
 *  Map + inverted index keeps matching well below 1 ms for 150 open events.) */
export type CandidateIndex = Map<string, [number, number][]>;

export function buildIndex(cands: Candidate[]): CandidateIndex {
  const idx: CandidateIndex = new Map();
  cands.forEach((c, i) => indexAdd(idx, c, i));
  return idx;
}

export function indexAdd(idx: CandidateIndex, c: Candidate, pos: number): void {
  for (const k in c.centroid) {
    const list = idx.get(k);
    if (list) list.push([pos, c.centroid[k]]); else idx.set(k, [[pos, c.centroid[k]]]);
  }
}

export function matchEvent(an: Analysis, publishedAt: number, cands: Candidate[], index?: CandidateIndex): [number | null, number] {
  const idx = index ?? buildIndex(cands);
  const v = vec(an);
  const lex = new Map<number, number>();
  for (const k in v) {
    const list = idx.get(k);
    if (!list) continue;
    const w = v[k];
    for (const [pos, cw] of list) lex.set(pos, (lex.get(pos) ?? 0) + w * cw);
  }
  let best: number | null = null, bs = 0;
  for (const [pos, l] of lex) {
    if (l < 0.12) continue; // cannot reach the threshold
    const c = cands[pos];
    if (Math.abs(publishedAt - c.lastSeen) > WINDOW) continue;
    let ent = 0;
    if (an.entities.length && c.entities.size) {
      let inter = 0;
      for (const e of an.entities) if (c.entities.has(e)) inter++;
      ent = inter / (an.entities.length + c.entities.size - inter);
    }
    let geo = 0;
    if (an.countries.length && c.countries.size) geo = an.countries.some((x) => c.countries.has(x)) ? 0.05 : -0.05;
    const sc = 0.75 * l + 0.35 * ent + geo;
    if (sc > bs) { bs = sc; best = c.id; }
  }
  return bs >= JOIN_THRESHOLD ? [best, bs] : [null, bs];
}

export function isDuplicate(t1: string, s1: string, t2: string, s2: string): boolean {
  if (t1.trim().toLowerCase() === t2.trim().toLowerCase()) return true;
  return jaccard(shingles(`${t1} ${s1}`, 3), shingles(`${t2} ${s2}`, 3)) >= DUPLICATE_THRESHOLD;
}

export function eventCategories(ans: Analysis[], k = 3): string[] {
  const cnt: Record<string, number> = {};
  for (const an of ans) for (const c of an.categories) cnt[c] = (cnt[c] ?? 0) + 1;
  return Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, k).map(([c]) => c);
}

/** code -> location | mentioned | source. Event country and source country are distinct. */
export function eventCountries(items: [ArticleInput, Analysis][]): Record<string, "location" | "mentioned" | "source"> {
  const n = items.length;
  const cnt: Record<string, number> = {};
  for (const [, an] of items) for (const c of new Set(an.countries)) cnt[c] = (cnt[c] ?? 0) + 1;
  const rel: Record<string, "location" | "mentioned" | "source"> = {};
  for (const [c, k] of Object.entries(cnt)) rel[c] = k * 2 >= n ? "location" : "mentioned";
  for (const [a] of items) if (a.source.country_code && !(a.source.country_code in rel)) rel[a.source.country_code] = "source";
  return rel;
}

/** Countries for which the event is shown under the country filter:
 *  takes place in / is about it, or is reported by its media without a foreign location. */
export function relevantCountries(rel: Record<string, string>): string[] {
  const about = Object.keys(rel).filter((c) => rel[c] === "location" || rel[c] === "mentioned");
  const hasLocation = Object.values(rel).includes("location");
  const media = Object.keys(rel).filter((c) => rel[c] === "source" && !hasLocation);
  return [...new Set([...about, ...media])];
}

export function assessEvent(items: [ArticleInput, Analysis][], now = Date.now()): Assessment {
  return assess(items, now, eventCategories(items.map(([, an]) => an)));
}

const LOADED = /\b(skandal|scandal|outrage|shocking|schockierend|disaster for|katastrophal|unfassbar|incredible|slams?|blasts?|destroys?|furious|wutend|horror)\b/i;

export function headline(titles: string[]): string {
  if (!titles.length) return "";
  const tok = titles.map((t) => new Set(fold(t).split(/\s+/)));
  const freq: Record<string, number> = {};
  for (const t of tok) for (const w of t) freq[w] = (freq[w] ?? 0) + 1;
  const score = (i: number) => {
    let s = [...tok[i]].reduce((x, w) => x + freq[w], 0) / (tok[i].size || 1);
    if (LOADED.test(fold(titles[i])) || titles[i].includes("!")) s -= 5;
    if (/^(live|liveticker|ticker|video|kommentar|opinion)\b/.test(fold(titles[i]))) s -= 3;
    return s;
  };
  let best = 0;
  for (let i = 1; i < titles.length; i++) if (score(i) > score(best)) best = i;
  return titles[best].replace(/^(eilmeldung|breaking( news)?)\s*[:\-–]\s*/i, "").trim();
}

/** Extractive, neutral summary from source sentences only (never invents). */
export function neutralSummary(items: { group: string; text: string; opinion: boolean }[], cen: Vec, max = 3): string {
  const cands: [number, string, string][] = [];
  for (const it of items) {
    if (it.opinion) continue;
    const ss = sentences(it.text).slice(0, 3);
    for (const s of ss.length ? ss : it.text.length > 30 ? [it.text] : []) {
      if (LOADED.test(fold(s))) continue;
      cands.push([cosine(vector([], tokenize(s)), cen), it.group, s]);
    }
  }
  cands.sort((a, b) => b[0] - a[0]);
  const groupsAvail = new Set(cands.map((c) => c[1])).size;
  const chosen: string[] = [], used = new Set<string>(), seen = new Set<string>();
  for (const [, g, s] of cands) {
    const key = fold(s).slice(0, 60);
    if (seen.has(key) || (used.has(g) && used.size < groupsAvail)) continue;
    chosen.push(/[.!?]$/.test(s) ? s : `${s}.`);
    used.add(g); seen.add(key);
    if (chosen.length >= max) break;
  }
  return chosen.join(" ");
}

export function buildContent(items: [ArticleInput, Analysis][], a: Assessment) {
  const ans = items.map(([, an]) => an);
  const cen = centroid(ans.map(vec));
  const groupOf = new Map<number, string>();
  for (const [g, ids] of Object.entries(a.groups)) for (const id of ids) groupOf.set(id, g);
  const title = headline(items.filter(([, an]) => !an.opinion).map(([x]) => cleanText(x.title, 300))) || cleanText(items[0][0].title, 300);
  const summary = neutralSummary(items.slice(0, 8).map(([x, an]) => ({ group: groupOf.get(x.id) ?? String(x.id), text: cleanText(x.summary, 1500) || cleanText(x.title), opinion: an.opinion })), cen);
  const count = (arr: string[][]) => {
    const c: Record<string, number> = {};
    for (const l of arr) for (const x of l) c[x] = (c[x] ?? 0) + 1;
    return Object.entries(c).sort((p, q) => q[1] - p[1]).map(([x]) => x);
  };
  const entities = count(ans.map((an) => an.entities)).slice(0, 10);
  const places = count(ans.map((an) => an.places)).slice(0, 6);
  const first = Math.min(...items.map(([x]) => x.published_at));
  return {
    title, summary, centroid: cen, entities, categories: eventCategories(ans),
    facts: { what: summary, where: places.map((p) => p[0].toUpperCase() + p.slice(1)), when: new Date(first).toISOString(), who: entities.slice(0, 8) },
  };
}

// Isolate warm-up: executes every regex once at start-up (global scope), so the
// first request/cron run in a fresh isolate does not pay ~20 ms of compile time.
try {
  analyze({ id: 0, title: "Wien (APA) - Regierung in Berlin: 3 Tote, Magnitude 5.1", summary: "Laut Polizei wurden 12 Menschen verletzt, officials said. Kommentar.", url: "", published_at: 0, feed_categories: [],
    source: { id: 0, name: "", source_type: "other", country_code: null, owner_group: null, base_reliability: 0, corrections_90d: 0, wire_key: null } });
} catch { /* never block start-up */ }
