// Daumen hoch / Daumen runter für Meldungen
//   GET  /api/react?ids=a,b,c&client=…   → { items: { <id>: { up, down, mine } } }   (mine: 1, -1 oder 0)
//   POST /api/react {storyId, value, client}   value: 1 (hoch), -1 (runter), 0 (zurücknehmen)
// Pro Browser (zufällige Kennung, kein Login) zählt eine Bewertung je Meldung; sie kann geändert werden.

import { json, bad, clientOf, readBody } from "../../lib/api.js";

const ID = /^[a-zA-Z0-9]{6,24}$/;
const CHUNK = 80; // D1 erlaubt höchstens 100 Parameter je Abfrage

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const ids = [...new Set((url.searchParams.get("ids") || "").split(",").filter((x) => ID.test(x)))].slice(0, 400);
  const client = clientOf(request, null) || "-";
  const items = {};
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const rows = (await env.DB.prepare(
      `SELECT story_id, SUM(value = 1) AS up, SUM(value = -1) AS down, MAX(CASE WHEN client = ? THEN value END) AS mine
         FROM reactions WHERE story_id IN (${part.map(() => "?").join(",")}) GROUP BY story_id`
    ).bind(client, ...part).all()).results;
    for (const r of rows) items[r.story_id] = { up: r.up || 0, down: r.down || 0, mine: r.mine || 0 };
  }
  return json({ items });
}

export async function onRequestPost({ request, env }) {
  const body = await readBody(request);
  const client = clientOf(request, body);
  if (!client) return bad("Ungültige Browser-ID.");
  const id = String(body?.storyId || "");
  const value = Number(body?.value);
  if (!ID.test(id)) return bad("Ungültige Meldung.");
  if (![1, -1, 0].includes(value)) return bad("Ungültige Bewertung.");
  const exists = await env.DB.prepare("SELECT 1 FROM stories WHERE id = ?").bind(id).first();
  if (!exists) return bad("Diese Meldung gibt es nicht mehr.", 404);

  if (value === 0) await env.DB.prepare("DELETE FROM reactions WHERE story_id = ? AND client = ?").bind(id, client).run();
  else await env.DB.prepare(
    "INSERT INTO reactions (story_id, client, value, created_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(story_id, client) DO UPDATE SET value = excluded.value, created_at = excluded.created_at"
  ).bind(id, client, value, Date.now()).run();

  const r = await env.DB.prepare(
    "SELECT SUM(value = 1) AS up, SUM(value = -1) AS down FROM reactions WHERE story_id = ?"
  ).bind(id).first();
  return json({ id, up: r?.up || 0, down: r?.down || 0, mine: value });
}
