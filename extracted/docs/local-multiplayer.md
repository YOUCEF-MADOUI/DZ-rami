# Multijoueur local (à tour de rôle, sans serveur)

## Principe

Le bouton **Multijoueur** → **Mode local existant** ouvre maintenant un vrai
multijoueur local : 2 à 5 humains sur le même appareil, chacun leur tour.
Le moteur reste **la seule autorité** : aucune règle n'a été modifiée ni
dupliquée côté interface.

## Ce qui a changé

### Moteur (`src/game/core`)

- `createInitialGameState(config, playerNames, options)` accepte
  `{ humans: 'first' | 'all' | readonly number[] }` :
  - défaut (`first` ou absent) : **comportement solo inchangé**, un seul humain ;
  - `all` : **tous les sièges humains** (multijoueur local) ;
  - indices explicites : mélange libre (tests, futurs modes).
- Nouveau helper pur et testable `isHumanSeat()`.
- Nouveau module `src/game/core/hotseat.ts`, sans aucune règle de jeu :
  `activeHumanIndex`, `activeHumanPlayer`, `activeAccuserId`, `turnSerial`,
  `shouldPassDevice`, `visibleHand`, `maskedHandSlots`.

### Interface

- `useGame(..., hotseat)` : toutes les actions (`availableActions`, tri,
  réorganisation, signalement) sont évaluées depuis **le joueur humain actif**
  (`currentPlayerIndex`), et non plus depuis `players[0]`. Le mode solo conserve
  la perspective du premier siège.
- `GameScreen` reçoit `hotseat` et remplace `players[0]` par le joueur actif
  partout : main affichée, glisser-déposer, pioche, défausse, pose, CHOP,
  signalement (l'accusateur = le joueur qui clique).
- Nouvel écran **« Passe l'appareil à [Nom] »** (`HotseatPassScreen`) avant
  chaque tour, avec le bouton **« Je suis prêt »**.
  Il **remplace** la zone de main : la main du joueur précédent n'est pas
  simplement cachée en CSS, elle n'est pas rendue (aucun `data-card-id` dans le
  DOM) ; seuls des dos de cartes anonymes sont affichés.
- Pendant cet écran, la pioche, la défausse, le CHOP et le signalement sont
  désactivés : on ne peut pas jouer à la place du joueur précédent.
- Les mains des autres joueurs restent masquées en permanence (dos + nombre),
  comme avant.
- Une fenêtre de CHOP appartient au joueur **dont c'est le tour** : elle est
  proposée après son passage d'appareil, avec les mêmes boutons qu'en solo.

## Tests

`npx vitest run` (`npm run test:vitest`, inclus dans `npm test` par défaut) :

- `src/game/tests/hotseat.test.ts` — **10 tests** :
  partie à 3 humains sans aucun `isAI`, non-régression du solo (1 humain),
  `isHumanSeat`, joueur actif (hot-seat vs solo), écran de passage par tour,
  changement effectif de joueur en fin de tour, **accusation par le bon joueur**
  (et refus de s'auto-accuser), masquage des mains et projection publique.
- `src/game/tests/hotseat-ui.test.tsx` — **4 tests** (jsdom + React) :
  écran « Passe l'appareil à … », aucune carte physique dans le DOM avant
  « Je suis prêt », main du joueur actif révélée ensuite, `CHOP` proposé au bon
  joueur, nouveau passage à la fin du tour, et mains adverses jamais exposées.

Vérifications complémentaires : `npm run typecheck`, `npm run lint`,
`npm test` (toutes les suites existantes, dont solo, équipes, IA 500 parties et
en ligne), `npm run build`, `git diff --check` — toutes réussies.

Contrôle navigateur réel (Chromium) : 3 humains, écran de passage avant le
premier tour, main de 15 cartes révélée après « Je suis prêt », passage suivant
à un autre joueur après la défausse, et **mode solo sans aucune interruption**.

## CI

`.github/workflows/ci.yml` (présent sur `origin/main`, absent du checkout de
travail) a été **restauré à l'identique**. Il exécute typecheck, lint, tests et
build ; `npm test` inclut désormais Vitest, donc les nouveaux tests tournent
aussi en CI. Aucune étape n'a été supprimée.
