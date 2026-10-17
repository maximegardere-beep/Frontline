// Règles de terrain : coûts de déplacement, défense, ligne de vue.
// Les points de mouvement sont doublés (2 = un hexagone de plaine, 1 = sur route).

import { hexLine, hexDistance } from './hex.js';
import { METRO_RULES } from './frontmetro.js';

export const TERRAIN = {
  plain: { label: 'Steppe', cost: 2, def: 0, conceal: false },
  farm: { label: 'Champs', cost: 2, def: 0, conceal: false },
  forest: { label: 'Forêt', cost: 4, def: 1, conceal: true },
  marsh: { label: 'Marais', cost: 6, def: 0, conceal: false },
  village: { label: 'Village', cost: 2, def: 2, conceal: true },
  // Ville tactique (urbangen.js). urban : couvert de ville (corps à corps contre les chars, moral) ; wood : brûle.
  street: { label: 'Rue', cost: 2, def: 0, conceal: false },
  building: { label: 'Maisons en pierre', cost: 3, def: 3, conceal: true, urban: true },
  isba: { label: 'Isbas', cost: 2, def: 1, conceal: true, urban: true, wood: true },
  garden: { label: 'Jardins', cost: 2, def: 0, conceal: false },
  strong: { label: 'Point fort', cost: 3, def: 4, conceal: true, urban: true },
};

// Chars en ville : ils ne traversent pas les pâtés de maisons (sinon au pas, en défonçant les murs), ni les gravats
// qui bouchent une rue.
const TANK_URBAN = { building: 8, isba: 4, strong: 12, garden: 3 };
export const RUBBLE = { infantry: 2, tank: 12 }; // surcoût d'une rue encombrée de gravats

// Couvert urbain : maisons, isbas, point fort, ou leurs ruines.
export const isUrban = (t) => !!t && (TERRAIN[t.terrain].urban || (t.ruined && t.terrain !== 'village'));

export const ELEV_LABELS = ['Bas-fond', 'Plaine', 'Collines', 'Hauteurs'];

export function tileAt(map, col, row) {
  if (col < 0 || row < 0 || col >= map.W || row >= map.H) return null;
  return map.tiles[row * map.W + col];
}

export const tileIndex = (map, h) => h.row * map.W + h.col;

export function roadEdgeKey(map, a, b) {
  const i = tileIndex(map, a), j = tileIndex(map, b);
  return i < j ? `${i}|${j}` : `${j}|${i}`;
}

export function moveCost(map, from, to, unitType) {
  const t = tileAt(map, to.col, to.row);
  const f = tileAt(map, from.col, from.row);
  if (map.roadEdges.has(roadEdgeKey(map, from, to)) && !t.rubble) return 1;
  let c = TERRAIN[t.terrain].cost;
  if (unitType === 'tank' && TANK_URBAN[t.terrain]) c = TANK_URBAN[t.terrain];
  if (t.ruined) c = unitType === 'tank' ? Math.max(6, TANK_URBAN[t.terrain] ?? 0) : 4; // décombres
  if (t.rubble) c += unitType === 'tank' ? RUBBLE.tank : RUBBLE.infantry;
  if (t.craters && (t.terrain === 'plain' || t.terrain === 'farm')) c += 1; // champ criblé de trous d'obus
  if (unitType === 'tank' && t.terrain === 'forest') c = 6;
  if (unitType === 'tank' && t.terrain === 'marsh') c = 8;
  if (t.frozen && t.terrain === 'marsh') c = 2; // marais gelé : praticable
  if (t.river && !t.road && !t.frozen) c += t.ford ? 1 : t.stream ? 2 : 4; // à gué : rivière, ruisseau ou gué aménagé
  // Pluie ou neige : les véhicules s'enlisent hors route ; l'infanterie, à pied, passe.
  if (unitType !== 'infantry') c += map.mud ?? 0;
  const dz = t.elev - f.elev;
  if (dz > 0) c += 2 * dz;
  return c;
}

// unitType : les cratères n'abritent que l'infanterie.
export function terrainDefense(tile, unitType = null) {
  let d = TERRAIN[tile.terrain].def;
  if (tile.craters && unitType === 'infantry' && (tile.terrain === 'plain' || tile.terrain === 'farm')) d += 1;
  if (tile.river && !tile.road && !tile.frozen) d -= 1;
  return d;
}

