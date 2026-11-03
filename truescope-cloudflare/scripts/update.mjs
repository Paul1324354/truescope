#!/usr/bin/env node
// Re-deploy after code or config changes:  npm run update
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const sh = (cmd, args, cwd) => { const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: isWin }); if (r.status !== 0) process.exit(r.status ?? 1); };
const npx = isWin ? "npx.cmd" : "npx", npm = isWin ? "npm.cmd" : "npm";
sh(npx, ["wrangler", "d1", "migrations", "apply", "truescope", "--remote"], join(ROOT, "worker"));
sh(npx, ["wrangler", "deploy"], join(ROOT, "worker"));
sh(npm, ["run", "deploy"], join(ROOT, "frontend"));
console.log("\nAktualisiert.");
