// Claim extraction + contradiction detection. Contradictions are only raised
// between independent groups, on each group's LATEST value (rising tolls are
// developments, not disputes).
import { parseNumber } from "./entities.ts";
import { fold } from "./text.ts";

export interface Claim { kind: string; value: number; type: "fact" | "attributed" | "official" | "hedged" | "opinion"; evidence: string }

const NUM = String.raw`(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)`;
const P: Record<string, string[]> = {
  dead: [
    String.raw`${NUM} (?:people |persons |civilians |menschen |personen )?(?:were |have been |wurden |sind )?(?:killed|dead|died|tote\b|todesopfer|getotet|ums leben)`,
    String.raw`(?:death toll|todesopfer|zahl der toten)[^.\d]{0,60}?(?:to|at|auf|bei|of|von) ${NUM}`,
    String.raw`(?:killing|killed|totet(?:e)?) (?:at least |mindestens )?${NUM}`,
    String.raw`(?:at least|mindestens) ${NUM} (?:people |menschen )?(?:dead|killed|tote|died|starben)`,
  ],
  injured: [
    String.raw`${NUM} (?:people |menschen |personen )?(?:were |wurden )?(?:injured|wounded|hurt|verletzt|verletzte)`,
    String.raw`(?:injuring|verletzte|verletzten) (?:at least |mindestens )?${NUM}`,
  ],
  missing: [String.raw`${NUM} (?:people |menschen |personen )?(?:missing|vermisst|werden vermisst)`],
  arrested: [String.raw`${NUM} (?:people |personen |menschen |suspects |verdachtige )?(?:were |wurden )?(?:arrested|detained|festgenommen)`],
  evacuated: [String.raw`${NUM} (?:people |menschen |residents |bewohner )?(?:were |wurden |must be |mussten )?(?:evacuated|evakuiert)`],
  magnitude: [String.raw`(?:magnitude|starke|starke von|magnitude of)[- ]?(?:of )?${NUM}`, String.raw`${NUM}[- ]magnitude`, String.raw`(?:erdbeben|beben) (?:der )?(?:starke )?${NUM}`],
};
const RE = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.map((s) => new RegExp(s, "g"))])) as Record<string, RegExp[]>;
const ATTRIB = /\b(said|says|told|according to|claims?|sagte|sagt|erklarte|laut|teilte .{0,20} mit|bestatigte)\b/;
const OFFICIAL = /\b(ministry|ministerium|police|polizei|authorit\w*|behorde|government|regierung|civil protection|katastrophenschutz|officials?|meteorological agency|geological survey|usgs|fire department|feuerwehr)\b/;
const HEDGE = /\b(reportedly|allegedly|unconfirmed|unbestatigt|angeblich|moglicherweise|soll|sollen)\b/;

export const UNIT_LABELS: Record<string, string> = { dead: "Todesopfer", injured: "Verletzte", missing: "Vermisste", arrested: "Festnahmen", evacuated: "Evakuierte", magnitude: "Magnitude" };

export function extractClaims(text: string, isOpinion = false): Claim[] {
  const hay = fold(text);
  const best: Record<string, Claim> = {};
  for (const sent of hay.split(/(?<=[.!?;])\s+/)) {
    const attributed = ATTRIB.test(sent);
    const official = attributed && OFFICIAL.test(sent);
    const hedged = HEDGE.test(sent);
    for (const [kind, regs] of Object.entries(RE)) {
      for (const r of regs) {
        r.lastIndex = 0;
        for (const m of sent.matchAll(r)) {
          const v = parseNumber(m[1]);
          if (v === null || (kind === "magnitude" && v > 10) || (kind !== "magnitude" && !Number.isInteger(v))) continue;
          const type: Claim["type"] = isOpinion ? "opinion" : hedged ? "hedged" : official ? "official" : attributed ? "attributed" : "fact";
          const c: Claim = { kind, value: v, type, evidence: sent.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + m[0].length + 40).trim() };
          if (!best[kind] || v > best[kind].value) best[kind] = c;
        }
      }
    }
  }
  return Object.values(best);
}

function material(kind: string, a: number, b: number): boolean {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (kind === "magnitude") return hi - lo >= 0.5;
  if (hi < 3) return hi !== lo && hi - lo >= 2;
  return hi - lo >= 3 && hi / Math.max(lo, 1) >= 1.5;
}

export const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export interface Contradiction { kind: string; label: string; values: Record<string, unknown>; description: string }

export function findContradictions(groupClaims: Record<string, [number, Claim][]>, groupFlags?: Record<string, { debunk: boolean }>): Contradiction[] {
  const out: Contradiction[] = [];
  const latest: Record<string, Record<string, [number, Claim]>> = {};
  for (const [g, items] of Object.entries(groupClaims)) {
    for (const [ts, c] of items) {
      if (c.type === "opinion") continue;
      const cur = (latest[g] ??= {})[c.kind];
      if (!cur || ts > cur[0]) latest[g][c.kind] = [ts, c];
    }
  }
  const kinds = [...new Set(Object.values(latest).flatMap((p) => Object.keys(p)))].sort();
  for (const kind of kinds) {
    const firm = Object.entries(latest).filter(([, p]) => p[kind] && p[kind][1].type !== "hedged").map(([g, p]) => [g, p[kind][1].value] as const);
    outer: for (let i = 0; i < firm.length; i++) {
      for (let j = i + 1; j < firm.length; j++) {
        if (material(kind, firm[i][1], firm[j][1])) {
          const label = UNIT_LABELS[kind] ?? kind;
          out.push({ kind, label, values: { [firm[i][0]]: firm[i][1], [firm[j][0]]: firm[j][1] },
            description: `${label}: unabhängige Quellen nennen ${fmt(firm[i][1])} bzw. ${fmt(firm[j][1])}.` });
          break outer;
        }
      }
    }
  }
  if (groupFlags) {
    const deb = Object.keys(groupFlags).filter((g) => groupFlags[g].debunk);
    const aff = Object.keys(groupFlags).filter((g) => !groupFlags[g].debunk);
    if (deb.length && aff.length) {
      out.push({ kind: "denial", label: "Dementi / Widerlegung", values: { debunk_groups: deb, report_groups: aff },
        description: `${deb.length} Quellengruppe(n) dementieren oder widerlegen die Meldung, ${aff.length} berichten sie.` });
    }
  }
  return out;
}

const DAY = 86_400_000;
export function staleRecirculation(ts: number[], now: number): boolean {
  if (ts.length < 2) return false;
  const s = [...ts].sort((a, b) => a - b);
  return now - s[s.length - 1] < DAY && s[s.length - 1] - s[0] > 3 * DAY;
}
