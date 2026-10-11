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
| Mode directives | drapeau à droite de la carte (`D`) | idem |
| Son | haut-parleur à droite de la carte (`M`) ; coupé, le choix est mémorisé | idem |
| Panneaux Unité / Troupes / Journal | colonne de droite | onglets en bas ; toucher l'onglet actif replie le tiroir |

Raccourcis clavier : `Tab` unité suivante, `E` retrancher, `B` barrage, `H` annuler, `D` mode directives, `M` son, `Entrée` exécuter.

## Rendu : terrain continu sur grille

Les règles reposent entièrement sur la grille hexagonale (une altitude, un couvert, un coût par case).
Le rendu en tire une image continue :

- **relief** : les altitudes des hexagones sont lissées par un noyau gaussien, plus un micro-relief de bruit.
  On en déduit les teintes hypsométriques, l'ombrage depuis le nord-ouest et des courbes de niveau
  (« marching squares »). Les courbes maîtresses coïncident avec les seuils d'altitude de la grille ;
- **couverts** : forêts en couronnes d'arbres fusionnées, champs en parcelles irrégulières, marais en nappes ;
- **routes et cours d'eau** : splines passant par les centres des cases, avec méandres pour l'eau.
  Un tiers des cartes environ a une rivière (franchissable aux ponts, à 1 ou 2 gués aménagés pour +½ mouvement, ailleurs pour +2),
  un tiers un ruisseau qui s'arrête en chemin (+1), le reste aucun cours d'eau ;
- **brouillard, zone de mouvement, portée d'artillerie** : masques adoucis au contour lissé ;
- **mouvements** : chaque unité glisse à vitesse constante le long d'une spline, avec traînée et légère
  inclinaison, au lieu de sauter de case en case ;
- **combat** (`src/fx.js`) : rafales de traçantes, départs de coups et obus en cloche, explosions (lueur, boule de feu,
  onde de choc, débris, fumée qui dérive), légère secousse de la carte pour les gros calibres ;
- **traces durables** : cratères et brûlures peintes sur le terrain, ornières des chenilles, épaves qui brûlent
  puis fument pendant deux tours. Elles restent jusqu'à la fin de la bataille.

La grille reste affichée en filigrane (bouton ⬡ pour la renforcer ou la masquer).

## Son

Tout est synthétisé à la volée (Web Audio), sans aucun fichier : départs de coups, sifflement des obus,
explosions et crépitement des épaves, calés sur la chronologie des effets visuels et placés en stéréo
selon leur position à l'écran (plus faibles hors champ) ; moteurs et chenilles des blindés, pas de
l'infanterie pendant les mouvements ; vent et canonnade lointaine en fond ; déclics d'interface,
transmission radio à l'exécution et cloche de fin de tour. Les tirs d'un ennemi invisible s'entendent étouffés.

## Déroulement

1. **Choix du camp** : Wehrmacht (moins nombreuse, mieux entraînée, blindés redoutables) ou Armée rouge
   (plus d'unités, fusiliers plus résistants, artillerie plus lourde).
2. **Armée aléatoire** : infanterie, reconnaissance, artillerie, blindés, antichars, chacun avec un niveau
   (Recrue, Vétéran, Élite). Le rapport de renseignement du briefing dépend de votre reconnaissance.
3. **Déploiement** dans les trois colonnes de votre bord de carte : c'est le premier plan de bataille.
4. **Tour de jeu** :
   - *Plan* : pour chaque unité, un trajet (dans la limite de ses points de mouvement), un ordre de
     retranchement, ou pour l'artillerie un barrage sur un hexagone, même invisible. Ou, en mode directives,
     des intentions globales (voir plus bas).
   - *Exécution* : mouvements simultanés hexagone par hexagone ; une unité qui arrive au contact d'un
     ennemi s'arrête. Puis phase de feu simultanée aux dés.
5. **Fin de bataille** : rapport, pertes, promotions, renforts, puis carte suivante.

### Mode directives

Le bouton drapeau à droite de la carte bascule entre le contrôle direct (un ordre par unité) et le commandement
par directives. En mode directives on place jusqu'à trois intentions sur la carte :

- **Attaquer** : marcher sur le point, puis engager les ennemis qui le tiennent ;
- **Défendre** : rejoindre la position, s'y couvrir, s'y retrancher, sans poursuivre ;
- **Repli** : rompre le contact et rejoindre ce point de ralliement.

L'état-major répartit les unités entre les directives (les plus proches, à parts égales) et rédige leurs ordres
à chaque tour, avec la même IA que l'adversaire et uniquement ce que vos unités ont vu. Les ordres restent
visibles et modifiables : un ordre donné à la main à une unité prime pour ce tour (« Rendre à l'état-major »
l'annule). « Contrôle direct » (ou le drapeau) rend la main en gardant le plan en cours.

### Combat

Chaque tireur lance autant de d6 que sa valeur d'attaque, proportionnellement à ses PV restants.
Il touche sur **4+**, modifié par :

| Modificateur | Effet |
|---|---|
| Couvert : forêt / village | +1 / +2 |
| Cible dans l'eau (rivière, ruisseau, gué) | −1 |
| Retranchement | + niveau (1 à 3) |
| Cible plus haute / tir plongeant | +1 / −1 |
| Tireur ayant utilisé plus de la moitié de son mouvement | +1 |
| Cible ayant parcouru 3 hexagones ou plus à découvert | −1 |
| Infanterie ou reconnaissance contre blindés | +2 (0 au corps à corps en forêt ou village) |
| Artillerie contre blindés | +1 |
| Barrage sur une cible que personne n'observe | +1 |
| Tireur élite | −1 |
| Tireur cloué | +1 |

Seuil borné entre 2+ et 6+. Un 6 inflige 2 dégâts (sauf armes légères contre blindés).

**Antichar** : canon tracté qui lance 2 dés de plus contre les blindés, mais ne tire pas s'il a bougé dans le tour.
Embusqué en forêt ou au village, il n'est repéré qu'au contact tant qu'il n'a pas ouvert le feu : un char qui passe
à 2 hexagones encaisse le premier tir sans pouvoir riposter.

**Munitions d'artillerie** : chaque batterie a 6 obus par bataille, rechargés entre deux batailles (jauge dans
la fiche, pastilles au-dessus du pion). Chaque tir à 2 hexagones ou plus coûte un obus : un barrage planifié, même
s'il tombe sur une case vide, comme un tir à vue sur un ennemi repéré. « Tir à vue : non » réserve les obus aux
barrages. L'autodéfense au contact est gratuite. À sec, la batterie ne peut plus que se défendre.

**Clouage** : une unité qui encaisse 2 touches dans le tour (3 si retranchée) ou un barrage est clouée ; au tour
suivant elle ne bouge pas et tire à −1 (losange jaune sur le pion). Un blindé n'est immobilisé que par un 6
d'une arme qui perce.

**Moral** : une unité qui tombe sous 35 % de ses PV, en perd 40 % d'un coup, ou voit une unité voisine anéantie,
teste son moral : d6 + niveau ≥ 5 pour tenir, avec +1 retranchée, +1 en forêt ou village, +1 si un voisin est
retranché, −1 isolée (aucun allié à 2 hexagones), −1 prise en tenaille (tirs directs venus de côtés opposés).
Un 1 échoue toujours. En cas d'échec elle part en déroute vers sa zone de repli et quitte la carte en l'atteignant.

### Conditions de victoire

- Toutes les unités adverses détruites ou en déroute.
- Sur les cartes « prise de position » : tenir l'objectif ★ 4 tours (infanterie ou blindés seulement,
  sans ennemi au contact).
