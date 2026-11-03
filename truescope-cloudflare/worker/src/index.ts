// Cloudflare Worker entry: Cron Trigger (news pipeline) + read-only public API.
import { handleApi } from "./app.ts";
import { Db } from "./db.ts";
import type { Ctx, Env } from "./env.ts";
import { runCron } from "./pipeline.ts";

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "") {
      return new Response("TrueScope API (read-only). Die Website läuft auf Cloudflare Pages.", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    const res = await handleApi(req, env, ctx, { readOnly: true });
    res.headers.set("Access-Control-Allow-Origin", "*"); // public, read-only data
    return res;
  },

  async scheduled(_event: unknown, env: Env, ctx: Ctx): Promise<void> {
    ctx.waitUntil(runCron(env, new Db(env.DB)).then((r) => console.log("cron", JSON.stringify(r))));
  },
};
