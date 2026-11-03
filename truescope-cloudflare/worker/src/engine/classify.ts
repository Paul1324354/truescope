// Categories and linguistic cues (transparent DE/EN keyword lexicons).
import { fold } from "./text.ts";

export const CATEGORY_LEXICON: Record<string, string[]> = {
  politik: ["regierung", "minister", "parlament", "wahl", "partei", "kanzler", "koalition", "bundestag", "nationalrat", "abgeordnet",
    "election", "government", "parliament", "senate", "congress", "president", "prasident", "prime minister", "premier", "vote",
    "opposition", "gesetz", "legislation", "policy", "politik", "politic", "budget", "haushalt"],
  wirtschaft: ["wirtschaft", "economy", "economic", "unternehmen", "company", "industrie", "industry", "konjunktur", "inflation",
    "arbeitsmarkt", "jobs", "unemployment", "arbeitslos", "handel", "trade", "zoll", "tariff", "export", "import", "gdp", "bip",
    "rezession", "recession"],
  finanzen: ["borse", "stock", "shares", "aktie", "markets", "dax", "atx", "dow jones", "nasdaq", "ftse", "zins", "interest rate",
    "leitzins", "ezb", "ecb", "federal reserve", "bank of england", "notenbank", "anleihe", "bond", "bitcoin", "krypto", "crypto", "wahrung", "currency"],
  technologie: ["technologie", "technology", "software", "kunstliche intelligenz", "artificial intelligence", " ki ", " ai ", "chip",
    "semiconductor", "halbleiter", "smartphone", "apple", "google", "microsoft", "openai", "cyber", "hacker", "internet"],
  wissenschaft: ["wissenschaft", "science", "forscher", "researcher", "studie", "study", "nasa", "esa", "weltraum", "space", "physik",
    "physics", "universitat", "university", "entdeckung", "discovery", "astronom"],
  gesundheit: ["gesundheit", "health", "krankenhaus", "hospital", "virus", "impf", "vaccine", " who ", "pandemie", "pandemic",
    "krankheit", "disease", "medizin", "medical", "patient", "arzt"],
  umwelt: ["klima", "climate", "umwelt", "environment", "emission", "co2", "hitzewelle", "heatwave", "hochwasser", "flood",
    "uberschwemmung", "durre", "drought", "waldbrand", "wildfire", "erdbeben", "earthquake", "sturm", "storm", "hurricane",
    "hurrikan", "tsunami", "vulkan", "tornado"],
  konflikte: ["krieg", " war ", "angriff", "attack", "militar", "military", "armee", "army", "rakete", "missile", "drohne", "drone",
    "nato", "waffenruhe", "ceasefire", "truppen", "troops", "offensive", "konflikt", "conflict", "airstrike", "luftangriff"],
  gesellschaft: ["gesellschaft", "society", "bildung", "education", "schule", "school", "migration", "demonstration", "protest",
    "streik", "strike", "religion", "kirche", "church", "familie"],
  kriminalitaet: ["polizei", "police", "festgenommen", "arrested", "mord", "murder", "gericht", "court", "prozess", "trial", "urteil",
    "verdict", "anklage", "charged", "betrug", "fraud", "ermittlung", "investigation", "tatverdacht", "suspect", "staatsanwalt", "prosecutor"],
  sport: ["fussball", "football", "soccer", "bundesliga", "premier league", "champions league", "tennis", "formel 1", "formula 1",
    "olympia", "olympic", " ski", "weltmeister", "world cup", "nba", "nfl", "trainer", "coach"],
  unterhaltung: ["film", "movie", "musik", "music", "konzert", "concert", "kino", "cinema", "netflix", "oscar", "grammy", "festival",
    "schauspieler", "actor", "sanger", "singer", "promi", "celebrity"],
};

