// Status, confidence score and reasoning — deterministic, explainable rules.
//  * count INDEPENDENT credible groups, not websites
//  * absence of counter-proof never makes something true; thin data never makes it FALSE
//  * contradictions block VERIFIED; very young events are capped
//  * no score when data is too thin; source weights never use political orientation
import { UNIT_LABELS, findContradictions, fmt, staleRecirculation, type Claim } from "./claims.ts";
import { groupArticles } from "./independence.ts";
import type { Analysis, ArticleInput, Assessment, Factor, Status } from "./types.ts";

const CREDIBLE = 0.6;
const H = 3_600_000;
const CAP: Record<Status, number> = { VERIFIED: 100, STRONGLY_CORROBORATED: 85, DEVELOPING: 60, DISPUTED: 50, UNCONFIRMED: 40, FALSE: 15, RETRACTED: 15 };
export const STATUS_DE: Record<Status, string> = { VERIFIED: "Verifiziert", STRONGLY_CORROBORATED: "Stark gestützt", DEVELOPING: "In Entwicklung",
  DISPUTED: "Umstritten", UNCONFIRMED: "Unbestätigt", FALSE: "Widerlegt", RETRACTED: "Zurückgezogen" };

type Item = [ArticleInput, Analysis];

function groupCred(members: Item[]): number {
  let best = 0;
  for (const [a] of members) {
    let c = a.source.base_reliability - Math.min(a.source.corrections_90d, 10) * 0.01;
    if (a.source.source_type === "press_release") c = Math.min(c, 0.5);
    if (a.source.source_type === "aggregator") c = Math.min(c, 0.4);
    best = Math.max(best, c);
  }
  return Math.max(0, Math.min(1, best));
}

const ageText = (ms: number) => {
  const m = Math.floor(ms / 60000);
  return m < 60 ? `${m} Min.` : m < 2880 ? `${Math.floor(m / 60)} Std.` : `${Math.floor(m / 1440)} Tagen`;
};

