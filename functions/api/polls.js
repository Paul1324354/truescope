// GET    /api/polls?country=AT|INT|ALL&client=...   Abstimmungen mit Ergebnis und Kommentaren
// POST   /api/polls   {question, options[], country, name, client}
// DELETE /api/polls?id=...&client=...                eigene Abstimmung löschen

import { json, bad, newId, clientOf, isAdmin, clean, readBody } from "../../lib/api.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const country = url.searchParams.get("country") || "ALL";
  const client = clientOf(request);
  const admin = isAdmin(request, env);

  // Beiträge mit 3 oder mehr Meldungen bleiben ausgeblendet, bis sie freigegeben sind.
  const hidden = (type) => {
    const t = type === "poll" ? "polls" : "comments";
    return `(${t}.approved = 0 AND (SELECT COUNT(*) FROM reports r WHERE r.type = '${type}' AND r.target_id = ${t}.id) >= 3)`;
  };
  const visiblePoll = admin ? "1=1" : `NOT ${hidden("poll")}`;
  const polls = (country === "ALL"
    ? await env.DB.prepare(`SELECT * FROM polls WHERE ${visiblePoll} ORDER BY created_at DESC LIMIT 100`).all()
    : await env.DB.prepare(`SELECT * FROM polls WHERE country = ? AND ${visiblePoll} ORDER BY created_at DESC LIMIT 100`).bind(country).all()
  ).results;
  if (!polls.length) return json({ polls: [] });

  const ids = polls.map((p) => p.id);
  const marks = ids.map(() => "?").join(",");
  const tallies = (await env.DB.prepare(
    `SELECT poll_id, option, COUNT(*) AS n FROM votes WHERE poll_id IN (${marks}) GROUP BY poll_id, option`
  ).bind(...ids).all()).results;
  const mine = client
    ? (await env.DB.prepare(`SELECT poll_id, option FROM votes WHERE client = ? AND poll_id IN (${marks})`)
        .bind(client, ...ids).all()).results
    : [];
  const comments = (await env.DB.prepare(
    `SELECT * FROM comments WHERE poll_id IN (${marks}) AND ${admin ? "1=1" : "NOT " + hidden("comment")} ORDER BY created_at ASC`
  ).bind(...ids).all()).results;

  const out = polls.map((p) => {
    const options = JSON.parse(p.options);
    const counts = options.map(() => 0);
    for (const t of tallies) if (t.poll_id === p.id && counts[t.option] !== undefined) counts[t.option] = t.n;
    const my = mine.find((m) => m.poll_id === p.id);
    return {
      id: p.id,
      question: p.question,
      options,
      counts,
      country: p.country,
      author: p.author_name,
      createdAt: p.created_at,
      mine: p.author_client === client || admin,
      myVote: my ? my.option : null,
      comments: comments.filter((c) => c.poll_id === p.id).map((c) => ({
        id: c.id,
        text: c.text,
        author: c.author_name,
        createdAt: c.created_at,
        mine: c.author_client === client || admin,
      })),
    };
  });
  return json({ polls: out });
}

export async function onRequestPost({ request, env }) {
  const body = await readBody(request);
  const client = clientOf(request, body);
  if (!client) return bad("Ungültige Browser-ID.");
  const question = clean(body?.question, 200);
  const options = (Array.isArray(body?.options) ? body.options : []).map((o) => clean(o, 60)).filter(Boolean).slice(0, 4);
  const country = /^([A-Z]{2}|INT)$/.test(body?.country || "") ? body.country : null;
  const name = clean(body?.name, 40) || "Anonym";
  if (question.length < 5) return bad("Die Frage ist zu kurz.");
  if (options.length < 2) return bad("Bitte mindestens zwei Antworten angeben.");
  if (!country) return bad("Ungültiges Land.");

  const id = newId();
  await env.DB.prepare(
    "INSERT INTO polls (id, question, options, country, author_name, author_client, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, question, JSON.stringify(options), country, name, client, Date.now()).run();
  return json({ id }, 201);
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const client = clientOf(request);
  const poll = await env.DB.prepare("SELECT author_client FROM polls WHERE id = ?").bind(id).first();
  if (!poll) return bad("Abstimmung nicht gefunden.", 404);
  if (poll.author_client !== client && !isAdmin(request, env)) return bad("Nur die Person, die sie erstellt hat, kann sie löschen.", 403);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM reports WHERE (type = 'poll' AND target_id = ?) OR (type = 'comment' AND target_id IN (SELECT id FROM comments WHERE poll_id = ?))").bind(id, id),
    env.DB.prepare("DELETE FROM votes WHERE poll_id = ?").bind(id),
    env.DB.prepare("DELETE FROM comments WHERE poll_id = ?").bind(id),
    env.DB.prepare("DELETE FROM polls WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
}
