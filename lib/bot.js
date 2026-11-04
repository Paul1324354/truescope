// Gemeinsame Helfer für Recherche-Bot und Detailansicht: KI-Aufruf, Textbereinigung, Sperren.

export const MODELS = ["@cf/google/gemma-4-26b-a4b-it", "@cf/zai-org/glm-4.7-flash", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"];

export const clean = (s, n) => String(s || "").replace(/\s+/g, " ").replace(/\|/g, "/").trim().slice(0, n);

export function aiText(out) {
  if (!out) return "";
  if (typeof out === "string") return out;
  if (typeof out.response === "string") return out.response;
  const c = out.choices?.[0]?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => p.text || "").join("");
  return "";
}

// Fragt die KI; probiert die Modelle der Reihe nach. null = keine Antwort (z. B. Tageskontingent aufgebraucht).
export async function ask(env, system, user, maxTokens, log = []) {
  for (const model of MODELS) {
    try {
      const out = await env.AI.run(model, {
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: maxTokens, temperature: 0.1, chat_template_kwargs: { enable_thinking: false },
      });
      const txt = aiText(out);
      if (txt && txt.length > 3) return txt;
      log.push(model + ": leere Antwort");
    } catch (e) {
      log.push(model + " Fehler: " + String(e).slice(0, 160));
      if (/3036|daily free allocation/i.test(String(e))) return null;
    }
  }
  return null;
}

// Verhindert, dass mehrere Anfragen gleichzeitig dasselbe tun.
export async function lock(env, name, ms) {
  const now = Date.now();
  const r = await env.DB.prepare(
    "INSERT INTO locks (name, until) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET until = excluded.until WHERE locks.until < ?"
  ).bind(name, now + ms, now).run();
  return (r.meta?.changes ?? r.changes ?? 0) > 0;
}
export async function unlock(env, name) {
  await env.DB.prepare("UPDATE locks SET until = 0 WHERE name = ?").bind(name).run();
}
