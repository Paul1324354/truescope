// Bindings and configuration. Minimal D1 typings so the code also runs under Node tests.

export interface D1Result<T = Record<string, unknown>> { results: T[]; success: boolean; meta: { rows_read?: number; rows_written?: number; last_row_id?: number; changes?: number } }
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(stmts: D1PreparedStatement[]): Promise<D1Result[]>;
}
export interface AiBinding { run(model: string, input: unknown): Promise<unknown> }

export interface Env {
  DB: D1Database;
  AI?: AiBinding;
  ADMIN_EMAIL?: string;          // the account registered with this e-mail becomes admin
  PEPPER?: string;               // secret mixed into password hashes (recommended)
  PUBLIC_APP_URL?: string;
  // free-tier guard (all optional, sensible defaults)
  MAX_FEEDS_PER_RUN?: string;
  MAX_ITEMS_PER_FEED?: string;
  MAX_ANALYZE_PER_RUN?: string;
  DAILY_WRITE_BUDGET?: string;   // stop ingestion before the 100k/day D1 limit
  DAILY_READ_BUDGET?: string;
  MAX_NEW_ARTICLES_PER_DAY?: string;
  RETENTION_DAYS?: string;
  AI_SUMMARIES?: string;         // "true" to use Workers AI (free 10k neurons/day)
  AI_MODEL?: string;
  AI_DAILY_CALLS?: string;
  PBKDF2_ITERATIONS?: string;
  USER_AGENT?: string;
}

export interface Ctx { waitUntil(p: Promise<unknown>): void }

export function cfg(env: Env) {
  const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    maxFeedsPerRun: n(env.MAX_FEEDS_PER_RUN, 2),
    maxItemsPerFeed: n(env.MAX_ITEMS_PER_FEED, 20),
    maxAnalyzePerRun: n(env.MAX_ANALYZE_PER_RUN, 4),
    dailyWriteBudget: n(env.DAILY_WRITE_BUDGET, 70_000),
    dailyReadBudget: n(env.DAILY_READ_BUDGET, 4_000_000),
    maxNewArticlesPerDay: n(env.MAX_NEW_ARTICLES_PER_DAY, 1_500),
    retentionDays: n(env.RETENTION_DAYS, 30),
    aiEnabled: env.AI_SUMMARIES === "true" && !!env.AI,
    aiModel: env.AI_MODEL || "@cf/meta/llama-3.1-8b-instruct",
    aiDailyCalls: n(env.AI_DAILY_CALLS, 100),
    pbkdf2: Math.min(n(env.PBKDF2_ITERATIONS, 12_000), 100_000),
    userAgent: env.USER_AGENT || "TrueScopeBot/1.0 (+https://github.com/truescope; RSS reader)",
  };
}
