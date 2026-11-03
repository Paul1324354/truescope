// Countries, places, named entities, numbers. Gazetteer is extendable at runtime
// (countries.extra_keywords in D1).
import { fold, words } from "./text.ts";

export const GAZETTEER: Record<string, string[]> = {
  AT: ["austria", "austrian", "osterreich", "osterreichs", "osterreichisch", "osterreichische", "osterreichischen", "osterreicher",
    "wien", "vienna", "graz", "linz", "salzburg", "innsbruck", "klagenfurt", "vorarlberg", "tirol", "steiermark", "styria", "karnten",
    "burgenland", "niederosterreich", "oberosterreich", "nationalrat", "bundeskanzleramt", "hofburg"],
  DE: ["germany", "german", "deutschland", "deutschlands", "deutsche", "deutschen", "deutscher", "berlin", "munich", "munchen",
    "hamburg", "koln", "cologne", "frankfurt", "stuttgart", "dusseldorf", "dresden", "leipzig", "bayern", "bavaria", "bundestag",
    "bundesrat", "bundesregierung", "kanzleramt", "nordrhein-westfalen", "sachsen", "hessen"],
  US: ["united states", "u.s.", "usa", "us-prasident", "us-regierung", "us-wahl", "us-kongress", "american", "amerikanisch",
    "amerikanische", "amerikanischen", "vereinigte staaten", "washington", "new york", "california", "kalifornien", "texas",
    "florida", "white house", "weisses haus", "us congress", "u.s. congress", "us senate", "u.s. senate", "pentagon", "chicago",
    "los angeles", "u.s. supreme court"],
  GB: ["united kingdom", "uk", "britain", "british", "britisch", "britische", "britischen", "grossbritannien", "england",
    "scotland", "schottland", "wales", "northern ireland", "london", "manchester", "birmingham", "edinburgh", "glasgow",
    "downing street", "westminster", "unterhaus", "house of commons"],
  CH: ["switzerland", "swiss", "schweiz", "schweizer", "zurich", "bern", "geneva", "genf", "basel"],
  FR: ["france", "french", "frankreich", "franzosisch", "paris", "lyon", "marseille", "elysee"],
  IT: ["italy", "italian", "italien", "italienisch", "rome", "rom", "milan", "mailand", "genoa", "genua"],
  ES: ["spain", "spanish", "spanien", "spanisch", "madrid", "barcelona", "valencia"],
  UA: ["ukraine", "ukrainian", "ukrainisch", "kyiv", "kiew", "kiev", "kharkiv", "charkiw", "odesa", "odessa"],
  RU: ["russia", "russian", "russland", "russisch", "moscow", "moskau", "kremlin", "kreml", "putin"],
  CN: ["china", "chinese", "chinesisch", "beijing", "peking", "shanghai"],
  JP: ["japan", "japanese", "japanisch", "tokyo", "tokio", "osaka", "fukushima"],
  IN: ["india", "indian", "indien", "indisch", "new delhi", "neu-delhi", "mumbai"],
  IL: ["israel", "israeli", "israelisch", "jerusalem", "tel aviv"],
  PS: ["gaza", "palestinian", "palastinensisch", "west bank", "westjordanland"],
  IR: ["iran", "iranian", "iranisch", "tehran", "teheran"],
  TR: ["turkey", "turkiye", "turkish", "turkei", "turkisch", "ankara", "istanbul"],
  PL: ["poland", "polish", "polen", "polnisch", "warsaw", "warschau"],
  HU: ["hungary", "hungarian", "ungarn", "ungarisch", "budapest", "orban"],
  CA: ["canada", "canadian", "kanada", "kanadisch", "ottawa", "toronto"],
  AU: ["australia", "australian", "australien", "sydney", "canberra", "melbourne"],
  EU: ["european union", "europaische union", "eu-kommission", "european commission", "brussels", "brussel"],
};

// Matching uses token sets instead of one giant regex: compiling a large Unicode
// alternation costs ~40 ms of CPU on a cold isolate, the set lookup well under 1 ms.

const isLetter = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

function hasPhrase(hay: string, w: string): boolean {
  let i = hay.indexOf(w);
  while (i !== -1) {
    if (!isLetter(hay[i - 1]) && !isLetter(hay[i + w.length])) return true;
    i = hay.indexOf(w, i + 1);
  }
  return false;
}

function matches(hay: string, tokens: Set<string>, w: string): boolean {
  return /^[\p{L}\p{N}'-]+$/u.test(w) ? tokens.has(w) : hasPhrase(hay, w);
}

export function registerPlaces(code: string, ws: string[]): void {
  (GAZETTEER[code] ??= []).push(...ws.map(fold).filter(Boolean));
}

export function detectCountries(text: string): string[] {
  const hay = fold(text);
  const tokens = new Set(words(hay));
  return Object.entries(GAZETTEER).filter(([, ws]) => ws.some((w) => matches(hay, tokens, w))).map(([c]) => c);
}

export function detectPlaces(text: string): string[] {
  const tokens = new Set(words(fold(text)));
  const out = new Set<string>();
  for (const ws of Object.values(GAZETTEER)) for (const w of ws) if (w.length > 3 && !w.includes(" ") && !w.includes(".") && tokens.has(w)) out.add(w);
  return [...out].sort();
}

const COMMON_CAPS = new Set(fold(`Der Die Das Ein Eine Und Mit Nach Bei Im In Am Laut Wie Was Wer Wo Seit Auch Doch Aber Nun Heute
Gestern Montag Dienstag Mittwoch Donnerstag Freitag Samstag Sonntag Januar Februar März April Mai Juni Juli August September Oktober
November Dezember The A An And But After Before Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March
June July October December This That These Those It He She They We Regierung Polizei Menschen Prozent Euro Dollar Millionen
Milliarden Jahr Jahren Woche Tag Tage Stunden Update Live Breaking Video Analyse Kommentar Opinion Interview`).split(/\s+/));

const NAME_RE = /\b([A-ZÄÖÜ][a-zäöüß]+(?:[- ][A-ZÄÖÜ][a-zäöüß]+){1,3})\b/g;
const ACRONYM_RE = /\b([A-ZÄÖÜ]{2,6})\b/g;
const NUM_RE = /(?<![\w.])(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)(?!\w)/g;
const ACR_STOP = new Set(["THE", "AND", "LIVE", "VIDEO", "UPDATE", "DEMO"]);

export function namedEntities(text: string): string[] {
  const out = new Set<string>();
  for (const m of (text || "").matchAll(NAME_RE)) {
    const parts = m[1].split(/[- ]/).filter((p) => !COMMON_CAPS.has(fold(p)));
    if (parts.length >= 2) out.add(parts.join(" "));
  }
  for (const m of (text || "").matchAll(ACRONYM_RE)) if (!ACR_STOP.has(m[1])) out.add(m[1]);
  return [...out].sort();
}

export function numbers(text: string): string[] {
  return [...(text || "").matchAll(NUM_RE)].map((m) => m[1]);
}

export function parseNumber(raw: string): number | null {
  const s = raw.trim();
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(s)) return parseFloat(s.replace(/[.,]/g, ""));
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : null;
}
