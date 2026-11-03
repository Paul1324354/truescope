// Shared request handler used by BOTH the Pages Function (full site API, same origin)
// and the standalone Worker (read-only public API).
import { Db } from "./db.ts";
import type { Ctx, Env } from "./env.ts";
import { HttpError, json } from "./http.ts";
import { accountRoute } from "./routes/account.ts";
import { adminRoute } from "./routes/admin.ts";
import { CACHEABLE, publicRoute } from "./routes/public.ts";

const CACHE_SECONDS = 60;

export interface AppOptions { readOnly?: boolean; cache?: boolean }

export async function handleApi(req: Request, env: Env, ctx?: Ctx, opts: AppOptions = {}): Promise<Response> {
  const url = new URL(req.url);
  try {
    if (!url.pathname.startsWith("/api/")) throw new HttpError(404, "Nicht gefunden");
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (opts.readOnly) throw new HttpError(405, "Diese Adresse ist nur lesend. Bitte die TrueScope-Website verwenden.");
      // CSRF: state-changing requests must come from our own origin
      const origin = req.headers.get("origin");
      if (origin && origin !== url.origin) throw new HttpError(403, "Origin not allowed");
    }

    // Edge cache for public GETs (Cache API works for Pages Functions, also on *.pages.dev)
    const cacheable = opts.cache && req.method === "GET" && CACHEABLE.test(url.pathname);
    const cache = cacheable && typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : null;
    if (cache) {
      const hit = await cache.match(req.url);
      if (hit) return hit;
    }

    const db = new Db(env.DB);
    const res = (await publicRoute(db, req, url)) ?? (opts.readOnly ? null : (await accountRoute(db, env, req, url)) ?? (await adminRoute(db, env, req, url)));
    if (!res) throw new HttpError(404, "Nicht gefunden");
    if (cache && res.ok) {
      const copy = new Response(res.clone().body, res);
      copy.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
      ctx?.waitUntil(cache.put(req.url, copy));
    }
    return res;
  } catch (e) {
    if (e instanceof HttpError) return json({ detail: e.message }, e.status);
    const msg = String((e as Error)?.message ?? e);
    if (/limit|exceeded/i.test(msg) && /D1|daily|rows/i.test(msg)) {
      return json({ detail: "TrueScope hat das kostenlose Tageskontingent der Datenbank erreicht. Ab 01:00/02:00 Uhr (00:00 UTC) geht es weiter." }, 503);
    }
    console.error("unhandled", url.pathname, e);
    return json({ detail: "Interner Fehler" }, 500);
  }
}
