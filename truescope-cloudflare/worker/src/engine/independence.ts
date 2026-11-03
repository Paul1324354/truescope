// Source independence: wire credits, shared ownership and syndicated (near-identical)
// text merge articles into one group (union-find, transitive). Ten sites republishing
// one Reuters dispatch are ONE confirmation.
import { fold, jaccard, shingles } from "./text.ts";

const WIRE: Record<string, RegExp[]> = {
  reuters: [/\(Reuters\)/, /\bReuters\s*[-–—:]/, /\b(according to|told|via|laut|berichtet(e)?) Reuters\b/, /\bReuters (reported|reports|berichtet)/, /\bThomson Reuters\b/],
  ap: [/\(AP\)/, /\bAP\s*[-–—]/, /\bAssociated Press\b/, /\b(according to|told|laut) (the )?AP\b/],
  afp: [/\(AFP\)/, /\bAFP\s*[-–—/:]/, /\bAgence France[- ]Presse\b/, /\blaut AFP\b/],
  dpa: [/\(dpa\)/, /\bdpa\s*[-–—/:]/, /\bdpa-AFX\b/, /\b(laut|meldet(e)?|berichtet(e)?) (die )?(Deutsche Presse-Agentur|dpa)\b/, /\bDeutsche Presse-Agentur\b/, /\bQuelle: dpa\b/],
  apa: [/\(APA\)/, /\bAPA\s*[-–—/:]/, /\bAustria Presse Agentur\b/, /\b(laut|meldet(e)?) (der )?APA\b/, /\bQuelle: APA\b/, /\bAPA\//],
  kna: [/\(KNA\)/, /\bKNA\s*[-–—/]/],
  epd: [/\(epd\)/, /\bepd\s*[-–—/]/],
  pa: [/\(PA\)/, /\bPA Media\b/, /\bPress Association\b/],
  efe: [/\(EFE\)/, /\bEFE\s*[-–—]/],
  ansa: [/\(ANSA\)/, /\bANSA\s*[-–—]/],
  kyodo: [/\bKyodo\b/],
  xinhua: [/\bXinhua\b/],
  tass: [/\bTASS\b/, /\bTass\b/],
  bloomberg: [/\(Bloomberg\)/, /\bBloomberg News\b/],
};

export const SYNDICATION_THRESHOLD = 0.55;

export function detectWireOrigin(text: string): string | null {
  let best: [number, string] | null = null;
  for (const [key, regs] of Object.entries(WIRE)) {
    for (const r of regs) {
      const m = r.exec(text || "");
      if (m && (!best || m.index < best[0])) best = [m.index, key];
    }
  }
  return best ? best[1] : null;
}

export interface GroupItem {
  article_id: number;
  source_id: number;
  source_name: string;
  owner_group?: string | null;
  wire_key?: string | null;   // the source itself is this agency
  wire_origin?: string | null; // the article credits this agency
  text: string;
}

export function groupArticles(items: GroupItem[]): Record<string, number[]> {
  if (!items.length) return {};
  const parent = new Map<number, number>(items.map((i) => [i.article_id, i.article_id]));
  const find = (x: number): number => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  };
  const anchor = new Map<string, number>();
  const link = (key: string, id: number) => (anchor.has(key) ? union(anchor.get(key)!, id) : anchor.set(key, id));
  const sh = new Map<number, Set<string>>();
  for (const it of items) {
    const origin = it.wire_origin || it.wire_key;
    if (origin) link(`wire:${origin}`, it.article_id);
    if (it.owner_group) link(`owner:${fold(it.owner_group)}`, it.article_id);
    link(`source:${it.source_id}`, it.article_id);
    sh.set(it.article_id, shingles(it.text, 4));
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.source_id !== b.source_id && jaccard(sh.get(a.article_id)!, sh.get(b.article_id)!) >= SYNDICATION_THRESHOLD) union(a.article_id, b.article_id);
    }
  }
  const groups = new Map<number, GroupItem[]>();
  for (const it of items) {
    const r = find(it.article_id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(it);
  }
  const out: Record<string, number[]> = {};
  for (const members of groups.values()) {
    const origins = [...new Set(members.map((m) => m.wire_origin || m.wire_key).filter(Boolean) as string[])].sort();
    const owners = [...new Set(members.map((m) => m.owner_group && fold(m.owner_group)).filter(Boolean) as string[])].sort();
    let key = origins.length ? `wire:${origins.join("+")}` : owners.length ? `owner:${owners.join("+")}` :
      `source:${[...new Set(members.map((m) => m.source_name))].sort().join("+")}`;
    while (key in out) key += "'";
    out[key] = members.map((m) => m.article_id).sort((a, b) => a - b);
  }
  return out;
}
