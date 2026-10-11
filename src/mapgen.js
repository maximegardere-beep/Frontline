// Génération procédurale du champ de bataille : relief, forêts, marais, rivière, villages, fermes, routes.

import { createRng } from './rng.js';
import { neighborCoords, hexDistance } from './hex.js';
import { tileAt, roadEdgeKey, TERRAIN } from './terrain.js';
import { placeName } from './names.js';

export function makeNoise(rng) {
  const N = 64;
  const grid = Float32Array.from({ length: N * N }, () => rng.next());
  const at = (x, y) => grid[((y % N) + N) % N * N + (((x % N) + N) % N)];
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  };
  return (x, y, octaves = 4) => {
    let v = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      v += noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return v / norm;
  };
}

function quantile(values, q) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

function inBounds(map, h) {
  return h.col >= 0 && h.row >= 0 && h.col < map.W && h.row < map.H;
}

export function neighbors(map, h) {
  return neighborCoords(h.col, h.row).filter((n) => inBounds(map, n));
}

function carveRiver(map, rng) {
  const { W, H } = map;
  const fromTop = rng.chance(0.5);
  let cur = { col: rng.int(Math.floor(W * 0.38), Math.ceil(W * 0.62) - 1), row: fromTop ? 0 : H - 1 };
  const dir = fromTop ? 1 : -1;
  const path = [cur];
  const seen = new Set([`${cur.col},${cur.row}`]);
  let lateral = 0;
  const center = W / 2;
  while (cur.row !== (fromTop ? H - 1 : 0) && path.length < H * 3) {
    const opts = neighbors(map, cur).filter((n) => !seen.has(`${n.col},${n.row}`));
    let best = null, bestScore = Infinity;
    for (const n of opts) {
      const dr = n.row - cur.row;
      if (dr === -dir) continue;
      if (dr === 0 && lateral >= 2) continue;
      const t = tileAt(map, n.col, n.row);
      const score = t.h * 3 + rng.next() * 1.2 + (dr === 0 ? 0.6 : 0) + Math.abs(n.col - center) * 0.08;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    if (!best) break;
    lateral = best.row === cur.row ? lateral + 1 : 0;
    cur = best;
    seen.add(`${cur.col},${cur.row}`);
    path.push(cur);
  }
  for (const h of path) {
    const t = tileAt(map, h.col, h.row);
    t.river = true;
    if (t.terrain === 'forest') t.terrain = 'plain';
    t.elev = Math.min(t.elev, 1);
    for (const n of neighbors(map, h)) {
      const nt = tileAt(map, n.col, n.row);
      if (nt.elev > t.elev + 1) nt.elev = t.elev + 1; // vallée
    }
  }
  return path;
}

// A* pour tracer les routes (coût = difficulté de construction).
function roadPath(map, a, b) {
  const key = (h) => h.row * map.W + h.col;
  const cost = (from, to) => {
    const t = tileAt(map, to.col, to.row);
    if (t.road) return 0.4;
    let c = { plain: 1, farm: 1, village: 0.6, forest: 3, marsh: 7 }[t.terrain];
    c += Math.abs(t.elev - tileAt(map, from.col, from.row).elev) * 1.5;
    if (t.river) c += 4;
    return c;
  };
  const open = new Map([[key(a), { h: a, g: 0, f: hexDistance(a, b) }]]);
  const came = new Map();
  const g = new Map([[key(a), 0]]);
  while (open.size) {
    let curK, cur;
    for (const [k, v] of open) if (!cur || v.f < cur.f) { cur = v; curK = k; }
    open.delete(curK);
    if (curK === key(b)) {
      const out = [cur.h];
      let k = curK;
      while (came.has(k)) { const p = came.get(k); out.push(p); k = key(p); }
      return out.reverse();
    }
    for (const n of neighbors(map, cur.h)) {
      const ng = cur.g + cost(cur.h, n);
      const nk = key(n);
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, cur.h);
        open.set(nk, { h: n, g: ng, f: ng + hexDistance(n, b) });
      }
    }
  }
  return [];
}

function layRoad(map, path) {
  if (path.length > 1) map.roads.push(path);
  for (let i = 0; i < path.length; i++) {
    tileAt(map, path[i].col, path[i].row).road = true;
    if (i > 0) map.roadEdges.add(roadEdgeKey(map, path[i - 1], path[i]));
  }
}

