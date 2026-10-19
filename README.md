# Frontline

Jeu de stratégie sur le front de l'Est, de 1941 à 1944. Le mode principal est le **Front stratégique** : quinze
jours d'offensive sur tout un secteur, où les unités laissent place à des masses de troupes et à une ligne de front
continue. Chaque matin, on trace ses poussées (infanterie, blindés), replis, lignes de défense et barrages, on fait
monter les réserves et on décide du sort des poches ; puis la journée se déroule seule, en une vingtaine de secondes.

Le **mode tactique** (campagne de cinq batailles sur hexagones, ordres simultanés) est débranché pour l'instant :
son code reste en place et testé, et `TACTICAL_ENABLED` dans `src/main.js` le rétablit au menu. Ses règles sont
décrites plus bas.

## Lancer le jeu

Aucune dépendance. Node 18+ suffit.

```sh
npm start          # serveur local sur http://localhost:8080
npm test           # tests : moteurs tactique et stratégique, saisie du front, page, fichier unique
node tools/balance.mjs 600        # équilibre des camps sur 600 batailles IA contre IA
node tools/campaign-sim.mjs 200   # difficulté de la campagne, l'IA jouant le joueur
node tools/front-sim.mjs 120      # front stratégique : 120 batailles IA contre IA (attaquant, camps)
node tools/front-bench.mjs        # front stratégique : banc de calibrage (percée, attaque frontale, poches)
node tools/urban-sim.mjs 48       # batailles de rue IA contre IA (ATT=6 : à forces égales)
node tools/metro-sim.mjs 12       # métropole IA contre IA : progression dans la ville, quartiers pris, fleuve atteint
node tools/bundle.mjs   # génère dist/frontline.html, un fichier unique jouable hors ligne
```

Les modules ES nécessitent un serveur HTTP : ouvrir `index.html` directement depuis le disque ne fonctionne pas,
mais `dist/frontline.html` si. `front-preview.html` montre une bataille du front stratégique IA contre IA, en
direct (outil de développement) ; `sounds.html` joue un à un les sons du jeu (banc sonore).

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

## Front stratégique

Au menu, choisir l'année (1941 à 1944) puis son camp. Le rôle, attaquant ou
défenseur, est tiré de la graine et annoncé au briefing, avec l'objectif : les villes marquées ★.