export function assess(items: Item[], now = Date.now(), categories: string[] = []): Assessment {
  if (!items.length) return { status: "UNCONFIRMED", score: null, explanation: "Keine Berichte vorhanden.", factors: [], groups: {}, credible: 0, contradictions: [], confirmed: [], unclear: [], breaking: false };
  const byId = new Map(items.map((it) => [it[0].id, it]));
  const groups = groupArticles(items.map(([a, an]) => ({ article_id: a.id, source_id: a.source.id, source_name: a.source.name,
    owner_group: a.source.owner_group, wire_key: a.source.wire_key, wire_origin: an.wire, text: `${a.title} ${a.summary}`.slice(0, 400) })));

  const info: Record<string, { cred: number; opinionOnly: boolean; hedged: boolean; debunk: boolean; retraction: boolean; official: boolean }> = {};
  for (const [k, ids] of Object.entries(groups)) {
    const m = ids.map((i) => byId.get(i)!);
    info[k] = { cred: groupCred(m), opinionOnly: m.every(([, an]) => an.opinion), hedged: m.every(([, an]) => an.hedged),
      debunk: m.some(([, an]) => an.debunk), retraction: m.some(([, an]) => an.retraction),
      official: m.some(([a, an]) => a.source.source_type === "official" || an.official) };
  }
  const credible = Object.keys(info).filter((g) => info[g].cred >= CREDIBLE && !info[g].opinionOnly);
  const firm = credible.filter((g) => !info[g].hedged);
  const nCred = credible.length, nFirm = firm.length;

  const gClaims: Record<string, [number, Claim][]> = {};
  for (const g of credible) gClaims[g] = groups[g].flatMap((i) => byId.get(i)![1].claims.map((c) => [byId.get(i)![0].published_at, c] as [number, Claim]));
  const contradictions = findContradictions(gClaims, Object.fromEntries(credible.map((g) => [g, { debunk: info[g].debunk }])));
  const material = contradictions.filter((c) => c.kind !== "denial");
  const denial = contradictions.find((c) => c.kind === "denial");
  const debunkers = credible.filter((g) => info[g].debunk);
  const retractors = credible.filter((g) => info[g].retraction);
  const official = credible.some((g) => info[g].official);
  const ts = items.map(([a]) => a.published_at);
  const age = now - Math.min(...ts);
  const stale = staleRecirculation(ts, now);
  const hedgedShare = items.filter(([, an]) => an.hedged).length / items.length;
  const injection = items.some(([, an]) => an.injection.length > 0);

  const reasons: string[] = [];
  let status: Status;
  if (retractors.length && (nCred <= 2 || retractors.length * 2 >= nCred)) {
    status = "RETRACTED";
    reasons.push(`${retractors.length} glaubwürdige Quellengruppe(n) haben die Meldung zurückgezogen oder wesentlich korrigiert.`);
  } else if (debunkers.length >= 2 && debunkers.length >= nCred - debunkers.length) {
    status = "FALSE";
    reasons.push(`${debunkers.length} unabhängige, glaubwürdige Quellengruppen widerlegen die Behauptung mit eigener Prüfung.`);
  } else if (material.length || denial) {
    status = "DISPUTED";
    for (const c of material) reasons.push(c.description);
    if (denial) reasons.push(denial.description);
  } else if (nFirm >= 3 && (official || nFirm >= 4) && hedgedShare < 0.5) {
    status = "VERIFIED";
    reasons.push(`${nFirm} voneinander unabhängige, glaubwürdige Quellengruppen berichten übereinstimmend${official ? ", eine offizielle Bestätigung liegt vor." : "."}`);
  } else if (nFirm >= 2) {
    status = "STRONGLY_CORROBORATED";
    reasons.push(`${nFirm} unabhängige, glaubwürdige Quellengruppen stützen die Meldung; ` + (nFirm < 4
      ? "für eine Verifizierung fehlt noch eine offizielle Bestätigung oder eine weitere unabhängige Quelle."
      : "die Berichte sind teils noch vorläufig formuliert."));
  } else if (age < 24 * H && nCred >= 1) {
    status = "DEVELOPING";
    reasons.push("Aktuelles Ereignis: bisher berichtet nur eine unabhängige Quellengruppe oder die Angaben sind vorläufig.");
  } else {
    status = "UNCONFIRMED";
    reasons.push("Bisher keine ausreichende unabhängige Bestätigung durch glaubwürdige Quellen. Das bedeutet nicht, dass die Meldung falsch ist.");
  }
  if (status === "VERIFIED" && age < 2 * H) {
    status = "STRONGLY_CORROBORATED";
    reasons.push("Das Ereignis ist jünger als zwei Stunden; die Einstufung VERIFIED erfolgt frühestens nach einer Stabilisierungsphase.");
  }
  if ((status === "VERIFIED" || status === "STRONGLY_CORROBORATED") && stale) {
    status = "DEVELOPING";
    reasons.push("Hinweis auf erneut verbreitete ältere Meldungen: Berichte liegen mehr als drei Tage auseinander.");
  }

  const f: Factor[] = [];
  const add = (key: string, label: string, value: number, max: number, detail: string) => f.push({ key, label, value: Math.round(value * 10) / 10, max, detail });
  const cv = credible.map((g) => info[g].cred).sort((a, b) => b - a).slice(0, 5);
  const q = cv.length ? cv.reduce((s, x) => s + x, 0) / cv.length : 0;
  add("quality", "Qualität der Quellen", 25 * q, 25, `Durchschnittliche Quellenbewertung der stärksten Gruppen: ${q.toFixed(2)}`);
  add("independence", "Unabhängigkeit", (25 * Math.min(nFirm, 5)) / 5, 25, `${nFirm} unabhängige, nicht vorläufige Gruppe(n) bei ${items.length} Bericht(en) in ${Object.keys(groups).length} Gruppe(n)`);
  const agree = Math.max(0, 20 - 10 * material.length - (denial ? 10 : 0));
  add("agreement", "Übereinstimmung der Kernaussagen", agree, 20, agree === 20 ? "Keine Widersprüche erkannt" : `${material.length + (denial ? 1 : 0)} Widerspruch/Widersprüche`);
  add("official", "Offizielle Bestätigung", official ? 10 : 0, 10, official ? "Offizielle Quelle oder Behördenangabe vorhanden" : "Keine offizielle Bestätigung gefunden");
  const specific = items.filter(([, an]) => an.claims.length || an.entities.length >= 2).length / items.length;
  add("evidence", "Überprüfbare Angaben", 10 * specific, 10, `${Math.round(specific * 100)} % der Berichte enthalten konkrete, prüfbare Angaben`);
  add("stability", "Stabilität über Zeit", age >= 6 * H ? 5 : age >= 2 * H ? 2.5 : 0, 5, `Erste Meldung vor ${ageText(age)}`);
  const corr = items.reduce((s, [a]) => s + a.source.corrections_90d, 0);
  add("corrections", "Korrekturhistorie der Quellen", Math.max(0, 5 - corr * 0.5), 5, `${corr} dokumentierte Korrektur(en) der beteiligten Quellen in 90 Tagen`);
  if (hedgedShare >= 0.3) add("hedging", "Vorläufige Formulierungen", -10 * hedgedShare, 0, `${Math.round(hedgedShare * 100)} % der Berichte sind ausdrücklich unbestätigt/vorläufig formuliert`);
  if (stale) add("stale", "Mögliche Wiederverbreitung", -10, 0, "Alte und neue Berichte vermischt");
  if (injection) add("manipulation", "Auffällige Inhalte", -5, 0, "Mindestens ein Bericht enthält Text, der wie eine Manipulationsanweisung an KI-Systeme aussieht");

  let score: number | null;
  if (nCred < 2 && status !== "FALSE" && status !== "RETRACTED") {
    score = null;
    reasons.push("Für einen belastbaren Confidence Score ist die Datenlage noch zu dünn; TrueScope gibt deshalb keinen Wert an.");
  } else {
    score = Math.round(Math.max(0, Math.min(f.reduce((s, x) => s + x.value, 0), CAP[status])));
  }

  const confirmed: string[] = [], unclear: string[] = [];
  const agreed: Record<string, Map<number, Set<string>>> = {};
  for (const [g, list] of Object.entries(gClaims)) for (const [, c] of list) {
    if (c.type === "opinion" || c.type === "hedged") continue;
    const m = (agreed[c.kind] ??= new Map());
    if (!m.has(c.value)) m.set(c.value, new Set());
    m.get(c.value)!.add(g);
  }
  if (nFirm >= 2) confirmed.push(`Das Ereignis selbst wird von ${nFirm} unabhängigen Quellengruppen berichtet.`);
  for (const [kind, m] of Object.entries(agreed)) for (const [v, gs] of m) {
    const label = UNIT_LABELS[kind] ?? kind;
    if (gs.size >= 2) confirmed.push(`${label}: ${fmt(v)} (übereinstimmend in ${gs.size} unabhängigen Gruppen)`);
    else if (!material.some((c) => c.kind === kind)) unclear.push(`${label}: ${fmt(v)} – bisher nur von einer Quellengruppe genannt`);
  }
  if (hedgedShare > 0) unclear.push("Einzelne Angaben sind in den Quellen ausdrücklich als unbestätigt gekennzeichnet.");
  if (!official) unclear.push("Eine offizielle Bestätigung (Behörde, Regierung, Institution) liegt bisher nicht vor.");
  if (stale) unclear.push("Es ist unklar, ob es sich um ein neues Ereignis oder eine erneut verbreitete ältere Meldung handelt.");
  for (const c of material) unclear.push(c.description);

  const syn = items.length - Object.keys(groups).length;
  if (syn > 0) reasons.push(`${syn} Bericht(e) beruhen auf derselben Ursprungsquelle (z. B. Agenturmeldung oder gleicher Medienkonzern) und zählen nicht als zusätzliche Bestätigung.`);
  const hard = categories.some((c) => ["politik", "konflikte", "umwelt", "wirtschaft", "kriminalitaet", "gesundheit"].includes(c));
  const breaking = age < 3 * H && (items.length >= 4 || nCred >= 3) && hard && status !== "FALSE" && status !== "RETRACTED";
  const explanation = `Status: ${STATUS_DE[status]}. ${reasons.join(" ")} Der Score ist eine Orientierungshilfe und keine Garantie für die Richtigkeit.`;
  return { status, score, explanation, factors: f, groups, credible: nCred, contradictions, confirmed, unclear, breaking };
}
