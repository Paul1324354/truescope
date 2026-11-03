// Free-tier guard: tracks D1 rows written/read by the pipeline per UTC day and
// pauses ingestion well before Cloudflare's daily limits are reached.
// On the free plan nothing is ever billed — exceeding a limit only causes errors
// until 00:00 UTC. The guard keeps the public site readable in that case.
import { utcDay, type Db } from "./db.ts";
import { cfg, type Env } from "./env.ts";

export interface Usage { day: string; cron_runs: number; rows_written: number; rows_read: number; articles_new: number; ai_calls: number }

export async function getUsage(db: Db, now = Date.now()): Promise<Usage> {
  const day = utcDay(now);
  return (await db.first<Usage>("SELECT * FROM usage_daily WHERE day = ?", day)) ?? { day, cron_runs: 0, rows_written: 0, rows_read: 0, articles_new: 0, ai_calls: 0 };
}

export async function addUsage(db: Db, delta: Partial<Usage>, now = Date.now()): Promise<void> {
  const d = { cron_runs: 0, rows_written: 0, rows_read: 0, articles_new: 0, ai_calls: 0, ...delta };
  await db.run(`INSERT INTO usage_daily (day, cron_runs, rows_written, rows_read, articles_new, ai_calls) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET cron_runs = cron_runs + excluded.cron_runs, rows_written = rows_written + excluded.rows_written,
    rows_read = rows_read + excluded.rows_read, articles_new = articles_new + excluded.articles_new, ai_calls = ai_calls + excluded.ai_calls`,
    utcDay(now), d.cron_runs, d.rows_written, d.rows_read, d.articles_new, d.ai_calls);
}

export interface GuardDecision { fetch: boolean; analyze: boolean; ai: boolean; reason: string | null }

export function decide(env: Env, u: Usage, paused: boolean): GuardDecision {
  const c = cfg(env);
  if (paused) return { fetch: false, analyze: false, ai: false, reason: "Ingestion im Admin-Bereich pausiert" };
  if (u.rows_written >= c.dailyWriteBudget) return { fetch: false, analyze: false, ai: false, reason: `Tagesbudget Schreibzugriffe erreicht (${u.rows_written}/${c.dailyWriteBudget})` };
  if (u.rows_read >= c.dailyReadBudget) return { fetch: false, analyze: false, ai: false, reason: `Tagesbudget Lesezugriffe erreicht (${u.rows_read}/${c.dailyReadBudget})` };
  const nearWrite = u.rows_written >= c.dailyWriteBudget * 0.85;
  const fetch = u.articles_new < c.maxNewArticlesPerDay && !nearWrite;
  return { fetch, analyze: true, ai: c.aiEnabled && u.ai_calls < c.aiDailyCalls, reason: fetch ? null : nearWrite ? "Schreibbudget fast erreicht – nur noch Analyse" : "Tageslimit neuer Artikel erreicht" };
}
