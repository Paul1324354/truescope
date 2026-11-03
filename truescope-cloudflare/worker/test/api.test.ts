// End-to-end tests: real Worker code + D1 emulation + mocked feeds.
// Feed contents are SYNTHETIC TEST FIXTURES (not real news).
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { handleApi } from "../src/app.ts";
import { Db } from "../src/db.ts";
import type { Env } from "../src/env.ts";
import { runCron } from "../src/pipeline.ts";
import { parseFeed, robotsAllows, canonicalUrl } from "../src/rss.ts";
import worker from "../src/index.ts";
import { createD1 } from "./d1shim.ts";

const MIG = fileURLToPath(new URL("../migrations", import.meta.url));
const d1 = createD1(MIG);
const env: Env = { DB: d1, ADMIN_EMAIL: "admin@example.com", PEPPER: "test-pepper", PBKDF2_ITERATIONS: "2000", MAX_FEEDS_PER_RUN: "2", MAX_ANALYZE_PER_RUN: "4" };
const BASE = "https://truescope.pages.dev";
const H = 3_600_000;
const T0 = Date.now();

const rss = (items: [string, string, number][]) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title>${items.map(([t, d, h], i) =>
  `<item><title><![CDATA[${t}]]></title><link>https://example.test/${encodeURIComponent(t)}/${i}?utm_source=rss</link><description>${d.replace(/&/g, "&amp;")}</description><pubDate>${new Date(T0 - h * H).toUTCString()}</pubDate><category>Politik</category></item>`).join("")}</channel></rss>`;

const FEEDS: Record<string, string> = {
  "https://rss.orf.at/news.xml": rss([["Nationalrat in Wien beschließt Budget", "Der Nationalrat in Wien hat das Budget für Österreich beschlossen, teilte das Parlament mit.", 8]]),
  "https://www.derstandard.at/rss": rss([["Österreich: Nationalrat beschließt Budget in Wien", "Der Nationalrat in Wien hat das Budget für Österreich mit den Stimmen der Koalition beschlossen.", 7]]),
  "https://www.tagesschau.de/index~rss2.xml": rss([["Budget für Österreich vom Nationalrat in Wien beschlossen", "Das Finanzministerium bestätigte den Beschluss des Budgets im Nationalrat in Wien.", 7]]),
  "https://feeds.npr.org/1001/rss.xml": rss([["Tornado hits Texas town", "A tornado hit a town in Texas; officials said 3 people were killed.", 4]]),
  "https://feeds.bbci.co.uk/news/rss.xml": rss([["Texas tornado kills many", "A tornado in Texas: authorities said 30 people were killed in the town.", 4],
    ["Austrian parliament in Vienna passes budget", "Austria's parliament in Vienna passed the budget, officials confirmed.", 7]]),
};
const ACTIVE = Object.keys(FEEDS);

let fetchCalls = 0;
globalThis.fetch = (async (input: string | URL | Request) => {
  fetchCalls++;
  const u = String(input instanceof Request ? input.url : input);
  if (u.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /private\n", { status: 200 });
  if (FEEDS[u]) return new Response(FEEDS[u], { status: 200, headers: { etag: '"v1"' } });
  return new Response("not found", { status: 404 });
}) as typeof fetch;

const call = async (method: string, path: string, data?: unknown, cookie?: string, headers: Record<string, string> = {}) => {
  const res = await handleApi(new Request(BASE + path, { method, headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}), ...headers }, body: data === undefined ? undefined : JSON.stringify(data) }), env);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? null };
};

before(async () => {
  d1.raw.exec(`UPDATE sources SET active = 0 WHERE feed_url NOT IN (${ACTIVE.map((u) => `'${u}'`).join(",")}) OR feed_url IS NULL`);
  // drive the cron: fetch slots (even 5-min slot) then analyse slots (odd) until everything is processed
  const t = Math.floor(T0 / 120_000) * 120_000; // aligned to an even minute
  for (let i = 0; i < 30; i++) await runCron(env, new Db(d1), t + i * 60_000);
});

test("rss parser: rss, atom, rdf, canonical urls", () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A &amp; B</title><link rel="alternate" href="https://x.test/a?utm_medium=x&amp;id=1"/><summary>&lt;p&gt;Teaser&lt;/p&gt;</summary><updated>2026-01-01T10:00:00Z</updated><category term="Science"/></entry></feed>`;
  const a = parseFeed(atom);
  assert.equal(a[0].title, "A & B");
  assert.equal(a[0].url, "https://x.test/a?id=1");
  assert.equal(a[0].summary, "Teaser");
  assert.deepEqual(a[0].categories, ["Science"]);
  const rdf = `<rdf:RDF><item rdf:about="x"><title>DW Titel</title><link>https://dw.test/a</link><dc:date>2026-01-01T10:00:00Z</dc:date></item></rdf:RDF>`;
  assert.equal(parseFeed(rdf)[0].title, "DW Titel");
  assert.equal(canonicalUrl("javascript:alert(1)"), null);
  assert.ok(!robotsAllows("User-agent: *\nDisallow: /", "/feed"));
  assert.ok(robotsAllows("User-agent: *\nDisallow: /private", "/feed"));
  assert.ok(robotsAllows("User-agent: truescopebot\nAllow: /\n\nUser-agent: *\nDisallow: /", "/feed"));
});