export function describeTile(tile) {
  const parts = [tile.label ? tile.label[0].toUpperCase() + tile.label.slice(1) : TERRAIN[tile.terrain].label + (tile.frozen && tile.terrain === 'marsh' ? ' gelé' : '')];
  if (tile.name) parts[0] += ` de ${tile.name}`;
  if (tile.rubble) parts.push('gravats');
  if (tile.ruined) parts[0] += ' en ruines';
  if (tile.fire > 0) parts[0] += ' en feu';
  if (tile.burnt) parts[0] = tile.terrain === 'isba' ? 'Isbas incendiées' : 'Forêt brûlée';
  if (tile.craters && (tile.terrain === 'plain' || tile.terrain === 'farm')) parts.push('cratères');
  if (tile.river) parts.push(tile.road ? 'pont' : tile.frozen ? `${tile.stream ? 'ruisseau' : 'rivière'} gelé${tile.stream ? '' : 'e'}` : tile.ford ? 'gué' : tile.stream ? 'ruisseau' : 'rivière');
  else if (tile.road) parts.push('route');
  parts.push(ELEV_LABELS[tile.elev]);
  return parts.join(' · ');
}

// Ligne de vue : bloquée par une forêt / un village intermédiaire ou un relief plus haut que les deux extrémités.
export function hasLOS(map, a, b) {
  if (hexDistance(a, b) <= 1) return true;
  const ta = tileAt(map, a.col, a.row), tb = tileAt(map, b.col, b.row);
  const top = Math.max(ta.elev, tb.elev);
  const line = hexLine(a, b);
  for (let i = 1; i < line.length - 1; i++) {
    const t = tileAt(map, line[i].col, line[i].row);
    if (!t) continue;
    if (t.elev > top) return false;
    if (TERRAIN[t.terrain].conceal && t.elev + 1 >= top) return false; // arbres et maisons masquent sauf depuis les hauteurs
  }
  return true;
}

// ---------- Micro-grille (mode Frontline stratégique) ----------
// Le terrain n'arrête plus des unités : il freine ou canalise un fluide de troupes.
// flow : fluidité (part du flux qui passe), def : multiplicateur de la densité défensive. Montagne : infranchissable.
export const FRONT_KINDS = ['plain', 'forest', 'marsh', 'town', 'mountain'];
export const FRONT_TERRAIN = {
  plain: { label: 'Steppe', flow: 1, def: 1 },
  forest: { label: 'Forêt', flow: 0.6, def: 1.35 },
  marsh: { label: 'Marais', flow: 0.35, def: 1.1 },
  town: { label: 'Ville', flow: 0.8, def: 1.7 },
  mountain: { label: 'Montagne', flow: 0, def: 1 },
};
// Collines (altitude 2) et hauteurs (3) : la pression avance moins vite et se brise plus facilement.
const ELEV_FLOW = [1, 1, 0.6, 0.45];
const ELEV_DEF = [0.95, 1, 1.3, 1.5];

export const MOUNTAIN = FRONT_KINDS.indexOf('mountain');
export const TOWN = FRONT_KINDS.indexOf('town');

// Fluidité de la case i (0 = bloquée), à précalculer une fois par carte.
export function cellFluidity(map, i) {
  return FRONT_TERRAIN[FRONT_KINDS[map.kind[i]]].flow * ELEV_FLOW[map.elev[i]];
}

export function cellDefense(map, i) {
  return FRONT_TERRAIN[FRONT_KINDS[map.kind[i]]].def * ELEV_DEF[map.elev[i]];
}

// Terrain selon le type de troupes : les blindés (part blindée d'une poussée) ont leur propre fluidité (flowA) et
// perdent une part de leur choc en entrant dans certaines cases (atkA). Forêts, marais et villes les freinent bien plus
// que l'infanterie ; une route les accélère.
export const ARMOR_TERRAIN = {
  plain: { flow: 1, atk: 1 },
  forest: { flow: 0.45, atk: 0.65 },
  marsh: { flow: 0.2, atk: 0.6 },
  town: { flow: 0.6, atk: 0.6 },
  mountain: { flow: 0, atk: 0 },
};
// Eau : rivière (1), gué (2) ; pont (map.bridge = 1). La rivière est infranchissable (ses cases n'appartiennent à
// personne, front.js : syncWater) ; seuls les ponts la traversent. Gelée, elle se franchit presque partout.
export const WATER = {
  river: { flow: 0, def: 1, flowA: 0, atkA: 0 },
  ford: { flow: 0.55, def: 0.85, flowA: 0.3, atkA: 0.7 },
  bridge: { flow: 0.9, def: 1, flowA: 0.9, atkA: 0.9 },
  frozen: { flow: 0.8, def: 1, flowA: 0.7, atkA: 0.9 },
};
// Ruisseau : une case de terre ferme, mais les berges ralentissent (les chars plus encore) et offrent un appui au
// défenseur qui les tient. Une route le franchit sans peine (ponceau) ; gelé, il ne compte plus.
export const STREAM = { flow: 0.6, flowA: 0.5, def: 1.15 };
export const ROAD_ARMOR = 2; // fluidité des blindés sur route…
export const ROAD_CAP = 1.6; // … plafonnée : les chars y roulent 60 % plus vite qu'en steppe, sans gagner de choc

