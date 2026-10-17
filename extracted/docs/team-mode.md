# 4 joueurs — 2 contre 2

## Isolation des règles

`GameConfig.variant = 'teams'` exige quatre sièges. Une valeur absente ou
`classic` conserve le moteur classique. Les politiques sont regroupées dans
`src/game/core/team-rules.ts`, sans deuxième moteur de tours/distribution.

- Équipe 1 : Sud + Nord ; équipe 2 : Est + Ouest, indépendamment des index/IA.
- Premier ouvreur de chaque équipe : naturel ≥ 91 et total ≥ SUITE courante.
- Partenaire déjà ouvert : les deux seuils sont levés, mais une combinaison
  valide reste nécessaire ; l’équipier est aussi dispensé de tierce obligatoire.
- L'ouverture de l'équipier ne change ni SUITE ni le TOTAL de référence.
- CHOP sans malus ni obligation de prendre la défausse. Les options « CHOP uniquement pour ouverture » et « Carte CHOP obligatoire à jouer ce tour » sont respectées si activées : le moteur refuse la défausse tant que les obligations ne sont pas remplies. Le CHOP peut être annulé avant toute autre action.
- Les points d'une manche sont stockés une seule fois, sous `team-1`/`team-2`.
  Les champs de score des partenaires reflètent ce total pour compatibilité ;
  ils ne sont jamais additionnés pour calculer le score de l'équipe.

Pour des adversaires ayant 4 et 2 cartes, les scores vérifiés sont :

| Adversaires ouverts | RS | RJ |
|---|---:|---:|
| Aucun | 200 | 400 |
| Un seul (ouvert : 4 cartes) | 140 | 320 |
| Tous les deux | 60 | 120 |

Après RS, les cartes du joueur non ouvert ne sont pas comptées : seul son
forfait de 100 points s’applique. Le cas mixte RJ reste inchangé.

Les fautes conservent leur pénalité configurée, ajoutée une fois au score
d'équipe. Une défausse jouable n'est pénalisée qu'après signalement confirmé,
sur preuve du tour terminé. En équipe, seules les combinaisons propres et
celles du partenaire ouvert sont concernées (y compris le remplacement légal
d'un Joker). Les cycles épuisés conservent le décompte existant, agrégé par équipe.

## Animations

`DiscardEffects` observe l'événement public validé : aucun appel d'action moteur.
Défausse : 230 ms ; RS et RJ : 5 000 ms, carte agrandie (RS : dos uniquement,
RJ : annonce dorée et étoiles). Pioche : 400 ms, dos uniquement jusqu’à
l’arrivée. Le donneur est le premier joueur (15 cartes). Les cartes sont
distribuées une par une dans la rotation des sièges, depuis son côté. Le calcul du score est immédiat dans le moteur ; seule la présentation
est animée. Un événement n'est pas rejoué après reprise/remontage. Réduction des
animations et absence de Web Animations : affichage immédiat sans retarder le jeu.

## Données privées : frontière et limite

`projectPlayerView` est une projection explicite, testée, qui conserve la main
locale autorisée, les décomptes adverses, les poses publiques et les scores.
Elle exclut le stock, les mains adverses, l'historique interne et les snapshots
privés. Le RS est expurgé, y compris pour les anciennes sauvegardes. Le composant
`OpponentHand` reçoit seulement un nom et un nombre, jamais des GameCard.

**Ce dépôt n'a pas de serveur multijoueur autoritaire ni d'authentification de
joueurs distants.** Le menu 2 contre 2 lance un joueur local avec un partenaire
IA et deux adversaires IA. Le moteur local et la sauvegarde solo contiennent
l'état complet nécessaire à la simulation. La projection/les dos ne rendent
pas ce moteur local inviolable face aux outils de développement du navigateur.

Avant un multijoueur réseau, garder GameState côté serveur, dériver viewerId
d'une session authentifiée, et ne transmettre que la projection autorisée. Ne
jamais envoyer un GameState complet ni ses snapshots à des clients distants.