test("cron imported, deduplicated and analysed all fixture articles", () => {
  const n = d1.raw.prepare("SELECT COUNT(*) AS n, SUM(processed) AS p FROM articles").get() as { n: number; p: number };
  assert.equal(n.n, 6);
  assert.equal(n.p, 6);
  const url = (d1.raw.prepare("SELECT url FROM articles LIMIT 1").get() as { url: string }).url;
  assert.ok(!url.includes("utm_"), "tracking parameters removed");
  const pending = d1.raw.prepare("SELECT COUNT(*) AS n FROM events WHERE needs_assessment = 1").get() as { n: number };
  assert.equal(pending.n, 0);
});

test("refetch does not duplicate (ETag + URL dedupe)", async () => {
  d1.raw.exec("UPDATE sources SET last_fetched_at = 0, etag = NULL WHERE active = 1");
  await runCron(env, new Db(d1), Math.floor(Date.now() / 120_000) * 120_000);
  assert.equal((d1.raw.prepare("SELECT COUNT(*) AS n FROM articles").get() as { n: number }).n, 6);
});

test("country filter separates event country and source country", async () => {
  const at = (await call("GET", "/api/home?countries=AT")).body;
  assert.ok(at.latest.some((e: any) => e.title.includes("Budget")), JSON.stringify(at.latest.map((e: any) => e.title)));
  assert.ok(!at.latest.some((e: any) => e.title.includes("Texas")));
  const gb = (await call("GET", "/api/home?countries=GB")).body;
  assert.ok(!gb.latest.some((e: any) => /budget/i.test(e.title)), "BBC report about Austria is not UK news");
  const us = (await call("GET", "/api/events?countries=US")).body;
  assert.ok(us.items.some((e: any) => e.title.includes("Texas") || e.title.includes("Tornado")));
  const all = (await call("GET", "/api/events?countries=GLOBAL")).body;
  assert.ok(all.items.length >= 3);
});

test("contradiction -> DISPUTED; corroborated budget event with reasoning", async () => {
  const t = (await call("GET", "/api/events?q=tornado")).body.items;
  assert.equal(t[0].status, "DISPUTED");
  const b = (await call("GET", "/api/events?q=Nationalrat&sort=top")).body.items[0];
  const d = (await call("GET", `/api/events/${b.id}`)).body;
  assert.ok(["VERIFIED", "STRONGLY_CORROBORATED"].includes(d.status), d.explanation);
  assert.ok(d.explanation.length > 20 && d.factors.length >= 5);
  assert.ok(d.source_groups.length >= 3);
  assert.ok(d.source_groups.every((g: any) => g.articles.every((a: any) => a.url.startsWith("https://"))));
});

test("search filters and FTS injection safety", async () => {
  assert.ok((await call("GET", "/api/events?q=Nationalrat&window=24h")).body.items.length >= 1);
  assert.equal((await call("GET", "/api/events?q=Nationalrat&window=1h")).body.items.length, 0);
  assert.equal((await call("GET", `/api/events?q=${encodeURIComponent('" OR 1=1 --')}`)).status, 200);
  assert.equal((await call("GET", "/api/events?q=*")).status, 200);
  assert.ok((await call("GET", "/api/events?source=ORF")).body.items.length >= 1);
});

