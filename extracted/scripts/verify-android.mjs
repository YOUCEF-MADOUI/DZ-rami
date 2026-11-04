#!/usr/bin/env node
/**
 * Contrôle statique du projet Android, exécutable sans SDK ni Gradle.
 *
 *   node scripts/verify-android.mjs
 *
 * Vérifie que l'APK produira bien l'application attendue : export web présent,
 * identité, permissions, thème, splash, signature et ressource de l'écran de
 * démarrage. Sort en erreur (code 1) si un élément manque.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const android = join(root, "android");
const res = join(android, "app", "src", "main", "res");
const problems = [];
const checks = [];
function check(label, ok, detail = "") {
  (ok ? checks : problems).push(ok ? label : `${label}${detail ? ` — ${detail}` : ""}`);
}
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");

/* --- Export web embarqué ---------------------------------------------------- */
const assets = join(android, "app", "src", "main", "assets", "public");
check("Export web copié dans l'APK", existsSync(join(assets, "index.html")));
check("Cartes présentes dans l'APK", existsSync(join(assets, "cards")) && readdirSync(join(assets, "cards")).length > 0);
const bundleSize = existsSync(join(assets, "_next"))
  ? readdirSync(join(assets, "_next", "static", "chunks"))
      .map(file => statSync(join(assets, "_next", "static", "chunks", file)).size)
      .reduce((total, size) => total + size, 0)
  : 0;
check("Bundle JS/CSS généré", bundleSize > 100_000, `${Math.round(bundleSize / 1024)} Ko`);

/* --- Identité et configuration --------------------------------------------- */
const capacitor = JSON.parse(read("capacitor.config.json"));
check("Identité de l'application", /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(capacitor.appId), capacitor.appId);
check("Nom affiché", capacitor.appName === "DZ-rami", capacitor.appName);
check("Dossier web = export statique", capacitor.webDir === "out", capacitor.webDir);
check("Schéma https (origine stable pour localStorage)", capacitor.server?.androidScheme === "https");
const gradle = read("android", "app", "build.gradle");
const embedded = JSON.parse(read("android", "app", "src", "main", "assets", "capacitor.config.json"));
check("appId identique côté natif", gradle.includes(`applicationId "${capacitor.appId}"`));
check("webDir identique côté natif", embedded.webDir === capacitor.webDir);

/* --- Manifeste -------------------------------------------------------------- */
const manifest = read("android", "app", "src", "main", "AndroidManifest.xml");
check("Permission Internet déclarée", manifest.includes("android.permission.INTERNET"));
check("Aucune permission sensible inutile", !/READ_CONTACTS|CAMERA|ACCESS_FINE_LOCATION|READ_EXTERNAL/.test(manifest));
check("Activité principale exportée", /android:name="\.MainActivity"[\s\S]*?android:exported="true"/.test(manifest));
check("Icône ronde déclarée", manifest.includes('android:roundIcon="@mipmap/ic_launcher_round"'));
check("Thème de lancement (splash)", manifest.includes("@style/AppTheme.NoActionBarLaunch"));

/* --- Ressources graphiques -------------------------------------------------- */
const densities = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
check(
  "Icônes générées pour toutes les densités",
  densities.every(d => existsSync(join(res, `mipmap-${d}`, "ic_launcher.png")) && existsSync(join(res, `mipmap-${d}`, "ic_launcher_round.png"))),
);
check(
  "Icône adaptative (avant-plan + fond)",
  existsSync(join(res, "mipmap-anydpi-v26", "ic_launcher.xml")) &&
    read("android", "app", "src", "main", "res", "values", "ic_launcher_background.xml").includes("#1A5C2E"),
);
check("Splash présent en portrait et paysage", existsSync(join(res, "drawable-port-xxhdpi", "splash.png")) && existsSync(join(res, "drawable-land-xxhdpi", "splash.png")));
check("Couleurs du thème définies", existsSync(join(res, "values", "colors.xml")));
const styles = read("android", "app", "src", "main", "res", "values", "styles.xml");
check("Barres système sombres", /navigationBarColor">#0F172A/.test(styles));
check("Pas de mode sombre imposé par le système", styles.includes("android:forceDarkAllowed\">false"));
check("postSplashScreenTheme défini", styles.includes("postSplashScreenTheme"));

/* --- Signature -------------------------------------------------------------- */
check("Signature pilotée par variables d'environnement", gradle.includes("DZ_KEYSTORE_FILE") && !/storePassword\s+"[^"]+"/.test(gradle));
check("Aucun keystore dans le dépôt", !readdirSync(join(root, "android")).some(f => f.endsWith(".jks") || f.endsWith(".keystore")));

/* --- Coquille native -------------------------------------------------------- */
const activity = read("android", "app", "src", "main", "java", "dz", "rami", "app", "MainActivity.java");
check("Écran maintenu allumé", activity.includes("FLAG_KEEP_SCREEN_ON"));
check(
  "Plugin retour Android installé",
  read("package.json").includes("@capacitor/app"),
);

const lines = [...checks.map(label => `✅ ${label}`), ...problems.map(label => `❌ ${label}`)];
console.log(lines.join("\n"));
console.log(`\nAndroid : ${checks.length} contrôles réussis, ${problems.length} échec(s).`);
process.exit(problems.length ? 1 : 0);
