// Génération procédurale du champ de bataille : relief, forêts, marais, rivière, villages, fermes, routes.

import { createRng } from './rng.js';
import { neighborCoords, hexDistance, neighborTable } from './hex.js';
import { tileAt, roadEdgeKey, TERRAIN, FRONT_KINDS, MOUNTAIN, TOWN, computeTerrain } from './terrain.js';
import { placeName } from './names.js';
import { BIOMES } from './conditions.js';

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

// Cours d'eau descendant la carte du nord au sud (ou l'inverse). Un ruisseau (maxLen) s'arrête en chemin.
function carveRiver(map, rng, { maxLen = Infinity, stream = false } = {}) {
  const { W, H } = map;
  const fromTop = rng.chance(0.5);
  let cur = { col: rng.int(Math.floor(W * 0.38), Math.ceil(W * 0.62) - 1), row: fromTop ? 0 : H - 1 };
  const dir = fromTop ? 1 : -1;
  const path = [cur];
  const seen = new Set([`${cur.col},${cur.row}`]);
  let lateral = 0;
  const center = W / 2;
  while (cur.row !== (fromTop ? H - 1 : 0) && path.length < Math.min(H * 3, maxLen)) {
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
    if (stream) t.stream = true;
    if (t.terrain === 'forest') t.terrain = 'plain';
    t.elev = Math.min(t.elev, 1);
    for (const n of neighbors(map, h)) {
      const nt = tileAt(map, n.col, n.row);
      if (nt.elev > t.elev + 1) nt.elev = t.elev + 1; // vallée
    }
  }
  return { path, stream };
}