const FEED_HINTS: Record<string, string> = {
  politics: "politik", politik: "politik", inland: "politik", ausland: "politik", business: "wirtschaft", wirtschaft: "wirtschaft",
  economy: "wirtschaft", finance: "finanzen", markets: "finanzen", finanzen: "finanzen", technology: "technologie", tech: "technologie",
  web: "technologie", digital: "technologie", science: "wissenschaft", wissenschaft: "wissenschaft", wissen: "wissenschaft",
  health: "gesundheit", gesundheit: "gesundheit", environment: "umwelt", climate: "umwelt", klima: "umwelt", sport: "sport",
  sports: "sport", entertainment: "unterhaltung", kultur: "unterhaltung", culture: "unterhaltung", panorama: "gesellschaft",
  chronik: "gesellschaft", society: "gesellschaft",
};

const CUES: Record<string, RegExp[]> = {
  opinion: [/\bkommentar\b/, /\bmeinung\b/, /\bopinion\b/, /\bcommentary\b/, /\bkolumne\b/, /\bcolumn\b/, /\bleitartikel\b/,
    /\beditorial\b/, /\bgastbeitrag\b/, /\bop-ed\b/, /\banalysis\b:/, /\banalyse\b:/],
  hedged: [/\breportedly\b/, /\ballegedly\b/, /\bunconfirmed\b/, /\bunbestatigt/, /\bangeblich\b/, /\bsoll(en)? .{0,40}(haben|sein|worden)\b/,
    /\bmoglicherweise\b/, /\bgeruchte?\b/, /\brumou?rs?\b/, /\bclaims? (that|to)\b/, /\bnot (yet )?(been )?(independently )?verified\b/,
    /\bnicht unabhangig (uberpruf|bestatig)/],
  retraction: [/\bretract(ed|ion)\b/, /\bcorrection:/, /\bkorrektur:/, /\bzuruckgezogen\b/, /\bwe (have )?(removed|withdrawn)\b/,
    /\ban earlier version of this (story|article) (incorrectly|wrongly)/, /\bin einer fruheren version .{0,40}(falsch|irrtumlich)/, /\bberichtigung\b/],
  debunk: [/\bfact[- ]?check/, /\bfaktencheck/, /\b(is|was) (false|fake|untrue)\b/, /\bdebunk/, /\bfalschmeldung\b/, /\bfake news\b/,
    /\bentbehrt jeder grundlage\b/, /\bdementi(ert)?\b/, /\bdenied (the )?(report|claim)s?\b/, /\bwiderleg/],
  official: [/\b(ministry|ministerium|behorde|authority|agency|polizei|police) (said|says|erklarte|teilte|bestatigte|confirmed)/,
    /\b(confirmed|bestatigte?) (by )?(the )?(government|regierung|ministry|ministerium|police|polizei)/, /\bofficial(ly)? confirmed\b/,
    /\bamtlich\b/, /\boffiziell bestatigt\b/, /\bin a statement\b/, /\bin einer (stellungnahme|aussendung|mitteilung)\b/,
    /\bofficials (said|say|confirmed)\b/, /\bauthorities (said|say|confirmed)\b/, /\bdie behorde bestatigte\b/],
};

export type Cues = Record<"opinion" | "hedged" | "retraction" | "debunk" | "official", boolean>;

export function cues(text: string): Cues {
  const hay = fold(text);
  const out = {} as Cues;
  for (const k of Object.keys(CUES) as (keyof Cues)[]) out[k] = CUES[k].some((r) => r.test(hay));
  return out;
}

export function classify(text: string, feedCategories: string[] = [], max = 3): string[] {
  const hay = ` ${fold(text)} `;
  const scores: Record<string, number> = {};
  for (const [slug, ws] of Object.entries(CATEGORY_LEXICON)) {
    let hits = 0;
    for (const w of ws) if (hay.includes(w)) hits++;
    if (hits) scores[slug] = hits;
  }
  for (const fc of feedCategories) {
    const h = FEED_HINTS[fold(fc).trim()];
    if (h) scores[h] = (scores[h] ?? 0) + 2;
  }
  return Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, max).map(([s]) => s);
}
