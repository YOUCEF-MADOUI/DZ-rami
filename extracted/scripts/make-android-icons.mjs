#!/usr/bin/env node
/**
 * Génère les ressources Android (icône adaptative, icône ronde, splash) à partir
 * d'une seule image carrée : `android-assets/icon-source.png`.
 *
 *   node scripts/make-android-icons.mjs
 *
 * Nécessite Python + Pillow (dépendance d'outillage uniquement, pas du projet) :
 *   python3 -m venv .imgtool && .imgtool/bin/pip install pillow
 *   IMGTOOL_PYTHON=.imgtool/bin/python node scripts/make-android-icons.mjs
 *
 * Aucun fichier n'est produit si l'outil manque : le projet reste utilisable
 * avec les icônes par défaut de Capacitor.
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "android-assets", "icon-source.png");
const res = join(root, "android", "app", "src", "main", "res");
const python = process.env.IMGTOOL_PYTHON ?? "python3";

if (!existsSync(source)) {
  console.error(`✖ Image source introuvable : ${source}`);
  process.exit(1);
}
if (!existsSync(res)) {
  console.error("✖ Projet Android absent : lancez `npx cap add android` d'abord.");
  process.exit(1);
}

// Icône adaptative : 108 dp de zone, dont 72 dp visibles (le reste est rogné).
const LEGACY_DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const ADAPTIVE_DENSITIES = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const SPLASH = {
  drawable: [480, 320],
  "drawable-port-mdpi": [320, 480],
  "drawable-port-hdpi": [480, 800],
  "drawable-port-xhdpi": [720, 1280],
  "drawable-port-xxhdpi": [960, 1600],
  "drawable-port-xxxhdpi": [1280, 1920],
  "drawable-land-mdpi": [480, 320],
  "drawable-land-hdpi": [800, 480],
  "drawable-land-xhdpi": [1280, 720],
  "drawable-land-xxhdpi": [1600, 960],
  "drawable-land-xxxhdpi": [1920, 1280],
};

const script = join(root, "android-assets", ".render.py");
mkdirSync(join(root, "android-assets"), { recursive: true });
writeFileSync(
  script,
  `import json, os, sys
from PIL import Image, ImageDraw

src, res = sys.argv[1], sys.argv[2]
legacy = json.loads(sys.argv[3])
adaptive = json.loads(sys.argv[4])
splash = json.loads(sys.argv[5])
BACKGROUND = (26, 92, 46, 255)   # #1a5c2e, le tapis vert du jeu
icon = Image.open(src).convert("RGBA").resize((1024, 1024), Image.LANCZOS)

def ensure(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)

# Icône classique (avant Android 8) : l'image entière, coins arrondis gérés par le système.
for density, size in legacy.items():
    out = os.path.join(res, f"mipmap-{density}", "ic_launcher.png")
    ensure(out)
    icon.resize((size, size), Image.LANCZOS).save(out)
    out_round = os.path.join(res, f"mipmap-{density}", "ic_launcher_round.png")
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    rounded = icon.resize((size, size), Image.LANCZOS)
    rounded.putalpha(mask)
    rounded.save(out_round)

# Icône adaptative : avant-plan = image réduite avec marge de sécurité (72/108),
# arrière-plan = couleur unie du tapis.
for density, size in adaptive.items():
    foreground = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = int(size * 72 / 108 * 0.86)
    art = icon.resize((inner, inner), Image.LANCZOS)
    offset = (size - inner) // 2
    foreground.alpha_composite(art, (offset, offset))
    out = os.path.join(res, f"mipmap-{density}", "ic_launcher_foreground.png")
    ensure(out)
    foreground.save(out)

# Splash : fond vert, icône centrée sur 28 % du plus petit côté.
for folder, (width, height) in splash.items():
    canvas = Image.new("RGBA", (width, height), BACKGROUND)
    logo = int(min(width, height) * 0.28)
    art = icon.resize((logo, logo), Image.LANCZOS)
    canvas.alpha_composite(art, ((width - logo) // 2, (height - logo) // 2))
    out = os.path.join(res, folder, "splash.png")
    ensure(out)
    canvas.convert("RGB").save(out)

print("icônes et splashes générés")
`,
);

const run = spawnSync(
  python,
  [
    "-c",
    "import PIL",
  ],
  { stdio: "ignore" },
);
if (run.status !== 0) {
  console.error(
    "✖ Pillow est requis. Créez un environnement :\n" +
      "  python3 -m venv .imgtool && .imgtool/bin/pip install pillow\n" +
      "  IMGTOOL_PYTHON=.imgtool/bin/python node scripts/make-android-icons.mjs",
  );
  process.exit(1);
}

const render = spawnSync(
  python,
  [
    script,
    source,
    res,
    JSON.stringify(LEGACY_DENSITIES),
    JSON.stringify(ADAPTIVE_DENSITIES),
    JSON.stringify(SPLASH),
  ],
  { cwd: root, stdio: "inherit" },
);
process.exit(render.status ?? 1);