test("accounts: admin bootstrap, login, prefs, saved, history, notifications", async () => {
  const bad = await call("POST", "/api/auth/register", { username: "x", email: "bad", password: "1" });
  assert.equal(bad.status, 422);
  const r = await call("POST", "/api/auth/register", { username: "chef", email: "admin@example.com", password: "sicher12345" });
  assert.equal(r.status, 201);
  assert.equal(r.body.role, "admin");
  const u = await call("POST", "/api/auth/register", { username: "paul", email: "paul@example.com", password: "sicher12345" });
  assert.equal(u.body.role, "user");
  const login = await call("POST", "/api/auth/login", { email: "paul@example.com", password: "sicher12345" });
  assert.equal(login.status, 200);
  const ck = login.cookie!;
  assert.match(String(d1.raw.prepare("SELECT pw_hash FROM users WHERE username = 'paul'").get()!.pw_hash), /^[A-Za-z0-9_-]{40,}$/);
  const p = await call("PUT", "/api/me/preferences", { preferred_countries: ["AT", "DE"], notification_settings: { countries: ["AT", "US"], min_status: "DEVELOPING" } }, ck);
  assert.deepEqual(p.body.preferences.preferred_countries, ["AT", "DE"]);
  const eid = (await call("GET", "/api/events")).body.items[0].id;
  assert.equal((await call("POST", `/api/me/saved/${eid}`, {}, ck)).status, 201);
  assert.equal((await call("GET", "/api/me/saved", undefined, ck)).body.length, 1);
  await call("POST", `/api/me/history/${eid}`, {}, ck);
  assert.equal((await call("GET", "/api/me/history", undefined, ck)).body.length, 1);
  const notes = (await call("GET", "/api/me/notifications", undefined, ck)).body;
  assert.ok(Array.isArray(notes));
  assert.equal((await call("GET", "/api/admin/stats", undefined, ck)).status, 403);
  await call("POST", "/api/auth/logout", {}, ck);
  assert.equal((await call("GET", "/api/auth/me", undefined, ck)).status, 401);
});

test("brute force protection", async () => {
  let last = 0;
  for (let i = 0; i < 10; i++) last = (await call("POST", "/api/auth/login", { email: "paul@example.com", password: "falsch1234567" })).status;
  assert.equal(last, 429);
});

test("admin: stats, override audited, CSRF, pause", async () => {
  const ck = (await call("POST", "/api/auth/login", { email: "admin@example.com", password: "sicher12345" })).cookie!;
  const s = (await call("GET", "/api/admin/stats", undefined, ck)).body;
  assert.equal(s.articles_total, 6);
  assert.ok(s.usage_today.cron_runs >= 30);
  assert.ok(s.usage_today.rows_written > 0);
  const eid = (await call("GET", "/api/events?q=tornado")).body.items[0].id;
  const r = await call("PATCH", `/api/admin/events/${eid}`, { status: "RETRACTED", reason: "Test: Quelle hat zurückgezogen" }, ck);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "RETRACTED");
  const log = (await call("GET", "/api/admin/audit", undefined, ck)).body;
  assert.equal(log[0].action, "event.update");
  const evil = await call("PATCH", `/api/admin/events/${eid}`, { archived: true, reason: "csrf attempt" }, ck, { origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  // manual override survives re-assessment
  await call("POST", `/api/admin/events/${eid}/reanalyze`, {}, ck);
  assert.equal((await call("GET", `/api/events/${eid}`)).body.status, "RETRACTED");
  assert.equal((await call("PUT", "/api/admin/settings", { ingest_paused: true }, ck)).status, 200);
  const res = await runCron(env, new Db(d1));
  assert.equal(res.kind, "skipped");
  await call("PUT", "/api/admin/settings", { ingest_paused: false }, ck);
  const tmp = (await call("POST", "/api/admin/users/2/reset-password", {}, ck)).body.temporary_password;
  assert.equal((await call("POST", "/api/auth/login", { email: "paul@example.com", password: tmp }, undefined, { "cf-connecting-ip": "10.0.0.9" })).status, 429, "mail-based limiter still active");
});

test("budget guard stops ingestion before the free limit", async () => {
  const day = new Date().toISOString().slice(0, 10);
  d1.raw.prepare("UPDATE usage_daily SET rows_written = 999999 WHERE day = ?").run(day);
  const before = fetchCalls;
  const r = await runCron(env, new Db(d1));
  assert.equal(r.kind, "skipped");
  assert.match(String(r.guard), /Tagesbudget/);
  assert.equal(fetchCalls, before);
  d1.raw.prepare("UPDATE usage_daily SET rows_written = 0 WHERE day = ?").run(day);
});

test("worker entry is read-only", async () => {
  const ctx = { waitUntil() {} };
  const get = await worker.fetch(new Request("https://api.example.workers.dev/api/home"), env, ctx);
  assert.equal(get.status, 200);
  const post = await worker.fetch(new Request("https://api.example.workers.dev/api/auth/register", { method: "POST", body: "{}" }), env, ctx);
  assert.equal(post.status, 405);
});

test("GDPR delete removes the account", async () => {
  const ck = (await call("POST", "/api/auth/register", { username: "weg", email: "weg@example.com", password: "sicher12345" })).cookie!;
  assert.equal((await call("GET", "/api/me/export", undefined, ck)).status, 200);
  assert.equal((await call("DELETE", "/api/me", undefined, ck)).status, 200);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'weg'").get()!.n, 0);
});
