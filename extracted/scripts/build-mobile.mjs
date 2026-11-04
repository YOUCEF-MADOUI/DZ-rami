#!/usr/bin/env node
/**
 * Static export for the Android shell (Capacitor).
 *
 * The web build keeps its route handlers (`/api/multiplayer`, `/api/health`)
 * because it is served by a Node process. An embedded app has no server: the
 * export must not contain them, otherwise Next.js refuses `output: "export"`.
 * This script moves the folder away for the duration of the build and always
 * restores it, even when the build fails.
 *
 *   npm run build:mobile
 *   npm run build:mobile -- --api-base https://dz-rami.example.com
 *
 * Only the online mode uses `NEXT_PUBLIC_API_BASE`; solo, 2v2 and local
 * multiplayer are fully offline.
 */
import { spawnSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(root, "src", "app", "api");
const parkedApi = join(root, ".mobile-api-parked");
const outDir = join(root, "out");

/** `--api-base URL` (or NEXT_PUBLIC_API_BASE) points the APK at a hosted server. */
function apiBaseFromArgs() {
  const index = process.argv.indexOf("--api-base");
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return process.env.NEXT_PUBLIC_API_BASE ?? "";
}

const apiBase = apiBaseFromArgs().trim().replace(/\/+$/, "");
if (apiBase && !/^https:\/\//.test(apiBase)) {
  console.error(
    "✖ NEXT_PUBLIC_API_BASE doit être une URL HTTPS (ex. https://dz-rami.example.com).",
  );
  process.exit(1);
}

let parked = false;
function parkApi() {
  if (!existsSync(apiDir)) return;
  if (existsSync(parkedApi)) rmSync(parkedApi, { recursive: true, force: true });
  renameSync(apiDir, parkedApi);
  parked = true;
}
function restoreApi() {
  if (!parked) return;
  rmSync(apiDir, { recursive: true, force: true });
  renameSync(parkedApi, apiDir);
  parked = false;
}

console.log(
  apiBase
    ? `▶ Export Android — serveur en ligne : ${apiBase}`
    : "▶ Export Android — hors-ligne (multijoueur en ligne désactivé)",
);

try {
  parkApi();
  rmSync(outDir, { recursive: true, force: true });
  const result = spawnSync("npx", ["next", "build"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      DZ_MOBILE_EXPORT: "1",
      NEXT_PUBLIC_API_BASE: apiBase,
      // The database is only used by /api/health, which is not exported.
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://build:build@localhost:5432/build",
    },
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else if (!existsSync(join(outDir, "index.html")))
    throw new Error("L’export statique n’a produit aucun out/index.html.");
  else
    console.log(
      `\n✔ Export prêt dans out/ ${apiBase ? "(en ligne activé)" : "(solo, 2 contre 2 et multijoueur local)"}` +
        "\n  Étape suivante : npx cap sync android && cd android && ./gradlew assembleRelease",
    );
} catch (error) {
  console.error(`✖ Export Android échoué : ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  restoreApi();
}
