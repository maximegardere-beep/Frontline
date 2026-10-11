# Frontline

Mini-jeu de stratégie au tour par tour sur le front de l'Est, été 1943. Vous incarnez un officier
qui commande un petit groupement tactique (allemand ou soviétique) au fil d'une campagne de cinq batailles,
chacune sur un champ de bataille généré procéduralement.

Le cœur du jeu : **planifier en même temps que l'adversaire**. Chaque tour, les deux camps tracent leurs
ordres sans voir ceux de l'autre, puis tout s'exécute simultanément sans qu'on puisse intervenir.
Il faut donc anticiper où l'ennemi sera, pas seulement où il est.

## Lancer le jeu

Aucune dépendance. Node 18+ suffit.

```sh
npm start          # serveur local sur http://localhost:8080
npm test           # tests du moteur (carte, combat, batailles IA contre IA, campagne)
node tools/bundle.mjs   # génère dist/frontline.html, un fichier unique jouable hors ligne
```

Les modules ES nécessitent un serveur HTTP : ouvrir `index.html` directement depuis le disque ne fonctionne pas,
mais `dist/frontline.html` si.

## Commandes

| | Souris | Tactile (iPhone, iPad) |
|---|---|---|
| Sélectionner une unité, choisir sa destination | clic | toucher |
| Déplacer la carte | glisser | glisser à un doigt |
| Zoomer | molette | pincer, ou boutons + / − |
| Vue d'ensemble, grille | boutons à droite de la carte (`G` pour la grille) | idem |
| Panneaux Unité / Troupes / Journal | colonne de droite | onglets en bas ; toucher l'onglet actif replie le tiroir |

Raccourcis clavier : `Tab` unité suivante, `E` retrancher, `B` barrage, `H` annuler, `Entrée` exécuter.

## Rendu : terrain continu sur grille

Les règles reposent entièrement sur la grille hexagonale (une altitude, un couvert, un coût par case).
Le rendu en tire une image continue :

- **relief** : les altitudes des hexagones sont lissées par un noyau gaussien, plus un micro-relief de bruit.
  On en déduit les teintes hypsométriques, l'ombrage depuis le nord-ouest et des courbes de niveau
  (« marching squares »). Les courbes maîtresses coïncident avec les seuils d'altitude de la grille ;
- **couverts** : forêts en couronnes d'arbres fusionnées, champs en parcelles irrégulières, marais en nappes ;
- **routes et rivières** : splines passant par les centres des cases, avec méandres pour l'eau ;
- **brouillard, zone de mouvement, portée d'artillerie** : masques adoucis au contour lissé ;
- **mouvements** : chaque unité glisse à vitesse constante le long d'une spline, avec traînée et légère
  inclinaison, au lieu de sauter de case en case.

La grille reste affichée en filigrane (bouton ⬡ pour la renforcer ou la masquer).

## Déroulement

1. **Choix du camp** : Wehrmacht (moins nombreuse, mieux entraînée, blindés redoutables) ou Armée rouge
   (plus d'unités, fusiliers plus résistants, artillerie plus lourde).
2. **Armée aléatoire** : infanterie, reconnaissance, artillerie, blindés, chacun avec un niveau
   (Recrue, Vétéran, Élite). Le rapport de renseignement du briefing dépend de votre reconnaissance.
3. **Déploiement** dans les trois colonnes de votre bord de carte : c'est le premier plan de bataille.
4. **Tour de jeu** :
   - *Plan* : pour chaque unité, un trajet (dans la limite de ses points de mouvement), un ordre de
     retranchement, ou pour l'artillerie un barrage sur un hexagone, même invisible.
   - *Exécution* : mouvements simultanés hexagone par hexagone ; une unité qui arrive au contact d'un
     ennemi s'arrête. Puis phase de feu simultanée aux dés.
5. **Fin de bataille** : rapport, pertes, promotions, renforts, puis carte suivante.

### Combat

Chaque tireur lance autant de d6 que sa valeur d'attaque, proportionnellement à ses PV restants.
Il touche sur **4+**, modifié par :

| Modificateur | Effet |
|---|---|
| Couvert : forêt / village | +1 / +2 |
| Cible dans la rivière (à gué) | −1 |
| Retranchement | + niveau (1 à 3) |
| Cible plus haute / tir plongeant | +1 / −1 |
| Tireur ayant utilisé plus de la moitié de son mouvement | +1 |
| Cible ayant parcouru 3 hexagones ou plus à découvert | −1 |
| Infanterie ou reconnaissance contre blindés | +2 (0 au corps à corps en forêt ou village) |
| Artillerie contre blindés | +1 |
| Barrage sur une cible que personne n'observe | +1 |
| Tireur élite | −1 |

Seuil borné entre 2+ et 6+. Un 6 inflige 2 dégâts (sauf armes légères contre blindés).
Une unité qui tombe sous 35 % de ses PV, ou en perd 40 % d'un coup, teste son moral :
d6 + niveau (+1 retranchée, +1 en forêt ou village) ≥ 5 pour tenir. Un 1 échoue toujours. En cas d'échec
elle part en déroute vers sa zone de repli et quitte la carte en l'atteignant.

### Conditions de victoire

- Toutes les unités adverses détruites ou en déroute.
- Sur les cartes « prise de position » : tenir l'objectif ★ 4 tours (infanterie ou blindés,
  sans ennemi au contact).
- Au bout de 12 tours : le détenteur de l'objectif, sinon le camp proportionnellement le moins éprouvé.

### Brouillard de guerre

On ne voit l'ennemi que dans le champ de vision de ses unités (relief et couverts bloquent la vue,
les hauteurs l'étendent). Une unité en forêt ou au village n'est repérée qu'à 2 hexagones, sauf si elle a tiré.
Les dernières positions connues restent sur la carte au crayon rouge, avec une flèche indiquant le
dernier mouvement observé : c'est la base pour anticiper et placer ses barrages.

## Structure du code

| Fichier | Rôle |
|---|---|
| `src/rng.js` | Générateur pseudo-aléatoire à graine (parties reproductibles) |
| `src/hex.js` | Géométrie hexagonale (offset odd-r, distances, lignes, pixels) |
| `src/terrain.js` | Coûts de mouvement, défense, ligne de vue |
| `src/mapgen.js` | Génération procédurale : relief, forêts, marais, rivière, villages, fermes, routes |
| `src/units.js` | Types d'unités, niveaux, armées aléatoires |
| `src/path.js` | Hexagones atteignables (Dijkstra) |
| `src/combat.js` | Jets de dés et moral |
| `src/game.js` | État de bataille, brouillard, exécution simultanée, victoire |
| `src/ai.js` | IA adverse (ne voit que ce que voient ses unités) |
| `src/campaign.js` | Enchaînement des batailles, expérience, renforts |
| `src/render.js` | Rendu Canvas : terrain continu, caméra (zoom, déplacement), pions, effets |
| `src/main.js` | Interface, gestes tactiles, animation |

Le moteur (`rng` → `campaign`) ne dépend pas du navigateur : il est testé sous Node et peut servir
de base à un portage (Godot, Unity…) ou à un mode multijoueur. Voir `DESIGN.md` pour les pistes.
