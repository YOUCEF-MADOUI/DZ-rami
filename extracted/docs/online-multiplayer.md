# Multijoueur en ligne — DZ-Rami

## Audit initial

- `HomeScreen.tsx` avait **un** bouton « Multijoueur ». Il ouvrait un formulaire
  « Multijoueur Local » (noms et nombre de joueurs).
- `page.tsx:handleStartMulti` lançait ensuite le même `GameScreen` local. Le moteur
  initialisait encore les autres joueurs avec `isAI: true` : ce n'était pas un
  multijoueur réseau, ni un véritable partage de mains entre appareils.
- Aucune route de table, session ou synchronisation n'existait. Seule la route
  `/api/health` utilisait PostgreSQL. Le schéma Drizzle était vide.
- Le moteur était indépendant du DOM, avec un validateur complet et une projection
  publique `projectPlayerView`. Ces composants sont réutilisés, pas réécrits.

Le **bouton existant** ouvre désormais `OnlineLobby`. Son ancien formulaire reste
accessible par « Mode local existant » ; les modes solo/équipes contre IA sont
inchangés. Aucun second bouton Multijoueur n'a été créé.

## Architecture et garanties

- Next.js App Router, React et TypeScript restent en place ; aucune conversion mobile.
- `POST /api/multiplayer` : session, création, entrée/sortie, prêt, démarrage,
  reprise du rôle d'hôte, heartbeat et actions de jeu.
- `GET /api/multiplayer` : instantané autorisé pour la session.
- `GET /api/multiplayer/events` : SSE authentifié par cookie/en-tête, conservé pour
  les déploiements classiques. Le client utilise `POST /api/multiplayer` avec
  `command: "watch"` (long-poll 2,5 s maximum, jeton dans le corps) : ce canal
  fonctionne même si le proxy d'aperçu supprime cookies et en-têtes. Les
  heartbeats **clients** toutes les 5 secondes prouvent la présence (un serveur
  qui écrit dans un flux ne prouve pas que le client reçoit encore les données).
- Le serveur conserve le `GameState` complet. Les navigateurs reçoivent uniquement
  la projection autorisée : leur main, leur brouillon, les combinaisons publiques,
  défausses visibles, nombres de cartes et scores. Les propositions d'actions du
  moteur ne sont envoyées **qu'au joueur actif**, car elles examinent sa main.
