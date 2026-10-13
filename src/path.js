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

// ---------- Micro-grille : flood-fill (mode Frontline stratégique) ----------

// Remplissage par diffusion depuis des cases sources, à travers les cases que pass(i) accepte.
// Renvoie un tableau 0/1 des cases atteintes.
export function floodFill(nb, N, seeds, pass) {
  const seen = new Uint8Array(N);
  const stack = [];
  for (const s of seeds) if (!seen[s] && pass(s)) { seen[s] = 1; stack.push(s); }
  while (stack.length) {
    const i = stack.pop();
    for (let d = 0; d < 6; d++) {
      const j = nb[i * 6 + d];
      if (j >= 0 && !seen[j] && pass(j)) { seen[j] = 1; stack.push(j); }
    }
  }
  return seen;
}

// Composantes connexes des cases retenues par keep(i) : listes d'indices.
export function components(nb, N, keep) {
  const label = new Int32Array(N).fill(-1);
  const out = [];
  for (let s = 0; s < N; s++) {
    if (label[s] >= 0 || !keep(s)) continue;
    const cells = [s];
    label[s] = out.length;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      for (let d = 0; d < 6; d++) {
        const j = nb[i * 6 + d];
        if (j >= 0 && label[j] < 0 && keep(j)) { label[j] = out.length; cells.push(j); }
      }
    }
    out.push(cells);
  }
  return { label, list: out };
}

// Distance en cases (BFS) depuis des sources, à travers pass(i), plafonnée à maxD (au-delà : maxD + 1).
export function bfsDistance(nb, N, seeds, pass, maxD = 255) {
  const dist = new Uint16Array(N).fill(maxD + 1);
  let cur = [];
  for (const s of seeds) if (dist[s] > 0) { dist[s] = 0; cur.push(s); }
  for (let d = 1; d <= maxD && cur.length; d++) {
    const next = [];
    for (const i of cur) {
      for (let k = 0; k < 6; k++) {
        const j = nb[i * 6 + k];
        if (j >= 0 && dist[j] > d && pass(j)) { dist[j] = d; next.push(j); }
      }
    }
    cur = next;
  }
  return dist;
}

// Encerclement : les cases d'un camp que l'on ne relie pas à son bord de carte par ses propres cases.
// owner : Int8Array (0, 1 ; -1 infranchissable) ; edgeCol : colonne de ravitaillement du camp.
// Renvoie { supplied, pockets: [{ cells, label }] }.
export function findPockets(map, owner, side, edgeCol) {
  const { W, H, N, nb } = map;
  const seeds = [];
  for (let row = 0; row < H; row++) seeds.push(row * W + edgeCol);
  const supplied = floodFill(nb, N, seeds, (i) => owner[i] === side);
  const { list } = components(nb, N, (i) => owner[i] === side && !supplied[i]);
  return { supplied, pockets: list };
}