- **La carte** : chaque camp est une masse de troupes (bleue pour la Wehrmacht, rouge pour l'Armée rouge), plus
  sombre où elle est dense ; le trait noir est le front. Hors de vue, l'ennemi n'est qu'une estimation estompée.
- **Atouts** : l'artillerie, les formations blindées, la DCA, le génie et l'aviation ne sont pas fixés d'avance.
  Après le briefing, on tire 5 cartes du paquet de son rôle (selon l'année) et on en garde 3 (« Choix de
  l'état-major » propose un choix) ; au matin du 7e jour, on en tire 4 (5 si l'on est mené aux points) et on en garde
  2. Chaque carte a une rareté (commun, rare, élite : les chars lourds, Tiger, KV ou IS-2, sont des cartes d'élite).
  L'attaquant tire divisions blindées, artillerie lourde, soutien aérien, génie d'assaut, lance-roquettes,
  parachutistes et DCA ; le défenseur, artillerie divisionnaire, canons antichar, bataillons de soutien, point
  d'appui, chasseurs et DCA. Les cartes de l'ennemi restent secrètes.
- **Déploiement** : après le tirage (et la bataille des airs), un bandeau liste les unités à placer, et le PC avant
  la bataille. Touchez une unité (sur la carte ou dans le bandeau), puis sa position dans vos lignes ; elles sont déjà
  posées d'office, on peut s'en tenir là. Un point d'appui se place sur une de vos villes. « Terminer » (ou le bouton
  du jour) clôt le déploiement.
- **Canons antichar** (défenseur) : ils tirent dans un cône face au contact, sur les seuls blindés, qu'ils déciment et
  freinent (les chars lourds encaissent mieux) ; pas de barrage. Deux ou trois barrages ou chasses aériennes en
  viennent à bout ; débordés, ils sont perdus.
- **Bataillons de soutien** (défenseur) : posés en arrière, ils retranchent le secteur du front devant eux (zone
  surlignée le matin), d'autant plus qu'ils restent en place : tranchées le premier jour, barbelés ensuite, puis
  obstacles antichar, jusqu'au niveau de leur carte. Touchez-en un puis sa nouvelle position : il s'y rend de nuit et
  recommence par des tranchées ; les ouvrages faits restent. Ils remplacent l'ancien outil « Ligne ». Pour l'instant, le choix et le
  placement sont automatiques ; le briefing liste vos cartes.
- **Poste de commandement** : votre PC (tente à antenne) coordonne les troupes dans son rayon (une douzaine de
  cases) : attaque, défense et vitesse y gagnent jusqu'à 10-15 %, selon la distance et la liaison. Touchez-le puis sa
  nouvelle position : un saut court (10 cases) se fait de nuit, plus loin de jour, et il est désorganisé pour la
  journée. Barrages et frappes aériennes sur lui coupent ses liaisons, la nuit les rétablit. Désorganisé : plus de
  coordination, pas de regroupement de nuit par l'état-major, 45 % des troupes engagées au plus, vecteurs à midi.
  Pris : malus autour de lui, 35 % engagés au plus, et l'ennemi lit vos documents (vos blindés, une journée) ;
  reprenez sa case, sinon un PC de secours s'installe à l'arrière après deux nuits.
- **Alerte « SOS »** : pendant la journée, quand l'un de vos secteurs craque (au moins quatre cases perdues en six
  heures), un officier au combiné apparaît au-dessus, son appel défile en morse (· · · — — — · · ·) et on l'entend
  à la radio. L'alerte s'estompe quelques heures après que le secteur s'est stabilisé.
- **Appui d'artillerie** : dans la portée de vos groupes d'artillerie (halo laiton le matin), vos poussées frappent
  plus fort (jusqu'à +12 %) et vos cases se défendent mieux (jusqu'à +15 %), sans ordre à donner ; deux groupes qui
  se recoupent ajoutent moins que le double. Pendant la journée, quelques obus épars tombent là où l'on se bat.
