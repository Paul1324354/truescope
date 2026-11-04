// Liest die Tagesseiten "Portal:Current events" der englischen Wikipedia.
// Lizenz der Texte: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
// Nutzung erlaubt, auch kommerziell, mit Namensnennung und Weitergabe unter gleicher Lizenz.

export const UA = "TrueScope/1.0 (https://truescope-49p.pages.dev; nicht kommerzielles Nachrichtenprojekt)";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Wikipedia-Rubrik -> Ressorts der App
const SECTION_CATS = [
  [/armed conflict|attack/i, ["politik"]],
  [/international relations/i, ["politik"]],
  [/politics|election/i, ["politik"]],
  [/business|econom/i, ["wirtschaft"]],
  [/sport/i, ["sport"]],
  [/art|culture/i, ["kultur"]],
  [/science|technolog/i, ["wissenschaft", "technik"]],
  [/health/i, ["gesundheit"]],
  [/environment|climate/i, ["umwelt"]],
  [/disaster|accident/i, ["chronik"]],
  [/law|crime/i, ["chronik"]],
];

// Ländererkennung: Wikipedia-Linkziele und Wörter im Text
export const COUNTRY_WORDS = {
  AT: ["Austria", "Austrian", "Vienna"], DE: ["Germany", "German", "Berlin", "Bundestag"],
  CH: ["Switzerland", "Swiss", "Bern"], FR: ["France", "French", "Paris"], IT: ["Italy", "Italian", "Rome"],
  ES: ["Spain", "Spanish", "Madrid"], GB: ["United Kingdom", "British", "UK", "England", "English", "Scotland", "Scottish", "Wales", "Welsh", "London"],
  US: ["United States", "U.S.", "American", "Washington, D.C."], NL: ["Netherlands", "Dutch", "Amsterdam"],
  BE: ["Belgium", "Belgian", "Brussels"], LU: ["Luxembourg"], PL: ["Poland", "Polish", "Warsaw"],
  CZ: ["Czech Republic", "Czechia", "Czech", "Prague"], SK: ["Slovakia", "Slovak", "Bratislava"],
  HU: ["Hungary", "Hungarian", "Budapest"], SI: ["Slovenia", "Slovenian", "Ljubljana"], HR: ["Croatia", "Croatian", "Zagreb"],
  RS: ["Serbia", "Serbian", "Belgrade"], BA: ["Bosnia and Herzegovina", "Bosnian", "Sarajevo"], RO: ["Romania", "Romanian", "Bucharest"],
  BG: ["Bulgaria", "Bulgarian", "Sofia"], GR: ["Greece", "Greek", "Athens"], TR: ["Turkey", "Türkiye", "Turkish", "Ankara", "Istanbul"],
  PT: ["Portugal", "Portuguese", "Lisbon"], IE: ["Republic of Ireland", "Ireland", "Irish", "Dublin"],
  DK: ["Denmark", "Danish", "Copenhagen"], SE: ["Sweden", "Swedish", "Stockholm"], NO: ["Norway", "Norwegian", "Oslo"],
  FI: ["Finland", "Finnish", "Helsinki"], EE: ["Estonia", "Estonian", "Tallinn"], LV: ["Latvia", "Latvian", "Riga"],
  LT: ["Lithuania", "Lithuanian", "Vilnius"], UA: ["Ukraine", "Ukrainian", "Kyiv"], RU: ["Russia", "Russian", "Moscow", "Kremlin"],
  IL: ["Israel", "Israeli", "Jerusalem", "Tel Aviv"], CA: ["Canada", "Canadian", "Ottawa"], MX: ["Mexico", "Mexican"],
  BR: ["Brazil", "Brazilian", "Brasília"], AR: ["Argentina", "Argentine", "Buenos Aires"], CN: ["China", "Chinese", "Beijing"],
  JP: ["Japan", "Japanese", "Tokyo"], KR: ["South Korea", "South Korean", "Seoul"], IN: ["India", "Indian", "New Delhi"],
  AU: ["Australia", "Australian", "Canberra"], ZA: ["South Africa", "South African", "Pretoria", "Johannesburg", "Cape Town"],
  EG: ["Egypt", "Egyptian", "Cairo"], NG: ["Nigeria", "Nigerian", "Abuja", "Lagos"], IR: ["Iran", "Iranian", "Tehran"],
};
const COUNTRY_RES = Object.entries(COUNTRY_WORDS).map(([code, words]) => [
  code,
  new RegExp("(?:^|[^A-Za-zÀ-ÿ])(?:" + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?=$|[^A-Za-zÀ-ÿ])"),
]);

