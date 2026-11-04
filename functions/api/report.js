// POST /api/report {type: "poll"|"comment", id, client}   Beitrag melden
// GET  /api/report  (nur mit X-Admin-Key)                  gemeldete Beiträge ansehen
// Ab 3 Meldungen wird ein Beitrag automatisch ausgeblendet, bis er geprüft ist.
// Freigeben: POST /api/report {action:"approve", type, id} mit X-Admin-Key

import { json, bad, clientOf, isAdmin, readBody } from "../../lib/api.js";

export const HIDE_AT = 3;

export async function onRequestPost({ request, env }) {
  const body = await readBody(request);
  const type = body?.type === "poll" ? "poll" : body?.type === "comment" ? "comment" : null;
  if (!type) return bad("Ungültiger Typ.");
  const table = type === "poll" ? "polls" : "comments";
  const exists = await env.DB.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(body?.id || "").first();
  if (!exists) return bad("Beitrag nicht gefunden.", 404);

  if (body?.action === "approve") {
    if (!isAdmin(request, env)) return bad("Keine Berechtigung.", 403);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM reports WHERE type = ? AND target_id = ?").bind(type, exists.id),
      env.DB.prepare(`UPDATE ${table} SET approved = 1 WHERE id = ?`).bind(exists.id),
    ]);
    return json({ ok: true });
  }

  const client = clientOf(request, body);
  if (!client) return bad("Ungültige Browser-ID.");
  await env.DB.prepare(
    "INSERT OR IGNORE INTO reports (type, target_id, client, created_at) VALUES (?, ?, ?, ?)"
  ).bind(type, exists.id, client, Date.now()).run();
  return json({ ok: true });
}

export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return bad("Keine Berechtigung.", 403);
  const rows = (await env.DB.prepare(
    `SELECT r.type, r.target_id, COUNT(*) AS n, MAX(r.created_at) AS last,
            COALESCE(p.question, c.text) AS content
       FROM reports r
       LEFT JOIN polls p ON r.type = 'poll' AND p.id = r.target_id
       LEFT JOIN comments c ON r.type = 'comment' AND c.id = r.target_id
      GROUP BY r.type, r.target_id ORDER BY last DESC`
  ).all()).results;
  return json({ reports: rows });
}