// Gués : quelques points de passage plus faciles, à l'écart des ponts et les uns des autres.
function placeFords(map, river, rng, count) {
  const cands = rng.shuffle(river.path.slice(1, -1).map((h) => tileAt(map, h.col, h.row)));
  const fords = [];
  for (const t of cands) {
    if (fords.length >= count) break;
    if (t.road || t.terrain === 'marsh') continue;
    if (river.path.some((h) => tileAt(map, h.col, h.row).road && hexDistance(h, t) < 3)) continue;
    if (fords.some((f) => hexDistance(f, t) < 4)) continue;
    t.ford = true;
    fords.push(t);
  }
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

function placeTown(map, rng, usedNames) {
  const { W, H } = map;
  const cands = map.tiles.filter((t) => !t.river && t.terrain !== 'marsh' && t.elev <= 2 && Math.abs(t.col - W / 2) <= 2.5 && Math.abs(t.row - H / 2) <= 2.5);
  if (!cands.length) return;
  const center = rng.pick(cands);
  Object.assign(center, { terrain: 'village', name: placeName(rng, usedNames), town: true });
  map.villages.push(center);
  const blocks = rng.shuffle(neighbors(map, center).map((n) => tileAt(map, n.col, n.row)).filter((t) => !t.river && t.terrain !== 'marsh'));
  for (const t of blocks.slice(0, rng.int(3, 5))) {
    Object.assign(t, { terrain: 'village', name: null, town: true });
    map.villages.push(t);
  }
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
  const B = { forestQ: 0.76, grove: 0.03, marshQ: 0.8, marshElev: 0, villages: [3, 5], farms: [2, 5], water: { river: 35, stream: 30, none: 35 }, ...(BIOMES[opts.biome] ?? {}) };
  const heightNoise = makeNoise(rng);
  const moistNoise = makeNoise(rng);
  const map = { seed, W, H, biome: opts.biome ?? null, tiles: [], roadEdges: new Set(), roads: [], rivers: [], villages: [], objective: null };

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
  const forestQ = quantile(ms, B.forestQ), marshQ = quantile(ms, B.marshQ);
  for (const t of map.tiles) {
    t.elev = t.h < q1 ? 0 : t.h < q2 ? 1 : t.h < q3 ? 2 : 3;
    if (t.elev <= B.marshElev && t.m > marshQ) t.terrain = 'marsh';
    else if (t.m > forestQ && t.elev >= 1) t.terrain = 'forest';
    else if (rng.chance(B.grove)) t.terrain = 'forest'; // bosquets isolés
  }

  // Eau : une rivière sur environ un tiers des cartes, un ruisseau qui s'arrête en chemin sur un autre tiers,
  // rien sur le reste. Trop de rivières faisaient de chaque bataille une bataille de pont.
  const water = opts.river === true ? 'river' : opts.river === false ? 'none' : rng.weighted(B.water);
  if (water === 'river') map.rivers.push(carveRiver(map, rng));
  else if (water === 'stream') map.rivers.push(carveRiver(map, rng, { stream: true, maxLen: rng.int(Math.round(H * 0.4), Math.round(H * 0.7)) }));

  // Villages : espacés, hors rivière et marais, plutôt bas et proches de l'eau.
  const usedNames = new Set();
  // Bourg : un pâté de 4 à 6 hexagones bâtis près du centre, avant les villages ordinaires.
  if (B.town) placeTown(map, rng, usedNames);
  const nVillages = rng.int(...B.villages);
  for (let i = 0; i < nVillages; i++) {
    let best = null, bestScore = -Infinity;
    for (let k = 0; k < 40; k++) {
      const t = rng.pick(map.tiles);
      if (t.river || t.terrain === 'marsh' || t.elev >= 3) continue;
      if (t.col < 2 || t.col > W - 3 || t.row < 1 || t.row > H - 2) continue;
      if (map.villages.some((v) => hexDistance(v, t) < (v.town ? 3 : 4))) continue;
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
  for (let i = rng.int(...B.farms); i > 0; i--) {
    const t = rng.pick(map.tiles);
    if (t.terrain === 'plain' && !t.river) t.terrain = 'farm';
  }

  // Routes : une route principale ouest → est à travers les villages, plus quelques embranchements.
  const vs = map.villages.filter((v) => v.name).sort((a, b) => a.col - b.col);
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
  for (const r of map.rivers) if (!r.stream) placeFords(map, r, rng, rng.int(1, 2));
  // Les routes défrichent la forêt.
  for (const t of map.tiles) if (t.road && t.terrain === 'forest' && rng.chance(0.6)) t.terrain = 'plain';

  if (opts.objective) {
    const center = { col: (W - 1) / 2, row: (H - 1) / 2 };
    const named = map.villages.filter((v) => v.name);
    const cands = named.length ? named : map.tiles.filter((t) => t.elev >= 2);
    cands.sort((a, b) => Math.abs(a.col - center.col) + Math.abs(a.row - center.row) * 0.5 - (Math.abs(b.col - center.col) + Math.abs(b.row - center.row) * 0.5));
    const o = cands[0] ?? tileAt(map, Math.floor(W / 2), Math.floor(H / 2));
    map.objective = { col: o.col, row: o.row };
  }
  const main = map.objective ? tileAt(map, map.objective.col, map.objective.row) : map.villages[0];
  map.name = main?.name ? `Secteur de ${main.name}` : `Cote ${100 + rng.int(10, 290)}`;
  for (const t of map.tiles) { delete t.h; delete t.m; }
  return map;
}

// ---------- Micro-grille (mode Frontline stratégique) ----------
// Des cases beaucoup plus petites et nombreuses (96 × 64 par défaut) simulent un espace continu : les cases ne portent
// plus d'unités mais une densité de troupes. Tableaux plats indexés i = row * W + col.
// Relief : 0 bas-fond, 1 plaine, 2 collines, 3 hauteurs ; quelques massifs de montagne infranchissables font goulets.

// Biomes de la micro-grille : mêmes noms que le mode tactique, réglages adaptés à la grande carte.
// river : 'none' | 'meander' (rivière sinueuse, nord-sud ou est-ouest) | 'big' (fleuve nord-sud côté défenseur) ;
// riverOdds : probabilité d'une rivière ; passes : cols percés dans les chaînes de montagnes ; roads : liaisons.
export const FRONT_BIOMES = {
  steppe: { label: 'Steppe ouverte', text: 'Peu de couvert, de longues vues : le terrain des chars.', forestQ: 0.93, marshQ: 0.9, marshElev: 0, mountains: 0.02, towns: [5, 7], river: 'meander', riverOdds: 0.5 },
  bocage: { label: 'Forêts et bocages', text: 'Bois nombreux : les chars y perdent leur élan, l\'infanterie s\'y accroche.', forestQ: 0.62, marshQ: 0.86, marshElev: 0, mountains: 0.03, towns: [5, 7], river: 'meander', riverOdds: 0.5 },
  polesie: { label: 'Marais de Polésie', text: 'Marais et rivières : les routes et les ponts décident de tout.', forestQ: 0.74, marshQ: 0.64, marshElev: 1, mountains: 0.008, towns: [4, 6], river: 'meander', riverOdds: 0.85 },
  bourg: { label: 'Grande ville', text: 'Une grande ville au centre, nœud de routes : combats de rue.', forestQ: 0.8, marshQ: 0.86, marshElev: 0, mountains: 0.03, towns: [4, 6], city: true, river: 'meander', riverOdds: 0.5 },
  montagne: { label: 'Montagnes (Carpates)', text: 'Chaînes infranchissables percées de quelques cols : les percées s\'y canalisent.', forestQ: 0.6, marshQ: 0.92, marshElev: 0, mountains: 0.13, passes: 4, towns: [4, 6], river: 'meander', riverOdds: 0.4 },
  foret: { label: 'Grande forêt (Briansk)', text: 'Forêt profonde et rares routes : un combat d\'infanterie.', forestQ: 0.38, marshQ: 0.88, marshElev: 0, mountains: 0.01, towns: [4, 6], river: 'meander', riverOdds: 0.6 },
  fleuve: { label: 'Grand fleuve (Dniepr)', text: 'Un fleuve barre le secteur, quelques ponts seulement : têtes de pont et défense de rive.', forestQ: 0.86, marshQ: 0.86, marshElev: 0, mountains: 0.01, towns: [5, 7], river: 'big', riverOdds: 1 },
};

// Rivière : chemin continu de case en case, d'un bord à l'opposé, guidé par le relief (elle cherche les creux) et un
// bruit de méandres. vertical : du nord au sud. x0 : position de départ (colonne, ou ligne si est-ouest).
function carveFrontRiver(map, hs, rng, { vertical = true, x0, width = 1, avoid, pull = 0.06 }) {
  const { W, H, nb } = map;
  const wig = makeNoise(rng);
  const cells = [];
  const line = []; // tracé lissé pour le dessin : [ligne, colonne] (réels) à chaque pas
  const along = vertical ? H : W, across = vertical ? W : H;
  let pos = x0;
  const at = (a, b) => (vertical ? a * W + b : b * W + a);
  for (let a = 0; a < along; a++) {
    // Méandre : dérive douce, rappelée vers les creux voisins.
    const drift = (wig(a * 0.08, 0.3, 2) - 0.5) * 2.2;
    let best = pos, bv = Infinity;
    for (const d of [-1, 0, 1]) {
      const b = Math.max(2, Math.min(across - 3, Math.round(pos + d)));
      const i = at(a, b);
      const v = hs[i] * 6 - drift * d + (avoid?.(i) ? 50 : 0) + Math.abs(b - x0) * pull;
      if (v < bv) { bv = v; best = b; }
    }
    const prev = Math.round(pos);
    pos = best + (drift - Math.round(drift)) * 0.3;
    const b1 = Math.round(pos);
    // Cases de la ligne a, entre l'ancienne et la nouvelle position : la rivière reste continue.
    for (let b = Math.min(prev, b1); b <= Math.max(prev, b1); b++) for (let k = 0; k < width; k++) cells.push(at(a, Math.min(across - 1, b + k)));
    line.push(vertical ? [a, pos + (width - 1) / 2] : [pos + (width - 1) / 2, a]);
  }
  // Raccord des lignes successives (le décalage des lignes impaires de la grille hexagonale peut laisser un trou).
  const set = new Set(cells);
  for (const i of [...set]) {
    let linked = false;
    for (let d = 0; d < 6; d++) { const j = nb[i * 6 + d]; if (j >= 0 && set.has(j)) { linked = true; break; } }
    if (!linked) { const j = nb[i * 6 + (vertical ? 5 : 0)]; if (j >= 0) set.add(j); }
  }
  return { cells: [...set], line };
}

// Chemin de coût minimal (Dijkstra simple sur la grille) : routes et cols.
function cheapestPath(map, from, isGoal, cost) {
  const { N, nb } = map;
  const dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  dist[from] = 0;
  const heap = [[0, from]];
  while (heap.length) {
    let m = 0;
    for (let k = 1; k < heap.length; k++) if (heap[k][0] < heap[m][0]) m = k;
    const [dv, i] = heap[m];
    heap[m] = heap[heap.length - 1];
    heap.pop();
    if (done[i]) continue;
    done[i] = 1;
    if (isGoal(i)) {
      const path = [];
      for (let c = i; c >= 0; c = prev[c]) path.push(c);
      return path.reverse();
    }
    for (let d = 0; d < 6; d++) {
      const j = nb[i * 6 + d];
      if (j < 0 || done[j]) continue;
      const c = cost(i, j);
      if (!Number.isFinite(c)) continue;
      if (dv + c < dist[j]) { dist[j] = dv + c; prev[j] = i; heap.push([dist[j], j]); }
    }
  }
  return null;
}

export function generateFrontMap(seed, opts = {}) {
  const W = opts.width ?? 96;
  const H = opts.height ?? 64;
  const N = W * H;
  const rng = createRng(`front:${seed}`);
  const B = { forestQ: 0.76, marshQ: 0.84, marshElev: 0, mountains: 0.035, towns: [5, 7], ...(FRONT_BIOMES[opts.biome] ?? {}) };
  const heightNoise = makeNoise(rng), moistNoise = makeNoise(rng), ridgeNoise = makeNoise(rng);
  const hs = new Float32Array(N), ms = new Float32Array(N), rs = new Float32Array(N);
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const i = row * W + col, x = col + 0.5 * (row & 1), y = row * 0.866;
      hs[i] = heightNoise(x * 0.045 + 3.1, y * 0.045 + 7.7, 5);
      ms[i] = moistNoise(x * 0.07 + 11.3, y * 0.07 + 1.9, 4);
      // Crêtes : bruit replié (|2n - 1|) pour des massifs allongés plutôt que des taches rondes.
      rs[i] = 1 - Math.abs(2 * ridgeNoise(x * 0.05 + 5.5, y * 0.05 + 2.2, 3) - 1);
    }
  }
  const [q1, q2, q3] = [quantile(hs, 0.25), quantile(hs, 0.7), quantile(hs, 0.9)];
  const forestQ = quantile(ms, B.forestQ), marshQ = quantile(ms, B.marshQ);
  const elev = new Uint8Array(N), kind = new Uint8Array(N);
  const K = (name) => FRONT_KINDS.indexOf(name);
  for (let i = 0; i < N; i++) {
    elev[i] = hs[i] < q1 ? 0 : hs[i] < q2 ? 1 : hs[i] < q3 ? 2 : 3;
    if (elev[i] <= B.marshElev && ms[i] > marshQ) kind[i] = K('marsh');
    else if (ms[i] > forestQ && elev[i] >= 1) kind[i] = K('forest');
  }
  const nb = neighborTable(W, H);
  // Relief continu pour le rendu : l'altitude de bruit, ramenée à l'échelle des niveaux (k + 0,5 aux seuils),
  // si bien que le relief dessiné reste cohérent avec les niveaux du jeu.
  const relief = new Float32Array(N);
  const lo = quantile(hs, 0), hi = quantile(hs, 0.999);
  const knots = [[lo, -0.3], [q1, 0.5], [q2, 1.5], [q3, 2.5], [hi, 3.4]];
  for (let i = 0; i < N; i++) {
    const v = hs[i];
    let k = 0;
    while (k < knots.length - 2 && v > knots[k + 1][0]) k++;
    const [x0, y0] = knots[k], [x1, y1] = knots[k + 1];
    relief[i] = y0 + ((v - x0) / Math.max(1e-6, x1 - x0)) * (y1 - y0);
  }
  const map = { seed, W, H, N, nb, elev, kind, relief, flow: null, def: null, towns: [], biome: opts.biome ?? null, name: '' };

  // Montagnes : sommets des hauteurs qui sont aussi sur une crête, jamais sur les bords ouest et est
  // (chaque camp doit pouvoir se ravitailler) ; on vérifie qu'un passage ouest → est subsiste.
  const mountainShare = opts.mountains ?? B.mountains;
  const score = new Float32Array(N);
  // Biome de montagne : les crêtes (bruit replié) dessinent des chaînes allongées, percées ensuite de cols.
  for (let i = 0; i < N; i++) score[i] = B.passes ? (elev[i] >= 1 ? rs[i] + hs[i] * 0.3 : -1) : elev[i] >= 2 ? hs[i] + rs[i] * 0.08 : -1;
  for (let share = mountainShare; share > 0.004; share *= 0.6) {
    const cut = quantile(score, 1 - share);
    for (let i = 0; i < N; i++) {
      const col = i % W;
      if (kind[i] === MOUNTAIN) kind[i] = 0;
      if (score[i] >= cut && score[i] > 0 && col > 4 && col < W - 5) kind[i] = MOUNTAIN;
    }
    // Montagnes : des cols percent les chaînes (chemin le moins coûteux d'ouest en est, élargi d'une case).
    if (B.passes) {
      map.passes = [];
      for (let k = 0; k < B.passes; k++) {
        const r0 = Math.round(((k + 0.5) / B.passes) * H + (rng.next() - 0.5) * 4);
        const start = Math.max(0, Math.min(H - 1, r0)) * W;
        const path = cheapestPath(map, start, (i) => i % W === W - 1, (i, j) => (kind[j] === MOUNTAIN ? 25 : 1) + Math.abs(Math.floor(j / W) - r0) * 0.15);
        if (!path) continue;
        for (const i of path) {
          if (kind[i] !== MOUNTAIN) continue;
          kind[i] = 0;
          elev[i] = Math.min(elev[i], 2);
          map.passes.push(i);
          for (let d = 0; d < 6; d++) { const j = nb[i * 6 + d]; if (j >= 0 && kind[j] === MOUNTAIN && rng.chance(0.5)) { kind[j] = 0; elev[j] = Math.min(elev[j], 2); } }
        }
      }
    }
    if (crossable(map)) break;
  }

  // Rivières (avant les villes, qui s'installent sur une rive, pas dedans).
  map.river = new Uint8Array(N);
  map.bigRiver = new Uint8Array(N);
  map.bridge = new Uint8Array(N);
  map.road = new Uint8Array(N);
  map.rivers = [];
  map.roads = [];
  const wantRiver = opts.river ?? (B.river && B.river !== 'none' && rng.chance(B.riverOdds ?? 0.5) ? B.river : 'none');
  if (wantRiver === 'big') {
    // Fleuve nord-sud, côté du défenseur, à quelques colonnes de la ligne de départ (vers W/2).
    const side = opts.defender === 0 ? -1 : 1;
    const { cells, line } = carveFrontRiver(map, hs, rng, { vertical: true, x0: W / 2 + side * (12 + rng.int(0, 3)), width: 2, avoid: (i) => kind[i] === MOUNTAIN, pull: 0.5 });
    for (const i of cells) if (kind[i] !== MOUNTAIN) { map.river[i] = 1; map.bigRiver[i] = 1; }
    map.rivers.push({ cells, line, big: true });
  } else if (wantRiver === 'meander') {
    const vertical = rng.chance(0.55);
    const x0 = vertical ? rng.int(Math.round(W * 0.2), Math.round(W * 0.8)) : rng.int(Math.round(H * 0.25), Math.round(H * 0.75));
    const { cells, line } = carveFrontRiver(map, hs, rng, { vertical, x0, avoid: (i) => kind[i] === MOUNTAIN });
    for (const i of cells) if (kind[i] !== MOUNTAIN) map.river[i] = 1;
    map.rivers.push({ cells, line, big: false });
  }
  for (const i of map.river.keys()) if (map.river[i] && kind[i] === K('marsh')) kind[i] = 0;

  // Villes : nœuds à tenir, espacées, hors marais et montagnes, plutôt réparties d'ouest en est.
  const usedNames = new Set();
  // Bourg : une grande ville au centre (la case et deux couronnes, 19 cases), le nœud de la bataille.
  if (B.city) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      if (kind[i] === MOUNTAIN || elev[i] >= 3) continue;
      const col = i % W, row = Math.floor(i / W);
      const d = Math.hypot(col - W / 2, (row - H / 2) * 1.2) + elev[i] * 2 + (kind[i] === K('marsh') ? 5 : 0);
      if (d < bd) { bd = d; best = i; }
    }
    const ring1 = [0, 1, 2, 3, 4, 5].map((d) => nb[best * 6 + d]).filter((j) => j >= 0);
    const area = new Set([best, ...ring1, ...ring1.flatMap((j) => [0, 1, 2, 3, 4, 5].map((d) => nb[j * 6 + d]))]);
    for (const j of area) if (j >= 0 && kind[j] !== MOUNTAIN) kind[j] = TOWN;
    map.towns.push({ i: best, col: best % W, row: Math.floor(best / W), name: placeName(rng, usedNames), city: true });
  }
  const nTowns = rng.int(...B.towns);
  for (let t = 0; t < nTowns; t++) {
    let best = -1, bestScore = -Infinity;
    for (let k = 0; k < 80; k++) {
      const i = rng.int(0, N - 1), col = i % W, row = Math.floor(i / W);
      if (kind[i] === MOUNTAIN || kind[i] === K('marsh') || elev[i] >= 3 || map.river[i]) continue;
      if ([0, 1, 2, 3, 4, 5].some((d) => nb[i * 6 + d] >= 0 && map.river[nb[i * 6 + d]])) continue;
      if (col < 8 || col > W - 9 || row < 4 || row > H - 5) continue;
      const far = Math.min(Infinity, ...map.towns.map((o) => hexDistance({ col, row }, o)));
      if (far < 14) continue;
      const s = Math.min(far, 30) * 0.1 - elev[i] * 0.3 + rng.next() * 1.5;
      if (s > bestScore) { bestScore = s; best = i; }
    }
    if (best < 0) continue;
    const col = best % W, row = Math.floor(best / W);
    // Une ville couvre la case et ses voisines : elle se lit sur la carte et offre un vrai point d'appui.
    kind[best] = TOWN;
    for (let d = 0; d < 6; d++) { const j = nb[best * 6 + d]; if (j >= 0 && kind[j] !== MOUNTAIN && !map.river[j]) kind[j] = TOWN; }
    map.towns.push({ i: best, col, row, name: placeName(rng, usedNames) });
  }
  map.towns.sort((a, b) => a.col - b.col);
  if (B.city) for (let i = 0; i < N; i++) if (kind[i] === TOWN && map.river[i]) map.bridge[i] = 1; // la ville enjambe la rivière

  // Routes : chaque ville reliée à ses deux voisines les plus proches, et les villes extrêmes aux bords ouest et est.
  // Elles évitent marais, forêts et montées ; là où elles franchissent une rivière, un pont.
  const roadCost = (i, j) => {
    if (kind[j] === MOUNTAIN) return Infinity;
    let c = kind[j] === K('marsh') ? 5 : kind[j] === K('forest') ? 2.2 : 1;
    c += Math.max(0, elev[j] - elev[i]) * 1.5;
    if (map.river[j] && !map.river[i]) c += 10;
    if (map.road[j]) c *= 0.4; // réutiliser une route existante
    return c;
  };
  const link = (from, isGoal) => {
    const path = cheapestPath(map, from, isGoal, roadCost);
    if (!path) return;
    for (const i of path) { map.road[i] = 1; if (map.river[i]) map.bridge[i] = 1; }
    map.roads.push(path);
  };
  const T = map.towns;
  const linked = new Set();
  for (const t of T) {
    const others = T.filter((o) => o !== t).sort((a, b) => hexDistance(a, t) - hexDistance(b, t)).slice(0, 2);
    for (const o of others) {
      const key = [t.i, o.i].sort().join('-');
      if (linked.has(key)) continue;
      linked.add(key);
      link(t.i, (i) => i === o.i);
    }
  }
  if (T.length) {
    link(T[0].i, (i) => i % W === 0);
    link(T[T.length - 1].i, (i) => i % W === W - 1);
  }
  // Gués : un ou deux passages lents par rivière, loin des ponts.
  for (const r of map.rivers) {
    const cands = rng.shuffle(r.cells.filter((i) => map.river[i] && !map.bridge[i] && !map.bigRiver[i]));
    let n = rng.int(1, 2);
    for (const i of cands) {
      if (!n) break;
      if (r.cells.some((j) => map.bridge[j] && Math.abs((j % W) - (i % W)) + Math.abs(Math.floor(j / W) - Math.floor(i / W)) < 8)) continue;
      map.river[i] = 2;
      n--;
    }
  }
  computeTerrain(map);
  const mid = map.towns.reduce((b, t) => (Math.abs(t.col - W / 2) < Math.abs((b?.col ?? -1e9) - W / 2) ? t : b), null);
  map.name = mid ? `Front de ${mid.name}` : `Secteur ${100 + rng.int(10, 290)}`;
  return map;
}

// Un passage praticable relie-t-il le bord ouest au bord est ? (garantie contre les chaînes de montagnes continues)
function crossable(map) {
  const { W, N, nb, kind } = map;
  const seen = new Uint8Array(N);
  const stack = [];
  for (let i = 0; i < N; i += W) if (kind[i] !== MOUNTAIN) { seen[i] = 1; stack.push(i); }
  let reached = 0;
  while (stack.length) {
    const i = stack.pop();
    if (i % W === W - 1) reached++;
    for (let d = 0; d < 6; d++) {
      const j = nb[i * 6 + d];
      if (j >= 0 && !seen[j] && kind[j] !== MOUNTAIN) { seen[j] = 1; stack.push(j); }
    }
  }
  // Exige aussi qu'aucune grande poche de terrain ne soit isolée par les montagnes.
  let open = 0, linked = 0;
  for (let i = 0; i < N; i++) if (kind[i] !== MOUNTAIN) { open++; if (seen[i]) linked++; }
  return reached > 0 && linked >= open * 0.995;
}

export { TERRAIN };