- Au bout de 12 tours : le détenteur de l'objectif, sinon le camp proportionnellement le moins éprouvé.

### Conditions de bataille

Chaque bataille tire au briefing son biome, sa météo et son heure de départ (même graine, mêmes conditions).

| Biome | Carte |
|---|---|
| Steppe ouverte | peu de couvert, longues vues : le terrain des chars |
| Forêts et bocages | environ un tiers de forêt : vues courtes, embuscades |
| Marais de Polésie | environ un quart de marais : les routes servent de digues |
| Bourg | un pâté de 4 à 6 hexagones bâtis au centre, souvent l'objectif |

| Météo | Effet |
|---|---|
| Temps clair | aucun |
| Pluie | vision −1 ; hors route, les véhicules s'enlisent (½ point de plus par hexagone), l'infanterie passe |
| Brouillard | vision −2 ; les hauteurs ne donnent plus de vue supplémentaire |
| Neige | vision −1 ; même enlisement des véhicules ; rivières et marais gelés franchissables, sans malus de défense |

La météo suit la saison de la campagne : de juillet à novembre 1943, de plus en plus de pluie et de brouillard,
et la neige à partir d'octobre. Un tour dure une heure. La bataille commence le plus souvent au matin, parfois
l'après-midi, et peut alors finir de nuit (plus souvent en automne, quand les jours raccourcissent).
Aube et crépuscule : vision −1 ; nuit : −2. Une unité voit toujours au moins l'hexagone voisin.

À l'écran : palette d'hiver ou sol détrempé, lumière de l'heure, pluie, neige ou nappes de brouillard animées,
et le fond sonore suit le temps (pluie, vent de neige). L'heure, la lumière et la météo s'affichent dans la barre.

### Terrain destructible

Les obus d'artillerie marquent le terrain, et ces marques deviennent des règles :

| Terrain | Après les barrages |
|---|---|
| Village (ou pâté du bourg) | en ruines au 2e barrage : défense +2 conservée, mais on y avance plus lentement (1 point de plus, 2 pour les blindés) |
| Steppe, champs | cratères dès le 1er barrage : +1 en défense pour l'infanterie, ½ point de plus pour traverser |
| Forêt | une chance sur trois par obus de prendre feu (jamais sous la pluie ni la neige) |

Une forêt en feu brûle 2 tours : on ne peut pas y entrer, les unités qui y restent perdent 2 PV par tour, et le
feu gagne chaque forêt voisine une fois sur trois. Elle laisse une zone brûlée, découverte. Le feu s'allume à la
fin d'un tour et ne brûle qu'à la fin du suivant : on a le temps d'évacuer. L'IA s'en écarte.

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
| `src/ai.js` | IA adverse (ne voit que ce que voient ses unités) ; sert aussi d'état-major en mode directives |
| `src/campaign.js` | Enchaînement des batailles, expérience, renforts |
| `src/conditions.js` | Météo, heure du jour, biomes et saisons : tirage et effets sur la vision |
| `src/weather.js` | Couche animée de pluie, neige et brouillard au-dessus de la carte |
| `src/fx.js` | Effets de combat (tirs, explosions, fumée) et traces durables (cratères, ornières, épaves) |
| `src/audio.js` | Sons synthétisés (Web Audio) : combat, mouvements, fond sonore, interface |
| `src/render.js` | Rendu Canvas : terrain continu, caméra (zoom, déplacement), pions, directives |
| `src/main.js` | Interface, gestes tactiles, animation |

Le moteur (`rng` → `campaign`) ne dépend pas du navigateur : il est testé sous Node et peut servir
de base à un portage (Godot, Unity…) ou à un mode multijoueur. Voir `DESIGN.md` pour les pistes.
