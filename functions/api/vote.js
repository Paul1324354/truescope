// POST /api/vote {pollId, option, client}  – eine Stimme pro Browser, kann geändert werden

import { json, bad, clientOf, readBody } from "../../lib/api.js";

export async function onRequestPost({ request, env }) {
  const body = await readBody(request);
  const client = clientOf(request, body);
  if (!client) return bad("Ungültige Browser-ID.");
  const poll = await env.DB.prepare("SELECT options FROM polls WHERE id = ?").bind(body?.pollId || "").first();
  if (!poll) return bad("Abstimmung nicht gefunden.", 404);
  const option = Number(body?.option);
  if (!Number.isInteger(option) || option < 0 || option >= JSON.parse(poll.options).length) return bad("Ungültige Antwort.");
  await env.DB.prepare(
    "INSERT INTO votes (poll_id, client, option, created_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(poll_id, client) DO UPDATE SET option = excluded.option, created_at = excluded.created_at"
  ).bind(body.pollId, client, option, Date.now()).run();
  return json({ ok: true });
}
