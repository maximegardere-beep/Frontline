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
  ce qu'il en reste pour la journée ; raccourcis 1 à 6, Échap, Entrée. Deux appuis pour les vecteurs et les
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
