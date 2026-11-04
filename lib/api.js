// Gemeinsame Helfer für die Abstimmungs-API

export const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export const bad = (msg, status = 400) => json({ error: msg }, status);

export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

// Die Browser-ID identifiziert einen Besucher ohne Login (zufällig, im Browser gespeichert).
export function clientOf(request, body) {
  const c = (body && body.client) || new URL(request.url).searchParams.get("client") || "";
  return /^[a-zA-Z0-9-]{16,64}$/.test(c) ? c : null;
}

// Optional: Wer den ADMIN_KEY kennt, darf alles löschen (Moderation).
export function isAdmin(request, env) {
  const k = request.headers.get("X-Admin-Key");
  return !!(env.ADMIN_KEY && k && k === env.ADMIN_KEY);
}

export const clean = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}