- Le serveur obtient l'identité du joueur depuis une session opaque de 256 bits.
  Cette session voyage par cookie `HttpOnly`, `Secure`, `SameSite=None` et
  `Partitioned` sur HTTPS (preview en iframe), et par en-tête
  `Authorization: Bearer` lorsque le navigateur ou un mandataire refuse le cookie.
  Le jeton est exactement celui du cookie, délivré dans le corps de la réponse
  uniquement si le client le demande explicitement (`tokenTransport: true`),
  conservé dans `sessionStorage` (portée de l'onglet) et jamais placé dans une URL.
  En HTTP direct de développement, `SameSite=Lax` est conservé. Aucun `playerId` fourni
  par le client n'est accepté comme identité. Les tokens sont indexés par SHA-256
  dans le stockage et ne figurent ni dans les listes ni dans les messages SSE.
- Le client ne considère une session comme utilisable qu'après un aller-retour
  authentifié vérifié. Si le cookie n'est pas conservé, il bascule
  automatiquement sur le même jeton en en-tête, sans intervention manuelle.
  Aucune identité joueur (`playerId`, `viewerId`, place de siège) envoyée par le
  client n'est utilisée : l'identité vient toujours de la session authentifiée,
  et un en-tête forgé ou expiré répond 401.
- Les mots de passe privés sont hachés par **scrypt**, avec sel aléatoire de
  128 bits. Comparaison en temps constant. Jamais renvoyés aux joueurs. L'invitation
  contient l'URL et le code ; l'hôte communique le mot de passe séparément.
- Schéma de configuration filtré, charge utile limitée à 16 Kio, contrôle Origin
  sur POST, limites de fréquence et de connexions SSE. Pour une exposition publique
  importante, ajouter aussi limitation IP/WAF au reverse proxy : il n'y a pas
  d'inscription de comptes, de CAPTCHA ou de protection anti-DDoS intégrée.
- Révision optimiste de table + identifiant de requête (128 derniers identifiants
  par session). Les requêtes répétées n'exécutent pas une seconde action ; les
  versions obsolètes sont refusées. Aucun changement de jeu optimiste côté client.
- Toutes les actions passent par les fonctions du moteur existant et un audit des
  **108 cartes** avant sauvegarde. Aucun score, seuil, RS/RJ, rotation ni exemption
  d'équipe modifié. Tous les participants en ligne sont humains (`isAI:false`).
- Le port RNG synchrone optionnel de `deck.ts` permet au serveur d'utiliser
  `crypto.randomInt` pour les mélanges/tirages/recyclages ; le solo et ses tests
  conservent leur source aléatoire existante.
- Interface en ligne : composants `PlayerHand`, `CardView`, `OpponentHand`,
  `FittedTable`, `DiscardSpread`, effets de défausse/pioche et `ScoreBoard`
  réutilisés. Tri, réorganisation par Pointer Events, verrouillage, poses,
  ajout/récupération du Joker, choix d'extrémité, retour de carré, annulation
  CHOP/brouillon, confirmation d'ouverture, signalement et manches suivantes.
  L'ordre/verrouillage de la main est une préférence locale, pas une mutation du
  moteur. Une reconnexion ne rejoue pas l'animation initiale de distribution.

## Sessions, absences, départs

- La reconnexion nécessite **le même cookie** : même navigateur, même origine et même contexte de partitionnement
  (site intégrant le preview). Ouvrir dans un nouvel onglet peut utiliser une
  autre partition et donc une autre session.
  On ne peut pas prendre le siège d'un autre joueur en réutilisant son nom.
- Une session dure 30 jours, prolongée par l'activité sauvegardée. Ce n'est pas un
  compte utilisateur ; aucun transfert automatique vers un autre appareil.
- Après environ 15 secondes sans heartbeat, le joueur est affiché absent.
  Sa main et son tour restent en place. Aucun bot, remplacement, redistribution,
  saut de tour ni forfait avec score inventé.
- En salle d'attente, « Quitter » libère le siège ; le prochain joueur peut
  l'occuper. Si l'hôte quitte, le rôle passe à un membre restant.
- Pendant la partie, « Quitter » ferme l'écran mais **réserve le siège**. Le rôle
  d'hôte est transféré. Le joueur peut revenir via le bouton Multijoueur.
  Les autres attendent s'il est le joueur actif. C'est une politique explicite
  de pause, pas une règle de remplacement automatique.
- Après 30 secondes sans présence de l'hôte, un membre connecté peut reprendre
  le rôle. Le premier à le faire gagne la révision ; aucune double attribution.
- Une table expire après la durée configurée sans activité d'aucun membre. La
  table expirée n'est pas recréée lors d'une reconnexion. Nettoyage paresseux lors
  des nouvelles commandes/sessions/heartbeats ; tables expirées retirées des listes.
- Les actions et sessions sont sauvegardées par remplacement atomique du fichier.
  Rechargement après redémarrage et restauration des références d'actions requises
  par l'annulation de brouillon. Ne supprimez pas ce fichier en déploiement.

## Développement et preview

```sh
npm ci
npm run dev -- --hostname 0.0.0.0 --port 3000
```

Stockage par défaut : `.multiplayer/state.json` (ignoré par Git, permissions
répertoire 0700/fichier 0600). Les requêtes navigateur utilisent des URL relatives,
jamais `localhost` pour joindre le serveur depuis un appareil distant.

Le preview Arena est temporaire. Les tests Chromium utilisent des contextes
indépendants et le serveur HTTP local. **Ils ne prouvent pas un déploiement
permanent, une connexion entre téléphones physiques ni un test depuis deux
réseaux Internet distincts.** Le preview peut être partagé tant que son proxy
reste accessible et le processus actif ; les éventuels contrôles d'accès Arena
restent ceux de la plateforme.

## Hébergement permanent requis

Choisir un **serveur Node unique, toujours actif**, avec volume persistant, par
exemple un VPS derrière Caddy/nginx, ou un conteneur unique avec disque persistant.
**Pas d'hébergement statique, pas de fonctions serverless à courte durée, pas de
plusieurs workers/réplicas, pas de PM2 cluster avec ce backend fichier.** Les
transactions sont synchrones dans un seul processus. Plusieurs processus sur le
même fichier risquent de perdre des mises à jour. Le stockage fichier convient à
un petit déploiement, pas à une plateforme à grande échelle. Une évolution
multi-instance nécessitera PostgreSQL/Redis avec transactions, verrouillage et
pub/sub, pas seulement une variable de connexion.

```sh
npm ci
DATABASE_URL='postgresql://…' npm run build
# Exemple d'emplacement sur un VOLUME MONTÉ, accessible seulement au compte serveur :
export MULTIPLAYER_STORE_PATH=/var/lib/dz-rami/state.json
export MULTIPLAYER_PUBLIC_ORIGIN=https://votre-domaine.example
export MULTIPLAYER_RETENTION_MINUTES=1440
npm run start -- --hostname 0.0.0.0 --port 3000
```

- `MULTIPLAYER_PUBLIC_ORIGIN` : origine HTTPS exacte, sans chemin. CORS n'est pas
  ouvert globalement. En production, l'API refuse de démarrer sans cette origine
  HTTPS et un chemin de stockage absolu.
- `MULTIPLAYER_STORE_PATH` : sauvegarde complète **privée**. Hors répertoire public,
  sur volume durable, sauvegardes chiffrées recommandées, accès réservé au serveur.
  Son contenu donne accès à toutes les mains au personnel qui administre le serveur.
- `MULTIPLAYER_RETENTION_MINUTES` : 5 à 10080 ; défaut 1440 (24 h).
- `DATABASE_URL` : utilisée par la route de santé PostgreSQL déjà existante,
  **pas** par ce service multijoueur fichier. Le schéma DB existant n'est pas modifié.
- Configurer TLS, DNS, redémarrage automatique du processus, backups et surveillance.
- Proxy SSE : désactiver le buffering, conserver les connexions, timeout > heartbeat
  (par exemple `proxy_buffering off; proxy_read_timeout 90s;`). Préserver Host/Origin.
- Un seul point d'entrée HTTPS : UI et API même origine. Une future application
  Android pourra utiliser les mêmes endpoints, le cookie de session et SSE, avec
  une politique d'origine explicite. Aucun code Android n'est ajouté ici.

Aucun fournisseur ni domaine permanent n'a été provisionné par cette tâche.
Aucune clé secrète externe n'est requise pour ce backend autonome.

## Vérifications

```sh
npm run typecheck
npm run lint
npm test                  # inclut les tests en ligne
npm run test:online       # tests isolés du service, stockage temporaire
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/app_db' npm run build
git diff --check
```

Test navigateur facultatif : `scripts/test-online-browser.cjs` utilise Playwright
et `@sparticuz/chromium`, installés sans modifier le manifeste. Adapter
`LD_LIBRARY_PATH` si le système a besoin des bibliothèques Chromium. Ne pas utiliser
`--disable-web-security` ni `--single-process` : ils désactivent Origin/isolation
et invalident un test de confidentialité multi-session. Le test crée des tables
préfixées « Browser … » ; l'exécuter de préférence avec un stockage de test isolé.

Les tests du service vérifient authentification, mots de passe, liste/capacité,
préparation/hôte, confidentialité, actions hors tour/dupliquées/obsolètes,
reconnexion avec relecture disque, hôte absent, départ, CHOP/carré rentré,
brouillon privé/annulation après rechargement/ouverture, signalement confirmé,
RS/RJ/scores/manche suivante, sièges opposés 2v2 et expiration.

## Résultats de cette implémentation

- TypeScript, ESLint, build Next.js et `git diff --check` : réussis.
- `npm test` : toutes les suites passent, dont **17 scénarios serveur en ligne**,
  **180 contrôles UI**, **19 scénarios équipes**.
- Chromium réel : **15 vérifications**, avec **4 contextes isolés** et une session
  API supplémentaire : bouton existant, table publique, préparation/démarrage,
  cartes privées, réorganisation native, défausse/pioche synchronisées, actualisation,
  coupure/reconnexion réseau, table privée, mauvais/bon mot de passe, capacité,
  origine refusée et affichage mobile. Les tests serveur couvrent les fins de manche
  RS/RJ, scores, ouvertures et signalements ; ils ne sont pas tous rejoués à la souris.
- Régression IA classique : **500 simulations**, 475 manches terminées, 25 atteignant
  la limite de 800 tours (pas présentées comme terminées), aucun tour bloqué,
  194 844 audits intermédiaires des 108 cartes.
- Régression équipes : **110 simulations terminées**, aucun plafonnement,
  22 988 audits intermédiaires.
- Pas de test sur téléphones physiques, Safari/Firefox, ni de charge Internet.
  Aucun hébergement permanent configuré ou validé.
- Aucun commit, push ou merge effectué.

### Fichiers de cette tâche

Modifiés :

- `src/app/page.tsx`, `src/components/HomeScreen.tsx` : connexion du bouton existant.
- `src/app/globals.css` : écrans en ligne et contrôles.
- `src/game/core/deck.ts` : injection RNG synchrone optionnelle, sans changement de règle.
- `package.json` : commande `test:online` et inclusion dans `npm test`.
- `.gitignore` : exclusion du stockage serveur.

Ajoutés :

- `src/game/online/{protocol,server,http}.ts` : DTO, service autoritaire et sécurité HTTP.
- `src/app/api/multiplayer/route.ts`, `src/app/api/multiplayer/events/route.ts`.
- `src/components/online/{OnlineLobby,OnlineGameScreen}.tsx`.
- `src/game/tests/online-tests.ts`, `scripts/test-online-browser.cjs`.
- `docs/online-multiplayer.md` : ce rapport et les instructions d'hébergement.

Les autres modifications déjà présentes sur la branche avant cette tâche ont été
conservées. Aucune dépendance de production supplémentaire n'est nécessaire.


## Correctif du formulaire / connexion dans le preview

### Diagnostic avant modification

Le bouton « Créer » dépendait de `busy || !connected || !name.trim()` ; le nom de
la table et le mot de passe étaient des contraintes HTML séparées. Aucun texte
n'expliquait tous les blocages. « ○ » était un indicateur déconnecté, pas un zéro.

Les journaux montraient la création de session en HTTP 200, suivie du SSE et des
heartbeats en HTTP 401. Avec un cookie transmis explicitement, GET, heartbeat et
SSE répondaient 200. La reproduction Chromium a confirmé : cookie `SameSite=Lax`
accepté en accès direct, mais refusé dans un iframe inter-sites avec la raison
**`SchemefulSameSiteLax`**. Dans l'iframe, aucun cookie n'était conservé et le
serveur répondait « Session requise ». Ce n'était donc pas un serveur arrêté.

### Changements

- Cookie HTTPS `HttpOnly; Secure; SameSite=None; Partitioned`, y compris derrière
  un proxy HTTP lorsque l'origine HTTPS a été validée. Les contrôles Origin,
  sessions et validations du moteur restent obligatoires. Aucun token n'est
  retourné au JavaScript ni stocké dans localStorage.
- Vérification du retour du cookie avec un GET authentifié immédiatement après
  la création de session. Le seul succès de POST/session ne suffit plus.
- Délai maximum de 10 secondes sur les requêtes ; raisons explicites pour réseau,
  HTTP 401/403/503, réponse invalide et timeout. Reconnexion sans rechargement ni
  effacement des champs. Si les cookies sont encore bloqués par le navigateur,
  lien pour ouvrir le jeu directement dans un nouvel onglet.
- En cas d'échec du SSE **seul**, le statut précise l'actualisation HTTP authentifiée
  toutes les 5 secondes. Cela utilise le vrai serveur, sans données simulées ni
  contournement de session. En cas d'échec de l'authentification ou du serveur HTTP,
  les commandes restent désactivées.
- Liste accessible des raisons bloquant la création : nom du joueur, nom de
  table (espaces seuls refusés), mot de passe privé, requête en cours, connexion.
- Classe d'erreur serveur mise en cache comme le service pour conserver les
  codes 401/403 après les rechargements à chaud de Next (au lieu d'une erreur 500
  générique due à une comparaison `instanceof` avec une ancienne classe).

### Tests spécifiques

- `npm run test:online-form` : **11 tests** (validation, diagnostics, cookies,
  proxy HTTPS, maintien du contrôle Origin et des codes d'erreur).
- `scripts/test-online-form-browser.cjs` : **16 contrôles Chromium** avec le vrai
  serveur, un proxy TLS local et un parent iframe d'un autre site. Création réelle,
  formulaire incomplet, mot de passe court, cookies partitionnés/HttpOnly,
  rechargement au même siège, cookies refusés, panne réseau et HTTP 503,
  reconnexion conservant les champs, SSE indisponible avec HTTP authentifié.
  Seuls les scénarios de panne interceptent le transport ou la livraison du cookie ;
  aucune partie ou réponse de succès n'est simulée.
- `scripts/test-online-browser.cjs` : **15 contrôles multijoueurs de régression**.
- Les deux scripts navigateur nécessitent les dépendances temporaires Playwright
  et Chromium décrites plus haut. Le test formulaire génère un certificat TLS de
  test avec `openssl`, ferme ses proxies et supprime le certificat après exécution.
- Safari, Firefox et le navigateur physique de l'utilisateur ne sont pas pilotés
  par ces tests. Un navigateur qui refuse également les cookies partitionnés doit
  utiliser l'ouverture directe ; l'authentification n'est jamais désactivée.

Fichiers du correctif : `src/components/online/OnlineLobby.tsx`,
`src/game/hooks/useOnlineConnection.ts`, `src/game/online/{client,errors,http,server}.ts`,
`src/app/api/multiplayer/route.ts`, `src/game/tests/online-form-tests.ts`,
`scripts/test-online-form-browser.cjs`, `package.json`, ce document.


## Correctif de session dans l'environnement Arena (jeton + cookie)

### Cause exacte du HTTP 401

La requête qui répondait 401 était la **vérification `GET /api/multiplayer`**
immédiatement après la création de session, puis **`POST /api/multiplayer`
(`command: "heartbeat"`)** et **`GET /api/multiplayer/events`** (SSE). Dans
`src/game/online/http.ts`, `tokenFrom()` ne lisait **que** le cookie
`dz-rami-online`. La création de session répondait bien 200 et posait le cookie,
mais l'aperçu Arena s'affiche dans un iframe inter-sites : lorsque le navigateur
(ou un mandataire) refuse ce cookie, aucune requête suivante n'est authentifiée.
Le serveur n'était donc pas arrêté : il répondait 401 « Session requise ».

Mesures effectuées dans Chromium sur un proxy TLS local et un parent d'un autre
site :

| Environnement | Cookie conservé | Transport utilisé |
| --- | --- | --- |
| HTTPS direct | oui (`SameSite=None; Secure; Partitioned`) | cookie |
| iframe inter-sites | oui | cookie |
| iframe + verrouillage des cookies tiers de Chrome | oui (cookie partitionné) | cookie |
| navigateur/mandataire refusant le cookie | non | **jeton (nouveau)** |

Aucun cookie n'était bloqué dans les trois premiers cas : la limitation ne
concernait que les navigateurs ou mandataires qui refusent réellement le cookie,
ce qui ne peut pas être corrigé côté client autrement qu'avec un second transport.

### Changements

- `optionalToken()` accepte le cookie **ou** `Authorization: Bearer <jeton>`
  opaque (16–200 caractères). `tokenFrom()` refuse tout le reste avec un message
  explicite ; aucune autorisation n'est affaiblie.
- `POST /api/multiplayer {command:"session", tokenTransport:true}` renvoie le
  même jeton que le cookie, uniquement sur demande explicite. La route réutilise
  toute session valide présentée par cookie **ou** en-tête : une reconnexion
  conserve donc le même siège.
- `bootstrapSession()` : création de session, puis **vérification authentifiée
  forcée du cookie** (`auth: "cookie"`). Si elle échoue en 401, le client demande
  le jeton, le conserve dans `sessionStorage` et revérifie. Le statut n'affiche
  « Connecté » que si l'un des deux transports a réellement été validé.
- Le temps réel utilise la commande POST `watch` (long-poll : le serveur garde la
  requête jusqu'à un vrai changement, 2,5 s maximum). Comme le jeton voyage dans
  le corps, ce canal traverse tout proxy qui accepte un POST, sans cookie ni
  en-tête. `GET /api/multiplayer/events` (SSE) reste disponible côté serveur, mais
  n'est plus requis par le client. Le heartbeat de 5 s sert de filet de sécurité.
- Indicateur stable `data-online-transport` (`cookie`, `token`, `none`) affiché
  dans la barre de statut : le diagnostic ne dépend plus d'un texte transitoire.
- Correction associée : une réponse **409 « La table a changé »** (autre joueur
  venant d'agir) est désormais rejouée **une fois avec le même `requestId`** après
  observation de la nouvelle révision. Comme le serveur déduplique les
  identifiants de requête, l'action est appliquée au plus une fois ; auparavant
  le bouton « Prêt » restait bloqué après l'arrivée d'un joueur.
- Rien n'a changé dans les règles du Rami, le moteur, les scores, les seuils ni
  les contrôles d'origine, de mot de passe et d'autorisation.

### Tests de ce correctif

- `npm run test:online-session` : **8 tests** au niveau des routes HTTP réelles —
  401 explicite sans identifiant, cookie posé sans jeton divulgué par défaut,
  même jeton accepté en en-tête, `tokenTransport` qui réutilise la session
  existante, jetons forgés/malformés/absents refusés, identités `playerId`/
  `viewerId` du corps ignorées, action hors tour refusée (403) sans modification
  d'état, contrôle d'origine et limitation de fréquence inchangés.
- `scripts/test-online-session-browser.cjs` : **10 contrôles Chromium** sur le vrai
  serveur. Le blocage du cookie est reproduit comme le serveur le subit : toute
  requête arrivant sans jeton reçoit le **401 réel** du serveur. Parcours complet :
  ouverture, session, repli automatique sur jeton, création d'une table publique,
  flux SSE et heartbeat sur la même session, actualisation de la page qui conserve
  le siège et la main, second joueur dans un autre navigateur (sièges Sud/Nord),
  démarrage d'une vraie partie, confidentialité des mains, cas témoin avec cookie,
  échec total explicite avec bouton Reconnecter, et SSE refusé avec repli HTTP.
- `scripts/test-online-form-browser.cjs` : **14 contrôles** (formulaire, mot de
  passe, iframe HTTPS réelle, serveur indisponible, SSE indisponible, panne après
  connexion).
- `scripts/test-online-browser.cjs` : **15 contrôles** multijoueurs de régression.
- Combinés : `typecheck`, `lint`, `npm test` (toutes suites, dont IA et équipes),
  `npm run build` et `git diff --check` réussis.

### Limite restante

Aucun test n'a été fait sur un téléphone physique, Safari ou Firefox. Si un
navigateur bloque **à la fois** le cookie et l'écriture dans `sessionStorage`,
l'application l'indique explicitement avec un bouton « Reconnecter » et un lien
pour ouvrir le jeu dans un nouvel onglet ; elle ne simule jamais une connexion.
Le déploiement permanent reste à faire (serveur Node unique + volume persistant,
origine HTTPS, proxy laissant passer `Set-Cookie` et le SSE non tamponné).


## Correctif de session dans l'environnement Arena (jeton de corps + long-poll)

### Ce qui échouait encore

La correction précédente utilisait `Authorization: Bearer` comme repli. Dans
l'aperçu, le proxy peut **à la fois** refuser `Set-Cookie` **et** réécrire ou
supprimer les en-têtes de requête. Les trois requêtes authentifiées
(`POST /api/multiplayer` heartbeat, `command: "watch"`/`GET .../events`, et
toute commande) repartaient alors en **HTTP 401 « Session requise »**, et
l'interface affichait « Serveur ou session indisponible » + « Aucune session
vérifiée ». Preuve mesurée : en supprimant cookie **et** en-têtes d'autorisation
côté client, le serveur répond 401 sur toutes les requêtes authentifiées alors
que la création de session répond 200 — le corps de la requête, lui, arrive
toujours.

### Correction

- `optionalToken()` accepte désormais quatre transports du **même** jeton opaque :
  cookie, `Authorization: Bearer`, `X-DZ-Session`, et **`sessionToken` dans le
  corps POST**. Format strictement validé (`^[A-Za-z0-9_-]{16,200}$`).
- Le client envoie le jeton dans le corps de **toutes** les commandes ; il ne
  dépend donc plus ni d'un cookie, ni d'un en-tête.
- La vérification de session utilise `POST heartbeat` (et non plus un GET) : elle
  prouve le transport réellement retenu et ne peut pas réussir « à tort ».
- Nouveau canal temps réel `command: "watch"` : long-poll automatique dans le
  corps, réponse immédiate dès qu'un changement survient, sinon 2,5 s maximum.
  Latence mesurée ~0,2 s.
- L'interface indique le transport retenu (`data-online-transport="cookie"|"token"|"none"`)
  et la **requête exacte en échec** (`data-online-last-failure`), par exemple
  `POST /api/multiplayer → HTTP 401 · Session requise…`.
- Aucune protection retirée : contrôle d'origine (`requireOrigin`) sur POST,
  mot de passe scrypt, déduplication des requêtes, limitation de fréquence,
  audit des 108 cartes, refus des actions hors tour et des identités fournies
  par le client.

### Vérifications exécutées

- `scripts/check-preview-session.cjs` (nouveau) : pilote **l'interface réelle**
  derrière un proxy TLS et un parent inter-sites, en supprimant cookie et
  en-têtes d'autorisation de chaque requête API. Résultat : transport `token`,
  bouton « Créer » actif, **table réellement créée**, siège conservé après
  actualisation, aucune erreur console.
- `npm run test:online-session` : **10 tests** (401 explicite sans identifiant,
  cookie sans jeton divulgué, jeton identique en en-tête, réutilisation de
  session via `tokenTransport`, jetons forgés/malformés refusés, identités
  client ignorées, action hors tour refusée, origine + limitation de fréquence,
  **jeton de corps seul valide**, **watch qui ne se réveille que sur un vrai
  changement**).
- `scripts/test-online-session-browser.cjs` : **10 contrôles** (proxy hostile :
  cookie + en-têtes supprimés → repli jeton → table → second joueur → partie
  réelle → actualisation → cas témoin cookie → échec explicite → watch indisponible).
- `scripts/test-online-form-browser.cjs` : **14 contrôles**.
- `scripts/test-online-browser.cjs` : **15 contrôles**.
- `npm test` complet (moteur, IA 500 parties, équipes), `typecheck`, `lint`,
  `build`, `git diff --check` : réussis.

### Note d'environnement

Installer Playwright **dans** `extracted/` avec `npm install --no-save` supprime
une dépendance transitive de Tailwind (`enhanced-resolve`) et casse le CSS du
serveur de dev (`Cannot find module 'enhanced-resolve'`, page 500). Les outils
navigateur doivent être installés **hors du projet** (par exemple `/home/user/browsertest`)
et utilisés via `NODE_PATH`. De même, `npm run build` ne doit pas être lancé
pendant que le serveur de dev tourne : ils partagent `.next`.


## Retour à la présentation d’origine et règles choisies par le créateur

### Ce que l’interface a retrouvé

L’intégration multijoueur avait introduit un menu en ligne parallèle : titres
sans barre d’en-tête, boutons de tailles différentes, listes en `<article>`
sans `btn-primary`, « Menu / Quitter la table » en texte nu, et absence de la
barre VIERGE/SUITE/TOTAL pendant la partie en ligne.

- En-tête identique à **Paramètres** et **Scores** : `p-4 border-b border-slate-700`,
  « ← Retour » ambre et gras à gauche, titre ambre centré. Un seul « ← Retour »
  contextuel par écran (retour au menu principal, ou retour à la liste).
- Boutons aux classes historiques `btn-primary` / `btn-secondary`, empilés dans
  une colonne de même largeur (`max-w-md`), exactement comme le menu principal.
- Salle d’attente et écran de jeu alignés sur les conventions locales
  (`bg-slate-800 rounded-lg`, `game-info-bar`, `local-player-summary`).
- La barre de statut de connexion reste visible pendant la partie.
- Le mode local existant est toujours accessible (**💻 Mode local existant**),
  et les écrans du jeu local (solo, paramètres, scores) n’ont pas changé.

### Règles choisies avant la création de la table

- `src/components/rules/GameRulesFields.tsx` : **source unique** des champs de
  règles, partagée par `SettingsScreen` (paramètres généraux) et par le panneau
  de création en ligne. Aucun doublon de formulaire.
- Parcours : Créer une table → nom, mode, nombre de joueurs, visibilité,
  mot de passe éventuel, **« Règles de cette table »** (repliées par défaut,
  résumé toujours visible) → bouton explicite **« ➕ Créer la table »**.
- Options incompatibles masquées ou désactivées **avec la raison affichée** :
  CHOP obligatoire et malus CHOP en 2v2, barème RS/RJ d’équipe en 2v2, nombre de
  joueurs forcé à 4 en 2v2, et difficulté des robots (aucun robot en ligne).
- Validation **côté serveur** entièrement réécrite : bornes explicites par règle
  (0–200 malus CHOP, 5–50 RS, 1–10 cycles, 0–3000 limite, …), types booléens
  stricts, enums contrôlés, mode/effectif cohérents, puis normalisation 2v2
  autoritaire. Une requête forgée est refusée avec un message précis et **aucune
  table n’est créée**.
- Les règles sont stockées **avec la table** : elles survivent à l’actualisation,
  à la reconnexion et à toute modification ultérieure des paramètres généraux.
  Deux tables gardent des configurations indépendantes. Un joueur qui rejoint
  reçoit les règles de l’hôte **en lecture seule** : aucune commande ne permet de
  les modifier, et un `config` envoyé avec `join` est ignoré.
- Le mot de passe privé (scrypt, comparaison en temps constant) et sa protection
  sont inchangés.

### Bug corrigé au passage

La reprise après un **409 « La table a changé »** rafraîchissait l’état par un
`GET /api/multiplayer` : sans corps de requête, cet appel ne pouvait présenter
aucun jeton lorsque le proxy d’aperçu supprime cookies et en-têtes, donc la
révision restait périmée et le bouton « Prêt » restait bloqué après l’arrivée
d’un second joueur. Le rafraîchissement passe maintenant par un `POST`
authentifié (`heartbeat`), avec **rejeu du même `requestId`** (déduplication
serveur, donc jamais deux fois la même action) et **deux reprises au maximum**.

### Tests réellement exécutés

| Suite | Résultat |
| --- | --- |
| `npm test` (moteur, IA 500 parties, équipes, UI smoke 181, public view) | **réussi** |
| `npm run test:online-rules` (nouveau, 7 tests serveur) | **réussi** |
| `npm run test:online-session` | **10 réussis** |
| `npm run test:online-form` / `test:online` | **11** / **17 réussis** |
| `scripts/test-online-rules-browser.cjs` (nouveau) | **9 contrôles Chromium** |
| `scripts/test-online-session-browser.cjs` | **10 contrôles** (rejoué 3× pour la course « Prêt ») |
| `scripts/test-online-form-browser.cjs` | **14 contrôles** |
| `scripts/test-online-browser.cjs` | **15 contrôles** |
| `scripts/check-preview-session.cjs` | **réussi** (cookie + en-têtes supprimés) |
| `typecheck`, `lint`, `build`, `git diff --check` | **réussis** |

Le nouveau test navigateur couvre : table publique aux règles par défaut, règles
personnalisées, table privée (mauvais puis bon mot de passe), second navigateur
recevant exactement les règles de l’hôte et ne pouvant pas les éditer,
actualisation conservant la table, deux tables indépendantes, isolation vis-à-vis
des paramètres généraux, verrouillage 2v2 avec raison affichée, et conformité de
l’en-tête/boutons avec l’écran Paramètres.

Captures de contrôle : `/home/user/ui-audit/01-accueil.png` à `07-regles-2v2-verrouillees.png`.


## Nettoyage des tables fantômes et connexion aux tables

### Cause exacte des tables « que personne n’a créées »

Les tables listées provenaient des **exécutions de tests automatisés** (navigateurs
Playwright). Le serveur les gardait visibles parce qu’une table n’était retirée
qu’après **toute la fenêtre de conservation** (24 h par défaut), même si plus
aucun joueur n’y était connecté. Une table abandonnée (onglet fermé, test terminé)
restait donc listée comme si elle attendait des joueurs, souvent en « Complète »,
ce qui empêchait aussi d’en rejoindre une.

### Correction

- **Cycle de vie des tables** (`prune`) :
  - table **vide** → supprimée immédiatement ;
  - table **jamais démarrée** sans joueur connecté depuis 90 s → supprimée
    (fantôme d’onglet fermé ou de test) ;
  - **partie commencée** → les sièges restent réservés jusqu’à l’expiration de la
    fenêtre de conservation, comme avant.
- **Liste publique** : seules les tables ayant **au moins un joueur présent**
  (vu par le serveur depuis moins de 15 s) sont affichées, et un balayage est
  effectué avant chaque instantané : un fantôme ne peut plus apparaître.
- **Suppression par l’hôte** : bouton **🗑 Supprimer la table** dans la salle
  d’attente (avant le démarrage), avec confirmation. Refusé pour un non-hôte
  (403) et pour une partie commencée (409). Tous les sièges sont libérés, les
  joueurs concernés peuvent créer ou rejoindre immédiatement.
- **Rejoindre une table** : le bouton n’est plus grisé sans explication. Chaque
  ligne indique la raison exacte du refus : « Renseignez votre nom pour
  rejoindre », « Table complète : plus aucune place », « La partie a déjà
  commencé », « La partie est terminée », « Connexion au serveur requise ».
- **Codes de refus explicites** : le serveur renvoie désormais un `code`
  (`stale_revision`, `already_seated`, `table_started`) et le client ne rejoue
  une requête **que** sur `stale_revision`. Auparavant, une requête valide pouvait
  être rejouée inutilement sur un 409 de type « déjà assis ».
- **Révision optimiste limitée** aux commandes qui modifient l’état partagé
  (`ready`, `start`, `action`, `claimHost`). Quitter la table ou la supprimer
  répond maintenant sur l’**autorisation**, plus sur une révision périmée.

### Cas « je n’arrive pas à joindre la table créée »

Deux situations distinctes, toutes deux désormais explicites :

1. **La même session (même navigateur) possède déjà la table.** Deux fenêtres
   Chrome ordinaires partagent le cookie : elles représentent **le même joueur**.
   Rejoindre une seconde fois répond `409 already_seated` avec le message
   « Vous avez déjà une place à une table… ». Pour jouer à deux sur une même
   machine, il faut une fenêtre **de navigation privée** ou un **autre profil**
   (c’est ce qui fonctionnait lors de votre test à deux fenêtres).
2. **La table visée était complète ou déjà commencée** (tables de test restées
   listées). La raison est maintenant affichée sous chaque table.

Le stockage `.multiplayer/` a été remis à zéro : **plus aucune table de test**.

### Tests exécutés

| Suite | Résultat |
| --- | --- |
| `npm run test:online-rules` (10 tests, +3 nouveaux) | **réussi** |
| `npm test` complet (moteur, IA 500 parties, équipes, UI smoke 180) | **réussi** |
| Chromium multijoueur / règles / session / formulaire | **15 / 9 / 10 / 14** |
| `check-preview-session.cjs` | réussi |
| `typecheck`, `lint`, `build`, `git diff --check` | réussis |

Nouveaux tests serveur : disparition d’une table fantôme (liste **et** salle),
suppression par l’hôte avec libération des deux sièges et refus pour un invité,
et vérification des codes `stale_revision` / `already_seated` / `table_started`.

Parcours navigateur vérifié sur le serveur réel, avec **deux sessions distinctes** :
création, apparition dans la liste, deuxième joueur qui rejoint (sièges Sud/Nord),
mise à jour temps réel chez l’hôte, retour à la liste après « Quitter la table »,
suppression de la table en trop, puis reconnexion par le nom de la table.


## Interface de jeu en ligne alignée sur le mode solo

### Ce qui différait

En comparant la capture solo et la capture multijoueur :

| Élément | Solo | Multijoueur (avant) |
| --- | --- | --- |
| Pioche | carte face cachée + « Pioche · N » | bouton texte « Pioche / N » |
| Boutons | contexte : Piocher, CHOP, Défausser, Poser, Valider, Reprendre, RJ, Verrouiller, ✕ | **tous** affichés et grisés en permanence |
| Dock de défausse | `.discard-dock` arrondi ambre | bordure simple |
| Barre d’info | en bas : Menu / VIERGE / SUITE / TOTAL / Pioche / 📊 | en haut, avec le nom de la table |
| Résumé joueur | ligne `local-player-summary` | absent |
| Tour adverse | ligne « 🤖 X joue… » | rien |
| Carte piochée | sélectionnée automatiquement | non sélectionnée |

### Correction (aucune règle modifiée)

`OnlineGameScreen` réutilise désormais **exactement** la même structure que
`GameScreen` :

- **Même ordre de blocs** : table (`game-table-surface arena-stage` + bord ambre) →
  dock de défausse → panneau de main → barre d’info → résumé joueur.
- **Dock identique** : carte face cachée `CardView` + « Pioche · N » + `DiscardSpread`,
  mêmes classes `discard-dock rounded-2xl border-2 border-amber-900/70 bg-slate-950/65`.
- **Barre d’actions contextuelle** : chaque bouton n’apparaît qu’au moment utile,
  avec les mêmes libellés et icônes que le solo (📥 Piocher, ✋ CHOP, ↩️ Annuler CHOP,
  🃏 Poser <combinaison> (Joker→X), Valider l’ouverture, Récupérer le Joker,
  ↩️ Reprendre, 📦 Rentrer le carré dans la base, 🃏 RJ, 🔒 Verrouiller la sélection,
  🗑️ Défausser, ✕). Les commandes propres au réseau (choix d’extension du Joker,
  récupération, sortie de table) restent disponibles **dans le même style**.
- **Barre d’info en bas**, au même endroit et avec les mêmes classes.
- **Résumé joueur** `local-player-summary` : pastille de couleur, nom, siège,
  nombre de cartes, état ouvert/non ouvert, score, puis 🚪 Quitter la table.
- **Ligne « ⏳ X joue… »** quand ce n’est pas votre tour : plus aucun bouton.
- **Carte piochée auto-sélectionnée** dès que le serveur annonce votre pioche
  (valeur dérivée pendant le rendu, pas dans un effet), exactement comme le solo.
- Nouveau champ de projection `chopMustOpen` (calculé côté serveur) pour afficher
  le même rappel « ✋ CHOP : vous devez ouvrir ou annuler ».

Les **règles, les scores, les seuils, la rotation des sièges et les RS/RJ ne sont
pas touchés** : seuls le rendu et l’envoi des mêmes actions changent.

### Tests

- `scripts/test-online-ui-parity.cjs` (nouveau) : joue une vraie partie en solo et
  une en ligne, puis compare **les empreintes DOM** des deux écrans — ordre des
  blocs, classes du dock et de la barre d’info, texte de la barre d’info
  (`← Menu VIERGE : N SUITE : N TOTAL : N | RN · Pioche: N 📊`), présence de la
  carte de pioche, classes de la barre d’actions et structure du résumé.
- `scripts/test-online-actions-parity.cjs` (nouveau) : mesure les boutons réellement
  affichés à chaque phase dans les deux modes ; vérifie « jamais un mur de
  boutons », que l’ouverture de tour correspond à un état solo et qu’aucun bouton
  n’est proposé pendant le tour adverse. Rejoué 3× pour la stabilité.
- `scripts/test-online-waiting-parity.cjs` (nouveau) : la ligne d’attente utilise
  les mêmes classes dans les deux composants et masque les actions.
- Suites existantes revalidées : multijoueur **15**, règles de table **9**,
  session **10**, formulaire **14**, aperçu (cookie refusé) OK.

## Isoler les tests du stockage de l’aperçu

Les scripts navigateur créent de vraies tables. Pour ne jamais les faire
apparaître dans l’aperçu, lancez un **second serveur** avec son propre stockage :

```sh
# terminal 1 — aperçu
npm run dev -- --hostname 0.0.0.0 --port 3000

# terminal 2 — serveur de test isolé.
# IMPORTANT : Next.js n'autorise qu'UN serveur de dev par projet ; arrêtez donc
# l'aperçu, lancez le serveur de test, jouez les scripts, puis relancez l'aperçu.
MULTIPLAYER_STORE_PATH=/tmp/dz-test-store/state.json npm run dev -- --hostname 0.0.0.0 --port 3100
```

Puis exécutez les scripts avec `APP_PORT=3100` (`BASE_URL=http://localhost:3100`
pour `test-online-browser.cjs`). Tous les scripts lisent `APP_PORT` / `APP_BASE`.

Le serveur supprime de lui-même les tables de test : une table jamais démarrée
sans joueur connecté disparaît en 90 s, et les tables vides immédiatement.
L’hôte peut aussi les supprimer avec **🗑 Supprimer la table**.

## Boutons identiques, identité de joueur, spectateurs et remplacement

### 1. Boutons du mode multijoueur identiques au solo

Une règle CSS ajoutée pendant l'intégration multijoueur
(`.online-game .hand-actions button { background:#334155; padding:5px 10px; … }`)
**écrasait** les couleurs et les tailles des boutons du jeu en ligne. Elle est
supprimée : les boutons en ligne utilisent désormais **exactement** les mêmes
classes que le solo.

Vérifié automatiquement par `scripts/test-online-buttons-parity.cjs`, qui compare
les **styles calculés** (fond, couleur, rayon, padding, police) des boutons
présents dans les deux modes, puis vérifie que les boutons propres au réseau
réutilisent le vocabulaire du solo (`btn-primary`, `btn-secondary`, `btn-danger`,
`hand-lock-control`) sans style maison. Résultat : **12 boutons identiques** et
2 boutons réseau alignés — voir aussi `test-online-ui-parity.cjs` (structure) et
`test-online-actions-parity.cjs` (boutons contextuels).

Les **étiquettes de sièges** (noms au-dessus des cartes) sont volontairement
exclues de cette comparaison : vous aviez demandé qu'elles restent **sans cadre**,
et c'est un libellé, pas un contrôle.

### 2. Identifiant de joueur : revenir à sa table

- Nouvelle **identité de navigateur** persistante (`dz-rami:player-identity:v1`
  dans `localStorage`), créée une fois, du même format opaque que la session.
  Elle est envoyée dans le corps de **toutes** les requêtes (`playerIdentity`).
- Le serveur **lie le siège à cette identité** et la conserve avec la table. Si le
  cookie, le jeton de session ou même la session entière disparaissent (onglet
  fermé, cache vidé côté session, redémarrage), un `join` avec la même identité
  **retrouve le siège**, la main et ses cartes : message « Vous avez retrouvé
  votre place à cette table ».
- Cette identité n'est **pas** une identité de joueur fournie librement : elle ne
  sert qu'à retrouver *son propre* siège. Un client ne peut jamais choisir
  `playerId`, un siège ou le rôle d'un autre ; une identité inconnue ne prend
  aucun siège et un siège tenu ne peut pas être volé.
- Quitter une partie démarquée libère la **session** (et non le siège) : le même
  navigateur revient par son identité, un autre navigateur ne récupère rien.

### 3. Mode spectateur

- Nouveaux boutons **👁 Spectateur** dans la liste des tables et **« Entrer en
  spectateur »** dans le formulaire de connexion (code + mot de passe).
- Projection dédiée `projectSpectatorView()` : le spectateur reçoit la table
  publique (combinaisons, défausse visible, nombre de cartes, scores, seuils) mais
  **jamais une main**, jamais un brouillon, jamais d'action possible. Vérifié
  côté serveur (`localHand: []`, `actions: null`) et côté navigateur (aucune
  `hand-fan`, aucune barre d'action).
- Le nombre de spectateurs apparaît dans la liste des tables (👁) et la salle
  d'attente liste leurs noms et leur présence.
- Le spectateur quitte avec **🚪 Quitter le spectacle**.

### 4 & 5. Remplacement d'un joueur ayant quitté la partie

- Nouvelle **option de table** : « Remplacement d'un joueur ayant quitté la
  partie », choisie à la création, modifiable par l'hôte dans la salle d'attente
  (commande `setOptions`) et **figée dès le démarrage**. Elle est stockée avec la
  table et visible par tous les joueurs.
- Quand l'option est **activée** et qu'un joueur quitte une partie en cours, son
  siège est marqué comme libéré ; un spectateur voit alors le bouton
  **« ✋ Prendre le siège de <nom> »** et reprend **le même siège et la même main**
  (aucune carte n'est redistribuée, aucune manche n'est réinitialisée).
- Quand l'option est **désactivée**, le siège reste la propriété de son joueur :
  aucune reprise possible par un tiers (refus `replacement_disabled`).
- Le remplacement est réservé aux spectateurs ; un joueur déjà assis ne peut pas
  prendre un second siège.

### Tests réellement exécutés

| Suite | Résultat |
| --- | --- |
| `npm run test:online-seat` (nouveau, 7 tests) | **réussi** |
| `scripts/test-online-spectator-browser.cjs` (nouveau, 9 contrôles) | **réussi** |
| `scripts/test-online-buttons-parity.cjs` (nouveau, styles calculés) | **réussi** |
| `test-online-ui-parity` / `test-online-actions-parity` | **réussis** |
| `npm test` complet (moteur, IA 500 parties, équipes, UI smoke 180) | **réussi** |
| Chromium : multijoueur 15, règles 9, session 10, formulaire 14, aperçu | **tous réussis** |
| `typecheck`, `lint`, `build`, `git diff --check` | **réussis** |

Scénario navigateur couvert : table avec remplacement activé, spectateur qui
rejoint depuis la liste sans prendre de siège, partie démarrée, **spectateur sans
main ni bouton d'action**, joueur qui quitte, **reprise du siège et de la main par
le spectateur**, rechargement du repreneur (même siège retrouvé par identité),
joueur parti qui n'obtient pas de siège en double, et identité étrangère qui ne
peut rien voler.

> Note d'exploitation : un changement de code **côté serveur** nécessite un
> redémarrage du serveur (le service de tables est mis en cache dans le
> processus). Les tests navigateur doivent donc être relancés après redémarrage.
