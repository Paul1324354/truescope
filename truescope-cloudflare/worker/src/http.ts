export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store",
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...SEC_HEADERS, ...headers } });
}

export async function body<T = Record<string, any>>(req: Request, maxBytes = 20_000): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "Anfrage zu groß");
  try { return (text ? JSON.parse(text) : {}) as T; } catch { throw new HttpError(400, "Ungültiges JSON"); }
}

export const str = (v: unknown, max: number, min = 0): string => {
  if (typeof v !== "string") throw new HttpError(422, "Ungültige Eingabe");
  const s = v.trim();
  if (s.length < min || s.length > max) throw new HttpError(422, `Länge muss zwischen ${min} und ${max} Zeichen liegen`);
  return s;
};
export const optStr = (v: unknown, max: number) => (v === undefined || v === null || v === "" ? null : str(v, max));
export const num = (v: unknown, lo: number, hi: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new HttpError(422, `Zahl zwischen ${lo} und ${hi} erwartet`);
  return n;
};
export const iso = (t: number | null | undefined) => (t ? new Date(t).toISOString() : null);
