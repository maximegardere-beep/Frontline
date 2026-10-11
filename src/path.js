// Déplacements : hexagones atteignables (Dijkstra) dans la limite des points de mouvement.

import { neighborCoords } from './hex.js';
import { tileAt, moveCost } from './terrain.js';
import { unitStats } from './units.js';

export const hexKey = (map, h) => h.row * map.W + h.col;
export const keyHex = (map, k) => ({ col: k % map.W, row: Math.floor(k / map.W) });

// from : position de départ (par défaut celle de l'unité). blocked : Set de clés infranchissables.
export function reachable(map, unit, { from = unit, blocked = new Set(), mp = unitStats(unit).move * 2 } = {}) {
  const start = hexKey(map, from);
  const best = new Map([[start, { cost: 0, prev: null }]]);
  const frontier = [{ k: start, cost: 0 }];
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const { k, cost } = frontier.shift();
    if (cost > best.get(k).cost) continue;
    const h = keyHex(map, k);
    for (const n of neighborCoords(h.col, h.row)) {
      if (!tileAt(map, n.col, n.row)) continue;
      const nk = hexKey(map, n);
      if (blocked.has(nk)) continue;
      if (tileAt(map, n.col, n.row).fire > 0) continue; // on n'entre pas dans une forêt en feu
      let c = cost + moveCost(map, h, n, unit.type);
      if (c > mp) {
        if (k !== start) continue;
        c = mp; // le premier hexagone est toujours accessible
      }
      if (c < (best.get(nk)?.cost ?? Infinity)) {
        best.set(nk, { cost: c, prev: k });
        frontier.push({ k: nk, cost: c });
      }
    }
  }
  return best;
}

export function pathFrom(map, reach, target) {
  const out = [];
  let k = hexKey(map, target);
  if (!reach.has(k)) return null;
  while (reach.get(k).prev !== null) {
    out.push(keyHex(map, k));
    k = reach.get(k).prev;
  }
  return out.reverse();
}

export function pathCost(map, unit, path) {
  let c = 0, prev = unit;
  for (const h of path) { c += moveCost(map, prev, h, unit.type); prev = h; }
  return c;
}