- **Préparer ses attaques** : sans feux, un assaut piétine et se paie cher. Le barrage focalisé (trois par
  bataille : deux au départ, un de plus au 7e jour ; ●●○ sur l'outil) engage tous vos groupes libres qui ont la
  zone à portée. Barrages (au lever du jour) et frappes aériennes (fin de matinée) ébranlent les défenseurs :
  défense, riposte et tenue fondent, d'autant plus que les deux tombent au même endroit, puis l'effet s'efface en
  quelques heures. Gardez-les pour les assauts décisifs, au point de départ de vos poussées.
- **Les cours d'eau** : une rivière ne se franchit que sur ses ponts (ou gelée) ; ses cases n'appartiennent à
  personne et le front s'arrête sur les rives. Un barrage fait sauter un pont. Les ruisseaux ralentissent la
  progression et donnent +15 % de défense à qui tient leurs berges.
- **Le matin**, le jeu attend vos ordres. Les outils sont deux rails d'icônes au bord de la carte : à gauche
  Manœuvre (Infanterie, Blindés, Fixer, Repli) et Renforts (Réserves, Paras, Pont), à droite Feux (Barrage, Salve,
  Air). Une pastille au coin de l'icône dit ce qu'il en reste ; le nom, la touche et le détail s'affichent au survol.
  Sur téléphone, les rails restent sur la carte et défilent s'ils ne tiennent pas. Choisir un outil, puis toucher le
  départ et la cible : le jeu prend lui-même la case la plus pertinente autour du doigt (on peut déplacer la carte
  entre les deux appuis).
  La barre sous la carte reste muette : elle ne s'affiche que pour une consigne courte, une erreur, la confirmation
  d'un ordre (quelques secondes) ou l'estimation d'une zone touchée.

| Outil | Gestes | Effet |
|---|---|---|
| Infanterie (`1`) | départ, cible | couloir large, lent, tenace |
| Blindés (`2`) | départ, cible | percée étroite, rapide et profonde ; s'enlise sous la pluie ; 2 par jour |
| Repli (`3`) | secteur, point de repli | les troupes décrochent avec moins de pertes |
| Barrage (`5`) | la zone | barrage focalisé, trois par bataille : pilonnée au lever du jour par tous vos groupes libres à portée, même dans le brouillard |
| Réserves (`6`) | un appui par renfort | 800 hommes montent en ligne autour du point ; `U` annule le dernier |
| Pont (`G`) | la rivière, au bord de vos lignes | le génie jette un pont de bateaux la nuit ; 2 par bataille ; un barrage ou une frappe aérienne le coule |

  Quatre vecteurs par jour au plus (infanterie, blindés et replis confondus). Un vecteur draine les troupes
  autour de son départ : là où il prend, le front se dégarnit. Sans ordre, les troupes colmatent d'elles-mêmes
  les secteurs menacés. L'onglet Ordres liste les ordres du jour (✕ pour en retirer un) et propose de reprendre
  ceux de la veille.
- **Regroupement de nuit** : chaque nuit, l'état-major de chaque camp prélève des troupes sur son secteur le plus
  calme pour renforcer le plus menacé, le long de ses lignes ; une route tenue porte beaucoup plus loin et davantage
  qu'à travers champs. Au matin, une flèche bleue montre le chemin (« −N h » au départ, « +N h » à l'arrivée) et
  l'onglet Ordres le liste. Un PC désorganisé l'empêche.
- **Toucher la carte** sans outil : vos troupes comptées dans la zone, l'ennemi estimé en fourchette
  (« 1 000 à 1 800 hommes »).
- **Poches** : des troupes coupées de leur bord de carte fondent d'environ 30 % par jour. Chaque matin, pour
  chacune des vôtres : statu quo, Festung (se resserrer et tenir, en fondant moins vite) ou percée d'évasion
  (toucher ensuite sa direction).
- **La journée** se déroule seule en une vingtaine de secondes, de 6 h à 20 h ; l'horloge prend la place du
  bouton de lancement, « Passer » l'abrège (`Entrée`). Sur la carte, le front s'embrase là où l'on se bat : lueur
  d'autant plus vive que les pertes sont lourdes, tirs traçants des deux camps (jaunes allemands, orange
  soviétiques), rafales de mitrailleuse, obus là où les blindés poussent ; au matin, les barrages pilonnent leur
  zone, laissant fumée et sol noirci. On entend les fusillades et mitrailleuses des secteurs au contact, les
  canons des blindés, les salves des barrages (feulement des orgues de Staline, sirène des Stuka en piqué), les
  villes qui tombent. La lumière suit l'heure : dorée à l'aube, chaude puis bleuie au soir.
- **Ciel et poussière** : par temps clair, quelques ombres de cumulus glissent sous le vent ; sous la pluie et la neige,
  le ciel est bas (voile, ombres serrées, trouées de soleil). Les blindés en marche soulèvent un panache selon le temps :
  poussière ocre par temps sec, gerbes de boue sous la pluie, neige poudreuse l'hiver.
- **Poches et aviation** : une poche se teinte à la couleur des encerclés, son contour pulse en rouge pendant la journée
  et la fumée s'y concentre ; quand il ne reste plus qu'un tiers de l'effectif encerclé, des drapeaux blancs y flottent.
  Au matin, l'escadrille passe haut avec ses traînées de condensation ; les avions d'assaut ont leur ombre au sol ; un
  avion abattu part en vrille sous un panache noir et son épave fume encore.