// Villes sous le feu : ruin (0 intacte … 1 rasée) s'accumule avec les barrages et les combats (front.js). Le bonus
// défensif fond tant que la ville brûle et s'effondre, puis remonte dans les ruines (Stalingrad : les décombres sont
// une forteresse pour l'infanterie). Les blindés, eux, s'y empêtrent de plus en plus, route comprise.
export const RUINS = {
  intact: 0.7, // bonus défensif d'une ville intacte (défense × 1,7)
  trough: 0.3, // au plus bas, à mi-destruction
  troughAt: 0.5,
  rubble: 0.6, // dans les ruines complètes
  flow: 0.2, // fluidité de l'infanterie perdue dans les ruines complètes
  flowA: 0.55, // fluidité des blindés perdue
  atkA: 0.45, // choc des blindés perdu
  barrage: 0.04, // par tick de barrage d'artillerie divisionnaire à pleine puissance
  combat: 0.03, // par unité de densité perdue dans la case
  capture: 0.15, // assaut qui emporte la case
};
export const ruinBonus = (r) => (r <= RUINS.troughAt
  ? RUINS.intact + (RUINS.trough - RUINS.intact) * (r / RUINS.troughAt)
  : RUINS.trough + (RUINS.rubble - RUINS.trough) * ((r - RUINS.troughAt) / (1 - RUINS.troughAt)));
// Métropole (metrogen.js) : chaque type de quartier a son terrain. def : bonus défensif de l'îlot intact (la ville
// générique : RUINS.intact), qui suit la même courbe de ruine ; flow, flowA : fluidités de l'infanterie et des blindés.
export const DISTRICT_TERRAIN = {
  centre: { def: 0.7, flow: 0.45, flowA: 0.25 }, // pierre dense
  usine: { def: 0.9, flow: 0.4, flowA: 0.3 }, // halles, caves, cheminées : des citadelles
  ouvrier: { def: 0.4, flow: 0.6, flowA: 0.45 }, // isbas et jardins
  gare: { def: 0.2, flow: 0.7, flowA: 0.7 }, // faisceau de voies à découvert
  hauteur: { def: 0.2, flow: 0.55, flowA: 0.4 }, // le relief (niveaux 2 et 3) fait le reste
  parc: { def: 0.1, flow: 0.8, flowA: 0.9 },
  quai: { def: 0.3, flow: 0.6, flowA: 0.4 },
};
// Avenues : rapides pour les chars, à découvert ; ils y gardent l'essentiel de leur choc (atkA ; ville : 0,6). flank :
// pertes en plus des blindés qui y poussent, à proportion des îlots voisins tenus par l'ennemi (plein effet à deux).
export const AVENUE = { def: 0.1, flow: 1, flowA: 1.3, atkA: 0.9, flank: 0.3 };

// Tir de flanc sur une avenue j : multiplicateur des pertes des blindés qui l'assaillent (1 hors avenue).
export function flankFire(map, owner, j) {
  if (!map.avenue?.[j]) return 1;
  let n = 0;
  for (let d = 0; d < 6; d++) {
    const k = map.nb[j * 6 + d];
    if (k >= 0 && owner[k] === owner[j] && map.district[k] >= 0 && !map.avenue[k]) n++;
  }
  return 1 + AVENUE.flank * Math.min(1, n / 2);
}

// État affiché d'une case de ville selon sa ruine.
export const ruinLabel = (r) => (r < 0.08 ? null : r < 0.35 ? 'endommagée' : r < 0.7 ? 'en flammes' : 'en ruines');

// Calcule flow, def, flowA, atkA de toutes les cases (frozen : gel des marais et des rivières ; ruin : destruction
// des villes, par case).
export function computeTerrain(map, frozen = false, ruin = null) {
  const { N } = map;
  map.flow = new Float32Array(N);
  map.def = new Float32Array(N);
  map.flowA = new Float32Array(N);
  map.atkA = new Float32Array(N);
  for (let i = 0; i < N; i++) cellTerrain(map, i, frozen, ruin?.[i] ?? 0);
}

