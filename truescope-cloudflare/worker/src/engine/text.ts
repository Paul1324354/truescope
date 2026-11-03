// Tokenisation and similarity (German + English, no dependencies, low CPU).

export const STOPWORDS = new Set(`
a an and are as at be been but by for from has have he her his i if in into is it its
of on or our she so that the their them they this to was were will with you your we not
no after over up out about more than also new says said say who what when where why how
which while would could should can may might just now one two three last first year years
day days week report reports news live update updates video watch here there all
der die das und ist im in den des dem ein eine einer eines einem zu zur zum mit von auf
fur als auch an bei bis durch es sich sie er wir ihr nicht noch nach nur oder so uber um
vor wie wird werden wurde wurden sind war hat haben hatte aus am einen kann soll mehr neue
neuen neuer heute jahr jahre jahren laut sagt sagte gegen seit dass aber schon dieser diese
dieses ab man ihre ihren seine seinen sein unter zwei drei erste ersten ticker liveticker bilder
`.split(/\s+/).filter(Boolean));

const TOKEN_RE = /[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu;
const SUFFIXES = ["ungen", "ung", "ern", "en", "er", "es", "e", "s", "n"];

export function fold(text: string): string {
  return (text || "").toLowerCase().replace(/ß/g, "ss").normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export function stem(t: string): string {
  if (/^\d+$/.test(t) || t.length <= 4) return t;
  for (const s of SUFFIXES) if (t.endsWith(s) && t.length - s.length >= 4) return t.slice(0, -s.length);
  return t;
}

export function words(text: string): string[] {
  return fold(text).match(TOKEN_RE) ?? [];
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const w of words(text)) if (w.length >= 2 && !STOPWORDS.has(w)) out.push(stem(w));
  return out;
}

export function shingles(text: string, k = 4): Set<string> {
  const w = words(text);
  if (w.length < k) return new Set(w.length ? [w.join(" ")] : []);
  const s = new Set<string>();
  for (let i = 0; i <= w.length - k; i++) s.add(w.slice(i, i + k).join(" "));
  return s;
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export async function contentHash(title: string, summary: string): Promise<string> {
  const data = new TextEncoder().encode(words(`${title} ${summary}`).join(" "));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type Vec = Record<string, number>;

/** Sublinear TF vector; title tokens weighted double. Normalised to unit length.
 *  (No global document-frequency table: keeps CPU and D1 writes minimal; the
 *  stopword lists remove most high-frequency noise.) */
export function vector(titleTokens: string[], bodyTokens: string[]): Vec {
  const tf: Record<string, number> = {};
  for (const t of titleTokens) tf[t] = (tf[t] ?? 0) + 2;
  for (const t of bodyTokens) tf[t] = (tf[t] ?? 0) + 1;
  let norm = 0;
  for (const k in tf) { tf[k] = 1 + Math.log(tf[k]); norm += tf[k] * tf[k]; }
  norm = Math.sqrt(norm) || 1;
  for (const k in tf) tf[k] = tf[k] / norm;
  return tf;
}

export function cosine(a: Vec, b: Vec): number {
  let s = 0;
  const [x, y] = Object.keys(a).length < Object.keys(b).length ? [a, b] : [b, a];
  for (const k in x) if (k in y) s += x[k] * y[k];
  return s;
}

export function centroid(vectors: Vec[], topK = 25): Vec {
  const acc: Record<string, number> = {};
  for (const v of vectors) for (const k in v) acc[k] = (acc[k] ?? 0) + v[k];
  const top = Object.entries(acc).sort((p, q) => q[1] - p[1]).slice(0, topK);
  const norm = Math.sqrt(top.reduce((s, [, w]) => s + w * w, 0)) || 1;
  const out: Vec = {};
  for (const [k, w] of top) out[k] = Math.round((w / norm) * 1000) / 1000;
  return out;
}

export function sentences(text: string): string[] {
  return (text || "").split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9"„])/).map((s) => s.trim()).filter((s) => s.length > 20);
}