- **Ambiance sonore** : un choral de cordes au menu, un piano au briefing, puis plus de musique pendant les combats.
  Le matin des ordres, on est au QG : un téléphone de campagne sonne parfois, une machine à écrire tape de loin en
  loin ; chaque réserve qu'on fait monter passe au téléscripteur. Une ville qui tombe s'annonce en morse (« VILLE
  PRISE », « VILLE PERDUE »). Le soir, le poêle crépite pendant le bilan, et quelques notes disent si la journée a
  tourné en votre faveur (score, sinon terrain) ; d'autres saluent la victoire ou la défaite au rapport final. En
  novembre et sous la neige, le vent siffle sur la steppe. Tout est synthétisé, aucun fichier son.
- **Le terrain garde la trace des combats** : là où l'on se bat, la steppe se piétine et brunit, puis se crible de
  trous d'obus ; un secteur disputé plusieurs jours devient un champ lunaire gris. En été, par temps sec, un combat
  violent peut mettre le feu aux blés, qui brûlent sous le vent et laissent un chaume noir. Les chars perdus restent
  sur place, carcasses noircies qui fument quelques heures.
- **Le panneau** (à droite, ou en bas en portrait) se replie avec le chevron (`P`) : la carte prend tout l'écran,
  il ne reste qu'un rail avec la vue d'ensemble (`0`), le son (`M`) et le bouton du jour. Zoom au pincer ou à la
  molette (`+` / `−` au clavier).
- **Le soir**, un bilan en quelques chiffres : vos pertes, celles de l'ennemi (fourchette estimée), le terrain, les
  villes ★, le score ; puis l'issue en vue, les événements, les objectifs secondaires, la météo et les renforts du
  lendemain.
- **Victoire** au soir du 15e jour : l'attaquant gagne s'il tient assez de villes ★, sinon le défenseur a tenu.
  Un camp qui tombe sous 12 % de ses effectifs ou de son terrain, ou qui perd toutes les villes, a perdu sur-le-champ.

### Métropole

Un biome du front (environ une bataille sur dix) : une grande ville allongée le long d'un fleuve, côté défenseur, que
l'attaquant aborde par ses faubourgs (il en tient le tiers extérieur au départ).

- **Quartiers** : une vingtaine, chacun d'un type : vieille ville (●●●), usines, gare, hauteur, quais (●●), cités
  ouvrières, faubourgs, parc (●). Chacun a sa défense et sa vitesse : les usines sont des citadelles, le parc est à
  découvert. Un quartier appartient à qui tient plus de 60 % de ses cases ; entre les deux, il est disputé.
- **Avenues** : rapides pour les chars, qui y gardent leur choc, mais à découvert ; bordées d'îlots tenus par l'ennemi,
  elles leur coûtent 30 % de pertes en plus. Le front suit les rues.
- **Le fleuve** : le défenseur se ravitaille aussi par les bacs de nuit qui accostent à ses quais (et aux berges des
  usines) ; un quartier coupé des ponts et de ses quais devient une poche. Son artillerie lourde tire de l'autre rive,
  hors d'atteinte ; mortiers et lance-roquettes restent en ville. L'attaquant a deux barrages focalisés de plus.
- **Renforts** : 9 hommes par jour et par quartier possédé (au lieu de 25 par ville).
- **Maisons-forteresses** : silo à grain, grand magasin, maison d'angle, château d'eau ; plus solides, elles fondent
  six fois moins vite encerclées, gênent le ravitaillement de l'attaquant autour d'elles et accueillent le point
  d'appui.
- **Victoire aux points de quartiers gagnés** : chaque quartier pris rapporte ses points, chaque quartier de départ
  perdu les retire, un objectif secondaire vaut 1 point. +2 : victoire de l'attaquant ; +5 : victoire décisive ; +1 :
  indécis ; 0 : victoire défensive ; en dessous, victoire défensive décisive.
