# Frontline — document de conception

## Intention

Un wargame minimaliste où la décision importante est le **plan**, pas la micro-gestion.
Le joueur est un officier qui donne des ordres, puis regarde les conséquences sans pouvoir corriger.
La tension vient de l'incertitude : où sera l'ennemi quand mes troupes arriveront ?

## Boucle de jeu

```
Campagne (5 batailles)
 └─ Bataille (carte procédurale, ≤ 12 tours)
     ├─ Briefing (objectifs, renseignements, forces)
     ├─ Déploiement (= plan initial)
     └─ Tour × N
         ├─ Plan simultané (joueur + IA, à l'aveugle)
         ├─ Exécution : mouvement pas à pas, arrêt au contact
         ├─ Combat : tirs simultanés, dés, moral
         └─ Vérification des conditions de victoire
 └─ Rapport : pertes, promotions, renforts → bataille suivante
```

## Choix de conception déjà faits

- **Simultanéité stricte** : les dégâts sont appliqués après que tout le monde a tiré ; les conflits
  de mouvement (deux unités visant le même hexagone) sont résolus en faveur de celle qui a le plus de
  mouvement restant, l'autre attend jusqu'à deux pas.
- **Contact = arrêt** : entrer au contact d'un *nouvel* ennemi stoppe le mouvement. Une unité déjà au
  contact peut se désengager.
- **Retranchement** cumulatif (niveau max selon le type et l'expérience), perdu dès qu'on bouge.
- **Barrage d'artillerie** sur un hexagone, pas sur une unité : c'est le mécanisme d'anticipation par excellence.
- **Mémoire** des positions ennemies avec le dernier vecteur de mouvement : l'IA s'en sert pour prédire,
  le joueur la voit sur la carte.
- **Commandement par directives** (optionnel) : le joueur fixe des intentions (attaquer, défendre, se replier),
  l'état-major, soumis au même brouillard, en tire les ordres. Le joueur garde la main unité par unité. C'est la
  même IA que l'adversaire, paramétrée par les directives.
- **Eau rare** : une rivière infranchissable hors des ponts transformait chaque carte en goulot d'étranglement.
  Désormais environ un tiers de rivières (avec gués), un tiers de ruisseaux partiels, un tiers sans eau.
- **Clouage** : une unité qui encaisse 2 touches dans le tour (3 si retranchée) ou un barrage est clouée ;
  au tour suivant elle ne bouge pas et tire à −1. Les blindés ne sont immobilisés que par un 6 d'une arme
  qui perce. L'état est visible pendant la planification : le joueur doit composer avec, pas le subir à l'aveugle.
  Le feu prépare donc l'assaut : clouer une ligne avant de la déborder.
- **Munitions d'artillerie** : 6 obus par batterie et par bataille, recharge complète entre les batailles. Tout tir
  à 2 hex ou plus en consomme un, y compris un barrage tombé dans le vide : une mauvaise anticipation coûte cher.
  Le tir à vue se coupe par batterie, l'autodéfense au contact est gratuite. Pas de munitions pour les autres
  unités : la contrainte reste une décision de plan, pas de la comptabilité. L'IA devient plus exigeante sur ses
  cibles quand le stock baisse et coupe son tir à vue à 2 obus. Sur 300 batailles IA contre IA : 3,4 tirs par
  batterie (4,8 sans limite), barrages dans le vide 532 (779), victoires DE/SU/nuls 101/154/45 (96/167/37).
- **Conditions de bataille** : biome, météo et heure passent tous par les mêmes réglages (vision, coûts,
  génération, rendu), tirés au briefing depuis la graine. La boue ne freine que les véhicules : appliquée à tous,
  elle divisait par deux la marche de l'infanterie. Le départ est surtout matinal (27 % des batailles finissent
  de nuit) ; la vision ne descend jamais sous 1, même brouillard et nuit cumulés. La Polésie, d'abord trop
  marécageuse (36 % de marais), s'enlisait (5 % d'issues nettes) : ramenée à environ 25 %. Sur 300 batailles
  avec conditions, l'équilibre entre camps ne bouge pas (104/168/28 contre 101/153/46 sans).
- **Matériel d'élite** : rééquipement automatique au niveau Élite (promotion ou tirage), sans cumuler les bonus
  du niveau (+1 Mvt, +1 portée) avec ceux du cahier des charges : le T-34/85 se distingue par son 85 mm (+1 dé
  contre les blindés), Panzergrenadiers et Gardes par leur malus réduit contre les blindés (+1). Katioucha : salve
  de 3 cases, ⅔ des dés par case, 1 obus, rechargement d'un tour. Pas d'équivalent allemand pour l'artillerie.
  Rares au départ (7 Tigre, 6 T-34/85, 12 Katioucha sur 300 batailles tirées), elles viennent surtout des promotions ;
  l'équilibre IA contre IA ne bouge pas (107/157/36).
- **Terrain destructible** : ruines (2 barrages), cratères (1 barrage), incendies de forêt (1 chance sur 3 par obus,
  2 tours, 2 PV par tour, propagation 1 sur 3, jamais par temps humide). Le feu s'allume en fin de tour et ne brûle
  qu'au suivant pour laisser évacuer. Sur 300 batailles : 0,15 village ruiné, 0,7 hex brûlé, 1,5 hex criblé de cratères
  par bataille, une seule unité perdue dans les flammes ; l'équilibre ne bouge pas (108/159/33). Ce sont des effets
  d'appoint qui récompensent la préparation d'artillerie, pas des règles qui décident d'une bataille.
- **Moral contextuel** : −1 isolée (aucun allié à 2 hex), −1 prise en tenaille (tirs directs venus de directions
  opposées), +1 si un voisin est retranché ; voir une unité adjacente anéantie impose un test même sans pertes.
  Récompense la cohésion de la ligne et l'enveloppement. Sur 300 batailles IA contre IA, l'équilibre entre camps
  ne bouge pas, mais les issues nettes (anéantissement, objectif tenu) passent de 15 % à 28 %.
- **Asymétrie** légère des camps (qualité contre quantité), budgets d'armée différents.
- **Équilibrage** (banc `tools/balance.mjs`, 600 à 1 200 batailles IA contre IA par mesure, conditions tirées) :
  - Diagnostic : l'avantage soviétique (37 % / 52 %) venait surtout du décompte du 12e tour (« camp le moins
    éprouvé »), qui conclut la moitié des batailles ; quand la bataille se décide sur le terrain, l'écart est faible.
  - Réglage : budget allemand 11 → 12 points (soviétique 13) et un peu plus de vétérans allemands
    (recrue 40 %, vétéran 50 %, élite 10 %). Le budget seul ramenait à 43 % / 47 % ; avec les vétérans,
    sur 2 400 batailles et trois jeux de graines : environ 45 % / 44 %, 11 % de nuls. Le bruit d'une mesure
    de 600 batailles est d'environ ±4 points : ne conclure que sur plusieurs graines.
  - Reste : la Wehrmacht domine les prises de position (51 % / 46 %), l'Armée rouge les combats de rencontre
    (37 % / 46 %), qui se jouent à l'usure. C'est cohérent avec « qualité contre quantité ».
  - Campagne (`tools/campaign-sim.mjs`, l'IA joue le camp du joueur) : 48 % de batailles gagnées côté allemand,
    51 % côté soviétique, de 56 % à la 1re bataille à environ 45 % à la 5e (l'ennemi gagne 2 points par
    bataille). Un humain battant d'ordinaire l'IA, la campagne est plutôt accessible ; `ENEMY_GROWTH` et
    `ENEMY_BUDGETS` (src/campaign.js) règlent la difficulté.

## Paramètres d'unités (niveau Recrue)

| Type | PV | Mvt | Portée | Attaque | Vision | Retranch. max | Coût |
|---|---|---|---|---|---|---|---|
| Infanterie | 10 | 4 | 1 | 4d6 | 3 | 2 | 2 |
| Reconnaissance | 6 | 7 | 1 | 2d6 | 5 | 1 | 1 |
| Artillerie | 7 | 3 | 2–4 | 5d6, 6 obus par bataille | 2 | 1 | 3 |
| Blindés | 12 | 6 | 2 | 5d6 | 3 | 1 | 4 |
| Antichar | 6 | 3 | 2 | 5d6 (+2 contre blindés) | 3 | 2 | 3 |

L'antichar ne tire pas s'il a bougé dans le tour ; en couvert, il ne se repère qu'au contact tant qu'il n'a pas tiré.
Il ne tient pas l'objectif (comme l'artillerie et la reconnaissance).

Chaque niveau au-delà de Recrue : +1 PV et +1 dé. Vétéran ou mieux : +1 retranchement max
(et +1 vision pour la reconnaissance). Élite : +1 mouvement, +1 portée (artillerie, blindés), touche à −1,
et le matériel d'élite (Tigre, T-34/85, Katioucha, Panzergrenadiers, Gardes).

## Frontline stratégique (v1 jouable)

Mode séparé au menu : un front continu à grande échelle, en WEGO. Plus d'unités discrètes : chaque case d'une
micro-grille (96 × 64) porte une densité de troupes. Le matin, le jeu est en pause et chaque camp donne ses ordres
sans voir ceux de l'autre ; la journée s'exécute seule, en 30 ticks. Le mode tactique reste intact.

### Cahier des charges v1 (validé)

| Sujet | Décision |
|---|---|
| Intégration | Mode séparé au menu ; le mode tactique n'est pas modifié |
| Rendu | Masses fondues aux couleurs des camps, plus foncées où la densité est forte ; ligne de contact épaisse ; flèches d'ordres à l'encre jaune cernée de sombre (le crayon rouge se perdait sur la masse soviétique), sur le relief continu |
| Saisie des ordres | Toucher le départ puis la cible ; le jeu retient la case la plus pertinente autour du doigt, sans viser une case précise |
| Rythme | Front mobile : une percée concentrée sur un point faible avance de 10 à 15 cases par jour ; une attaque frontale sur un secteur dense s'use |
| Ordres | Vecteurs infanterie et blindés, déploiement des réserves, ligne de défense, barrage d'artillerie de zone, repli ordonné |
| Poches | Le joueur choisit chaque matin pour les siennes (statu quo, Festung, percée d'évasion) ; l'IA tire au sort, pondéré par les troupes piégées |
| Conditions | Météo tirée chaque jour, biomes de carte |
| Échelle | 10 jours, 96 × 64 cases |
| Rôles | Attaquant et défenseur fixés au briefing |
| Victoire | Anéantissement, effondrement du front, toutes les villes ; sinon au 10e jour, moitié territoire, moitié villes ; adaptées aux rôles |
| Vitesse | Journée contemplative d'environ 20 s, avec un bouton discret « Passer la journée » |
| Brouillard | Force ennemie lue à l'épaisseur de sa masse ; au toucher, une fourchette (« 2 000 à 3 000 hommes ») |

### Plan (une étape par commit)

1. Moteur mis à l'abri tel quel (fait).
2. Recalibrage de la physique avec un banc de mesure (cases gagnées par percée, coût d'une attaque frontale,
   fréquence des encerclements) ; rôles attaquant et défenseur (fait, voir ci-dessous).
3. Nouveaux ordres et choix du joueur pour ses poches (fait, voir ci-dessous).
4. Météo du jour et biomes sur la micro-grille (fait, voir ci-dessous).
5. IA (`frontai.js`) : défense élastique, percées sur les points faibles estimés, réserves, barrages, poches ;
   équilibrage IA contre IA (fait, voir ci-dessous).
6. Rendu en masses fondues (champ calculé par tick, interpolé entre deux ticks pour l'iPhone) (fait, voir ci-dessous).
7. Interface : menu, briefing, outils d'ordres, estimation au toucher, bilan quotidien, iPhone (fait, voir ci-dessous).
8. Sons, tests, documentation, publication (fait, voir ci-dessous).

### Calibrage de la physique (`tools/front-bench.mjs`)

Diagnostic de départ : un front calme perdait 10 % (Wehrmacht) et 4 % (Armée rouge) de ses troupes par jour, et
une percée blindée ne prenait aucune case. Causes et corrections :

- **Usure au contact** trop forte et à sens unique (fonction de la seule densité ennemie) : elle devient mutuelle
  (moyenne géométrique des deux densités, rapport des qualités) et 5 fois plus faible.
- **Colmatage élastique** trop rapide : la menace attirait toute la densité voisine, une case de contact montait à
  88 de densité (7 au repos) en quelques ticks. Poids de la menace et vitesse du colmatage réduits ; il dégarnit
  toujours les flancs, ce qui crée d'autres points faibles.
- **Avance** limitée par l'écoulement, pas par le combat : vitesse des blindés 0,42 → 0,7, de l'infanterie
  0,16 → 0,3.
- **Jauge de brèche** : une case ne tombe plus d'un coup ; tant que la pression dépasse 1,6 fois la défense, sa
  jauge se remplit selon le rapport des forces, et le seuil croît comme le cube de la défense (terrain, relief,
  retranchement). Forcer une ligne fortifiée prend donc du temps, pas seulement des pertes.
- **Rôles** : l'attaquant a 80 % de réserves et 30 % de renforts en plus ; le défenseur part retranché (défense
  +40 %) sur 6 cases de profondeur, inégalement selon les secteurs (toujours près des villes) : il y a des points
  faibles à découvrir. L'attaquant gagne au 10e jour s'il tient la moitié des villes du défenseur au départ.
- **Poches** : 1,2 % de densité perdue par tick (environ 30 % par jour) au lieu de 2 %, pour laisser le temps de
  choisir entre statu quo, Festung et percée d'évasion.

Résultats sur 8 cartes (cibles du cahier des charges entre parenthèses) :

| Mesure | Résultat |
|---|---|
| Front calme | 1,0 % et 0,9 % de pertes par jour, aucune case perdue (1 à 2 %) |
| Percée blindée sur point faible | 12 cases par jour en médiane (10 à 15) ; 0 quand le terrain s'y oppose (hauteurs) |
| Attaque frontale sur secteur renforcé | aucun gain, l'assaillant perd 1,7 fois plus (≤ 3 cases) |
| Poussée d'infanterie sur point faible | 6 cases par jour (3 à 6) |
| Traverser 7 cases de zone retranchée | 16 ticks sur point faible, 27 sur secteur fortifié (environ ½ journée de plus) |
| Tenaille | les bras se rejoignent au 2e jour ; poche de 2 000 à 4 500 hommes |

### Ordres (étape 3)

| Ordre | Saisie | Effet | Limite par jour |
|---|---|---|---|
| Vecteur infanterie / blindés | départ puis cible | la densité coule le long du couloir et pousse l'ennemi | 4 vecteurs, dont 2 blindés |
| Repli ordonné | départ puis point de ses lignes | les troupes reculent sans pousser ; usure et pertes d'assaut divisées par 3, terrain cédé plus vite (le terrain n'est perdu que si l'ennemi l'occupe) | compte dans les 4 vecteurs |
| Ligne de défense | deux points | bande de cases amies retranchée au fil de la journée (plein bonus de +40 % au soir), qui attire les troupes voisines | 2 lignes de 30 cases |
| Barrage de zone | un point, même dans le brouillard | cercle de 3 cases martelé les 6 premiers ticks : environ 20 % de la densité ennemie et ses fortifications | 2 (attaquant : 3), à 12 cases au plus de ses lignes |
| Réserves | un point de ses lignes ravitaillées | renforts répartis autour du point | le pool logistique |
| Poche | un choix par poche | statu quo ; Festung (contraction, défense ×1,4, usure infligée ×2,5, et 40 % de pertes en moins par encerclement) ; percée d'évasion vers un point, relancée chaque matin | choix en vigueur tant qu'on ne le change pas |

Mesures : repli face à une percée blindée, 35 % de pertes en moins qu'en tenant ; barrage, 19 % de densité
détruite dans la zone ; ligne, 10 % de troupes en plus sur les cases tracées ; Festung, la poche dure nettement plus
longtemps ; percée d'évasion, poche dégagée en deux jours à une dizaine de cases des lignes amies.

### Conditions (étape 4)