// Une case seulement (après un changement local : ville bombardée).
export function cellTerrain(map, i, frozen = false, ruin = 0) {
  let k = FRONT_KINDS[map.kind[i]];
  if (frozen && k === 'marsh') k = 'plain';
  const T = FRONT_TERRAIN[k], A = ARMOR_TERRAIN[k];
  const ef = ELEV_FLOW[map.elev[i]], ed = ELEV_DEF[map.elev[i]];
  let flow = T.flow, def = T.def, flowA = A.flow, atkA = A.atk;
  const water = map.river?.[i] ? (map.bridge?.[i] === 1 ? 'bridge' : frozen ? 'frozen' : map.river[i] === 2 ? 'ford' : 'river') : null;
  if (water && k !== 'mountain') {
    const Wt = WATER[water];
    flow = Math.min(flow, Wt.flow); def = Wt.def; flowA = Math.min(flowA, Wt.flowA); atkA = Math.min(atkA, Wt.atkA);
  }
  if (map.stream?.[i] && !water && !frozen && k !== 'mountain') {
    def *= STREAM.def;
    if (!map.road?.[i]) { flow *= STREAM.flow; flowA *= STREAM.flowA; }
  }
  if (map.road?.[i] && k !== 'mountain' && water !== 'river') flowA = Math.min(ROAD_CAP, Math.max(flowA, 0.6) * ROAD_ARMOR);
  if (k === 'town' && !water) {
    // Métropole : terrain du quartier, ou de l'avenue qui le traverse.
    const D = map.district?.[i] >= 0 ? (map.avenue[i] ? AVENUE : DISTRICT_TERRAIN[map.districts[map.district[i]].type]) : null;
    if (D) { flow = D.flow; flowA = D.flowA; if (D.atkA) atkA = D.atkA; }
    def = (1 + ruinBonus(ruin) * (D ? D.def / RUINS.intact : 1)) * (map.stronghold?.[i] === 2 ? METRO_RULES.strongDef : 1);
    flow *= 1 - RUINS.flow * ruin;
    flowA *= 1 - RUINS.flowA * ruin;
    atkA *= 1 - RUINS.atkA * ruin;
  }
  map.flow[i] = flow * ef;
  map.def[i] = def * ed;
  map.flowA[i] = flowA * ef;
  map.atkA[i] = atkA;
}

// Passage de i vers j : fluidité de la case d'arrivée, réduite en montée.
export function edgeFlow(map, i, j, armored = 0) {
  const climb = Math.max(0, map.elev[j] - map.elev[i]);
  return flowFor(map, j, armored) / (1 + 0.5 * climb);
}

// Fluidité d'une case pour une poussée dont une part `armored` est blindée.
export const flowFor = (map, j, armored = 0) => (armored > 0 && map.flowA ? map.flow[j] * (1 - armored) + map.flowA[j] * armored : map.flow[j]);

export function describeCell(map, i, ruin = 0) {
  const k = FRONT_KINDS[map.kind[i]];
  const town = k === 'town' ? map.towns.find((t) => t.i === i) : null;
  const district = map.district?.[i] >= 0 ? map.districts[map.district[i]] : null;
  const parts = [town && !district ? `${FRONT_TERRAIN[k].label} de ${town.name}` : district ? `${district.name}${map.avenue[i] ? ', avenue' : ''}` : FRONT_TERRAIN[k].label];
  // Bonus défensif réel de la case (quartier, ruine, maison-forteresse compris ; relief à part).
  const bonus = Math.round(((map.def ? map.def[i] / ELEV_DEF[map.elev[i]] : 1 + ruinBonus(ruin)) - 1) * 100);
  if (k === 'town' && ruinLabel(ruin)) parts[0] += ` ${ruinLabel(ruin)} (défense +${bonus} %)`;
  else if (district) parts[0] += ` (${map.stronghold?.[i] === 2 ? 'maison-forteresse, ' : ''}défense +${bonus} %)`;
  if (map.river?.[i]) parts.push(map.bridge?.[i] === 1 ? (map.pontoon?.[i] ? 'pont de bateaux' : 'pont') : `${map.bridge?.[i] === 2 ? 'pont détruit · ' : ''}${map.river[i] === 2 ? 'gué' : map.bigRiver?.[i] ? 'fleuve' : 'rivière'}${map.river[i] === 2 ? '' : ' (infranchissable hors des ponts)'}`);
  else if (map.road?.[i]) parts.push(map.stream?.[i] ? 'route · ruisseau' : 'route');
  else if (map.stream?.[i]) parts.push('ruisseau (berges : progression ralentie, défense +15 %)');
  parts.push(ELEV_LABELS[map.elev[i]]);
  return parts.join(' · ');
}
