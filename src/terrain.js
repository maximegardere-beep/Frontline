// Règles de terrain : coûts de déplacement, défense, ligne de vue.
// Les points de mouvement sont doublés (2 = un hexagone de plaine, 1 = sur route).

import { hexLine, hexDistance } from './hex.js';

export const TERRAIN = {
  plain: { label: 'Steppe', cost: 2, def: 0, conceal: false },
  farm: { label: 'Champs', cost: 2, def: 0, conceal: false },
  forest: { label: 'Forêt', cost: 4, def: 1, conceal: true },
  marsh: { label: 'Marais', cost: 6, def: 0, conceal: false },
  village: { label: 'Village', cost: 2, def: 2, conceal: true },
};

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
  if (map.roadEdges.has(roadEdgeKey(map, from, to))) return 1;
  let c = TERRAIN[t.terrain].cost;
  if (t.ruined) c = unitType === 'tank' ? 6 : 4; // décombres
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
  const parts = [TERRAIN[tile.terrain].label + (tile.frozen && tile.terrain === 'marsh' ? ' gelé' : '')];
  if (tile.name) parts[0] += ` de ${tile.name}`;
  if (tile.ruined) parts[0] += ' en ruines';
  if (tile.fire > 0) parts[0] += ' en feu';
  if (tile.burnt) parts[0] = 'Forêt brûlée';
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

// Passage de i vers j : fluidité de la case d'arrivée, réduite en montée.
export function edgeFlow(map, i, j) {
  const climb = Math.max(0, map.elev[j] - map.elev[i]);
  return map.flow[j] / (1 + 0.5 * climb);
}

export function describeCell(map, i) {
  const k = FRONT_KINDS[map.kind[i]];
  const town = k === 'town' ? map.towns.find((t) => t.i === i) : null;
  return [town ? `${FRONT_TERRAIN[k].label} de ${town.name}` : FRONT_TERRAIN[k].label, ELEV_LABELS[map.elev[i]]].join(' · ');
}
