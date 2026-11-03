// Cloudflare Pages Function: serves /api/* on the same origin as the website.
// It runs the exact same TrueScope backend code as the Worker (../../../worker/src),
// with the shared D1 database bound as `DB` (see wrangler.toml in this folder).
import { handleApi } from "../../../worker/src/app.ts";
import type { Env } from "../../../worker/src/env.ts";

interface PagesContext { request: Request; env: Env; waitUntil(p: Promise<unknown>): void }

export const onRequest = async (ctx: PagesContext): Promise<Response> =>
  handleApi(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) }, { cache: true });
