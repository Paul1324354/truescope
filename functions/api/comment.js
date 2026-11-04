// POST   /api/comment {pollId, text, name, client}
// DELETE /api/comment?id=...&client=...   eigenen Kommentar löschen

import { json, bad, newId, clientOf, isAdmin, readBody } from "../../lib/api.js";

export async function onRequestPost({ request, env }) {
  const body = await readBody(request);
  const client = clientOf(request, body);
  if (!client) return bad("Ungültige Browser-ID.");
  const text = String(body?.text ?? "").trim().slice(0, 600);
  const name = String(body?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || "Anonym";
  if (!text) return bad("Der Kommentar ist leer.");
  const poll = await env.DB.prepare("SELECT id FROM polls WHERE id = ?").bind(body?.pollId || "").first();
  if (!poll) return bad("Abstimmung nicht gefunden.", 404);
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO comments (id, poll_id, text, author_name, author_client, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, poll.id, text, name, client, Date.now()).run();
  return json({ id }, 201);
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const client = clientOf(request);
  const c = await env.DB.prepare("SELECT author_client FROM comments WHERE id = ?").bind(id).first();
  if (!c) return bad("Kommentar nicht gefunden.", 404);
  if (c.author_client !== client && !isAdmin(request, env)) return bad("Du kannst nur deine eigenen Kommentare löschen.", 403);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM reports WHERE type = 'comment' AND target_id = ?").bind(id),
    env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
}
