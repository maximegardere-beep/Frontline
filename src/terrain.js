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

export function terrainDefense(tile) {
  let d = TERRAIN[tile.terrain].def;
  if (tile.river && !tile.road && !tile.frozen) d -= 1;
  return d;
}

export function describeTile(tile) {
  const parts = [TERRAIN[tile.terrain].label + (tile.frozen && tile.terrain === 'marsh' ? ' gelé' : '')];
  if (tile.name) parts[0] += ` de ${tile.name}`;
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
