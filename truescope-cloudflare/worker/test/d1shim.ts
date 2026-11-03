// Minimal Cloudflare D1 emulation on node:sqlite – lets the real Worker code run in tests.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import type { D1Database, D1PreparedStatement, D1Result } from "../src/env.ts";

export function createD1(migrationsDir: string): D1Database & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith(".sql")).sort()) raw.exec(readFileSync(`${migrationsDir}/${f}`, "utf8"));

  const isRead = (sql: string) => /^\s*(SELECT|WITH)\b/i.test(sql);
  const make = (sql: string, params: unknown[] = []): D1PreparedStatement & { exec(): D1Result } => {
    const exec = (): D1Result => {
      const st = raw.prepare(sql);
      if (isRead(sql)) {
        const results = st.all(...(params as any[])) as Record<string, unknown>[];
        return { results, success: true, meta: { rows_read: Math.max(results.length, 1), rows_written: 0 } };
      }
      const r = st.run(...(params as any[]));
      return { results: [], success: true, meta: { rows_read: 1, rows_written: Number(r.changes), changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    };
    return {
      bind: (...v: unknown[]) => make(sql, v),
      all: async <T>() => exec() as D1Result<T>,
      first: async <T>() => ((exec().results[0] as T) ?? null),
      run: async () => exec(),
      exec,
    };
  };
  return {
    raw,
    prepare: (sql: string) => make(sql),
    batch: async (stmts: D1PreparedStatement[]) => {
      raw.exec("BEGIN");
      try {
        const out = stmts.map((s) => (s as unknown as { exec(): D1Result }).exec());
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
