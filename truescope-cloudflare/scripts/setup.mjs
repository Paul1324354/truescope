#!/usr/bin/env node
// TrueScope – one-command setup for Cloudflare (free plan).
//   npm run setup
// Creates the D1 database, applies schema + real news sources, deploys the
// Worker (cron bot) and the Pages website, and sets a random password pepper.
// Safe to run again: existing resources are reused.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER = join(ROOT, "worker");
const FRONTEND = join(ROOT, "frontend");
const isWin = process.platform === "win32";

const c = { b: (s) => `\x1b[1m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m` };
const step = (n, s) => console.log(`\n${c.b(`[${n}/8]`)} ${s}`);
function run(cmd, args, cwd, { capture = false, input, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, shell: isWin, encoding: "utf8", input, stdio: capture || input !== undefined ? ["pipe", "pipe", "pipe"] : "inherit", env: { ...process.env, FORCE_COLOR: "0" } });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0 && !allowFail) {
    if (capture || input !== undefined) console.log(out);
    console.log(c.r(`\nBefehl fehlgeschlagen: ${cmd} ${args.join(" ")}\nSiehe ANLEITUNG.md → „Wenn etwas nicht klappt“.`));
    process.exit(1);
  }
  return { ok: r.status === 0, out };
}
const wrangler = (args, cwd, opts) => run(isWin ? "npx.cmd" : "npx", ["wrangler", ...args], cwd, opts);

const [major] = process.versions.node.split(".").map(Number);
if (major < 20) { console.log(c.r(`Node.js ${process.versions.node} ist zu alt. Bitte Node.js 22 (LTS) von https://nodejs.org installieren.`)); process.exit(1); }

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(c.b("\nTrueScope – Einrichtung auf Cloudflare (kostenlos)\n"));
const email = (await rl.question("E-Mail-Adresse für dein Admin-Konto: ")).trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { console.log(c.r("Ungültige E-Mail-Adresse.")); process.exit(1); }
let project = (await rl.question("Name der Website (nur Kleinbuchstaben/Ziffern/-, Enter = truescope): ")).trim().toLowerCase() || "truescope";
project = project.replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "truescope";
rl.close();

step(1, "Programmpakete installieren (dauert beim ersten Mal 1–3 Minuten) …");
run(isWin ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"], WORKER);
run(isWin ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"], FRONTEND);

step(2, "Bei Cloudflare anmelden (Browser öffnet sich, dort „Allow“ klicken) …");
if (!wrangler(["whoami"], WORKER, { capture: true, allowFail: true }).out.match(/associated with the email|You are logged in/i)) wrangler(["login"], WORKER);

step(3, "Datenbank (D1) anlegen …");
let dbId = null;
const created = wrangler(["d1", "create", "truescope"], WORKER, { capture: true, allowFail: true });
dbId = created.out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? null;
if (!dbId) {
  const list = wrangler(["d1", "list", "--json"], WORKER, { capture: true, allowFail: true });
  try { dbId = JSON.parse(list.out.slice(list.out.indexOf("["))).find((d) => d.name === "truescope")?.uuid ?? null; } catch { /* handled below */ }
}
if (!dbId) { console.log(created.out); console.log(c.r("Konnte die Datenbank-ID nicht ermitteln.")); process.exit(1); }
console.log(c.g(`Datenbank bereit: ${dbId}`));

step(4, "Konfiguration schreiben …");
for (const [file, name] of [[join(WORKER, "wrangler.toml"), null], [join(FRONTEND, "wrangler.toml"), project]]) {
  let t = readFileSync(file, "utf8");
  t = t.replace(/database_id = "[^"]*"/, `database_id = "${dbId}"`).replace(/ADMIN_EMAIL = "[^"]*"/, `ADMIN_EMAIL = "${email}"`);
  if (name) t = t.replace(/^name = "[^"]*"/m, `name = "${name}"`);
  writeFileSync(file, t);
}
const pkg = join(FRONTEND, "package.json");
writeFileSync(pkg, readFileSync(pkg, "utf8").replace(/--project-name [a-z0-9-]+/, `--project-name ${project}`));

step(5, "Tabellen und echte Nachrichtenquellen in die Datenbank laden …");
wrangler(["d1", "migrations", "apply", "truescope", "--remote"], WORKER, { input: "y\n" });

step(6, "Backend-Worker (Nachrichten-Bot, läuft jede Minute) veröffentlichen …");
wrangler(["deploy"], WORKER);

step(7, "Website-Projekt anlegen und geheimen Passwort-Pepper setzen …");
wrangler(["pages", "project", "create", project, "--production-branch", "main"], FRONTEND, { capture: true, allowFail: true });
const secrets = wrangler(["pages", "secret", "list", "--project-name", project], FRONTEND, { capture: true, allowFail: true }).out;
if (!/PEPPER/.test(secrets)) {
  // set only once – changing it later would invalidate all existing passwords
  wrangler(["pages", "secret", "put", "PEPPER", "--project-name", project], FRONTEND, { input: randomBytes(32).toString("hex") + "\n" });
} else console.log("PEPPER ist bereits gesetzt – bleibt unverändert.");

step(8, "Website bauen und veröffentlichen …");
run(isWin ? "npm.cmd" : "npm", ["run", "build"], FRONTEND);
const dep = wrangler(["pages", "deploy", "out", "--project-name", project, "--branch", "main", "--commit-dirty=true"], FRONTEND, { capture: true });
console.log(dep.out.split("\n").slice(-6).join("\n"));

console.log(c.g(c.b(`\nFertig! Deine Website: https://${project}.pages.dev`)));
console.log(`(Falls der Name vergeben war, steht die genaue Adresse oben in der Ausgabe.)
Nächste Schritte:
  1. Website öffnen → „Konto erstellen“ mit ${c.b(email)} → du bist automatisch Admin.
  2. Die ersten Nachrichten erscheinen nach ca. 15–30 Minuten (der Bot arbeitet in kleinen Schritten).
  3. Status jederzeit unter „Admin“ ansehen.`);
