// Gemeinsame Helfer für die Bewertungs-API

export const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export const bad = (msg, status = 400) => json({ error: msg }, status);

// Die Browser-ID identifiziert einen Besucher ohne Login (zufällig, im Browser gespeichert).
export function clientOf(request, body) {
  const c = (body && body.client) || new URL(request.url).searchParams.get("client") || "";
  return /^[a-zA-Z0-9-]{16,64}$/.test(c) ? c : null;
}

export async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}
