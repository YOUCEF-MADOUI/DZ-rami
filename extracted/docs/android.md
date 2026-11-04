# Application Android (Capacitor)

DZ-rami est un Next.js dont **presque tout le code est déjà côté client**
(moteur, règles, IA, interface). La voie retenue est donc **Capacitor** : la même
base de code est exportée en site statique et embarquée dans une application
Android, sans réécriture.

- **Solo, 2 contre 2 et multijoueur local** : fonctionnent **hors-ligne**, sans
  réseau, dès la première version.
- **Multijoueur en ligne** : disponible dans un second temps, en pointant l'app
  vers un serveur HTTPS hébergé (`NEXT_PUBLIC_API_BASE`).

## Ce qui est déjà prêt dans le dépôt

| Fichier | Rôle |
|---|---|
| `next.config.ts` | `DZ_MOBILE_EXPORT=1` bascule en `output: "export"` (le build web reste inchangé). |
| `tsconfig.mobile.json` | Typecheck du build mobile : application seulement, sans tests ni routes API. |
| `scripts/build-mobile.mjs` | Export statique dans `out/` : sort `src/app/api` du build (puis le restaure), vérifie `out/index.html`, accepte `--api-base`. |
| `capacitor.config.json` | `webDir: "out"`, `androidScheme: "https"` (origine stable pour `localStorage`), `appId: dz.rami.app`. |
| `src/game/online/api-base.ts` | `apiBase()`, `apiUrl()`, `isRemoteApi()` : même origine sur le web, serveur distant dans l'app. |

### Construire l'export

```bash
# Version hors-ligne (solo + 2 contre 2 + multijoueur local)
npm run build:mobile

# Version avec le multijoueur en ligne (serveur HTTPS obligatoire)
npm run build:mobile -- --api-base https://dz-rami.example.com
```

L'export pèse environ **2,7 Mo** (dont 1,7 Mo de cartes PNG).

## Mise en place de l'app (poste de développement, une fois)

Prérequis : **Node 20+**, **JDK 17**, **Android Studio** (SDK + build-tools),
variables `ANDROID_HOME` / `JAVA_HOME` définies.

```bash
cd extracted
npm install @capacitor/core @capacitor/cli @capacitor/android
npm install @capacitor/app @capacitor/status-bar   # bouton retour + barre d'état

npm run build:mobile
npx cap add android        # crée le projet android/ (à committer ensuite)
npx cap sync android
```

Les dossiers générés utiles sont `android/app/src/main/…` (icônes, splash,
`AndroidManifest.xml`). Les sorties de build sont déjà ignorées par
`.gitignore` (`android/app/build/`, `.gradle/`, `*.jks`…).

## APK signé (distribution directe)

```bash
# 1. Clé de signature (à conserver hors du dépôt)
keytool -genkeypair -v -keystore dz-rami-release.jks -alias dz-rami \
  -keyalg RSA -keysize 2048 -validity 10000

# 2. android/app/build.gradle -> signingConfigs { release { … } }
#    avec les mêmes informations, puis :

cd android
./gradlew assembleRelease     # APK : app/build/outputs/apk/release/
./gradlew bundleRelease       # AAB si publication Play Store plus tard
```

L'APK produit s'installe directement (autoriser « sources inconnues »). Il faut
incrémenter `versionCode` / `versionName` à chaque nouvelle version.

## Codes d'identité et ressources

- `appId` : `dz.rami.app` — **ne plus le changer** après la première publication.
- Icône 512×512 et splash (Android 12+) à déposer dans
  `android/app/src/main/res/`.
- Écran maintenu allumé pendant une partie : `WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON`
  ou `@capacitor-community/keep-awake`.
- Orientation : verrouiller `portrait` dans le manifeste si tu veux un rendu
  unique (l'interface est prévue pour le paysage ; à trancher).

## Réglages mobiles (faits)

1. **Hauteur d'écran** : `layout.tsx` et `page.tsx` utilisent `h-dvh`, la coquille
   `.app-shell` vaut `100dvh` avec repli `100vh` pour les vieux WebView. Sur un
   viewport 412×915 et 915×412 : **0 px de débordement**, tous les boutons
   visibles, barre d'infos et main accessibles.
2. **Safe areas** : `body` réserve `env(safe-area-inset-*)` (0 sur desktop) et
   `viewportFit: "cover"` est déclaré, avec `themeColor: #0f172a`.
3. **Bouton retour Android** : `src/game/native/android-back.ts` — retour au menu
   depuis n'importe quel écran, fermeture de l'app seulement depuis l'accueil.
   Sans `window.Capacitor` (le web), c'est un **no-op** total : aucune dépendance
   npm ajoutée, comportement navigateur inchangé.
4. **Aucun rebond** : `overscroll-behavior: none` déjà présent sur `html, body`.
5. **Lisibilité WebView** : `-webkit-text-size-adjust: 100%`, fond `#0f172a` pour
   éviter le flash blanc au démarrage.

## Réglages mobiles encore à faire (poste avec SDK Android)

- Verrouillage de l'orientation dans `AndroidManifest.xml` si un seul sens est
  retenu (le jeu est prévu pour le paysage, le portrait fonctionne aussi).
- Écran maintenu allumé pendant une partie (`FLAG_KEEP_SCREEN_ON`).
- Désactiver la sélection de texte au long appui sur les cartes.

## Multijoueur en ligne depuis l'app

Le client conserve **deux transports** : cookie (web) et **jeton dans le corps**
(`sessionToken`), prévu justement pour les environnements qui refusent les
cookies. Dans l'app, les requêtes sont cross-origin : le serveur doit répondre

- `Access-Control-Allow-Origin: https://localhost` (origine Capacitor) ou
  `https://dz.rami.app` si tu utilises un domaine custom ;
- `Access-Control-Allow-Credentials: true` si le cookie doit passer ;
- sinon, le transport par jeton fonctionne seul : rien d'autre à faire côté app.

Sans `--api-base`, l'app reste **100 % hors-ligne** : le bouton Multijoueur
signale simplement que le serveur n'est pas configuré.

## Ordre de travail conseillé

| Étape | Contenu | État |
|---|---|---|
| **0. Préparation** | base d'API configurable, export statique, script de build, config Capacitor | ✅ fait |
| **1. Coquille Android** | `cap add android`, test sur appareil, bouton retour, safe areas, `100dvh` | à faire sur un poste avec SDK |
| **2. Finition** | icônes, splash, écran maintenu allumé, orientation | à faire |
| **3. APK signé** | keystore, `assembleRelease`, diffusion | à faire |
| **4. En ligne (option)** | serveur HTTPS + `--api-base`, CORS | plus tard |

## Vérifications

```bash
npm run typecheck          # web + tests
npm run lint
npm test                   # moteur, UI, en ligne
npm run build              # build web inchangé
npm run build:mobile       # export Android (out/)
```

Les tests `api-base.test.ts` garantissent que le web reste en URL relative et
que l'app utilise bien l'URL absolue configurée.