export function generateMap(seed, opts = {}) {
  const W = opts.width ?? 22;
  const H = opts.height ?? 15;
  const rng = createRng(`map:${seed}`);
  const heightNoise = makeNoise(rng);
  const moistNoise = makeNoise(rng);
  const map = { seed, W, H, tiles: [], roadEdges: new Set(), roads: [], rivers: [], villages: [], objective: null };

  const hs = [], ms = [];
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const x = col + 0.5 * (row & 1), y = row * 0.866;
      const h = heightNoise(x * 0.16 + 3.1, y * 0.16 + 7.7);
      const m = moistNoise(x * 0.22 + 11.3, y * 0.22 + 1.9);
      hs.push(h);
      ms.push(m);
      map.tiles.push({ col, row, h, m, elev: 0, terrain: 'plain', river: false, road: false, name: null });
    }
  }
  const [q1, q2, q3] = [quantile(hs, 0.28), quantile(hs, 0.7), quantile(hs, 0.9)];
  const forestQ = quantile(ms, 0.76), marshQ = quantile(ms, 0.8);
  for (const t of map.tiles) {
    t.elev = t.h < q1 ? 0 : t.h < q2 ? 1 : t.h < q3 ? 2 : 3;
    if (t.elev === 0 && t.m > marshQ) t.terrain = 'marsh';
    else if (t.m > forestQ && t.elev >= 1) t.terrain = 'forest';
    else if (rng.chance(0.03)) t.terrain = 'forest'; // bosquets isolés
  }

  if (opts.river ?? rng.chance(0.85)) map.rivers.push(carveRiver(map, rng));

  // Villages : espacés, hors rivière et marais, plutôt bas et proches de l'eau.
  const usedNames = new Set();
  const nVillages = rng.int(3, 5);
  for (let i = 0; i < nVillages; i++) {
    let best = null, bestScore = -Infinity;
    for (let k = 0; k < 40; k++) {
      const t = rng.pick(map.tiles);
      if (t.river || t.terrain === 'marsh' || t.elev >= 3) continue;
      if (t.col < 2 || t.col > W - 3 || t.row < 1 || t.row > H - 2) continue;
      if (map.villages.some((v) => hexDistance(v, t) < 4)) continue;
      const nearRiver = neighbors(map, t).some((n) => tileAt(map, n.col, n.row).river);
      const score = (nearRiver ? 2 : 0) - t.elev * 0.5 + rng.next() * 2;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (!best) continue;
    best.terrain = 'village';
    best.name = placeName(rng, usedNames);
    map.villages.push(best);
    const ring = rng.shuffle(neighbors(map, best).map((n) => tileAt(map, n.col, n.row)));
    let farms = rng.int(1, 3);
    for (const n of ring) {
      if (farms <= 0) break;
      if (n.river || n.terrain === 'village' || n.terrain === 'marsh') continue;
      n.terrain = 'farm';
      farms--;
    }
  }
  for (let i = rng.int(2, 5); i > 0; i--) {
    const t = rng.pick(map.tiles);
    if (t.terrain === 'plain' && !t.river) t.terrain = 'farm';
  }

  // Routes : une route principale ouest → est à travers les villages, plus quelques embranchements.
  const vs = [...map.villages].sort((a, b) => a.col - b.col);
  if (vs.length) {
    const west = { col: 0, row: vs[0].row };
    const east = { col: W - 1, row: vs[vs.length - 1].row };
    const stops = [west, ...vs, east];
    for (let i = 1; i < stops.length; i++) layRoad(map, roadPath(map, stops[i - 1], stops[i]));
    for (const v of vs) {
      if (rng.chance(0.45)) {
        const edge = rng.chance(0.5) ? { col: v.col + rng.int(-2, 2), row: 0 } : { col: v.col + rng.int(-2, 2), row: H - 1 };
        edge.col = Math.max(0, Math.min(W - 1, edge.col));
        layRoad(map, roadPath(map, v, edge));
      }
    }
  }
  // Les routes défrichent la forêt.
  for (const t of map.tiles) if (t.road && t.terrain === 'forest' && rng.chance(0.6)) t.terrain = 'plain';

  if (opts.objective) {
    const center = { col: (W - 1) / 2, row: (H - 1) / 2 };
    const cands = map.villages.length ? map.villages : map.tiles.filter((t) => t.elev >= 2);
    cands.sort((a, b) => Math.abs(a.col - center.col) + Math.abs(a.row - center.row) * 0.5 - (Math.abs(b.col - center.col) + Math.abs(b.row - center.row) * 0.5));
    const o = cands[0] ?? tileAt(map, Math.floor(W / 2), Math.floor(H / 2));
    map.objective = { col: o.col, row: o.row };
  }
  const main = map.objective ? tileAt(map, map.objective.col, map.objective.row) : map.villages[0];
  map.name = main?.name ? `Secteur de ${main.name}` : `Cote ${100 + rng.int(10, 290)}`;
  for (const t of map.tiles) { delete t.h; delete t.m; }
  return map;
}

export { TERRAIN };
