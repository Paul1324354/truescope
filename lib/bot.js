// Gemeinsame Helfer für Recherche-Bot und Detailansicht: KI-Aufruf, Textbereinigung, Sperren.

// Llama 3.3 70B wurde gestrichen: Es kostet je geschriebenem Wort etwa 7- bis 8-mal so viel wie Gemma.
export const MODELS = ["@cf/google/gemma-4-26b-a4b-it", "@cf/zai-org/glm-4.7-flash"];

// Neurons je Million Tokens (Eingabe, Ausgabe) laut Preisliste von Cloudflare Workers AI
const PRICE = {
  "@cf/google/gemma-4-26b-a4b-it": [9091, 27273],
  "@cf/zai-org/glm-4.7-flash": [5500, 36400],
};

// Tagesbudget: 10.000 Neurons gratis (Tageswechsel 0 Uhr UTC). Der Recherche-Bot darf höchstens BOT_BUDGET davon
// verbrauchen; der Rest bleibt für „Mehr lesen“ (Zusammenfassung, Vergleich, Ranking) reserviert.
export const BOT_BUDGET = 7000;
const today = () => new Date().toISOString().slice(0, 10);
export async function usedToday(env) {
  try { return (await env.DB.prepare("SELECT neurons FROM ai_usage WHERE day = ?").bind(today()).first())?.neurons || 0; } catch { return 0; }
}
async function addUsage(env, n) {
  try {
    await env.DB.prepare("INSERT INTO ai_usage (day, neurons) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET neurons = neurons + excluded.neurons").bind(today(), n).run();
  } catch {}
}
const estTokens = (s) => Math.ceil(String(s || "").length / 3.2);

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

// Ist das Gratis-Tageskontingent der KI aufgebraucht? Dann merken wir uns das bis kurz nach Mitternacht (UTC),
// damit nicht jede Anfrage erneut alle Modelle durchprobiert.
const QUOTA = "ai-quota";
export const isQuotaLog = (log) => log.some((l) => /3036|4006|daily free allocation|^quota/i.test(l));
const QUOTA_ERR = /3036|4006|daily free allocation/i;
async function quotaOut(env) {
  try {
    const r = await env.DB.prepare("SELECT until FROM locks WHERE name = ?").bind(QUOTA).first();
    return !!r && r.until > Date.now();
  } catch { return false; }
}
// Gesperrt wird nur 30 Minuten (nicht bis Mitternacht): Cloudflare meldet manchmal „aufgebraucht“ (Code 4006),
// obwohl laut Dashboard nichts verbraucht ist. So versucht es der Bot bald wieder.
async function markQuota(env) {
  const next = Date.now() + 30 * 60e3;
  try {
    await env.DB.prepare("INSERT INTO locks (name, until) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET until = excluded.until").bind(QUOTA, next).run();
  } catch {}
}

// Fragt die KI; probiert die Modelle der Reihe nach. null = keine Antwort (z. B. Tageskontingent aufgebraucht,
// dann steht in log ein Eintrag „quota …“; oder Bot-Budget erreicht, dann „budget …“).
// opts.kind: "bot" für den Recherche-Bot (hält sich an BOT_BUDGET), sonst "reader" (darf die Reserve nutzen).
export async function ask(env, system, user, maxTokens, log = [], opts = {}) {
  if (await quotaOut(env)) { log.push("quota: Tageskontingent aufgebraucht"); return null; }
  if (opts.kind === "bot" && (await usedToday(env)) >= BOT_BUDGET) { log.push("budget: Bot-Anteil für heute verbraucht, Rest ist für Mehr lesen reserviert"); return null; }
  let quotaHits = 0;
  for (const model of MODELS) {
    try {
      const out = await env.AI.run(model, {
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: maxTokens, temperature: 0.1, chat_template_kwargs: { enable_thinking: false },
      });
      const txt = aiText(out);
      const p = PRICE[model] || [10000, 40000];
      const tin = out?.usage?.prompt_tokens || estTokens(system) + estTokens(user);
      const tout = out?.usage?.completion_tokens || estTokens(txt);
      await addUsage(env, (tin * p[0] + tout * p[1]) / 1e6);
      if (txt && txt.length > 3) return txt;
      log.push(model + ": leere Antwort");
    } catch (e) {
      log.push(model + " Fehler: " + String(e).slice(0, 160));
      if (QUOTA_ERR.test(String(e))) quotaHits++; // nächstes Modell trotzdem versuchen
    }
  }
  if (quotaHits === MODELS.length) await markQuota(env); // erst sperren, wenn alle Modelle „aufgebraucht“ melden
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