Météo tirée chaque matin selon le mois (même table que le mode tactique : neige à partir d'octobre), avec une
chance sur deux de garder le temps de la veille. Elle est connue au moment de donner les ordres.

| Temps | Blindés | Infanterie | Reconnaissance | Autre | Percée blindée d'un jour (médiane) |
|---|---|---|---|---|---|
| Clair | × 1 | × 1 | 5 cases | | 15 cases |
| Pluie | × 0,6 | × 0,9 | 4 cases | | 9 cases |
| Brouillard | × 0,9 | × 1 | 2 cases | barrages 30 % moins efficaces (pas d'observation) | 13 cases |
| Neige | × 0,75 | × 0,85 | 4 cases | marais gelés, praticables | 11 cases |

Biomes de la micro-grille (moyennes sur 8 cartes) : steppe 90 % de plaine, 5 % de forêt ; bocage 28 % de forêt ;
Polésie 25 % de marais, presque pas de montagnes ; bourg avec une grande ville de 19 cases au centre.

### IA et équilibre (étape 5)

L'IA (`src/frontai.js`) ne lit de l'ennemi que sa mémoire du brouillard (propriétaire des cases vues, densité
estimée) : un test vérifie que changer les troupes ennemies hors de vue ne change pas ses ordres. Chaque matin elle
lit le front par secteurs de 4 lignes (ses forces contre l'estimation d'en face, terrain compris), puis :
défense élastique (lignes derrière les secteurs menacés, réserves au prorata du déficit, repli d'un saillant
intenable loin des villes), attaque des meilleurs rapports de forces vers la ville ennemie la plus proche (blindés,
infanterie sous la pluie ; préparation au barrage ; réserves en tête), barrages sur les concentrations ennemies,
et tirage pondéré pour ses poches. Réglages dans `AI_TUNING`.

Outils : `tools/front-sim.mjs` (batailles IA contre IA) et `tools/front-pool.sh` (trois séries en parallèle,
mises en commun). Une série de 40 batailles est trop bruitée : selon la graine, la même version donnait 35 % ou
68 % de victoires à l'attaquant. Décider sur 120 batailles au moins.

Corrections apportées :
- l'objectif de l'attaquant passe de la moitié aux trois quarts des villes du défenseur (arrondi au-dessus) :
  avec la moitié, il gagnait 75 % des batailles ;
- le défenseur gardait ses réserves (pool passé de 650 à 1 000 pendant que son front cédait) : l'IA engage
  désormais 85 % du pool chaque matin, au prorata du déficit des secteurs menacés ;
- qualité allemande 1,15 → 1,25 : l'Armée rouge gagnait 58 % des batailles.

Résultat sur 240 batailles (biomes, mois et rôles tournants) : attaquant 50 %, Wehrmacht 47,5 %, Armée rouge
52,5 % ; 8,5 jours en moyenne, un tiers des batailles finit avant le terme ; environ 6 encerclements par bataille ;
1 s de calcul par bataille sous Node.

### Rendu (étape 6)

`src/frontrender.js` (hérite de la caméra du rendu tactique) ; page d'aperçu `front-preview.html` : bataille IA
contre IA en direct, vue allemande, soviétique ou omnisciente (`?seed=…&biome=…&season=…&att=SU`).

- Terrain précalculé : le générateur garde l'altitude continue (`map.relief`), alignée sur les niveaux du jeu,
  d'où un relief sans plateaux en escalier ; forêts, marais, montagnes hachurées, villes ; voile blanc les jours
  de neige.
- Masses : chaque camp est une teinte de territoire renforcée par sa densité (lissée par noyau gaussien sur la
  micro-grille), avec des courbes de concentration qui fusionnent ; la ligne de front est la courbe de partage,
  épaisse et sombre. L'ennemi est dessiné d'après la mémoire du joueur (densité estimée), plus pâle hors de vue.
  Les montagnes prennent le camp des cases praticables voisines, sinon la ligne de partage les cernait.
- Animation : un instantané lissé par tick ; les masses et la ligne de front sont interpolées entre deux ticks,
  les courbes de concentration et les contours de poches sont recalculés une fois par tick.
- Coût (Chromium, ordinateur) : 20 ms par image (contours de poches mis en cache : 62 ms auparavant), 20 à 30 ms
  par tick pour le moteur et l'instantané.

### Interface (étape 7)

`src/frontui.js`, seconde vue (`#front-app`) à côté de la vue tactique ; les dossiers papier (`#overlay`) sont
partagés. Entrée « Front stratégique » au menu, sous les deux camps du mode tactique, avec la même graine.

- Briefing : rôle tiré de la graine (attaquant ou défenseur), objectif en villes ★, forces, renseignement en
  fourchette, biome, mois et météo du jour.
- Matin : barre de six outils en bas de carte (infanterie, blindés, repli, ligne, barrage, réserves), chacun avec
  ce qu'il en reste pour la journée ; raccourcis 1 à 6, Échap, Entrée. (Remplacée depuis par deux rails d'icônes au
  bord de la carte : voir « Rails d'ordres ».) Deux appuis pour les vecteurs et les
  lignes (on peut déplacer la carte entre les deux), un seul pour le barrage et les réserves (l'outil réserves
  reste actif : un appui, 800 hommes). Le jeu choisit la case autour du doigt (rayon ~32 px d'écran) : la plus
  garnie au contact pour un vecteur, une case ravitaillée au contact pour les réserves, la plus proche dans nos
  lignes pour une ligne ou la cible d'un repli. À la souris, aperçu de l'ordre en cours sous le pointeur.
- Onglet Ordres : ordres du jour avec les troupes engagées (≈), suppression, « Reprendre les ordres de la
  veille », annulation du dernier renfort, et pour chaque poche de plus de 200 hommes les trois comportements
  (la percée demande de toucher sa direction). Point rouge sur l'onglet quand une poche attend.
- Sans outil, toucher la carte : nos troupes comptées dans un rayon de 3 cases, l'ennemi estimé en fourchette
  (avec l'âge de l'observation hors de vue).
- Journée : ~20 s (30 ticks de 667 ms), horloge de 6 h à 20 h à la place du bouton de lancement, bouton discret « Passer »
  (ticks restants à 45 ms, une image par tick). Le menu met la journée en pause.
- Bilan du soir : nos pertes exactes, celles de l'ennemi en fourchette, terrain gagné ou cédé, objectif, villes
  prises et encerclements, renforts, météo du lendemain, poches en attente. Le journal masque le bilan chiffré
  du moteur (il donnerait les pertes ennemies exactes).
- Fin : rapport final avec les pertes réelles des deux camps, puis le brouillard est levé (vue omnisciente).
- Mesures : ~53 images/s pendant la journée en émulation iPhone (Chromium), parcours complet testé au toucher
  (414 × 715) et à la souris, en modules et dans le fichier unique.

### Sons, tests, publication (étape 8)

- Sons (`AudioBoard.front`, appelé à chaque tick) : fusillades et canons des trois secteurs les plus violents au
  contact, entendus seulement là où l'on a des troupes ou une vue (`combatSpots`, pertes par blocs de 8 × 8 cases,
  d'après `front.tickLoss`) ; sifflements et explosions des barrages pendant les ticks du matin (les nôtres, et
  ceux de l'ennemi qui tombent sur nos lignes ou en vue) ; grosse explosion quand une ville tombe ; message radio
  à un encerclement ; cloche au bilan du soir. Placés en stéréo selon leur position à l'écran. Silence en
  accéléré. Budget mesuré : ~90 sources sonores par seconde pendant le barrage du matin, moins ensuite.
- Le vent et la canonnade lointaine du mode tactique servent de fond, seulement pendant la journée.
- Tests (`tests/frontui.test.js`) : fourchettes d'estimation, choix de la case autour du doigt, estimation au
  toucher sans fuite du brouillard (et vraie densité en vue omnisciente), foyers de combat, poches ignorées,
  présence dans la page de chaque élément cherché par les contrôleurs, compilation du fichier unique
  (`tools/bundle.mjs --check` : un nom déclaré deux fois dans deux modules casse la portée unique).
- Le bundle gère les imports sur plusieurs lignes ; `PALETTE` est désormais une vraie constante exportée (un
  alias `C as PALETTE` disparaissait à l'assemblage).
- Menu : lien sous le titre vers l'encadré du front stratégique (sous les deux camps du mode tactique, il était
  hors de l'écran sur iPhone).

### Plus tard : batailles locales

Après la v1, proposer de jouer en mode tactique un engagement décisif (percée contre secteur dense, ville
disputée, sortie de poche), au plus une fois par jour, avec résolution automatique possible. À prévoir : conversion
densités et vecteurs vers armées tactiques, terrain local vers paramètres de carte, résultat réinjecté dans les
densités. Le moteur garde des points d'accroche pour cela.

## Pistes pour la suite

- **Multijoueur à deux** (hot-seat ou en ligne) : le moteur est déjà déterministe et sépare plan et exécution.
- **Ordres conditionnels** : « avancer jusqu'au contact puis se retrancher », « tenir sauf si attaqué par des blindés ».
- **Ravitaillement** (les munitions d'artillerie existent déjà, par bataille).
- **Génie** : ponts à construire ou faire sauter, champs de mines.
- **Soutien aérien** aléatoire, appui de la Luftwaffe ou des Sturmoviks.
- **Carte de campagne stratégique** reliant les batailles (choisir son axe d'attaque).
- **Difficulté réglable** dans le menu (budget ennemi), à partir des réglages `ENEMY_BUDGETS` / `ENEMY_GROWTH`.

### Retours de jeu : plein écran, effets de combat (après la v1)

- Panneau réductible (chevron, `P`, mémorisé) : replié, un rail étroit à droite (ou une barre sous la carte en
  portrait) garde la vue d'ensemble, le son et le bouton du jour ; la carte garde son centre et couvre l'écran.
  Les boutons + / − sont retirés de la carte (pincer, molette, `+` / `−`), vue d'ensemble et son passent dans le
  rail. Sur téléphone en paysage, la carte couvre l'écran au lieu d'être entière avec des bandes vides.
- Effets (`frontfx.js`, purement visuels, lus dans `front.tickLoss` et `front.tickEdges` après chaque tick) :
  lueur par case au contact, échelle logarithmique des pertes (escarmouche ≈ 0,02 par tick à peine visible,
  assaut 0,2 à 1 flamboyant) ; tirs traçants reçus par chaque case (0,3 + 30 × pertes, 7 au plus, riposte 60 %),
  une fois sur quatre en rafale de mitrailleuse ; obus là où l'assaillant est surtout blindé (puissance de choc
  ≥ 1,45), avec antichars en riposte ; barrages : 16 explosions par tick et par zone pendant les 6 ticks du matin,
  fumée 3 s, sol noirci 14 s. Seulement là où l'on a des troupes ou une vue, et seulement à l'écran ; rien en
  accéléré ni en mouvement réduit. ~55 images/s en émulation iPhone pendant les barrages.
- Sons : rafales de mitrailleuse, canons plus proches où les blindés poussent, 4 explosions par tick et par
  barrage.
- Unités : trois symbolisations essayées (un point par 100 hommes, un rectangle par bataillon, un symbole OTAN par
  secteur) et écartées ; on garde les masses fondues, avec un dégradé de densité plus marqué : opacité
  0,2 + 0,66 k et teinte foncée de 32 % × k, où k = 1 − e^(−densité / 5) (arrières pâles, front et concentrations
  sombres).

### Tirs épars, fers de lance, artillerie positionnée

- Effets : le front calme (aucune poussée) n'échange plus que des coups isolés ; lueurs, rafales de mitrailleuse et tirs
  nourris sont réservés aux cases assaillies ou qui viennent de changer de mains. Le son suit (secteur sans assaut : un
  coup de temps en temps).
- Fer de lance blindé : pendant la journée, les cases entraînées par un vecteur blindé sont hachurées de la couleur
  sombre du camp ; une pointe de flèche nommée (« Pz.Gr. 1 », « 1er C. blindé ») marque la tête, la plus avancée le
  long de l'axe. L'ennemi n'apparaît que là où on le voit.
- Artillerie (`frontguns.js`) : le quota de barrages disparaît. Wehrmacht : deux régiments divisionnaires (portée 14)
  et un groupe lourd (20) ; Armée rouge : trois divisionnaires et un régiment de Katioucha (10, violent, peu efficace
  contre les retranchements). Chaque groupe tire au plus une mission de barrage par jour dans sa portée. Posture :
  en batterie 100 %, appui mobile 40 % à mi-vitesse, déplacement sans tir. Sans mission, il frappe les assaillants à
  sa portée (appui défensif, moins efficace contre les blindés). Un barrage use les groupes ennemis pris dans sa zone
  (contre-batterie) ; un groupe dont la case tombe est perdu. Camouflés, les groupes ne sont repérés qu'à ~3 cases
  des troupes ennemies ou quand ils tirent. L'IA les tient à mi-portée derrière le front.
- Doctrine de poussée de l'IA (serpentement) : travail commencé puis mis de côté, branche `claude/doctrine-wip`
  (règles de cohésion, feux croisés et étranglement des doigts de gant dans le moteur ; opérations suivies sur
  plusieurs jours dans l'IA). À reprendre.
- Pièces vues de dessus (`frontsprites.js`, style « C » choisi) : les groupes d'artillerie et les têtes de percée sont
  dessinés comme des pièces réelles, sans logo. Obusiers ouverts dans leurs épaulements (posture en batterie), une pièce
  en position et les autres attelées (appui mobile), colonne de camions (déplacement) ; mortiers 120 mm soviétiques sur
  plaque, Katioucha sur camion avec traînées de roquettes au tir ; coin de 2 à 5 chars à la tête de chaque percée
  blindée, avec poussière. Le nombre de pièces suit la force du groupe ; taille minimale à l'écran, deux pièces au zoom
  éloigné. L'Armée rouge aligne désormais deux régiments divisionnaires, un de mortiers lourds et un de Katioucha.

### Objectifs : victoire graduée aux points

- `frontscore.js` : le score de l'offensive (positif pour l'attaquant) additionne les villes ★ tenues au dernier soir
  (3 par bourg, 9 par grande ville), le contrôle soir après soir (1 par bourg et par soir), le terrain gagné (0,5 par %),
  le rapport des pertes, les troupes perdues dans les poches, l'exploitation jusqu'au bord ennemi et deux objectifs
  secondaires par camp (6 points chacun : encerclement, cote à prendre ou tenir, ville à prendre avant mi-bataille,
  groupes d'artillerie à réduire ou à préserver, plafond de pertes).
- Issues : victoire décisive de l'attaquant ≥ 42, victoire ≥ 25, indécis ≥ 12, victoire défensive ≥ 2, au-dessous
  victoire défensive décisive. Seuils calés sur 40 batailles IA contre IA (attaquant 55 %, défenseur 30 %, indécis 15 %),
  à revoir à l'équilibrage. Fins immédiates conservées (effondrement, anéantissement) ; « toutes les villes » ne vaut
  plus que pour l'attaquant (le défenseur qui part avec toutes les villes ne gagnait plus au premier tick).
- Interface : score et issue en vue dans la barre et l'onglet Forces, objectifs secondaires cochés au fil des jours,
  cotes marquées sur la carte, tableau du décompte au rapport final.

### Terrain : rivières, ponts, routes, terrain selon le type de troupes, nouveaux biomes

- (Remplacé plus bas : « Rivières infranchissables, ruisseaux, pont de bateaux ».)
- Rivières (`mapgen.js`) : tracé continu d'un bord à l'autre qui suit les creux, nord-sud ou est-ouest ; fleuve de deux
  cases côté défenseur (biome « fleuve »). Cases d'eau : fluidité 0,25, défense 0,7 (mauvais endroit où tenir) ; gué
  0,55 ; pont 0,9. Gelées (neige), elles se franchissent presque partout. Dessin : ruban lissé (moyenne glissante du
  tracé), gués en pierres claires, ponts en tablier brun.
- Routes : chaque ville reliée à ses deux voisines et les villes extrêmes aux bords ; chemin de moindre coût (évite
  marais, forêts, montées, et ne franchit une rivière qu'une fois : un pont).
- Terrain selon le type (`terrain.js`, `computeTerrain`) : fluidité et choc des blindés par case (forêt 0,45 / 0,65,
  marais 0,2 / 0,6, ville 0,6 / 0,6, rivière 0,08 / 0,5, route × 1,5). Le moteur mélange selon la part blindée de chaque
  poussée (déduite de sa puissance de choc). L'IA n'engage ses blindés que sur un axe praticable.
- Biomes ajoutés : montagne (chaînes de crêtes percées de cols), grande forêt, grand fleuve.

### Ouvrages : tranchées, barbelés, obstacles antichar, ponts

- `frontworks.js` remplace le retranchement invisible : trois niveaux par case. Tranchées (défense de l'infanterie,
  + 40 % au plein ; à moitié pour qui les prend, tournées du mauvais côté), barbelés (neutres : −40 % de pression
  d'infanterie et +50 % de riposte contre l'assaut qui les traverse), obstacles antichar (neutres : −60 % de choc et
  −70 % d'avance blindés).
- Lignes de défense = chantiers sur plusieurs jours (tranchées 1 jour, barbelés 2, antichar 3 ; trois fois plus lent
  au contact), niveau réglable dans le panneau, 2 nouveaux par jour et 4 en cours au plus. La ceinture initiale du
  défenseur : deux lignes continues (au contact et 4 cases en arrière), barbelés devant les secteurs solides, fossé et
  hérissons aux abords des villes.
- Destruction : un barrage arrache les barbelés, bouleverse les tranchées, use à peine les hérissons (sauf l'artillerie
  lourde) et fait sauter les ponts (la case redevient rivière). Un assaut qui prend une case coupe ses barbelés. Un
  ouvrage tombé en ruine laisse une trace grise persistante (cratères, barbelés épars, hérissons renversés) tant qu'on
  ne le reconstruit pas.
- Dessin discret : seules les lignes continues sont tracées (zigzag sombre et parapet clair côté ennemi), barbelés en
  petites croix devant, hérissons plus loin ; ouvrages ennemis visibles une fois observés.

### Formations blindées

- `frontarmor.js` : 2 divisions de Panzer (160 et 140 chars, aguerrie et vétéran) contre 3 corps blindés soviétiques
  (170 à 210 chars, plutôt bleus). Chaque formation a une case, des chars, une expérience (bleue, aguerrie, vétéran,
  élite : choc et pertes × 1 + 0,15 × exp), du carburant et des grenadiers portés.
- Le matin, on la touche puis on touche son objectif (le bouton Blindés passe d'une formation à l'autre). Dans la
  journée, elle rejoint le front par ses lignes (fluidité blindée : route, forêt, rivière sans pont), puis frappe la
  case ennemie devant elle (et à 35 % ses deux voisines) : sa pression s'ajoute à celle de l'infanterie dans le moteur,
  ses chars renforcent la défense de sa propre case. Case prise : elle y entre, y dépose 3 de densité de grenadiers,
  gagne de l'expérience, puis repart (au plus une case toutes les 2 ticks en terrain ouvert). La riposte lui coûte des
  chars, davantage contre les hérissons, en ville et en forêt ; elle consomme son carburant ; la nuit, ravitaillée,
  elle refait le plein et remet des chars en ligne. Sa case tombée : repli (−20 % de chars) ou destruction si elle est
  encerclée ; sous 8 % de ses chars, elle est retirée du front.
- L'ancien vecteur blindé reste dans le moteur (tests, outils) mais ni l'interface ni l'IA ne l'utilisent plus. L'IA
  lance la formation la plus proche en fer de lance de ses attaques, et garde les autres en contre-attaque ou en
  réserve derrière ses secteurs menacés.

### Rééquilibrage après les nouveaux chantiers

- Mesure de départ (formations, artillerie, terrain, ouvrages en place) : Wehrmacht 14 % des victoires, Armée rouge
  63 % (Wehrmacht en défense : 5 %).
- Réglages retenus : qualité allemande 1,45 (au lieu de 1,25) ; troupes de départ 5 800 / 6 000 (au lieu de
  5 200 / 6 200) ; artillerie soviétique ramenée à trois groupes (obusiers, mortiers, Katioucha) ; corps blindés
  soviétiques de 150, 170 et 120 chars.
- Résultat sur 2 × 90 batailles IA contre IA (graines différentes) : Wehrmacht 32 à 38 %, Armée rouge 39 à 42 %,
  indécis 23 à 26 % ; attaquant 40 à 44 %, défenseur 32 à 34 %. L'écart restant est dans le bruit de mesure (± 5 %).
- Le serpentement de l'IA reste à reprendre (branche `claude/doctrine-wip`).

### Rythme : plus lent, plus long, moins meurtrier

- Mesure de départ (14 batailles IA) : 90 cases prises par jour, jusqu'à 13 colonnes d'avance en une journée, pertes
  de 53 % (Wehrmacht) et 59 % (Armée rouge) en 10 jours.
- Plus de limite du nombre d'attaques : la seule limite est la part des troupes engagées (60 % au plus ; au-delà, tous
  les vecteurs sont réduits d'autant), affichée en jauge dans l'onglet Ordres et sur les outils Infanterie et Repli.
- 15 jours de 24 ticks ; usure et assauts −40 % ; chaque nuit, 20 % des pertes du jour (hors poches) rejoignent.
- `frontsupply.js` : têtes de ligne par ligne de carte, qui suivent le front de 3,5 unités par nuit (+2,5 avec une
  route), jamais à moins de 4 unités ; au-delà de 9 unités en avant, la poussée décroît jusqu'à 35 % (formations
  blindées : choc réduit, carburant consommé plus vite) ; une poche plafonne à 75 %. Fatigue : +0,03 par tick de
  poussée, −45 % de poussée au plein, la moitié s'efface la nuit, une case prise hérite de la fatigue des assaillants.
- Mesure après : 43 cases prises par jour, avance d'une journée 8 colonnes au plus. Les pertes rapportées aux effectifs
  de départ restent hautes (renforts de 15 jours compris), à revoir avec l'équilibrage.

### Fixation

- Nouvel ordre « Fixer » (outil 7) : vecteur large (σ 4,5), poussée faible (choc 0,55), avance quasi nulle ; ses
  troupes ne comptent pas dans la jauge de brèche (pas de prise) et subissent moitié moins de pertes.
- Toute case ennemie qui subit une poussée (fixation ou attaque) est fixée au tick suivant : elle ne cède plus que
  20 % de ce que le colmatage élastique lui ferait céder, et son besoin monte de 50 % (elle appelle des renforts).
  Fixer un secteur retient donc les réserves adverses loin du point de rupture.
- L'IA fixe un ou deux secteurs voisins (6 à 14 lignes) de ses attaques.

### Équilibrage par les camps et par l'année

- Atouts (`frontscenario.js`, FRONT_TRAITS) : Wehrmacht, reconnaissance +1 case et Panzer qui refont 80 % de leur plein
  la nuit (60 % côté soviétique) ; Armée rouge, réserves et renforts plus forts, défense des villes × 1,25, la neige ne
  ralentit pas son infanterie et à peine ses chars.
- Scénarios choisis au menu : 1941 Barbarossa, 1942 Fall Blau, 1943 Koursk (par défaut), 1944 Bagration. Chacun règle
  qualité, effectifs, réserves, renforts, blindés, artillerie, saisons, camp qui attaque le plus souvent, et l'exigence
  du score (points retranchés à une offensive favorite : 4 en 1941, 26 en 1944).
- Mesure (60 à 72 batailles IA contre IA par année, attaquant tiré selon le scénario) : 1941 Wehrmacht 38 % / Armée
  rouge 38 % ; 1942 35 / 37 ; 1943 38 / 47 ; 1944 31 / 60 (beaucoup de fins anticipées : l'effondrement allemand y
  échappe au score). Indécis 10 à 28 %.

### Villes sous le feu

- Chaque case de ville porte une destruction de 0 à 1 (`front.ruin`) : +0,04 par tick de barrage divisionnaire à
  pleine puissance (lourde +0,07, mortiers et Katioucha moins), +0,03 par unité de densité perdue dans la case, +0,15
  quand un assaut l'emporte. Elle ne se répare pas.
- Effet Stalingrad (`terrain.js`, RUINS) : le bonus défensif passe de +70 % (intacte) à +30 % à mi-destruction, quand la
  ville brûle et s'effondre, puis remonte à +60 % dans les ruines complètes, une forteresse pour l'infanterie. Les
  décombres coûtent 20 % de fluidité à l'infanterie, 55 % aux blindés (route comprise) et 45 % de leur choc.
  Bombarder une ville avant l'assaut paie donc, mais la raser rend la tâche à nouveau plus dure.
- Mesure (IA contre IA) : une ville prise d'assaut finit « endommagée » (≈ 0,2) ; seuls les combats de rue prolongés
  du biome « grande ville » la mettent en ruines.
- Rendu : les maisons sont dessinées à chaque image selon leur case (toit qui disparaît, murs noircis, puis tas de
  gravats gris, au-dessus des masses pour rester lisibles) ; chaque hausse de destruction attise un incendie qui
  s'éteint en un jour environ, avec un panache de fumée poussé par le vent. Chez l'ennemi, l'état n'est connu que des
  cases déjà observées, et les flammes ne se voient qu'à portée de vue.

### Obus en cloche et cratères

- Barrages (`frontfx.js`, ARC) : chaque obus part de la batterie et décrit une cloche vers le haut de l'écran
  (hauteur 0,38 de la distance ; mortiers 0,7, Katioucha 0,18 avec traînée de fumée grise), traînée lumineuse
  derrière la tête, explosion à l'arrivée. 8 à 14 obus par tick et par zone selon la pièce ; vol de 0,5 à 1,9 s. Tiré
  d'une batterie ennemie qu'on ne voit pas, l'obus n'apparaît qu'en fin de course.
- Cratères (`frontrender.js`, calque peint au fil de la bataille) : chaque tick de barrage effectivement tiré laisse
  5 à 9 cratères à pleine puissance (moins par mauvais temps), au hasard dans la zone, hors rivières et montagnes.
  Chacun ajoute une tache brune très légère (les zones pilonnées souvent virent à la terre labourée), un pointillé de
  terre retournée, puis le cratère : bourrelet clair éclairé du nord-ouest, entonnoir sombre, projections. Le calque
  est au-dessus des masses pour rester lisible dans les deux camps ; purement visuel.

### Fumée et vent

- Vent du jour (`front.js`, `rollWind`), purement visuel : tiré chaque matin avec la météo, surtout d'ouest (écart
  type ≈ 70°), force selon le temps (clair 0,15 à 0,55, pluie 0,45 à 0,9, neige 0,35 à 0,8, brouillard presque nul) ;
  un temps gardé de la veille garde à peu près son vent. Générateur à part : le déroulé des batailles ne change pas.
  Affiché avec la météo (« vent d'ouest, 24 km/h »).
- Panaches (`frontfx.js`, drawPlumes) : des foyers émettent des bouffées qui grossissent, s'éclaircissent, montent
  un peu et dérivent sous le vent (d'autant plus étirées qu'il est fort). Foyers : maisons en feu (un panache par case
  de ville) et cases où les combats ont été intenses (`frontrender.js` : chaleur = 1,5 × pertes du tick, −10 % par
  tick, +0,25 par cratère ; seuil 0,6, 28 foyers au plus, espacés de deux cases), vus par le camp observateur. Pas de
  nouvelles bouffées en accéléré ni en mouvement réduit.

### Tirs d'infanterie

- Aux assauts (`frontfx.js`, firefight) : 1 à 7 actions par case assaillie et par tick, des deux côtés (riposte
  45 %) : rafale de mitrailleuse qui balaie (6 traçants en éventail), grenade (petite explosion côté adverse) ou coup de
  fusil (traçant d'une frontière à l'autre, poussière à l'impact).
- Ailleurs le long du front (lineShot) : feu de ligne discret, un éclair de départ par case au contact avec une
  probabilité de 0,2 + 6 × pertes (0,8 au plus), un traçant court et sa poussière une fois sur trois. Les coups partent
  près de la frontière entre les deux cases, plus de case à case : le front se lit sur toute sa longueur.

### Routes et offensives blindées

- Vitesse (`terrain.js`) : sur route, la fluidité blindée est doublée et plafonnée à 1,6 (1,3 auparavant) : les chars
  y roulent 60 % plus vite qu'en steppe. Aucun bonus de choc : la route accélère, elle ne protège pas.
- Marche aimantée (`frontarmor.js`, armorRoute) : une formation rejoint le front par le chemin le plus rapide dans
  ses lignes (Dijkstra ; coût d'un pas 0,5 + 0,5 / fluidité blindée, dans un couloir de 6 unités autour de la ligne
  droite), vers la case amie qui rapproche le plus de l'objectif sans longer le front (distance restante + 0,9 × coût
  de marche). La route l'attire quand elle va à peu près dans le bon sens ; forêts et marais sont contournés. Route
  gardée en cache 4 ticks. Le matin, le trajet est dessiné (route surlignée), puis l'assaut file droit sur l'objectif.
- Colonnes (`frontrender.js`, drawConvoys) : pendant la journée, des camions soulèvent la poussière sur les routes
  tenues, à l'abri du front. Ambiance seulement.
- Mesure (84 batailles IA contre IA, même graine) : avant, attaquant 44 % / défenseur 37 % / nuls 19 %, Wehrmacht 35 %
  / Armée rouge 46 %, 5,9 encerclements ; après, 51 / 21 / 27, Wehrmacht 33 / Armée rouge 39, 5,4 encerclements.
  L'offensive y gagne un peu, comme attendu.

### Rythme : journée plus lente, front moins mobile

- Une journée dure une minute (20 s auparavant) : 2,5 s par tick, le barrage du matin dure ~12 s. Les obus en cloche
  volent 0,9 à 3,8 s, montent d'au moins 40 pixels même à courte portée (les batteries sont souvent juste derrière le
  front) et sont dessinés au-dessus des unités, avec une traînée et une tête plus grosses à toutes les échelles.
- Front moins mobile : poussée de l'infanterie 0,3 → 0,18 et des blindés 0,7 → 0,45 par tick, formations blindées
  4 ticks au moins entre deux cases prises (2 auparavant). Le colmatage élastique ralentit d'autant (0,25 → 0,12),
  sinon toute offensive s'enlisait ; seuil de rupture 1,6 → 1,45, réserves de l'attaquant ×2 et renforts ×1,6
  pour garder l'équilibre.
- Mesure (42 batailles IA contre IA) : cases prises par jour 40 → 32,5, pire journée (médiane) 84 → 63 ; victoires
  de l'attaquant 21 → 19, du défenseur 14 → 15.

### Artillerie : portée et décrochage sous le feu

- Portées +30 % : divisionnaire 18, lourde 26, mortiers 12, Katioucha 13 unités de grille. Mise en place initiale
  inchangée (à mi-portée derrière le front) : on frappe plus profond dès le premier jour.
- Mesure avant ce changement : un barrage tuait ~18 % des troupes de sa zone, rien ne bougeait autour (le besoin des
  cases n'en tient pas compte) et le trou n'était pas comblé le soir. Désormais, à chaque tick de barrage, 12 % des
  troupes d'une case pilonnée décrochent vers les cases amies plus éloignées du centre (GUN_RULES.flee) : la zone se vide
  de 44 % en 5 ticks, les troupes se regroupent juste derrière, les pertes ne changent presque pas. Un barrage prépare
  donc l'assaut en vidant les cases, que le colmatage ne remplit que lentement.

### Regroupement de nuit

- `frontnight.js`. Chemin de marche dans ses lignes (Dijkstra) : une case de route (entre deux cases de route) coûte
  0,25, une case de steppe 1, la forêt et le marais davantage ; une nuit permet un coût de 6 (≈ 24 cases par la
  route, 6 à travers champs). Un chemin à plus de 50 % sur route transporte jusqu'à 600 hommes, sinon 150. On prélève
  au plus la moitié de chaque case autour du départ (2 cases), on dépose autour de l'arrivée.
- La nuit (`staffNight`), l'état-major de chaque camp (1 regroupement pour le camp du joueur, 2 pour l'IA) prélève sur
  son secteur le plus calme pour le plus menacé (bandes de 8 lignes ; menace = densité ennemie connue au contact / nos
  troupes au contact, à partir de 0,7). Pas sans PC en état (`staffBlocked`). Notés dans `front.nightMoves`.
- Le joueur n'a plus d'outil « Transfert » (ancienne touche 8) : redondant avec les vecteurs et les réserves, il
  chargeait la barre d'ordres. Le regroupement reste l'affaire de l'état-major ; le joueur l'oriente par le secteur
  prioritaire, et dispose de régiments motorisés (voir plus bas).
- Rendu : le matin, flèche le long du chemin (épaisse par la route, pointillée à travers champs), « −N h » au départ et
  « +N h · état-major » à l'arrivée ; la ligne « Regroupement de l'état-major » dans l'onglet Ordres.
- Mesure (42 batailles IA contre IA) : 8 regroupements de l'état-major par bataille et par carte en moyenne, la moitié
  par la route ; équilibre inchangé (attaquant 15, défenseur 17).

### Régiments motorisés et secteur prioritaire

Remplacent le transfert manuel du joueur (retiré) : une réserve mobile qu'on voit rouler, et une façon d'orienter
l'état-major sans micro-gestion.
- `frontregiment.js`. Régiments : `cfg.regiments` par camp (2 en 1941-1942, 3 en 1943-1944 ; `FRONT_SETUP` = 1943),
  600 hommes chacun (`REGIMENT.men / cfg.men` de densité), retirés de la répartition initiale (`cfg.troops` reste le
  total ; `front.initial` les compte). Rassemblés près du PC, sur une route si possible ; placés au déploiement comme
  le PC (`placeable`, `placeUnit`, sorte `regiment`). Noms : « Schützen-Rgt. (mot.) N », « Rgt. de fusiliers
  motorisés N ».
- Marche : ordre du matin vers une case à soi ravitaillée ; chemin par nos cases (`transferPath` de `frontnight.js`,
  coût maximal paramétrable), route 0,25 par case, champs 1 / fluidité. Budget de 0,45 par tick (× la vitesse blindée
  de la météo) : ~40 cases par jour sur route, ~10 à travers champs ; la destination reste d'un jour à l'autre ; chemin
  recalculé si le front le coupe, halte s'il n'y en a plus.
- Engagement (le matin, immédiat, comme les réserves) : à moins de 5,3 unités (~3 cases) du régiment ; la densité est
  versée par `spreadMen` (la répartition de `deployReserve`, factorisée), sur 3 cases par nos lignes. Le pion disparaît,
  `back = jour + 2` : la nuit du jour `back − 1`, il revient près du PC en prenant 600 hommes au pool (il attend si le
  pool n'y suffit pas). Annulable le matin (✕ dans l'onglet Ordres). Le plafond des troupes engagées ne s'applique
  qu'aux vecteurs : comme les réserves, un régiment engagé n'y compte pas.
- Vulnérabilité : frappe aérienne ennemie (zone + 0,6) : 12 % de ses hommes par tick de frappe à pleine puissance, et
  il est repéré ; case prise : détruit, un tiers des hommes dans la case amie voisine, le reste en pertes (comptées
  comme pertes en poche pour le score). Brouillard : vu comme les blindés (case en vue, mémoire d'un jour).
- Secteur prioritaire : `front.priority[s]`, une case. `staffNight` fait d'abord un regroupement vers le fanion, pris
  sur le secteur le plus calme qui le relie en une nuit et où l'on tient au moins à égalité (menace < 1), puis les
  suivants comme avant (le joueur n'en a qu'un : il remplace celui du secteur le plus menacé). Les blessés rétablis
  de la nuit (20 % des pertes) vont autour du fanion jusqu'à 40 de densité (400 h), le reste au pool. Le fanion
  tombe si sa case est perdue.
- IA (`planRegiments`, sans tirage au sort) : fanion sur la première attaque de l'attaquant, sinon sur le secteur le
  plus menacé ; régiments : un régiment à portée d'un secteur qui craque (tenue < 0,45) ou de l'effort principal de
  l'attaquant s'y engage (un par secteur et par jour), les autres roulent se poster 3 unités derrière ; l'aviation
  vise aussi les régiments ennemis repérés.
- Interface : outil Priorité (`8`, fanion) dans le groupe Renforts ; régiment sélectionné en touchant son pion ou son
  nom dans le panneau (« Régiments motorisés » : Engager, Halte, Vers la priorité) ; trajet prévu en tirets jaunes,
  route surlignée, rayon d'engagement ; dans la journée, la colonne roule d'une case à l'autre dans sa poussière.
- Équilibre (IA contre IA) : seuil d'engagement de l'IA abaissé de 0,6 à 0,45, sans quoi le défenseur, qui colmate
  plus vite, gagnait 3 à 7 points. Mesures avant / après (attaquant / défenseur / nuls) : `front-sim 120` 25 / 63 / 12
  → 23 / 68 / 9 ; `front-pool 50` (150 batailles) 21 / 68 / 11 → 25 / 68 / 7, et sur d'autres graines 30 / 60 / 10
  → 30 / 57 / 13. Banc de calibrage inchangé à l'arrondi près (régiments immobiles sans IA, 3 % de troupes en moins
  sur la ligne).

### Aviation et DCA

- `frontair.js`. Deux réserves séparées, réglées par l'année (`frontscenario.js`) : sorties par jour (1941-1942 :
  Luftwaffe 3, VVS 1 ; 1943 : 2 et 2 ; 1944 : 1 et 3) et batteries de DCA pour la bataille (2 à 3 par camp, placées
  à 7 unités derrière le front). Brouillard : l'aviation reste au sol ; pluie × 0,6, neige × 0,8.
- Missions, le matin (outil « Air », touche 9) : appui rapproché sur une zone (rayon 2,4), n'importe où sur la carte,
  frappée aux ticks 6 à 8 (−6 % des troupes ennemies par tick, −7 % des chars d'une formation prise dedans) ; chasse
  de batteries quand on touche près d'un groupe d'artillerie ou d'une DCA ennemie repérés (−25 % de puissance de feu,
  détruit sous 25 %).
- Les avions partent de leur bord de carte et filent droit sur l'objectif. Chaque DCA ennemie dont le rayon (6 unités)
  croise leur route émousse la mission de 35 % et a 40 % de chances d'abattre un avion ; en tirant, elle se dévoile à
  l'attaquant. Sinon elle reste camouflée (repérée à 5,5 unités de ses troupes, comme l'artillerie). On la déplace
  le matin (10 unités au plus, elle a roulé de nuit). Une DCA dont la case tombe est perdue.
- IA : une chasse par jour au plus, sur la batterie la plus fraîchement repérée (si elle a plus d'une sortie), puis
  l'appui sur ses blindés repérés ou les cases ennemies les plus denses au contact, en évitant les DCA connues.
- Rendu : le matin, route de vol en pointillé et objectif cerclé, rayon de sa DCA, DCA ennemies repérées en
  pointillé rouge. Pendant la journée, trois avions vus de dessus avec leur ombre, piqué, bombes, retour ; flocons
  de DCA sur leur route ; un avion abattu part en vrille dans la fumée et s'écrase.
- Mesure (6 batailles) : 2 groupes d'artillerie détruits par l'aviation au total, 34 avions abattus ; équilibre
  inchangé sur 42 batailles (attaquant 17, défenseur 14).

### Troupes : de petits soldats le long du front

- Le dégradé opaque et les courbes de concentration disparaissent. Chaque camp n'a plus qu'une teinte légère
  (opacité 0,15 à 0,2) ; ses troupes sont de petits soldats vus de dessus (`frontinfantry.js`, placés par troopDots
  dans `frontrender.js`) : ombre portée, corps, tête plus claire, fusil, tournés vers l'ennemi.
  - au contact, depuis chaque case de contact, 0,45 homme par unité de densité du secteur (la case et ses voisines,
    14 au plus) ; la bande s'épaissit avec la densité (4 à 26 pixels monde). Un secteur faible se voit à ses rangs
    clairsemés. Chaque homme reste de son côté du trait du front ;
  - la disposition dit la posture du secteur, lue dans l'état du moteur (de la plus forte à la plus faible) :
    - poche (cases d'une poche montrée) : groupes de 2 à 5 épars, tournés en tous sens ; les drapeaux blancs restent
      ceux de drawPockets ;
    - repli (couloir ou ramassage d'un ordre de repli) : une arrière-garde de 3 au contact, qui tire, et une colonne
      en file indienne qui glisse vers l'arrière dans la poussière ;
    - attaque (la case a poussé ce tick, `tickEdges`, ou elle est dans le couloir d'un vecteur d'infanterie, de
      blindés ou de fixation) : groupes de 4 en deux vagues décalées ; pendant la journée, bonds alternés d'environ
      10 pixels (1,4 s par vague) : l'une avance, l'autre fait feu ; le matin, à leur ligne de départ ; un ordre
      retenu par le PC ne bouge pas encore ;
    - tenir (par défaut) : un groupe de 3 à 5 serré dans le créneau d'une tranchée parallèle au front, quelques
      pixels en arrière, et une ligne de soutien clairsemée derrière. La tranchée n'apparaît que si la case et ses
      voisines n'ont pas changé de mains depuis 3 ticks (toute la ligne de départ en a une), ou si elle est
      retranchée (`trenchFor`) ; elle se marque avec l'immobilité et le retranchement ;
    - chez l'ennemi, ses ordres ne se lisent que pendant la journée et sur les cases en vue : le matin, il tient ;
  - à l'arrière, seulement les amas de plus de 300 hommes (garnisons, réserves) : un essaim serré et son effectif ;
  - positions tirées d'un générateur par case, stables d'un tick à l'autre ; coups de feu (point jaune et halo, au
    hasard d'un tirage visuel) seulement pendant la journée ; mouvement réduit : ni bonds, ni colonnes, ni coups de
    feu. Chez l'ennemi, les hommes reprennent son estimation, estompés hors de vue (opacité 0,55).
- Une seule représentation à tous les zooms : taille monde (les hommes rapetissent quand on dézoome), avec un
  plancher à l'écran de 45 % de leur taille au zoom 1. Silhouettes pré-dessinées par camp et 16 orientations sur une
  planche, refaite par palier de zoom. Mesure (Chromium logiciel, écran ×2, bataille chargée à 2 500 hommes) : le
  dessin des troupes prend 10,5 ms contre 14 ms pour les anciens points.
- Essais écartés avant ce choix (maquettes) : groupes de fantassins sur toute la carte, hachures de carte, courbes
  d'isodensité, voile pâle et trous de combat, puis des points le long du front.

### Rivières infranchissables, ruisseaux, pont de bateaux

- Constat : une rivière était une case qu'on possédait (fluidité 0,25, défense 0,7) ; le front passait dessus, et
  près de la moitié des tracés couraient dans l'axe de l'attaque. Elle ne barrait rien.
- Rivière (`mapgen.js`, carveFreeRiver) : elle entre par un bord et ressort par un autre, l'opposé ou un voisin (assez
  loin pour ne pas couper qu'un coin), au plus court à travers les creux, avec des coudes tirés d'un bruit. Le chemin
  va de case voisine en case voisine : sur une grille hexagonale, il coupe la carte sans fuite. Le fleuve (biome
  « fleuve ») garde son tracé nord-sud de deux cases. Plus de gués.
- Eau infranchissable (`front.js`, syncWater) : une case de rivière sans pont ni glace n'appartient à personne
  (comme la montagne), le front s'arrête sur les rives et s'y interrompt au dessin. Pont détruit ou dégel : ses
  occupants refluent sur leurs cases voisines (perdus s'ils n'en ont pas). Pont jeté ou gel : la case revient, vide,
  au camp qui tient le plus de cases autour. Le ravitaillement ne passe que par les ponts.
- Ponts : au moins deux par rivière, trois sur une longue rivière ou un fleuve (`ensureBridges`) ; il en manque, une
  route de campagne traverse là où les ponts sont le plus loin et rejoint le réseau de chaque rive.
- Ligne de départ : une case coupée de son bord de carte par l'eau passe au camp d'en face (le front épouse la
  rivière) ; une enclave que ni l'un ni l'autre bord n'atteint devient neutre. Aucune poche au premier jour.
- Ruisseaux (`carveStream`) : 0 à 4 selon le biome ; ils naissent sur une hauteur et descendent jusqu'à la rivière,
  un autre ruisseau ou un bord. Terre ferme : fluidité × 0,6 (blindés × 0,5, sauf sur route), défense × 1,15.
- Rive (`combat.js`, frontNeed) : l'ennemi d'en face compte comme un contact à 35 % de sa densité : la rive se garde,
  plus légèrement qu'un front de terre.
- Pont de bateaux (outil « Pont », touche G, visible seulement s'il y a une rivière) : le matin, une case d'eau au bord
  de ses lignes ; le génie le jette la nuit jusqu'à l'autre rive (trois cases d'eau au plus), s'il tient encore sa rive.
  Deux par bataille, un par nuit. Solidité 0,35 d'un pont en dur : un barrage le coule en un matin. L'appui aérien
  coule les ponts de bateaux ennemis dans sa zone et use les ponts en dur (−0,12 par tick de frappe).
- IA (`frontai.js`) : le contact se lit aussi par-dessus l'eau. Un secteur de rive compte double ou triple pour
  attaquer (rapport `ratio`) et protège pour tenir (rapport `hold`). Une attaque dont l'axe bute sur l'eau au bord de
  ses lignes passe par le pont le plus proche (14 unités) ; sinon le génie lance un pont de bateaux et l'assaut attend
  le lendemain. L'attaquant bloqué sur toute sa rive prépare un franchissement sur son secteur le plus fort. Le
  défenseur fait sauter (barrage) un pont que l'ennemi tient ou touche.
- Mesure (70 batailles IA contre IA, avant le renforcement des défenses) : attaquant 31 % (40 % avant), fleuve 3/10
  (6/10), encerclements 4,8 par bataille (3,3). Sur 10 batailles à rivière : 9 ponts de bateaux lancés, 2 coulés,
  3 ponts sautés.

### Défense renforcée, choc des feux de préparation

- But : ralentir les percées ; pour percer, il faut faire coïncider barrages et frappes aériennes sur le point
  d'attaque, qui désorientent et affaiblissent les défenseurs.
- Choc (`front.shock`, 0 à 1, par case) : un tick de barrage ajoute 0,15 × puissance × √(cadence / 0,04) aux
  troupes ennemies de la zone ; un tick de frappe aérienne 0,35 × puissance. Il s'efface de 4 % par tick (×0,96) et
  retombe à zéro quand la case change de mains. Un barrage seul (ticks 0 à 6) monte vers 0,6 ; l'aviation (ticks 6
  à 8) sur la même zone le porte au plein. Effet (`combat.js`) : défense, riposte et seuil de brèche
  × (1 − 0,85 × choc) ; plafond de remplissage de la brèche ÷ (1 − 0,85 × choc)² ; pertes d'assaut du défenseur
  ÷ (1 − 0,85 × choc).
- Défense de base : riposte 1,2 (0,8) ; ténacité, le défenseur ne subit que 70 % des pertes d'assaut ; plafond de
  remplissage de la jauge de brèche, 0,06 par tick × (1 + 4 / densité) : une position dense résiste des heures quel
  que soit le rapport de forces, une case mince cède plus vite (exploitation).
- L'attaquant reçoit une artillerie de rupture (`attackGuns`, un groupe lourd et un divisionnaire de plus) et une
  sortie aérienne de plus par jour (`attackSorties`).
- IA : barrage puis appui aérien sur le même point (3 unités devant le départ de chaque attaque, et de chaque
  contre-attaque blindée) ; sans aucun feu disponible, pas d'assaut à moins d'un rapport de forces écrasant ; les
  groupes d'artillerie restés sans mission rejoignent l'axe principal pour que leurs barrages coïncident le
  lendemain.
- Interface : toucher la carte indique les défenseurs ébranlés et la baisse de leur défense ; l'aide l'explique.
- Banc (`front-bench.mjs`, préparation, 6 cartes × 2 jours, cases par jour) : blindés 3 sans feux, 4,5 avec
  artillerie, 6 avec artillerie et aviation ; infanterie 0 / 2,5 / 3. Sans feux, l'attaquant perd 1,5 (blindés) à
  2,4 fois (infanterie) ce que perd le défenseur. Secteur fortifié sur deux jours : 4 cases sans feux, 26 préparé.
- Équilibre IA contre IA (70 batailles, deux graines) : attaquant 19 % et 30 % (31 % après les rivières, 40 % avant).
  Les percées sont plus lentes, l'offensive gagne moins souvent ; le levier de réglage le plus direct est
  `DEF_TOUGH` (ténacité) puis `BREACH_CAP`.

### IA : repli sur pré-encerclement

- Détection (`frontai.js`, preEncirclement), chaque matin, avant tout déploiement : on ronge virtuellement son
  territoire depuis l'ennemi au contact, d'autant plus profond qu'il y est fort (rapport de la densité ennemie
  moyenne à la sienne : > 1,5 → 5 cases, > 0,8 → 3, sinon rien), et sur 8 unités autour d'une formation blindée
  ennemie repérée. Puis on refait le ravitaillement depuis son bord de carte. Les cases ravitaillées aujourd'hui qui
  ne seraient plus reliées et sont à plus de 6 cases de ce qui le resterait forment une poche en devenir (un
  saillant mince, entièrement rongé, est donc repéré par sa profondeur). Retenue si elle contient au moins 600 hommes
  et que l'ennemi qui la borde pèse au moins la moitié de ses troupes ; la plus grosse seulement.
- Réaction (tendance, tirage : 85 %, 40 % si le défenseur y tient une ville) : repli de la pointe vers la sortie (et
  du centre si le saillant dépasse 40 cases), ligne de défense en travers du goulot, 30 % des réserves au goulot ; on
  n'attaque pas depuis le saillant évacué. L'attaquant ne lâche une tête de percée que si l'ennemi qui la borde pèse
  1,5 fois ses troupes (sinon il évacuait ses propres percées : 11 % de victoires).
- Mesures : tenaille du banc, 16 cartes, camp soviétique joué par l'IA : 4 000 hommes encerclés au total contre
  13 700 sans repli. Batailles IA contre IA (21) : 29 % d'hommes encerclés en moins. Équilibre (70 batailles, deux
  graines) : attaquant 27 % et 31 %.

### Alerte « SOS » d'un secteur qui craque

- Détection (`frontalert.js`), après chaque tick, pour le camp du joueur : cases perdues depuis 6 ticks (1 point) et
  cases dont la jauge de brèche dépasse 60 % (0,5 point ; `combat.js` expose `front.breachFrac`), par blocs de 8 × 8
  cases. Un bloc craque à 6 points dont au moins 4 cases perdues. Mesure (défenseur, batailles IA contre IA) : 0 à
  2 alertes par jour, à l'écran environ un quart du temps de la journée.
- Rendu (`frontrender.js`, drawAlerts) : médaillon cerclé de rouge au bout d'un mât, officier (casquette, combiné à
  l'oreille, poste radio dont l'antenne oscille, uniforme du camp), bulle où · · · — — — · · · s'allume signe par
  signe, suivi de « SOS » ; au sol, deux ondes rouges. Taille à peu près constante à l'écran, trois alertes au plus ;
  elle reste 6 ticks après le dernier signal en s'estompant.
- Son (`audio.js`, ui('sos')) : souffle radio et · · · — — — · · · deux fois, placé dans l'espace stéréo comme les
  combats ; à l'apparition d'une alerte seulement, jamais en accéléré.

### Rééquilibrage vers l'offensive (attaquant ≈ 40 %)

- Constat : l'attaquant ne gagnait plus que 24 % des batailles IA contre IA (84 batailles, défenseur 57 %, nuls 19 %).
  Cible retenue : environ 40 % à l'attaquant ; l'attaque reste difficile, mais une préparation réussie paie.
- Réglages : barrage de 7 ticks (5), choc qui s'efface de 4 % par tick (×0,96 ; 7 %), renforts de l'attaquant ×1,9
  (×1,6). Seuls, ils ne bougent presque pas l'issue (attaquant 26 %) : l'offensive gagne du terrain et des villes,
  mais le score ne le récompensait pas. Seuils du score abaissés : victoire décisive 36 (42), victoire 16 (25),
  indécis 11 (12).
- `goalShare` (part des villes à tenir) supprimé : l'issue se lit au score depuis l'introduction de `frontscore.js`.
- Mesure (84 batailles par jeu de graines, `tools/front-pool.sh 28`) : graines A/B/C, attaquant 39 % / défenseur
  44 % / nuls 17 % ; graines D/E/F, 40 % / 55 % / 5 %. Écarté : réglages proposés pour freiner l'offensive (seuil de
  percée 1,6, ténacité 0,8, effet du choc 0,75, réserves ×1,5…) : attaquant 14 %.
- Outils : `tools/front-sim.mjs` lit aussi `SCORE` (seuils) ; `SCORES=1` affiche le score de chaque bataille.

### Immersion et interface

- Sons (`audio.js`), moins « 8 bits » : obus qui arrivent en bruit filtré en bande étroite qui descend (et non plus
  un sifflet sinusoïdal), une note sourde dessous ; explosions et départs plus graves (coup sourd saturé, grondement
  plus long, mottes de terre qui retombent). Réverbération de plaine : un convolueur partagé, réponse impulsionnelle
  synthétisée (6 échos francs entre 70 et 600 ms, queue diffuse ≈ 3 s qui s'assombrit), part envoyée plus forte pour
  un son lointain ; interface sèche. Compresseur de sortie presque limiteur (−18 dB, rapport 12) : crêtes ≈ 0,5.
- Sirène du Stuka (« trompette de Jéricho ») : dents de scie désaccordées et saturées dans trois formants de tuyau,
  175 → 410 Hz sur 2,3 s avec un battement irrégulier, souffle de l'air, moteur qui rugit puis la ressource ; bombes
  plus lourdes. Orgues de Staline (groupes `rocket`) : 12 à 16 départs en rafale qui feulent, hurlement collectif,
  chapelet d'impacts serrés. Banc sonore : boutons « Barrage lourd » et « Orgues de Staline ».
- Terrain (`frontrender.js`, `WEAR`) : usure par case = pertes cumulées sur la bataille + 0,6 par cratère de barrage.
  Teinte lissée (échantillonneur des masses) sous les troupes : brune au-delà de 1,5, grise cendre vers le champ
  lunaire (35) ; trous d'obus peints au calque des cratères à partir de 5 (0,55 par unité, 42 par case au plus),
  gris au-delà de 21. Mesure (4 batailles IA contre IA, ~700 cases touchées) : moitié au-delà de 2,5, un cinquième
  au-delà de 12, 5 % au-delà de 40 : une bande labourée suit le front, quelques taches lunaires aux points chauds.
- Champs qui brûlent (`FIELD_FIRE`) : en juillet-août par temps clair, une case de steppe dont la chaleur des combats
  dépasse 3 s'allume (4 % par tick), le feu court sous le vent sur deux cases au plus, fume, puis laisse un chaume
  sombre. Premier essai (12 %, propagation libre) : des pans entiers de l'arrière noircis, lus comme une ombre.
- Épaves (`WRECK`) : une carcasse par 20 chars perdus d'une formation (le reste quand elle est anéantie), à 2 unités
  au plus de sa position, vue par le joueur ; 90 au plus. Char noirci, tourelle de travers, fumée pendant 30 ticks.
- Lumière : voile en multiplication, doré de 6 h à 8 h 30 (et le matin des ordres), chaud après 16 h 30, bleui après
  18 h 30.
- Chars plus petits : échelle 0,95 (1,7 avant) avec un plancher à l'écran au dézoom, trois chars au plus par
  formation (deux en vue d'ensemble), serrés. L'artillerie garde son échelle.
- Texte : barre d'aide muette par défaut ; consignes d'outil réduites à une ligne ; confirmations d'ordre brèves qui
  s'effacent après 2,6 s. Étiquette de poche réduite à l'effectif (■ Festung, ➚ percée), taille constante à l'écran.
  Règles du briefing repliées. Bilan du soir en cinq chiffres (pertes, pertes ennemies en fourchette, terrain,
  villes ★, score), puis issue, quatre événements au plus, objectifs, météo et renforts en une ligne.


## Atouts, poste de commandement, bataille des airs (chantier)

Le front stratégique devient le mode principal (le tactique est débranché, `TACTICAL_ENABLED` dans `main.js`).
Les moyens de chaque camp ne sont plus placés d'office : ils sont tirés au sort avant la bataille et au 7e jour,
choisis et posés sur la carte par chaque camp. Un poste de commandement coordonne les troupes autour de lui ; une
bataille des airs décide qui a le droit de faire voler son aviation.

### Cahier des charges (validé)

| Sujet | Décision |
|---|---|
| Tirage | Avant le jour 1 : tirer 5 cartes, en garder 3. Au matin du jour 7 (renforts) : tirer 4, garder 2 ; le camp mené aux points en tire 5 |
| Paquets | Selon le rôle (attaquant, défenseur) et l'année ; chaque carte a une rareté : commun, rare, élite |
| Remplacement | Les cartes remplacent complètement l'artillerie, les formations blindées et la DCA placées d'office (`cfg.guns`, `attackGuns`, `cfg.armor`, `aaBatteries`). Effectifs, réserves et renforts inchangés |
| Placement | Instantané, avant le jour 1 (et au matin du jour 7), dans ses lignes ; l'IA place les siennes |
| Attaquant | Divisions blindées (rareté), artillerie lourde, soutien aérien, génie d'assaut, barrage de lance-roquettes, parachutistes, DCA |
| Défenseur | Canons antichar, bataillons de soutien, point d'appui, artillerie divisionnaire, DCA, chasseurs |
| Bataillon de soutien | Placé en arrière, projette une zone sur un secteur du front qui se retranche chaque jour sans mouvement (tranchées, puis barbelés, puis hérissons, ouvrages actuels) ; l'effet reste si le bataillon part. Remplace l'outil « Ligne », retiré de l'écran |
| Canon antichar | Comme l'artillerie, avec un cône de tir devant lui, efficace contre les blindés ; démoli par plusieurs barrages ou frappes aériennes |
| Bataille des airs | Avant le jour 1 et rejouée au jour 7 : manches de dés mises en scène (combat de chasseurs) ; le vainqueur a le droit au soutien aérien, le perdant garde la DCA qu'il a tirée |
| Poste de commandement | Un par camp, hors tirage, placé avec les cartes et déplaçable ; rayon de coordination dégressif ; jauge de liaison ; désorganisé s'il est bombardé ou déplacé de jour ; capturé : malus et documents saisis ; reprenable ; PC de secours |

### Catalogue des cartes (première version, à équilibrer)

Chaque carte est une donnée (`frontatout.js`) : `{ key, role, rarity, label, apply(front, side, place) }`. Une carte
vaut un **groupement** et non une seule pièce : avec 3 cartes au lieu d'une dizaine de moyens aujourd'hui, chacune doit
peser. Les noms et les chiffres changent avec l'année (`SCENARIOS[year].atouts` : poids des cartes, poids des raretés,
libellés).

Attaquant :

| Carte | Commun | Rare | Élite |
|---|---|---|---|
| Division blindée | 1 formation, 130 chars, Aguerrie | 1 formation, 170 chars, Vétéran | Bataillon lourd (Tiger, Tigre royal, IS-2 selon l'année) : 100 chars, choc ×1,5, pertes ×0,6, plus lent |
| Artillerie lourde | 2 groupes divisionnaires | 1 divisionnaire + 1 lourd | 1 lourd + 1 super-lourd (rayon 3, vient à bout des hérissons, fait sauter les ponts) |
| Lance-roquettes | 1 salve par bataille, rayon 3 | 1 salve, rayon 4 | 2 salves, rayon 4 |
| Soutien aérien | +1 sortie par jour, +1 en bataille des airs | +2 sorties, +2 | +2 sorties, +3, avions d'assaut (Stuka, Sturmovik : frappes ×1,5 contre les chars) |
| Génie d'assaut | 1 compagnie, zone de rayon 3 | rayon 4, +1 pont de bateaux | rayon 5, ouvrages ennemis rasés deux fois plus vite |
| Parachutistes | — | 1 largage, 400 h | 1 largage, 700 h |
| DCA | 2 batteries | 3 batteries | 2 batteries de 88 (DCA et antichar) |

Défenseur :

| Carte | Commun | Rare | Élite |
|---|---|---|---|
| Canons antichar | 2 pièces légères (45 mm, Pak 36) | 2 pièces moyennes (ZiS-3, Pak 40) | 1 batterie de 88 ou de 100 mm (portée et dégâts ×1,6, aussi DCA) |
| Bataillon de soutien | 1 bataillon, jusqu'aux barbelés | 1 bataillon, jusqu'aux hérissons | 2 bataillons |
| Point d'appui | Ville ★ : défense ×1,4, tranchées autour | ×1,7, tranchées et barbelés | ×2, ouvrages complets, garnison de 300 h |
| Artillerie divisionnaire | 2 groupes (divisionnaire, mortiers) | divisionnaire + lance-roquettes | divisionnaire + lourd |
| DCA | 2 batteries | 3 batteries | 2 batteries lourdes |
| Chasseurs | +1 en bataille des airs | +2 | +3, et +1 sortie s'il gagne |

Garanties de la main : 5 cartes distinctes ou non, avec au moins une carte de feu (artillerie ou lance-roquettes)
et, pour l'attaquant, une division blindée ; pour le défenseur, un canon antichar ou un bataillon de soutien.
Le tirage utilise sa propre suite (`createRng(\`atout:${seed}:${side}:${round}\`)`), jamais `front.rng` (sinon la
météo et l'IA changent) : la main est reproductible d'après la graine.

### Poste de commandement

- Objet `front.hq[s] = { x, y, cell, link, state, movedDay, lostDay, backup }`. États : opérationnel, désorganisé
  (liaison < 30 %), capturé, absent.
- **Coordination** : coefficient par case `coord(i)`, plein au PC, nul au-delà du rayon (12 cases ; selon le camp et
  l'année, voir plus bas), proportionnel à la liaison. Il multiplie l'attaque (+12 %), la défense (+10 %) et la vitesse
  (+15 %) dans le champ de chaque camp (`front.js`, construction de `F.atk`, `F.fort`, `F.speed`). Rien à changer dans
  `combat.js`.
- **Liaison** (0 à 100 %) : un barrage qui couvre le PC −40, une frappe aérienne −30, la nuit +50.
- **Déplacement** : de nuit et à 10 cases au plus, liaison ramenée à 60 % au plus ; plus loin ou de jour : désorganisé
  pour la journée. Même geste que le déplacement d'une batterie de DCA.
- **Désorganisé** : plus de bonus, plus de transferts de l'état-major la nuit (`staffNight`), part des troupes
  engagées plafonnée à 45 % (`engageCap` 0,6 ; c'est elle, et non `maxVectors`, qui limite les ordres), et les vecteurs
  ne partent qu'à midi.
- **Capturé** (la case du PC passe à l'ennemi) : le bonus devient un malus de même ampleur sur l'ancien rayon,
  `engageCap` à 35 %, et l'ennemi voit pendant une journée vos formations blindées, vos réserves et vos ordres du
  lendemain matin (documents saisis). Reprendre la case rend le PC, désorganisé, puis opérationnel après une nuit.
- **PC de secours** : après deux nuits sans PC, un PC apparaît loin à l'arrière, rayon réduit de moitié.
- **Repérage** : invisible pour l'ennemi au-delà de 4 cases de ses troupes, sauf s'il bouge de jour ou qu'une frappe
  ou des parachutistes l'ont trouvé ; une fois repéré, il se vise au barrage et à la chasse aérienne.
- **Camps et années** : la Wehrmacht souffre moins de la perte de son PC (malus ×0,6) ; l'Armée rouge de 1941 a un
  petit rayon (8) et un malus ×1,3 ; celle de 1944 un grand rayon (14). Dans `FRONT_TRAITS` et `SCENARIOS`.

### Bataille des airs

- Force aérienne de chaque camp : base de l'année (tirée des sorties actuelles : 1941 [3, 1] … 1944 [1, 3]) + cartes de
  chasseurs et de soutien aérien.
- Trois manches : chaque camp lance autant de d6 que sa force, touche sur 5+ ; plus de touches gagne la manche, et le
  perdant de la manche perd 1 de force. Deux manches gagnées : **suprématie** (sorties de l'année + cartes) ; le perdant
  n'a plus de sorties jusqu'à la bataille suivante. Égalité : **ciel disputé**, sorties divisées par deux pour les deux.
- Au jour 7, on rejoue avec la force restante plus les nouvelles cartes.
- Un seul point d'entrée dans le moteur : `sortiesToday` (`frontair.js`), lu par `addAirMission`, `planAir` et le
  compteur de l'interface. La DCA est indépendante : elle ne vient plus que des cartes.
- Le journal des manches (jets, touches, avions abattus) sert à l'animation ; il est calculé d'avance, l'animation ne
  fait que le rejouer.

### Nouvelles unités : branchements dans le moteur

- **Canon antichar** : nouveau type dans `GUN_KINDS` (`at`), exclu des barrages (`gunFor`) et du tir d'appui contre
  l'infanterie (`supportFire`). Orientation vers le contact le plus proche, cône de 100° et de 6 cases. Une formation
  blindée dans le cône subit des pertes en plus (`armorRiposte`) et perd du choc (`armorPressure`), comme sur les
  hérissons (`front.at`). Solidité `str` comme l'artillerie : un barrage ou une chasse aérienne en retire environ un
  quart, donc trois ou quatre coups pour le démolir ; perdu si sa case tombe.
- **Bataillon de soutien** : tableau `front.support[s]`. Sa zone : les cases amies entre lui et le front, sur ±6 rangées,
  jusqu'à 6 cases du contact. Chaque tick, une variante de `buildTick` (`frontworks.js`) fait avancer ces cases, avec
  le ralentissement au contact et les paliers existants ; le palier monte avec les jours passés sans bouger (jour 1
  tranchées, 2 barbelés, 3 hérissons, limité par la rareté). Les ouvrages vivent dans les tableaux par case
  (`entrench`, `wire`, `at`) : ils restent quand le bataillon part. Il remplit aussi `lineMask` (les troupes s'y portent).
- **Retrait de l'outil « Ligne »** : bouton de `index.html`, branches `tool === 'line'` de `frontui.js`, raccourci `4`,
  règles. `addLine` reste dans le moteur ; l'IA (`frontai.js`, deux appels) place et déplace des bataillons à la place.
- **Génie d'assaut** : unité placée comme un canon ; chaque tick, les barbelés et hérissons ennemis au contact dans
  son rayon fondent (`damageWorks`), et ses vecteurs y gagnent de la vitesse.
- **Lance-roquettes** : une salve est un barrage à grand rayon et au choc fort, ordonné avec l'outil Barrage tant qu'il
  reste des salves ; la carte est épuisée ensuite.
- **Parachutistes** : au lever du jour choisi, un îlot de cases prises jusqu'à 15 cases derrière le front ennemi. Coupé
  de son bord de carte, il devient une poche et fond comme elle : il faut le rejoindre. Posé sur un pont, il le tient ;
  sur le PC ennemi, il le capture.
- **Point d'appui** : sur une ville ★ amie ; défense de la ville (`townHold`) multipliée, ouvrages posés autour au départ.
- **Rareté des blindés** : champ `tier` sur la formation, d'où `shockMul`, `lossMul`, `speedMul` dans `armorPressure`,
  `armorRiposte` et la route ; le sprite de char lourd existe déjà (`tank(…, heavy)`).

### Interface

- Après « Prendre le commandement » : bataille des airs (petit canvas dans le dossier, sa propre boucle d'animation,
  le sprite d'avion de `frontfx.js` exporté, traçantes, sons de moteurs, mitrailleuses, avion abattu ; « Passer »),
  puis la main de 5 cartes (on en coche 3), puis le placement sur la carte : bandeau des cartes gardées, toucher une
  carte puis sa position, le PC en premier, aperçu de la zone ou du cône. « Commencer » quand tout est posé (un bouton
  « placer pour moi » applique le placement automatique). Le jeu reste en phase `plan` : une nouvelle phase casserait la
  dizaine de gardes `phase === 'plan'` ; un drapeau d'interface masque la barre d'outils pendant le placement.
- Même enchaînement au matin du jour 7, après le bilan du soir 6.
- Le code d'interface des Atouts va dans un module à part (`frontdeck.js`) : `frontui.js` dépasse déjà 1 100 lignes.
- Carte : PC (tente ou semi-chenillé à antenne, rayon en pointillé pendant le matin), canons antichar et leur cône,
  bataillons et leur zone, génie, parachutistes. Liaison du PC dans l'onglet Forces ; grésillement radio quand il est
  désorganisé.

### Moteur, tests, outils

- `createFront` tire et place tout seul par défaut (`setup.atouts: 'auto'`) : main tirée, choix et placement par
  l'heuristique de l'IA, pour les deux camps. Le joueur humain remplace ensuite les siens (`'manual'`). `front-sim`
  marche donc tel quel. `atouts: false` garde les moyens placés d'office, pour le banc de calibrage (`front-bench`) et
  les tests de physique qui supposent des formations blindées connues.
- Numéros des nouvelles unités : à la suite des existants (`Math.max(...ids) + 1`), les formations blindées
  numérotées par bataille ; `nextAirId` de `frontair.js` est global au module, à rendre propre à la bataille.
- Tests : main reproductible et garanties respectées ; remplacement complet (aucun canon, char ni DCA hors cartes) ;
  tirage du jour 7 ; PC (bonus dans le rayon, désorganisation, capture, reprise, secours) ; cône antichar ; zone du
  bataillon et persistance après départ ; parachutistes devenus poche ; bataille des airs (suprématie, ciel disputé,
  `sortiesToday` à 0 pour le perdant) ; plus d'outil « Ligne » dans la page.
- `front-sim` : journal des cartes gardées par bataille, taux de victoire par carte et par rareté, issue de la
  bataille des airs. Cible inchangée : attaquant ≈ 40 %.

### Plan (une étape par commit)

1. **Moteur des Atouts** (`frontatout.js`) : catalogue et paquets par année, tirage 5 → 3 et 4 → 2, heuristique de
   choix, placement automatique, remplacement des moyens placés d'office, tirage du jour 7 dans `endDay`. Cartes de
   cette étape : division blindée (avec la rareté), artillerie, DCA, soutien aérien. Tests.
2. **Poste de commandement** : modèle, coordination, liaison, déplacement, capture et reprise, documents saisis, PC de
   secours, liens avec `staffNight` et `engageCap`, placement par l'IA. Tests.
3. **Canon antichar et bataillon de soutien**, retrait de l'outil « Ligne » (interface, IA, règles). Tests.
4. **Génie d'assaut, lance-roquettes, parachutistes, point d'appui**. Tests.
5. **Bataille des airs** : résolution, `sortiesToday`, rejouée au jour 7, DCA issue des cartes seulement. Tests.
6. **IA** : choix des cartes selon la carte et le rôle, placement selon les secteurs (`readFront`), usage du PC
   (le déplacer de nuit, viser le PC ennemi repéré), des parachutistes et des salves.
7. **Interface** : dossiers de la bataille des airs et du tirage, placement sur la carte, jour 7, rendu des nouvelles
   unités, sons, règles, README.
8. **Équilibrage** : `front-sim` et `front-pool` par année ; poids des cartes et des raretés, chiffres des cartes.

Chaque étape laisse le jeu jouable : jusqu'à l'étape 7, le joueur reçoit ses cartes placées automatiquement.

### Étape 1 faite : moteur des Atouts

- `src/frontatout.js` : paquets par rôle (attaquant : division blindée, artillerie lourde, soutien aérien, DCA ;
  défenseur : artillerie divisionnaire, DCA), raretés par année et par camp (`SCENARIOS[année].rarity`), chars lourds
  d'élite (`SCENARIOS[année].heavy` : Tiger, KV, IS-2 ; 1941 allemand : division d'élite). Formations tirées d'après
  la moyenne des formations historiques de l'année (`ARMOR_TIERS`). Chars lourds : choc ×1,5, pertes ×0,6, marche
  ×0,75 (`ARMOR_RULES.heavy`). Soutien aérien d'élite : frappes ×1,5 contre les chars.
- Choix automatique (valeur × rareté, une seconde carte du même genre vaut 0,55 de moins) et placement par les
  fonctions existantes (`createGuns`, `createArmor`, `createAA`). Au 7e jour (`endDay`), 4 cartes (5 pour le camp mené
  aux points : sous l'issue indécise pour l'attaquant, au-delà de la victoire pour le défenseur), 2 gardées, posées
  derrière le front avec des numéros à la suite. Journal : seulement les cartes du joueur. Briefing : « Vos atouts ».
- `setup.atouts: false` garde les moyens placés d'office : banc de calibrage et quatre tests de physique.
- Mesure IA contre IA (`front-pool.sh`), avant → après : sans année fixe (72 batailles) attaquant 40 → 39 %,
  défenseur 42 → 56 %, nuls 18 → 6 %, encerclements 3,5 → 2,5 ; 1943 (48 batailles) attaquant 33 → 40 %,
  défenseur 60 → 56 %. Moins d'issues indécises et d'encerclements : le défenseur n'a plus de blindés et l'attaquant
  en a moins. À reprendre à l'étape 8, une fois toutes les cartes en place.

### Étape 2 faite : poste de commandement

- `src/fronthq.js` : un PC par camp, placé 16 unités derrière le contact (à hauteur des blindés de l'attaquant, au
  centre pour le défenseur). Coordination linéaire jusqu'au bord du rayon (20 ; 1941 soviétique 14, 1944 soviétique
  24) : attaque +12 %, vitesse +15 %, défense +10 % au PC, × liaison ; appliquée à la fin de `rebuildFields`.
- Liaison : −0,4 par barrage ennemi sur le PC, −0,3 par frappe aérienne, +0,5 la nuit. Désorganisé sous 0,3 : plus de
  bonus, `staffNight` sauté, `engageCap` 0,45, vecteurs à partir du tick 10. Pris : malus (× 0,6 pour la Wehrmacht,
  × 1,3 pour l'Armée rouge de 1941), `engageCap` 0,35, documents saisis (formations blindées révélées une journée) ;
  repris : liaison 0,1 ; PC de secours au rayon moitié après deux nuits.
- Déplacement : ordre du matin ; à 17 unités au plus (~10 cases), saut de nuit (liaison ≤ 0,6 au matin) ; plus loin,
  de jour (liaison 0, repéré). IA (`planHQ`) : recule de nuit sous 16 unités de l'ennemi, de jour sous 8, et suit un
  front qui s'éloigne. Elle ne vise pas encore le PC ennemi (étape 6).
- Interface minimale : toucher le PC puis sa position (rayon et saut de nuit dessinés), section « Commandement » de
  l'onglet Ordres, règles et README. `setup.hq: false` : aucun PC (banc, tests de physique).
- Mesure IA contre IA, après l'étape 1 → après l'étape 2 : sans année fixe (72 batailles) attaquant 39 → 36 %,
  défenseur 56 → 58 % ; 1943 (48 batailles) attaquant 40 → 33 %, défenseur 56 → 67 %. Le défenseur, statique près de
  son PC, profite davantage de la coordination ; l'attaquant pousse souvent au-delà de son rayon. À reprendre à
  l'étape 8 (et quand l'IA visera le PC ennemi).

### Étape 3 faite : canons antichar, bataillons de soutien

- Canons antichar (`frontguns.js`, types `atLight`, `atMed`, `atHeavy`) : portée 6 / 7,5 / 10, placés 3 à 4,5 unités
  derrière le contact, orientés vers la case ennemie la plus proche ; cône de ±50°. Par tick, une formation ennemie
  dans le cône perd `kill` × proximité (1 au canon, 0,5 en bout de portée) × puissance chars (4 / 6 / 9 ; ×0,6 pour
  les chars lourds), et jusqu'à 60 % de son choc au tick suivant. Exclus des barrages, de l'appui et des objectifs
  « groupes d'artillerie ». Contre-batterie, chasse aérienne et débordement comme l'artillerie. Mesure (12 batailles
  IA contre IA) : 6,9 % des chars de l'attaquant détruits par les canons antichar (3,5 % avec des pertes 2,5 fois
  moindres, jugé trop peu) ; 11 canons sur 38 perdus.
- Bataillons de soutien (`frontbattalion.js`) : zone = cases amies à 2 cases du contact au plus, ±9 unités autour de
  sa hauteur, à 16 unités de lui au plus, devant lui. Le chantier (`buildSite`, mis en commun avec les lignes) monte
  d'un niveau par nuit en place (tranchées, barbelés, obstacles antichar), jusqu'au niveau de la carte ; déplacé de
  nuit (17 unités au plus), il repart au niveau 1, les ouvrages restent. Débordé : perdu. IA : il reste sur un secteur
  menacé, sinon rejoint le plus menacé qu'aucun autre ne couvre.
- Outil « Ligne » retiré de l'écran (bouton, raccourci `4`, règles) ; l'IA ne trace plus de lignes (ni dans les
  secteurs menacés ni au goulot d'un saillant). `addLine` et `buildTick` restent dans le moteur.
- Cartes : « Canons antichar » et « Bataillon de soutien » dans le paquet du défenseur ; sa main garantit l'une des
  deux. Noms d'unités dédoublonnés (`nextName`), y compris pour les renforts du 7e jour.
- Mesure IA contre IA, après l'étape 2 → après l'étape 3 : sans année fixe (72 batailles) attaquant 36 → 38 %,
  défenseur 58 → 54 %, nuls 6 → 8 % ; 1943 (48 batailles) attaquant 33 → 33 %, défenseur 67 → 52 %, nuls 0 → 15 %.
  La fin des lignes de défense tracées chaque jour par les deux camps compense les nouveaux atouts du défenseur.

### Étape 4 faite : génie d'assaut, lance-roquettes, parachutistes, point d'appui

- Génie d'assaut (`frontbattalion.js`, `kind: 'sapper'`) : posé 3,5 unités derrière le contact ; rayon 5,2 / 7 / 8,7 ;
  barbelés et obstacles antichar ennemis dans le rayon détruits à 1,2 par jour (2,4 à l'élite) ; vitesse de nos
  vecteurs ×1,25 dans le rayon. Rare : un pont de bateaux de plus. IA : derrière le départ de l'attaque du jour.
- Salves (`frontspecial.js`) : 1 / 1 / 2 par bataille, rayon 3 / 4 / 4, sur 3 ticks : 13 % des troupes par tick, choc
  ×2,2 d'un barrage, ouvrages abîmés ; à 30 unités de nos lignes au plus. Effets et sons des Nebelwerfer et Katioucha.
  IA : dès le 2e jour, au départ de l'attaque principale (une salve gardée pour la seconde moitié si elle en a deux).
- Parachutistes : 300 / 400 / 700 hommes (le commun, absent du plan, a été ajouté) ; au lever du jour, les cases
  ennemies à 1,9 unité du point (7 environ) sont prises, 35 % de leurs occupants tués, le reste reflue. L'îlot est
  une poche ordinaire (fonte, choix du mode). Prises : événements « capture » (villes, PC). IA : à partir du 3e jour,
  sur le PC ennemi repéré, sinon 6 unités au-delà de l'objectif de l'attaque principale.
- Point d'appui : la ville ★ du défenseur la plus exposée ; cases à 2,6 unités : défense ×1,4 / ×1,7 / ×2,
  ouvrages posés d'avance (tranchées ; + barbelés ; + obstacles antichar) ; garnison de 300 hommes à l'élite.
- Interface : outils Salve (`R`) et Paras (`L`), masqués sans carte ; ordres listés et dessinés (double cercle et
  fusées, parachute) ; cercle crénelé « Point d'appui » ; génie d'assaut (charge et mèche, rayon en pointillé).
- Mesure IA contre IA, après l'étape 3 → après l'étape 4 : sans année fixe (72 batailles) attaquant 38 → 29 %,
  défenseur 54 → 67 %, nuls 8 → 4 % ; 1943 (48 batailles) attaquant 33 → 38 %, défenseur 52 → 63 %, nuls 15 → 0 %.
  L'attaquant perd nettement sans année fixe : ses nouvelles cartes remplacent souvent de l'artillerie (moins de
  barrages) et l'IA s'en sert sommairement ; le point d'appui renforce le défenseur. À corriger à l'étape 8 (valeur
  des cartes pour le choix, chiffres des cartes, IA de l'étape 6).

### Étape 5 faite : bataille des airs

- `src/frontairwar.js` : force de chaque camp = sorties de l'année (`cfg.airBase`) + cartes (« Chasseurs » du
  défenseur : +1 / +2 / +3, et +1 sortie s'il gagne à l'élite ; « Soutien aérien » de l'attaquant : +1 / +2 / +3) +
  initiative de l'attaquant (`airInitiative`). Trois manches : autant de d6 que de force (8 au plus), touche sur 5+ ;
  plus de touches gagne la manche, le perdant y perd 1 de force. Plus de manches gagnées : suprématie (toutes ses
  sorties ; l'adversaire 0) ; égalité : ciel disputé (moitié des sorties, arrondie au-dessus). Rejouée au 7e jour avec
  la force restante + les nouvelles cartes + l'initiative. Seul branchement : `sortiesToday` (× `airShare`). La DCA
  n'en dépend pas. Journal : une ligne par bataille des airs ; briefing : issue et touches des manches.
- Sans atouts, ou `setup.airWar: false` : pas de bataille des airs, toutes les sorties.
- Mesure IA contre IA (72 batailles sans année fixe / 48 en 1943), attaquant vainqueur : bataille des airs coupée
  28 % / 31 % ; active sans initiative 17 % / 13 % ; initiative +1 22 % / 25 % ; +2 24 % / 27 % (retenu).
  L'attaquant dépend bien plus de son aviation (feux de préparation) que le défenseur : perdre le ciel lui coûte
  beaucoup plus que le gagner ne lui rapporte. Sur 40 batailles (sans initiative), ciel à l'attaquant 25 fois (24 %
  de victoires), au défenseur 12 fois (aucune), disputé 3 fois (aucune). Le recul d'ensemble de l'attaquant (cible
  40 %) est pour l'étape 8.

### Étape 6 faite : IA des atouts

- Choix des cartes (`cardValue`, `frontatout.js`) selon la situation : carte de feu ×1,6 tant qu'on n'a ni artillerie ni
  salve ; division blindée ×1,3 pour l'attaquant qui n'en a plus de valide ; aviation et chasseurs ×1,4 pour qui part
  moins fort dans la bataille des airs (×1,3 de plus au 7e jour si l'on n'a pas le ciel) ; génie d'assaut rare (pont)
  ×1,2 sur une carte à rivière ; point d'appui ×1,2 avec au moins 3 villes ★, ×0,85 sinon ; canons antichar ×1,3 au
  7e jour si l'on en a perdu.
- Préparation d'un assaut : sans barrage ni sortie disponibles, une salve de lance-roquettes (l'IA n'attaque sinon
  qu'écrasante : c'était la cause principale de son recul avec moins d'artillerie). PC ennemi repéré : deux barrages
  et une frappe aérienne sur lui, avant toute autre mission. Déjà en place : salves au départ de l'attaque
  principale, parachutistes sur le PC repéré ou au-delà de l'objectif, génie d'assaut derrière l'attaque, bataillons
  sur les secteurs menacés, canons antichar face aux blindés repérés, PC reculé ou avancé de nuit.
- Usage mesuré (16 batailles IA contre IA) : 11 salves sur 11, 5 largages sur 5 ; un PC désorganisé par le feu ennemi,
  aucun pris (il se tient à 9 cases du front, rarement repéré).
- Mesure (72 / 48 batailles), après l'étape 5 → après l'étape 6 : sans année fixe attaquant 24 → 28 %, défenseur
  72 → 67 % ; 1943 attaquant 27 → 23 %, défenseur 67 → 67 %, nuls 6 → 10 % (écart dans le bruit de mesure, ±6 points).

### Étape 7 faite : interface des atouts

- Ordre retenu : briefing → tirage → bataille des airs → déploiement (la bataille des airs dépend des cartes
  choisies, chasseurs et soutien aérien, elle vient donc après le tirage et non avant comme prévu au plan).
- Moteur : `setup.atoutsManual` (posé par l'interface) laisse la main du joueur en attente (`atouts.pending`), sans
  unités ni bataille des airs ; `confirmAtouts` pose ses unités (`applyForces`, commun avec les renforts du 7e jour) et
  lance la bataille des airs quand les deux camps sont servis. `placeable` / `placeUnit` / `endPlacement` : les unités
  du dernier tirage (et le PC avant la bataille) se posent n'importe où dans ses lignes ravitaillées, d'un coup ; les
  points d'appui ne se retranchent qu'à la fin du déploiement (`buildStrongpoints`), pour pouvoir changer de ville.
  `beginDay` confirme d'office un tirage resté sans réponse et clôt le déploiement : les outils et l'IA n'en savent
  rien.
- Interface (`frontdeck.js`) : main en cartes à cocher (icône, rareté, contenu), « Choix de l'état-major »
  (`chooseCards`) ; combat de chasseurs sur un canvas (formations qui se croisent, traçantes, l'appareil abattu tombe
  en fumée, mitrailleuses et chute au son ; « Passer », image fixe si l'on réduit les animations), puis le récit des
  manches et l'issue. Déploiement : bandeau des unités à placer (défilant sur téléphone), toucher une unité puis sa
  position ; le bouton du jour devient « Terminer le déploiement ». Même enchaînement au matin du 7e jour, après le
  bilan du soir 6.

## Batailles de rue et artillerie (chantier)

Deux chantiers liés, validés sur maquettes. Le front stratégique propose de jouer en tactique la bataille d'une ville,
et l'artillerie passe d'un barrage par groupe et par jour à un appui permanent plus trois barrages par bataille.

### Cahier des charges (validé)

| Sujet | Décision |
|---|---|
| Fenêtre | Au lancement de la journée : une poussée vise une ville tenue, ou l'ennemi en menace une des nôtres. Anneau sur la ville, fenêtre au-dessus : rapport de force estimé (l'ennemi en fourchette), terrain, défenses, appui, barrages restants ; « Commander la bataille » ou « Résolution auto » |
| Fréquence | Une bataille commandée par jour ; plusieurs villes : la plus disputée d'abord, « Résolution auto » ouvre la suivante |
| Résultat | Décisif : les pâtés tenus en fin de bataille donnent les cases de la ville ; pertes reportées sur les densités, chars perdus retirés des formations, barrages dépensés retirés du stock. Les cases de la ville sont figées le reste de la journée |
| Échelle | Hexagones d'environ 50 m ; la ville et ses abords. Environ 150 hommes par section, 8 à 14 unités par camp |
| Ville tactique | Grands axes = routes stratégiques qui entrent dans la ville ; rivière et pont gardés ; centre en pierre (pâtés de maisons, place, église ; usine pour une grande ville), isbas en bois et jardins à la périphérie |
| Règles urbaines | Infanterie dans un bâtiment : très couverte, invisible avant de tirer. Chars : rapides sur route, tir dans l'axe, vulnérables au contact d'un bâtiment tenu. Barrage : ruines, défenseurs décimés et cloués, gravats qui bloquent la rue aux chars, les ruines restent un abri. Isbas : faible couvert, inflammables |
| Artillerie | Plus de barrage quotidien. Appui passif dans la portée de chaque groupe : attaque (au départ d'une poussée) et défense, rendements décroissants quand les zones se recoupent. Posture inchangée |
| Barrage focalisé | 2 au départ, 1 de plus au 7e jour ; tous les groupes libres à portée y concourent ; utilisable en bataille de rue |
| Lance-roquettes | Salve à part, hors du compte des barrages |
| Animations | Appui passif : quelques obus épars là où l'on se bat, plafonnés ; le barrage garde l'animation complète |

### Plan (une étape par commit)

1. **Artillerie, moteur** : stock de barrages (`barrageStock`, +1 au 7e jour), barrage concentré, appui passif
   (`applyArtillery` dans `rebuildFields`), tests ; banc de calibrage sans limite.
2. **Artillerie, IA et mesure** : barrages gardés pour les moments décisifs (assaut principal, PC repéré, percée à
   colmater) ; mesure IA contre IA, cible attaquant ≈ 40 %.
3. **Artillerie, interface** : compteur sur l'outil Barrage, halo de couverture le matin, obus épars, règles, README.
4. **Ville tactique** : générateur urbain (`urbangen.js`), terrains bâtiment, ruines, gravats ; règles urbaines dans le
   moteur tactique ; jouable seule depuis un menu de développement. Tests.
5. **Conversion** : d'une ville du front stratégique vers une bataille tactique (terrain, troupes, cartes, ouvrages,
   appui, barrages). Tests.
6. **Fenêtre et retour** : détection au lancement de la journée, fenêtre, bataille tactique dans le front, résultat
   réinjecté, cases figées. Tests.
7. **IA urbaine, équilibre, publication** : IA tactique en ville (tenir les bâtiments, chars accompagnés), mesures,
   README, fichier unique.

### Étape 1 faite : artillerie, moteur

- Stock de barrages (`front.barrageStock`, `cfg.barrageStock` 2, `barrageRefill` +1 au 7e jour) : `addBarrage` refuse
  au-delà du stock, le matin un barrage retiré est rendu ; le stock est débité au lancement de la journée
  (`beginDay`). `barragesLeft` pour l'interface et l'IA. `barrageStock: null` garde l'ancienne règle (un barrage par
  groupe et par jour) : banc de calibrage.
- Barrage focalisé : le groupe libre le plus puissant à portée et tous les autres groupes libres à portée
  (`b.guns`, `missionGuns`, `onMission`) ; zone du plus grand rayon + 0,5 ; puissance ×1,2 (`GUN_RULES.focus`). Effets,
  cratères, contre-batterie et coupure des liaisons du PC additionnent les groupes engagés (PC : une fois et demie un
  groupe au plus : un barrage focalisé suffit à le désorganiser).
- Appui passif (`applyArtillery`, à la fin de `rebuildFields`, avant le PC) : couverture de chaque groupe = sa puissance
  (× efficacité des feux du jour : brouillard 0,7), pleine jusqu'à 70 % de sa portée puis décroissante ; plusieurs
  groupes se cumulent (1 ; 1,4 ; 1,56). Attaque des poussées +12 % et défense +15 % à pleine couverture. L'ancien tir
  d'appui sur les assaillants (`supportFire`) reste.
- Mesure IA contre IA (72 batailles), avant → après : attaquant 28 → 24 %, défenseur 67 → 69 %, nuls 6 → 7 %. L'IA
  tire encore ses barrages comme avant et épuise le stock en deux jours : étape 2.

### Étape 2 faite : artillerie, IA et mesure

- Barrages de l'IA (`mayBarrage`, `fireBarrage`) : espacés sur chaque moitié de la bataille (jusqu'au 7e jour, puis
  jusqu'au terme), un par jour au plus, sur la première attaque du jour que l'artillerie a à portée ; hors calendrier
  pour le PC ennemi repéré (un seul barrage focalisé suffit) et la contre-attaque d'un secteur qui craque (tenue
  < 0,6). Plus de barrages sur les concentrations ennemies (ancienne règle seulement). Le défenseur garde les siens
  pour les ponts menacés et les contre-attaques.
- L'appui passif compte comme une préparation : un assaut parti d'une case couverte à 50 % s'engage même sans
  barrage ni aviation (`AI_TUNING.coverPrep`).
- Concentration de l'artillerie : un groupe ne rejoint l'axe principal que si celui-ci sort de 90 % de sa portée, et
  en appui mobile. Avant, l'IA déplaçait ses groupes chaque jour en posture de déplacement : ils ne tiraient plus,
  d'où 0,9 barrage par bataille pour l'attaquant ; désormais 2,2 (défenseur 1,6).
- `tools/front-sim.mjs` et `front-pool.sh` acceptent `GUNS` (réglages de `GUN_RULES`).
- Mesure (120 batailles) : attaquant 26 %, défenseur 67 %, nuls 8 % (avant le chantier, 72 batailles : 28 / 67 / 6).
  Une artillerie plus forte (attaque +25 %, barrage ×1,5) profite autant au défenseur : attaquant 22 %. Réglages
  gardés. La cible de 40 % reste à l'équilibrage des atouts (leur étape 8).

### Étape 3 faite : artillerie, interface

- Outil Barrage : compteur en pastilles (● restant, ○ dépensé ou à venir au 7e jour), désactivé sans stock ni groupe
  en état de tirer ; message « Barrage focalisé : groupes engagés, à l'aube (reste n) » ; même libellé dans la liste
  des ordres. Panneau Artillerie : « appui des troupes à sa portée ».
- Halo de couverture le matin autour de chacun de ses groupes (laiton, plein jusqu'à 70 % de la portée, selon la
  puissance), à la place du simple cercle de portée.
- Appui passif à l'écran (`frontfx.js`, `ARC.passive`) : trois obus au plus par tick dans la vue, tirés au hasard par
  les groupes des deux camps sur les cases ennemies au contact à leur portée ; petite gerbe sans panache ni sol
  noirci ; l'obus d'une batterie invisible n'apparaît qu'en fin de course. Son : un sifflement et une explosion
  sourde de temps en temps (`shell`). Le barrage focalisé garde l'animation complète, depuis chaque groupe engagé.
- Règles en jeu et README.

### Étape 4 faite : ville tactique

- `src/urbangen.js` (`generateUrbanMap`) : village, ville ou grande ville (`URBAN_SIZES`). Grand-rue d'ouest en est,
  rues transversales tous les quatre hexagones, rues parallèles tous les trois rangs ; place au carrefour principal,
  église sur la place (objectif de l'IA), maisons en pierre au centre, isbas et jardins autour et le long des routes
  d'accès ; grande ville : usine. Rivière éventuelle (`river: 'east' | 'west'`) avec un pont sur la grand-rue.
  `map.blocks` : îlots (composantes du bâti, rues exclues), pondérés (église 2, pierre 1,5, isbas 1) ; le pont est un
  îlot.
- Terrains (`terrain.js`) : rue, maisons en pierre (défense 3), isbas (1, brûlent), jardins, point fort (église, usine :
  4). Chars : 8 points pour un pâté, 12 pour un point fort, ils restent dans les rues ; gravats (`rubble`) : la rue
  est fermée aux chars, l'infanterie passe. Les maisons masquent la vue ; la grand-rue se voit d'un bout à l'autre.
- Combat : infanterie au contact d'un char depuis un couvert urbain : pas de malus de blindage, −1 au seuil
  (« embuscade en ville »). Moral : le couvert urbain compte.
- Feux hors carte (`callFire`, `state.fire`, `state.calls`) : barrage focalisé (l'hexagone et ses six voisins, toutes
  les unités, amies comprises, 6 dés sans couvert : les maisons s'effondrent ; ruine immédiate des maisons, gravats
  dans les rues voisines à 40 %, isbas en feu) et tir d'appui (4 à 6 dés, une case vue). Un de chaque par tour, dans
  la limite du stock de la bataille. Batterie fictive au bord de la carte (animation et sons des tirs indirects).
- Îlots (`updateBlocks`) : l'infanterie ou les chars d'un seul camp sur l'îlot le prennent ; disputé, il ne change
  pas de mains. Victoire au terme (10 tours) : l'attaquant gagne s'il tient au moins la moitié de la ville
  (`cityShare`) ; anéantissement comme avant.
- Déploiement : le défenseur dans toute la ville et ses abords (infanterie dans les maisons face à l'attaquant,
  antichar sur la grand-rue), l'attaquant par son bord (chars sur la route).
- IA (`planFire`) : tir d'appui sur l'ennemi vu qui vaut le plus, barrage sur la plus forte concentration connue sans
  ses propres unités dedans, un tour sur trois au plus. Le reste de l'IA tactique est inchangé (étape 7).
- Rendu : chaussées pavées, rues droites, masse de toits continue des pâtés avec cour, isbas dans leurs enclos,
  jardins, église, halles de l'usine, gravats ; liseré des îlots à la couleur de leur détenteur (disputés en
  pointillé). Interface : barre « Feux » (barrage, appui) en bas de la carte, croix et zone du feu demandé, bandeau
  de la part de ville tenue, briefing et bilan propres à la bataille de rue ; essai depuis le menu (« bataille de rue
  côté Wehrmacht / Armée rouge »).
- `tools/urban-sim.mjs` : batailles de rue IA contre IA (armées d'essai : 6 sections, 3 chars et une reconnaissance
  contre 7 sections et un antichar). Mesure (24 batailles) : attaquant 0 %, 10 % de la ville prise, 2,4 hexagones en
  ruines et 0,8 rue encombrée par bataille. L'IA tactique n'attaque pas une ville : étape 7.

### Étape 5 faite : conversion

- `src/frontstreet.js`. `streetCandidates(front)` (phase du matin, ordres des deux camps donnés : `planOrders`
  donne ceux de l'IA avant le lancement, `beginDay` ne les redonne pas) : villes qu'une poussée d'infanterie ou de
  blindés, ou une formation blindée, traverse à 2,6 unités au plus, à 12 unités au plus de son départ, avec au moins
  600 hommes engagés ; la plus disputée d'abord (hommes des deux camps, chars).
- `streetBattle(front, candidat)` : ville tactique de la taille de la ville (grande ville : 19 cases ; village : 3 cases
  ou moins), rivière du côté où elle coule, routes d'accès, ruines selon `front.ruin`. Troupes : les cases de
  l'attaquant à 7 unités (60 % engagés) et celles du défenseur autour de la ville ; une section pour 150 hommes, de 3
  à 12 (2 au moins pour le défenseur), au même rapport de force ; reconnaissance si 5 sections ou plus. Chars : les
  formations qui visent la ville (attaquant) ou sont dessus (défenseur), une compagnie pour 20 chars, 4 au plus ;
  chars lourds : élite. Antichars du défenseur à portée, 2 au plus. Retranchement de départ selon les ouvrages de la
  ville (+1 avec un point d'appui). Feux : là où son artillerie couvre la ville (couverture ≥ 0,2), 1 à 4 tirs
  d'appui et jusqu'à 2 barrages pris sur le stock de la bataille.
- `applyStreetBattle(front, link, état)` : chaque case de la ville prend le détenteur de l'îlot le plus proche de sa
  position relative ; pertes (hommes représentés par les unités à pied, au prorata de leurs PV perdus) retirées des
  cases qui ont fourni les troupes ; le défenseur reflue des cases prises, l'attaquant y entre ; chars perdus retirés
  des formations, barrages dépensés retirés du stock. Ville figée pour la journée (`front.frozen` : aucune prise dans
  `frontTick`), libérée le soir.
- `createBattle` : retranchement de départ (`u.startDig`).
- Essai IA contre IA (6 batailles du front en grande ville, 90 journées) : 8 batailles de rue, de 2 à 14 unités par
  camp ; l'IA tactique, qui attaque mal en ville, perd la plupart de ses assauts (étape 7).

### Étape 6 faite : fenêtre et retour

- Au lancement de la journée (`launchDay`, `frontui.js`) : ordres de l'IA donnés d'abord (`planOrders`), puis villes
  disputées où le joueur attaque ou défend (`streetCandidates`). La vue se centre sur la ville, un anneau pulse
  dessus et la fenêtre s'ouvre au-dessus (sous la carte sur téléphone) : rapport de force (le sien compté, l'ennemi en
  fourchette hachurée), terrain (taille, îlots, rivière), défense (ouvrages), appui (tirs d'appui), barrages
  utilisables (●●○ du stock). « Résolution auto » passe à la ville suivante, puis lance la journée ; « Commander la
  bataille » bascule dans le cadre tactique (`startUrban`, crochet de `initFront`).
- Une bataille commandée par jour (`front.streetDay`). Au bilan, « Retour au front » réinjecte le résultat
  (`applyStreetBattle`, une ligne au journal), rend le cadre du front et lance la journée ; la ville reste figée
  jusqu'au soir.

### Étape 7 faite : IA urbaine, mesures, publication

- IA tactique en ville (`urbanGoal`, `ai.js`) : ce qui compte, ce sont les îlots. L'attaquant (infanterie, chars,
  reconnaissance) vise l'îlot qu'il ne tient pas le plus proche, en se répartissant (un îlot déjà visé coûte 3 de
  distance de plus) et en préférant les îlots lourds ; posé sur un îlot à prendre, il y reste le tour. Le défenseur
  reprend les îlots perdus vides à 4 hexagones au plus. Un ennemi au contact passe avant l'îlot.
- Mesure (`tools/urban-sim.mjs`, 48 batailles par mesure), avant → après : à 1,5 contre 1, attaquant 0 → 42 %, part
  de ville prise 10 → 42 % ; à forces égales (chars en plus), 29 %, 32 % de la ville. La ville avantage le défenseur,
  comme voulu : il faut l'artillerie (barrages) et la supériorité numérique.
- Règles en jeu, README (section « Batailles de rue », outils, structure du code), fichier unique régénéré.
- Reste à surveiller en jeu : la fréquence des fenêtres (environ une ville disputée tous les dix jours de bataille
  par camp en IA contre IA ; davantage quand le joueur pousse sur les villes), et l'équilibre du résultat décisif face
  à la résolution automatique.

## Métropole (chantier)

Un nouveau biome du front stratégique où la ville n'est plus un point à prendre mais tout le champ de bataille
(type Stalingrad). Propositions et maquettes validées ; le biome « Grande ville » (`bourg`) reste à côté.

### Cahier des charges (validé)

| Sujet | Décision |
|---|---|
| Biome | Nouveau biome `metropole`, en plus du bourg |
| Forme | Ville allongée le long d'un fleuve, côté défenseur ; steppe à l'ouest (ou à l'est) pour l'arrivée de l'attaquant ; échelle des cases inchangée |
| Quartiers | 10 à 16 quartiers typés : vieille ville, usines, cités ouvrières et faubourgs, gare, hauteur, parc, quais. Terrain et bonus propres à chaque type |
| Axes | Avenues radiales, boulevard et route des quais : rapides pour les chars, à découvert ; tir de flanc des îlots ennemis qui les bordent |
| Victoire | Aux points de quartiers (1 à 3 points ; un quartier appartient à qui en tient plus de 60 %), à la place des villes ★. Étape 4 : l'issue se lit aux points gagnés pendant la bataille (la moitié des points était hors de portée, voir l'étape 4) |
| Ajouts de la v1 | Bacs de nuit (le défenseur se ravitaille par les quais), artillerie de la rive gauche, maisons-forteresses |
| Plus tard | Égouts (infiltration), réparation de chars à l'usine, sons urbains |

### Plan (une étape par commit)

1. **Générateur** : biome `metropole`, emprise de la ville, quartiers, avenues et boulevard, voie ferrée, fleuve et
   quais, ponts ; ligne de départ dans les faubourgs. Tests.
2. **Terrain** : défense et fluidités par type de quartier, avenues, tir de flanc. Mesure.
3. **Victoire et ravitaillement** : points de quartiers, bacs de nuit et coupure par les quais, artillerie de la rive
   gauche, maisons-forteresses.
4. **IA et équilibre** : l'attaquant vise quais et gare et pousse ses blindés sur les avenues ; le défenseur tient les
   îlots qui bordent les avenues. Attaquant ≈ 40 %.
5. **Rendu** : îlots par quartier, avenues, front en escalier, noms de quartiers, repères, états de destruction, nuit.
6. **Interface et batailles de rue** : panneau des quartiers, bilan du soir, trame tactique par type de quartier ;
   le biome entre dans le tirage.
7. **Publication** : règles, README, fichier unique.

### Étape 1 faite : générateur

- `src/metrogen.js` (`buildMetropole`), appelé par `generateFrontMap` à la place des villes et des routes quand le
  biome a `metropole` ; réglages dans `FRONT_BIOMES.metropole` (`riverOffset`, `cityDepth`) et `METRO`.
- Fleuve : le fleuve du biome « fleuve », 29 à 31 colonnes du milieu vers le défenseur. La ville se mesure depuis la
  rive côté attaquant (profondeur u, en colonnes) : de 30 à 33 colonnes, qui ondulent, amincie aux extrémités nord et
  sud. Environ 30 % de la carte ; derrière le fleuve, une quinzaine de colonnes de steppe pour le défenseur.
  (Resserré à l'étape 2.)
- Quartiers (`map.districts`, `map.district[i]`, -1 hors de la ville) : germes posés par type (deux usines vers un bout,
  vieille ville vers l'autre, gare à mi-profondeur à côté, hauteur sur le point le plus haut entre les deux, un parc),
  puis cités ouvrières et faubourgs qui comblent les vides (écart 10). Pavage au germe le plus proche, pondéré par type,
  limites brouillées ; quais : la bande de 3 colonnes au bord de l'eau hors des usines, en tronçons nord, centre, sud.
  Chaque quartier est rendu d'un seul tenant, les trop petits fondus dans un voisin. Mesure sur 24 cartes : 12 à 16
  quartiers, de 25 à 280 cases. Noms : usines et parcs dans une liste, « Hauteur 98 » à « 137 », « Cité … » à
  l'intérieur, « Faubourg … » sur le pourtour ; la ville prend un nom en -grad.
- Terrain : toute l'emprise est ville (`TOWN`) et à plat (niveau 1 au plus), sauf la hauteur (niveau 2, son sommet 3).
  En attendant l'étape 2, chaque case de ville a le terrain « ville » générique.
- Avenues (`map.avenue`, `map.avenues`, et routes) : quatre radiales au plus, du bord de l'attaquant à la rive, en
  éventail vers le centre ; un boulevard à mi-profondeur et la route des quais, du nord au sud. Les trois radiales les
  plus proches du centre franchissent le fleuve (ponts) et filent au bord du défenseur.
- Voie ferrée (`map.rail`, `map.rails`) : du bord de l'attaquant à la gare, puis le long de la ville jusqu'aux usines.
  Sans effet avant l'étape 3 (renforts).
- Objectifs : une ville du front par quartier, à son centre (`town.district`), en attendant les points de quartiers ;
  un ou deux villages dans la steppe de l'attaquant, sur une avenue.
- Ligne de départ (`map.startLine`, lue par `createFront`) : l'attaquant tient la frange des faubourgs, 5 colonnes
  (de 10 à 20 % de la ville) ; quais et vieille ville au défenseur. (8 colonnes à l'étape 2.)
- Hors du tirage des biomes : on la voit dans l'aperçu (`front-preview.html?biome=metropole`). Une bataille IA contre
  IA tourne sans erreur, mais l'attaquant ne prend rien (la ville entière a la défense d'une ville) : étapes 2 à 4.

### Étape 2 faite : terrain des quartiers, avenues, tir de flanc

- Terrain par type de quartier (`terrain.js`, `DISTRICT_TERRAIN`) : bonus défensif de l'îlot intact (il suit la courbe
  de ruine de la ville, mise à l'échelle), fluidités de l'infanterie et des blindés. Vieille ville +70 % (0,45 / 0,25),
  usines +90 % (0,4 / 0,3), cités et faubourgs +40 % (0,6 / 0,45), gare +20 % (0,7 / 0,7), hauteur +20 % plus son relief
  (0,55 / 0,4), parc +10 % (0,8 / 0,9), quais +30 % (0,6 / 0,4). Hors métropole, rien ne change (mêmes cartes, même
  terrain).
- Avenues (`AVENUE`) : défense +10 %, fluidité 1 / 1,3. Les ruines les encombrent comme le reste de la ville.
- Tir de flanc (`flankFire`) : un assaut sur une avenue bordée d'îlots tenus par l'ennemi (hors avenue ; plein effet à
  deux) coûte 30 % de pertes en plus à sa part blindée : la riposte des vecteurs (`frontTick`) et celle des formations
  blindées (`armorRiposte`).
- La case d'une métropole se décrit par son quartier (« Usine de tracteurs, avenue »).
- Mesure (`tools/metro-sim.mjs`, IA contre IA, 20 batailles par réglage) : la ville de l'étape 1, trop profonde, ne se
  traversait pas, quel que soit le terrain : même transparente (défense de steppe), l'attaquant n'en prenait que 12 %
  en quinze jours. Le front avance d'ordinaire de 3,5 (steppe) à 6 colonnes (bourg, fleuve) en moyenne, ses pointes de
  20 à 25. Géométrie resserrée : fleuve à 23-25 colonnes du milieu, ville de 22 à 25 colonnes, l'attaquant en tient
  les 8 extérieures (le tiers de la ville) ; usines un peu plus loin du bout de la ville (moins amincie), où elles
  étaient prises de flanc depuis la steppe.
- Résultats (avance moyenne en colonnes · ville tenue par l'attaquant à la fin · fleuve atteint) : ville générique
  1,0 · 34 % · 50 % ; terrain des quartiers 2,6 · 42 % · 85 % ; ville transparente 5,2 · 51 % · 100 %. Quartiers pris
  par type : parc 6/20, cités 6/21, quais 4/40, usines 3/40, hauteur 1/11, vieille ville 1/20, gare 0/7. « Fleuve
  atteint » : une case au moins, souvent par une percée le long d'une avenue.
- Reste pour l'étape 4 : l'IA jette ses blindés dans la ville et en perd 75 à 85 % quel que soit le réglage ; le tir
  de flanc n'y change rien de mesurable tant qu'elle ne les garde pas pour les avenues. Les victoires (70 % pour
  l'attaquant) comptent encore les villes ★ des quartiers : étape 3.

### Étape 3 faite : points de quartiers, bacs de nuit, rive gauche, maisons-forteresses

- `src/frontmetro.js` (sans dépendance, lu par le score, le ravitaillement, le terrain et le front) : `METRO_RULES`,
  contrôle des quartiers (`districtOwner` : plus de 60 % des cases, sinon disputé, à personne), points, issue.
- Victoire (`frontscore.js`, `metroBreakdown`) : le score d'une métropole est la somme des points des quartiers que
  possède l'attaquant (1 à 3 : vieille ville et quais 3, usines, gare et hauteur 2, cités, faubourgs et parc 1), plus
  1 point par objectif secondaire rempli (pour ou contre lui) ; pas de points du soir. L'issue se lit à la part du
  total : victoire décisive ≥ 65 %, victoire ≥ 50 %, indécis ≥ 40 %, victoire défensive ≥ 30 %, en dessous défensive
  décisive. « Villes ★ » : les quartiers que possède le défenseur au départ (`defTowns`, par leur centre) ; renforts
  de 25 hommes par quartier possédé au lieu de par ville. Le camp mené au 7e jour se lit à l'issue en vue
  (`trailingSide`), ce qui ne change rien hors métropole. Libellés de l'interface : « quartiers pris / perdus »,
  seuils en pourcentage au rapport final.
- Bacs de nuit : les accostages (`map.landing` : cases des quais et des usines au bord de l'eau) que tient le défenseur
  sont des sources de ravitaillement, comme son bord de carte (`findPockets`, graines en plus). Les cases qui ne
  tiennent que par eux (`front.ferried`) sont ravitaillées à 85 % de jour. Un quartier coupé des ponts et de ses quais
  devient une poche.
- Rive gauche : les groupes d'artillerie du défenseur (hors antichars) se posent à 3 unités au-delà du fleuve, au
  départ comme pour les renforts du 7e jour (`createGuns`) ; l'IA du défenseur les y garde (`gunSiteOk`, `map.farBank`).
  Hors d'atteinte des barrages ennemis, ils couvrent la moitié de la ville côté fleuve, pas les faubourgs.
- Maisons-forteresses (`map.strongholds`, `map.stronghold`) : silo à grain (quais ou usines, au bord de l'eau), grand
  magasin (vieille ville), maison d'angle (sur une avenue, vers le front), château d'eau (sommet de la hauteur). Îlot
  à défense × 1,3 ; une poche fond six fois moins vite sur l'îlot et ses abords (~5 % par jour) ; tant que le
  défenseur le tient, le ravitaillement de l'attaquant baisse de 15 % à deux cases autour. Le point d'appui du
  défenseur peut s'y poser, et l'IA l'y pose d'abord.
- Mesure (`tools/metro-sim.mjs`, 20 batailles) : l'attaquant passe de 21 % des points au départ à 24 % au dernier soir
  (avance 1,5 colonne, contre 2,6 à l'étape 2) ; 18 victoires défensives décisives, 2 victoires défensives. Essais un
  par un : sans les maisons-forteresses ou sans la rive gauche, rien ne change ; avec les anciens renforts (par ville),
  27 % ; sans les bacs, 27 % et le défenseur encerclé dans 60 % des batailles (10 % avec). Les bacs sont la bouée
  voulue du défenseur ; reste à l'IA de l'attaquant à viser les quais et à l'équilibre de remonter l'attaquant vers
  40 % : étape 4.

### Étape 4 faite : IA de la métropole, quartiers resserrés, victoire aux points gagnés

- Ce que la mesure a montré : l'IA de l'attaquant n'attaquait jamais la ville. Son rapport de forces divise par la
  défense du terrain d'en face, ×1,5 à ×1,9 partout en ville : aucun secteur n'atteignait le seuil d'engagement, et
  les progrès des étapes 2 et 3 venaient des blindés et du colmatage. Le rythme d'une case de ville tient à la jauge de
  brèche (seuil au cube de la défense, remplissage plafonné par tick) : ni plus de barrages ni plus de renforts ne
  l'accélèrent (essai : 4 barrages, renforts × 1,15 : rien). Même dans une ville transparente, l'attaquant gagnait 5 %
  des points : « la moitié des points » était hors de portée, et le gain médian d'une bataille, d'un point.
- IA (`frontai.js`) : en métropole, l'attaquant engage dès un rapport de forces de 0,5 (`metroEngage`) ; il vise le
  quartier ennemi qui vaut le plus d'être pris (`metroTarget` : distance ÷ points × attrait, quais 1,6, gare 1,3, usines
  0,7) ; ses blindés ne s'engagent, à l'assaut comme en contre-attaque, que le long d'une avenue radiale partie de
  moins de 3,5 unités de leur départ, vers la case de l'avenue douze pas plus loin (`avenueAhead`) ; sinon ils restent
  en réserve. Sur une avenue, les chars gardent 90 % de leur choc (`AVENUE.atkA`, ville 60 %).
- Quartiers resserrés (`metrogen.js`) : germes à 6 colonnes d'écart au lieu de 10, usines et vieille ville moins
  étendues : 20 à 24 quartiers de 20 à 120 cases. Quais en tronçons (six bandes du nord au sud, hors des usines : trois
  ou quatre), à 2 points chacun : atteindre le fleuve en un point rapporte un tronçon.
- Victoire aux points gagnés (choix validé) : la somme des points des quartiers pris pendant la bataille, moins ceux que
  l'attaquant possédait au départ et a perdus, plus ou moins 1 par objectif secondaire. Victoire décisive ≥ 5, victoire
  ≥ 2, indécis ≥ 1, victoire défensive ≥ 0, en dessous défensive décisive. Possession de départ : `front.metroStart`.
- Mesure (80 batailles, deux séries de graines) : attaquant 34 % (43 % puis 25 %), défenseur 46 %, indécis 20 % ;
  avance 2,7 colonnes, fleuve atteint presque toujours, défenseur encerclé dans 8 à 28 % des batailles, chars perdus
  par l'attaquant 65 à 72 % (steppe 53 %, fleuve 70 %, bourg 78 %). Quartiers pris par type : gare 17/47, cités 36/544,
  quais 24/361, hauteur 2/43, vieille ville 2/80, usines 1/160 (des citadelles), parc 1/80. Victoire à +1 : environ
  54 % ; on garde +2.
- Non fait : une IA du défenseur propre à la ville (tenir les îlots qui bordent les avenues, garder ses accostages) ;
  il gagne déjà assez sans elle.

### Étape 5 faite : rendu de la ville

- `src/frontcity.js`, appelé par `frontrender.js` quand la carte a des quartiers ; hors métropole, rien ne change.
- Calque de terrain : teinte de chaque type de quartier ; avenues en ruban large et clair, cerné, bordées d'arbres
  (radiales et boulevard ; en ville seulement, la steppe garde sa route) ; voie ferrée (rail et traverses) et faisceau
  de sept voies à la gare ; bosquets des parcs ; jardins des isbas.
- Îlots : une trame par quartier, tournée selon son type (grille de la vieille ville, longues halles des usines et
  entrepôts des quais alignés sur le fleuve, isbas éparses et un peu de travers, hangars de la gare dans l'axe des
  voies), tirée sur l'emprise du quartier hors avenues, voies et eau : environ 4 500 îlots. Intacts, ils sont peints
  une fois sur un calque à l'emprise de la ville (≈ 150 ms au chargement) ; chaque image recouvre les seuls îlots
  touchés (selon la ruine de leur case, comme les maisons : éventrés et noircis, puis gravats ; isbas réduites à leur
  poêle) et ajoute des tas de gravats en travers des avenues en ruines. Les incendies les font brûler comme les
  maisons.
- Front : en ville, il suit les bords des cases (tracé en escalier, le long des rues), recalculé à chaque tick
  (`cityFrontEdges`) ; la courbe lissée ne garde que ses segments hors de la ville.
- Noms des quartiers en capitales espacées, à la couleur du camp qui les possède (au sens de ce que l'on voit ;
  brun : disputé), points en pastilles dessous ; un quartier qui change de mains s'éclaire de jaune 1,6 s.
- Repères : maisons-forteresses (silo, grand magasin, maison d'angle, château d'eau ; nommées de près), gare, église de
  la vieille ville, cheminées d'usine qui restent debout ; grisés et en pointillés quand leur case est en ruines.
- Bacs de nuit, le matin : de la rive gauche à un accostage tenu de chaque quai ou usine, une barque glisse.
- Crépuscule : à partir de 16 h 30, les quartiers en feu jettent une lueur orangée (sur l'eau aussi).
- Coût (Chromium sans accélération, après 8 jours de combat) : 58 ms par image contre 51 (fleuve) et 48 (bourg) ; la
  ville elle-même ≈ 2,5 ms. Le rendu n'a pas de test automatique (canvas) : vérifié sur captures.
- Limites : deux noms de quartiers voisins peuvent se chevaucher ; la lueur du soir reste légère quand peu de
  quartiers brûlent.

### Étape 6 faite : interface, batailles de rue, tirage

- Le biome entre dans le tirage du front (poids 10, à côté de steppe 22, bocage 16, fleuve 14…).
- Consignes (`goalText`) propres à la métropole, pour l'attaquant et le défenseur ; briefing : objectifs secondaires à
  1 point, renforts selon les quartiers ; règles : une entrée « Métropole ».
- Panneau des quartiers (onglet Forces, `districtPanel`) : une ligne par quartier (les disputés d'abord, puis par
  points), barre de vos cases et de celles de l'ennemi (ce que l'on en sait), possession, pastilles de points, notes
  (bacs de nuit pour les quais et usines du défenseur, maisons-forteresses) ; toucher le nom centre la carte.
  « Villes » devient « Quartiers » dans les chiffres.
- Bilan du soir (`districtNews`) : quartiers pris et perdus dans la journée, avec leurs points.
- Noms de quartiers sur la carte : au moins 6,5 pixels à l'écran en vue d'ensemble.
- Batailles de rue (`frontstreet.js`) : en métropole, la bataille porte sur tout le quartier visé (`townCellsOf`), ses
  défenseurs jusqu'à 4 unités de son centre ; grande ville pour la vieille ville et les usines, ville sinon ; titre
  « Bataille de rue : <quartier> ». Trame tactique par type (`urbangen.js`, `URBAN_STYLES`) : part de pierre, îlot fort
  au carrefour (église, usine, gare, château d'eau, kiosque, entrepôt ; il compte double, sauf l'usine), halles
  d'usine sur 60 % du bâti, voies de la gare (deux rues de plus d'un bord à l'autre), parc en jardins et bosquets,
  hauteur en relief (niveaux 2 et 3). Rendu tactique : cuve ronde du château d'eau et du kiosque. Sans style, la ville
  tactique ne change pas.
- Vérifié dans le jeu (graine « m4 », Wehrmacht) : briefing, tirage, déploiement, panneau des quartiers, compteur
  « ★ 0/16 pris ». La fenêtre de bataille de rue n'a pas été déclenchée à la main dans le navigateur : la conversion
  et le retour sont couverts par un test.

### Étape 7 faite : relecture, corrections, fichier unique

- Relecture du chantier (revue indépendante du diff) : aucun bug bloquant ; corrigé :
  - renforts par quartier possédé : 9 hommes par jour (`METRO_RULES.reinforce`) au lieu des 25 d'une ville (le
    défenseur, avec 17 quartiers, recevait 425 hommes par jour en plus) ;
  - batailles de rue : seules les cases du quartier à portée de ses défenseurs (`defReach`) se jouent et changent de
    mains, au lieu du quartier entier ;
  - artillerie : seules les pièces à longue portée (`LONG_RANGE`, 15 : divisionnaire, lourde) passent sur la rive
    gauche ; mortiers et lance-roquettes, trop courts, restent en ville (l'IA aussi) ;
  - consigne du défenseur : 0 point, il a tenu ; +1, indécis ; +2, l'ennemi l'emporte ;
  - info-bulle d'une case de ville : le vrai bonus défensif (quartier, ruine, maison-forteresse) ;
  - victoire immédiate quand l'attaquant possède tous les quartiers (et non leurs seules cases centres) ; objectif
    « prendre … avant le jour n » rempli à la possession du quartier, au soir ;
  - fin de bataille : « (N à prendre) », les points des quartiers que l'attaquant ne possédait pas au départ ;
  - détails : seuil de possession partagé avec le rendu, route des quais repérée (`map.quayRoad`), une
    maison-forteresse ne ralentit la fonte que des poches du défenseur.
- Équilibre après corrections : les mortiers rendus au défenseur faisaient tomber l'attaquant à 27 % (80 batailles) ;
  l'attaquant a deux barrages focalisés de plus en métropole (`METRO_RULES.attackBarrages` : le choc des barrages est
  ce qui entame vite une ville). Mesure (80 batailles) : attaquant 35 % (40 % puis 30 %), défenseur 44 %, indécis 21 %.
- Fichier unique : il était cassé avant ce chantier (depuis les Atouts : `ATOUT_RULES is not defined` au chargement,
  le menu ne s'affichait pas) ; neuf modules manquaient à `tools/bundle.mjs`. Ajoutés dans l'ordre ; noms de premier
  niveau en double renommés dans leur module (`hqCellAt`, `HQ_NAMES`, `HQ_SIDE_NAME`, `nextSpecialId`,
  `specialCellAt`, `supportCellAt`, `SUPPORT_ORDINAL`, `supportContact`, `airCellAt`, `escDeck`, `airWarSummary`),
  `segDist` partagé (exporté par `front.js`) ; un import renommé devient une affectation. Le bundler refuse désormais
  un module de `src` absent de son ordre (l'aperçu du front mis à part) : `--check`, lancé par les tests, le voit.
  Vérifié dans le navigateur : menu, front en métropole (graine « m4 »), deux journées, fenêtre de bataille de rue,
  bataille commandée en tactique, bilans du soir.
- `tools/front-sim.mjs` compte la métropole parmi ses biomes.


### Avancement des attaques sur les flèches

- Mesure (`vectorProgress`, `front.js`) : jusqu'où nos lignes tiennent sans interruption le long de l'axe d'un vecteur
  d'infanterie ou de blindés, depuis son origine (0 au départ, 1 à l'objectif) ; trois axes parallèles dans le couloir,
  on garde le plus avancé, pour qu'un îlot ennemi sur l'axe ne fige pas la mesure. Relevée à l'aube puis à chaque tick
  (`v.track`) ; un ordre retenu par le PC jusqu'à midi est marqué (`v.hold`) et son élan ne compte qu'à son départ.
- Élan (`vectorMomentum`, réglages `MOMENTUM`) : rythme sur les 6 derniers ticks, en cases par tick. Percée au-delà
  de 0,6, avance au-delà de 0,08, recul en dessous de −0,08, piétinement entre les deux. Sur 12 batailles IA contre IA
  (8 jours) : piétinement 41 %, avance 43 %, percée 5 %, recul 1 %, objectif atteint 2 %.
- Projection au soir : avancement + rythme × ticks restants, avec le plus prudent du rythme des 4 derniers ticks et de
  celui depuis le départ. Comparée à quatre autres manières de la calculer, c'est la plus juste : écart moyen avec
  l'avancement réel du soir de 0,16 de l'axe à 6 h de jeu, 0,10 à midi, 0,04 en fin d'après-midi. Ce n'est pas une
  probabilité : on montre ce qu'on mesure, le brouillard du plan reste entier.
- Rendu, pendant la journée seulement (le plan garde la flèche pleine) : la flèche est creuse (intérieur couleur papier)
  et l'encre la remplit jusqu'à l'avancement, interpolé entre deux ticks ; la pointe ne se remplit qu'à l'objectif
  atteint. À la tête de l'avance, une marque dont la forme double la couleur : chevron vert (avance), double chevron
  vert vif qui pulse (percée), barre orange en travers (piétinement), chevron rouge à rebours (recul), cercle gris
  (ordre retenu par le PC). Quand l'attaque progresse, un trait pointillé fin mène à un chevron ouvert : là où elle sera
  ce soir à ce rythme. Repli et fixation, qui ne cherchent pas de terrain, gardent leur tracé.

### Rails d'ordres

- La barre d'outils du bas (dix étiquettes serrées, illisibles sur téléphone) devient deux rails verticaux d'icônes,
  posés sur la carte (`#f-tools`, `.order-rails`) : à gauche Manœuvre (Infanterie, Blindés, Fixer, Repli) puis
  Renforts (Réserves, Paras, Pont), séparés d'un filet ; à droite, au bord de la carte et non du panneau, Feux
  (Barrage, Salve, Air). Rails centrés verticalement, défilant s'ils ne tiennent pas ; affichés aux mêmes conditions
  que l'ancienne barre (matin, hors placement).
- Icônes SVG au trait (`currentColor`, 22 px) : symboles OTAN pour l'infanterie et les blindés, flèche contre un mur
  (fixer), flèche qui revient (repli), chevrons qui montent (réserves), parachute, pont sur l'eau, éclat (barrage),
  roquettes en salve, avion. Liseré de couleur de l'ordre côté bord de carte. `title` et `aria-label` : nom et touche
  (« Infanterie (1) ») ; l'info-bulle ajoute le détail (troupes engagées, restants, réserve en hommes).
- Pastille au coin de l'icône (côté carte) : ce qui reste, en court (« 12k » pour la réserve) ; barrages en ●●○ sous
  l'icône. Blindés : une seconde pastille rouge (rang / nombre) dit quelle formation est choisie, l'info-bulle la nomme.
- Téléphone (portrait et paysage bas) : cibles de 42 et 40 px. La barre d'aide se décale pour passer entre les rails.