export function pageTitle(day) {
  const [y, m, d] = day.split("-").map(Number);
  return `Portal:Current events/${y} ${MONTHS[m - 1]} ${d}`;
}
export function pageUrl(day) {
  return "https://en.wikipedia.org/wiki/" + encodeURIComponent(pageTitle(day).replace(/ /g, "_")).replace(/%2F/g, "/").replace(/%3A/g, ":");
}

// Wikitext -> lesbarer Text, Linkziele und Quellenlinks
function clean(raw) {
  const targets = [];
  const sources = [];
  let t = raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/g, "").replace(/<ref[\s\S]*?<\/ref>/g, "");
  // Vorlagen entfernen (auch verschachtelt)
  for (let i = 0; i < 5 && /\{\{[^{}]*\}\}/.test(t); i++) t = t.replace(/\{\{[^{}]*\}\}/g, "");
  t = t.replace(/\[(https?:\/\/[^\s\]]+)\s*([^\]]*)\]/g, (_, url, label) => {
    sources.push({ url, label: label.replace(/'{2,}/g, "").replace(/[()]/g, "").trim() });
    return "";
  });
  t = t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]([a-z]*)/g, (_, target, text, suffix) => { targets.push(target); return text + suffix; });
  t = t.replace(/\[\[([^\]]+)\]\]([a-z]*)/g, (_, target, suffix) => { targets.push(target); return target + suffix; });
  t = t.replace(/'{2,}/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
  return { text: t, targets, sources };
}

export function detectCountries(...texts) {
  const s = texts.join(" | ");
  return COUNTRY_RES.filter(([, re]) => re.test(s)).map(([code]) => code);
}

// Zerlegt eine Tagesseite in einzelne Ereignisse
export function parseDay(wikitext, day) {
  const body = wikitext.split("<!-- All news items below this line -->").pop().split("<!-- All news items above this line -->")[0];
  const events = [];
  let section = "";
  let cats = [];
  const stack = []; // Elternpunkte nach Tiefe
  const lines = body.split("\n");
  lines.forEach((line, idx) => {
    const head = /^\s*(?:'''(.+?)'''|;\s*(.+))\s*$/.exec(line);
    if (head) {
      section = (head[1] || head[2]).trim();
      cats = (SECTION_CATS.find(([re]) => re.test(section)) || [null, []])[1];
      stack.length = 0;
      return;
    }
    const bullet = /^(\*+)\s*(.*)$/.exec(line);
    if (!bullet || !cats.length) return;
    const depth = bullet[1].length;
    const c = clean(bullet[2]);
    stack.length = depth - 1;
    stack[depth - 1] = c;
    const next = lines[idx + 1] || "";
    const hasChild = (/^(\*+)/.exec(next)?.[1].length || 0) > depth;
    // Ein Ereignis ist ein Punkt mit eigenem Satz (Quelle angegeben) oder ohne Unterpunkte
    if (hasChild && !c.sources.length) return;
    if (c.text.length < 25) return;
    const context = stack.slice(0, depth - 1).filter(Boolean).map((p) => p.text).join(" › ");
    const ctxTargets = stack.slice(0, depth - 1).filter(Boolean).flatMap((p) => p.targets);
    events.push({
      day,
      ord: events.length,
      section,
      cats,
      context,
      text: c.text,
      countries: detectCountries(c.text, context, [...c.targets, ...ctxTargets].join(" | ")),
      source: c.sources[0] || null,
    });
  });
  return events;
}

export async function fetchDay(day) {
  const url = "https://en.wikipedia.org/w/index.php?action=raw&title=" + encodeURIComponent(pageTitle(day));
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Wikipedia antwortet mit ${res.status}`);
  return parseDay(await res.text(), day);
}