- **Le panneau des quartiers** (onglet Forces) : une ligne par quartier, vos cases et celles de l'ennemi, sa
  possession, ses points ; toucher son nom centre la carte. Le bilan du soir dit les quartiers pris et perdus.
- **Batailles de rue** : elles portent sur les cases du quartier visé à portée de ses défenseurs, avec la trame de son type (halles des usines, voies
  de la gare, château d'eau de la hauteur, kiosque du parc, entrepôt des quais, église de la vieille ville).

### Batailles de rue

Quand on lance la journée, une ville que vise une poussée (la vôtre, ou celle de l'ennemi sur l'une des vôtres) peut
se jouer en tactique. Un anneau marque la ville et une fenêtre s'ouvre au-dessus : rapport de force estimé, terrain,
défenses, appui d'artillerie, barrages utilisables. « Commander la bataille » ouvre la ville en hexagones d'environ
50 m ; « Résolution auto » la laisse au front comme d'habitude (et passe à la ville suivante). Une bataille commandée
par jour ; son résultat est décisif : chaque case de la ville prend le camp qui tient l'îlot correspondant, les
pertes et les chars perdus sont reportés sur le front, les barrages dépensés sortent du stock, et la ville ne change
plus de mains jusqu'au soir.

- **La ville** reprend la ville du front : sa taille (village, ville, grande ville avec son usine), la rivière et son
  pont, les routes d'accès, les ruines déjà là. Grand-rue d'ouest en est, rues transversales, place et église ; au
  centre des maisons en pierre, autour des isbas en bois et leurs jardins.
- **Les troupes** : une section pour 150 hommes engagés (de 3 à 12, au même rapport de force), une compagnie de chars
  pour 20 chars des formations qui visent la ville (4 au plus), les canons antichar du défenseur à portée ; les
  défenseurs partent retranchés selon les ouvrages de la ville.
- **Les règles** : l'infanterie dans les maisons est très couverte et invisible tant qu'elle ne tire pas ; les chars
  roulent dans les rues (un pâté de maisons ne se traverse pas) et tirent loin dans leur enfilade, mais une infanterie
  qui les prend à partie depuis une maison n'a plus de malus contre le blindage, et gagne un bonus d'embuscade. Les
  isbas brûlent.
- **Les feux** (barre « Feux » en bas de la carte, un de chaque par tour) : barrage focalisé sur un hexagone et ses six
  voisins, amis compris, les maisons s'effondrent (ruines immédiates, défenseurs décimés et cloués) et leurs gravats
  ferment les rues voisines aux chars ; tir d'appui sur une case que l'on voit. Leur nombre vient de l'artillerie qui
  couvre la ville sur le front et du stock de barrages de la bataille.
- **Les îlots** passent à qui y a seul de l'infanterie ou des chars ; disputés, ils ne changent pas de mains. Au bout
  de 10 tours, l'attaquant gagne s'il tient au moins la moitié de la ville (l'église compte double, la pierre une fois
  et demie).
- Un essai sans le front : au menu, « bataille de rue côté Wehrmacht / Armée rouge ».

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

Tout est synthétisé à la volée (Web Audio), sans aucun fichier : départs de coups, obus qui arrivent en déchirant l'air,
explosions et crépitement des épaves, calés sur la chronologie des effets visuels et placés en stéréo
selon leur position à l'écran (plus faibles hors champ) ; moteurs et chenilles des blindés, pas de
l'infanterie pendant les mouvements ; vent et canonnade lointaine en fond ; déclics d'interface,
transmission radio à l'exécution et cloche de fin de tour. Les tirs d'un ennemi invisible s'entendent étouffés.
Une réverbération de plaine (réponse impulsionnelle synthétisée : quelques échos francs puis une longue queue qui
s'assombrit) fait rouler les détonations, d'autant plus qu'elles sont lointaines ; les coups graves sont légèrement
saturés pour rester audibles sur un haut-parleur de téléphone.

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

### Unités d'élite

Toute unité au niveau Élite (par promotion en campagne, ou tirée ainsi dans une armée) reçoit son matériel.
Le niveau donne déjà +1 Mvt, +1 portée (artillerie, blindés), +2 dés et touche à −1 ; le matériel ajoute :

| Matériel | Camp | Trait |
|---|---|---|
| Tigre | char allemand | blindage épais : +1 au seuil de tous les tirs reçus ; PV +3, Mvt −1 |
| T-34/85 | char soviétique | canon de 85 mm : +1 dé contre les blindés |
| Katioucha | artillerie soviétique | salve sur la case visée et ses voisines est et ouest (⅔ des dés sur chacune), 1 obus, puis un tour de rechargement |
| Panzergrenadiers / Gardes | infanterie | armes antichars : malus +1 au lieu de +2 contre les blindés |

L'artillerie allemande n'a pas d'équivalent : asymétrie assumée, l'artillerie étant déjà le point fort soviétique.
Sur la carte, un liseré doré et le nom du matériel sous le pion signalent ces unités.

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
| `src/metrogen.js` | Biome métropole du front : ville le long du fleuve, quartiers, avenues, ponts, voie ferrée, maisons-forteresses |
| `src/frontmetro.js` | Métropole en jeu : quartiers possédés, points gagnés, bacs de nuit, maisons-forteresses |
| `src/frontcity.js` | Rendu de la métropole : îlots par quartier, avenues, front en escalier, noms de quartiers, repères |
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
| `src/main.js` | Interface, gestes tactiles, animation, menu |
| `src/front.js` | Front stratégique : état, ordres, journée en ticks, poches, brouillard, victoire |
| `src/frontai.js` | IA du front (ne lit que sa mémoire du brouillard) |
| `src/frontinput.js` | Saisie du front sans DOM : case autour du doigt, estimation au toucher, foyers de combat |
| `src/frontfx.js` | Effets de combat du front : lueurs au contact, tirs traçants, obus, barrages |
| `src/frontguns.js` | Artillerie du front : groupes nommés, portée, postures (batterie, mobile, déplacement), appui défensif, contre-batterie, camouflage |
| `src/frontscore.js` | Objectifs du front : score de l'offensive, issues graduées, objectifs secondaires tirés au briefing |
| `src/frontworks.js` | Ouvrages : tranchées, barbelés, obstacles antichar, ponts ; chantiers, dégâts, ruines persistantes |
| `src/frontarmor.js` | Formations blindées : chars, expérience, carburant, grenadiers ; marche, choc, exploitation, pertes, ravitaillement |
| `src/frontsupply.js` | Ravitaillement (têtes de ligne, point culminant logistique) et fatigue des troupes |
| `src/frontscenario.js` | Scénarios 1941 à 1944 (forces, blindés, artillerie, exigence du score) et atouts propres à chaque camp |
| `src/frontsprites.js` | Pièces vues de dessus dessinées en code : chars, obusiers, mortiers, Katioucha, camions, épaulements |
| `src/frontrender.js` | Rendu du front : masses fondues, ligne de front, ordres, poches |
| `src/frontui.js` | Interface du front : briefing, outils, journée animée, bilans, sons, fenêtre des batailles de rue |
| `src/urbangen.js` | Ville tactique : rues, pâtés de maisons, isbas, place et église, usine, rivière et pont ; îlots |
| `src/frontstreet.js` | Batailles de rue : villes disputées, conversion du front en bataille tactique, résultat réinjecté |

Les moteurs (`rng` → `campaign`, `front`, `frontai`, `frontinput`) ne dépendent pas du navigateur : il est testé sous Node et peut servir
de base à un portage (Godot, Unity…) ou à un mode multijoueur. Voir `DESIGN.md` pour les pistes.
