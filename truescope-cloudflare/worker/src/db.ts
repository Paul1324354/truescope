// Thin D1 wrapper that meters rows read/written (used by the free-tier guard).
import type { D1Database, D1PreparedStatement } from "./env.ts";

export class Db {
  d1: D1Database;
  reads = 0;
  writes = 0;
  constructor(d1: D1Database) { this.d1 = d1; }

  stmt(sql: string, ...params: unknown[]): D1PreparedStatement {
    return this.d1.prepare(sql).bind(...params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p)));
  }
  async all<T = Record<string, any>>(sql: string, ...params: unknown[]): Promise<T[]> {
    const r = await this.stmt(sql, ...params).all<T>();
    this.reads += r.meta?.rows_read ?? 0;
    this.writes += r.meta?.rows_written ?? 0;
    return r.results ?? [];
  }
  async first<T = Record<string, any>>(sql: string, ...params: unknown[]): Promise<T | null> {
    return (await this.all<T>(sql, ...params))[0] ?? null;
  }
  async run(sql: string, ...params: unknown[]): Promise<{ id: number; changes: number }> {
    const r = await this.stmt(sql, ...params).run();
    this.reads += r.meta?.rows_read ?? 0;
    this.writes += r.meta?.rows_written ?? 0;
    return { id: Number(r.meta?.last_row_id ?? 0), changes: Number(r.meta?.changes ?? 0) };
  }
  /** One round trip, atomic. */
  async batch(stmts: D1PreparedStatement[]) {
    if (!stmts.length) return [];
    const rs = await this.d1.batch(stmts);
    for (const r of rs) { this.reads += r.meta?.rows_read ?? 0; this.writes += r.meta?.rows_written ?? 0; }
    return rs;
  }
}

export const J = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== "string" || !s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};
export const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
