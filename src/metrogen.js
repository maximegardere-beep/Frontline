// Métropole : une grande ville allongée le long d'un fleuve, côté défenseur (type Stalingrad), découpée en
// quartiers. Appelé par generateFrontMap (mapgen.js) une fois le fleuve creusé, à la place des villes et des routes.
// Repère de la ville : u, la profondeur depuis la rive (en colonnes, 1 au bord de l'eau, vers l'attaquant) ; v, la ligne.

import { placeName } from './names.js';
import { TOWN } from './terrain.js';

// Types de quartiers. value : points de victoire (étape 3) ; w : étendue relative dans le pavage.
export const DISTRICT_TYPES = {
  centre: { label: 'Vieille ville', value: 3, w: 1.1 },
  usine: { label: 'Usines', value: 2, w: 1.3 },
  ouvrier: { label: 'Cité ouvrière', value: 1, w: 1 },
  gare: { label: 'Gare et triage', value: 2, w: 0.85 },
  hauteur: { label: 'Hauteur', value: 2, w: 0.8 },
  parc: { label: 'Parc', value: 1, w: 0.6 },
  quai: { label: 'Quais', value: 3, w: 1 },
};

export const METRO = {
  suburbs: 8, // profondeur des faubourgs tenus par l'attaquant au départ (colonnes)
  taper: 8, // lignes aux extrémités nord et sud où la ville s'amincit
  spacing: 10, // écart minimal entre deux germes de quartier (cités ouvrières, parc)
  quayDepth: 3, // bande des quais (profondeur depuis la rive)
  minCells: 12, // quartier plus petit : fondu dans un voisin (quais : la moitié)
};

const FACTORY_NAMES = ['Usine de tracteurs', 'Usine d\'artillerie', 'Aciéries', 'Usine chimique'];
const PARK_NAMES = ['Parc central', 'Jardin public', 'Cimetière'];

export function buildMetropole(map, { rng, hs, B, defender = 1, cheapestPath, makeNoise, usedNames }) {
  const { W, H, N, nb, kind, elev } = map;
  const dir = defender === 0 ? -1 : 1; // fleuve à l'est (1) ou à l'ouest (-1) : du côté du défenseur
  const xOf = (i) => (i % W) + 0.5 * (Math.floor(i / W) & 1);
  const rowOf = (i) => Math.floor(i / W);
  const nbs = (i) => { const out = []; for (let d = 0; d < 6; d++) { const j = nb[i * 6 + d]; if (j >= 0) out.push(j); } return out; };

  // Rive côté attaquant, ligne par ligne.
  const bank = new Float32Array(H).fill(NaN);
  for (let i = 0; i < N; i++) {
    if (!map.river[i]) continue;
    const r = rowOf(i), x = xOf(i);
    if (Number.isNaN(bank[r]) || (dir > 0 ? x < bank[r] : x > bank[r])) bank[r] = x;
  }
  for (let r = 0; r < H; r++) if (Number.isNaN(bank[r])) bank[r] = r > 0 ? bank[r - 1] : W / 2 + dir * 30;
  const uOf = (i) => (bank[rowOf(i)] - xOf(i)) * dir;
  const cellAt = (u, v) => {
    const row = Math.max(0, Math.min(H - 1, Math.round(v)));
    const x = bank[row] - dir * u - 0.5 * (row & 1);
    return row * W + Math.max(0, Math.min(W - 1, Math.round(x)));
  };

  // Emprise : de la rive jusqu'à une profondeur qui ondule, amincie aux extrémités.
  const D = rng.int(...B.cityDepth);
  const edgeNoise = makeNoise(rng), warp = makeNoise(rng);
  const depth = new Float32Array(H);
  for (let r = 0; r < H; r++) {
    const end = Math.min(r, H - 1 - r);
    depth[r] = (D + (edgeNoise(r * 0.15, 1.7, 2) - 0.5) * 8) * (end < METRO.taper ? 0.75 + (0.25 * end) / METRO.taper : 1);
  }
  const city = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const u = uOf(i); if (!map.river[i] && u >= 0.5 && u <= depth[rowOf(i)]) city[i] = 1; }
  // Ligne de départ (front.js) : l'attaquant tient la frange des faubourgs. Elle suit le bord de la ville sans
  // l'amincissement des extrémités, qui laisse un peu de steppe devant la ville au nord et au sud.
  map.startLine = new Float32Array(H);
  for (let r = 0; r < H; r++) {
    const u = D + (edgeNoise(r * 0.15, 1.7, 2) - 0.5) * 8 - METRO.suburbs;
    map.startLine[r] = bank[r] - dir * u;
  }

  // Germes des quartiers, dans le repère (u, v).
  const seeds = [];
  const add = (type, u, v) => { const s = { type, u, v: Math.max(1, Math.min(H - 2, v)) }; seeds.push(s); return s; };
  const north = rng.chance(0.5); // usines au nord ou au sud, la vieille ville vers l'autre bout
  const vAt = (f) => (north ? f : 1 - f) * (H - 1);
  add('usine', 6, vAt(0.2));
  add('usine', 6, vAt(0.38));
  const centre = add('centre', 7, vAt(0.62 + rng.next() * 0.08));
  const gare = add('gare', 16, centre.v + (rng.chance(0.5) ? 1 : -1) * rng.int(4, 7));
  // Hauteur : le point le plus haut entre les usines et le centre, à mi-profondeur.
  {
    const [v0, v1] = [vAt(0.44), vAt(0.56)].sort((a, b) => a - b);
    let best = null, bv = -Infinity;
    for (let i = 0; i < N; i++) {
      const u = uOf(i), v = rowOf(i);
      if (!city[i] || u < 9 || u > 20 || v < v0 || v > v1) continue;
      if (hs[i] > bv) { bv = hs[i]; best = { u, v }; }
    }
    add('hauteur', best?.u ?? 14, best?.v ?? (v0 + v1) / 2);
  }
  const far = (u, v) => Math.min(...seeds.map((s) => Math.hypot(s.u - u, s.v - v)));
  for (let k = 0; k < 40; k++) {
    const u = 11 + rng.next() * Math.max(1, D - 22), v = 4 + rng.next() * (H - 9);
    if (far(u, v) >= METRO.spacing * 0.75) { add('parc', u, v); break; }
  }
  // Cités ouvrières et faubourgs : ils comblent les vides, germes posés d'une grille brouillée, dans un ordre tiré au
  // sort, à bonne distance des autres.
  const spots = [];
  for (let u = 4; u <= D; u += 6) for (let v = 3; v <= H - 4; v += 6) spots.push([u + rng.next() * 3, v + rng.next() * 3]);
  for (const [u, v] of rng.shuffle(spots)) if (city[cellAt(u, v)] && far(u, v) >= METRO.spacing) add('ouvrier', u, v);
  // Pavage : germe le plus proche, distance pondérée par le type et brouillée pour des limites irrégulières.
  const district = new Int16Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    if (!city[i]) continue;
    const u = uOf(i), v = rowOf(i);
    let best = -1, bd = Infinity;
    for (let s = 0; s < seeds.length; s++) {
      const S = seeds[s];
      const d = Math.hypot(S.u - u, (S.v - v) * 0.9) / DISTRICT_TYPES[S.type].w + (warp(u * 0.2, v * 0.2, 2) - 0.5) * 5;
      if (d < bd) { bd = d; best = s; }
    }
    district[i] = best;
  }
  // Quais : la bande au bord de l'eau, hors des usines (elles ont leurs propres berges), en trois tronçons.
  const quays = [null, null, null];
  for (let i = 0; i < N; i++) {
    if (district[i] < 0 || uOf(i) > METRO.quayDepth || seeds[district[i]].type === 'usine') continue;
    const k = Math.min(2, Math.floor((rowOf(i) / H) * 3));
    if (!quays[k]) { quays[k] = seeds.length; seeds.push({ type: 'quai', u: 1, v: (k + 0.5) * (H / 3), part: k }); }
    district[i] = quays[k];
  }
  tidyDistricts(map, district, seeds, nbs);

  // Quartiers : liste compacte, cases, centre (la case la plus proche du barycentre), nom.
  const used = seeds.map(() => -1);
  map.districts = [];
  const cellsOf = new Map();
  for (let i = 0; i < N; i++) if (district[i] >= 0) { if (!cellsOf.has(district[i])) cellsOf.set(district[i], []); cellsOf.get(district[i]).push(i); }
  const order = [...cellsOf.keys()].sort((a, b) => cellsOf.get(a)[0] - cellsOf.get(b)[0]);
  const factories = rng.shuffle(FACTORY_NAMES.slice()), parks = rng.shuffle(PARK_NAMES.slice());
  const quayName = ['nord', 'du centre', 'sud'];
  for (const s of order) {
    const cells = cellsOf.get(s), S = seeds[s], id = map.districts.length;
    used[s] = id;
    const mx = cells.reduce((a, i) => a + xOf(i), 0) / cells.length, my = cells.reduce((a, i) => a + rowOf(i), 0) / cells.length;
    const center = cells.reduce((b, i) => (Math.hypot(xOf(i) - mx, rowOf(i) - my) < Math.hypot(xOf(b) - mx, rowOf(b) - my) ? i : b));
    const name = S.type === 'usine' ? factories.pop()
      : S.type === 'centre' ? 'Vieille ville'
      : S.type === 'gare' ? 'Gare centrale'
      : S.type === 'hauteur' ? `Hauteur ${rng.int(98, 137)}`
      : S.type === 'parc' ? parks.pop()
      : S.type === 'quai' ? `Quais ${quayName[S.part]}`
      : `${uOf(center) > D * 0.6 ? 'Faubourg' : 'Cité'} ${placeName(rng, usedNames)}`;
    map.districts.push({ id, type: S.type, name, value: DISTRICT_TYPES[S.type].value, center, cells });
  }
  map.district = new Int16Array(N).fill(-1);
  for (let i = 0; i < N; i++) if (district[i] >= 0) map.district[i] = used[district[i]];

  // Terrain : toute l'emprise devient ville, à plat, sauf la hauteur (son sommet au niveau 3).
  const hill = map.districts.find((d) => d.type === 'hauteur');
  for (let i = 0; i < N; i++) {
    if (map.district[i] < 0) continue;
    kind[i] = TOWN;
    elev[i] = Math.min(elev[i], 1);
    map.relief[i] = Math.min(map.relief[i], 1.4);
  }
  if (hill) {
    const top = new Set([hill.center, ...nbs(hill.center)]);
    for (const i of hill.cells) { elev[i] = top.has(i) ? 3 : 2; map.relief[i] = top.has(i) ? 3.1 : 2.2; }
  }

  // Avenues radiales : du bord de carte de l'attaquant jusqu'à la rive, en éventail vers le centre (fan : écart des
  // lignes au bord de la ville, par ligne d'écart au centre à la rive).
  map.avenue = new Uint8Array(N);
  map.avenues = [];
  map.rail = new Uint8Array(N);
  map.rails = [];
  const edgeCol = dir > 0 ? 0 : W - 1;
  const ahead = (i) => !map.river[i] && uOf(i) >= 0.5; // rive de la ville et steppe de l'attaquant
  const straight = (target, wiggle) => (i, j) => (ahead(j) ? 1 + Math.abs(target(j)) * wiggle + Math.max(0, elev[j] - elev[i]) * 0.8 : Infinity);
  const rows = [vAt(0.2), vAt(0.45), centre.v, vAt(0.86)].map(Math.round).sort((a, b) => a - b);
  const radial = [];
  for (const v of rows) {
    if (radial.some((a) => Math.abs(a.v - v) < 7)) continue;
    const fan = 0.35, vEdge = Math.max(1, Math.min(H - 2, Math.round(v + (v - centre.v) * fan)));
    const lane = (j) => rowOf(j) - (v + (vEdge - v) * Math.min(1, uOf(j) / D));
    const path = cheapestPath(map, vEdge * W + edgeCol, (i) => city[i] && uOf(i) <= 1.5 && Math.abs(rowOf(i) - v) <= 2, straight(lane, 0.6));
    if (!path) continue;
    for (const i of path) { map.road[i] = 1; map.avenue[i] = 1; }
    map.roads.push(path);
    map.avenues.push(path);
    radial.push({ v, path });
  }
  // Boulevard en arc à mi-profondeur et route des quais, du nord au sud.
  for (const uB of [Math.round(D * 0.45), METRO.quayDepth + 0.5]) {
    const from = cellAt(uB, 0);
    const path = cheapestPath(map, from, (i) => rowOf(i) === H - 1, straight((j) => uOf(j) - uB, 0.9));
    if (!path) continue;
    for (const i of path) { map.road[i] = 1; map.avenue[i] = 1; }
    map.roads.push(path);
    map.avenues.push(path);
  }
  // Ponts : les trois avenues les plus proches du centre franchissent le fleuve, puis filent au bord du défenseur.
  const farCol = dir > 0 ? W - 1 : 0;
  for (const a of radial.slice().sort((p, q) => Math.abs(p.v - centre.v) - Math.abs(q.v - centre.v)).slice(0, 3)) {
    const end = a.path[a.path.length - 1], r0 = rowOf(end);
    const cross = cheapestPath(map, end, (i) => !map.river[i] && uOf(i) < 0, (i, j) => (map.river[j] ? 1 + Math.abs(rowOf(j) - r0) * 3 : uOf(j) < 0 ? 1 : Infinity));
    if (!cross) continue;
    const landing = cross[cross.length - 1];
    const out = cheapestPath(map, landing, (i) => i % W === farCol, (i, j) => (map.river[j] || uOf(j) > 0 ? Infinity : 1 + Math.abs(rowOf(j) - r0) * 0.6));
    const route = [...cross, ...(out ? out.slice(1) : [])];
    for (const i of route) { map.road[i] = 1; if (map.river[i]) map.bridge[i] = 1; }
    map.roads.push(route);
  }
  // Voie ferrée : du bord de l'attaquant à la gare, puis le long de la ville jusqu'aux usines.
  {
    const g = cellAt(gare.u, gare.v), vg = rowOf(g);
    const inbound = cheapestPath(map, vg * W + edgeCol, (i) => i === g, straight((j) => rowOf(j) - vg, 0.4));
    const uR = Math.min(11, gare.u - 4), vEnd = Math.round(vAt(0.06));
    const along = cheapestPath(map, g, (i) => rowOf(i) === vEnd, straight((j) => uOf(j) - uR, 0.9));
    const line = [...(inbound ?? []), ...(along ? along.slice(1) : [])];
    for (const i of line) map.rail[i] = 1;
    if (line.length) map.rails.push(line);
  }

  // Villes du front : une par quartier, à son centre (objectifs ★ en attendant les points de quartiers).
  for (const d of map.districts) map.towns.push({ i: d.center, col: d.center % W, row: rowOf(d.center), name: d.name, district: d.id, city: d.type === 'centre' });
  // Un ou deux villages dans la steppe de l'attaquant, sur une avenue.
  for (const a of rng.shuffle(radial.slice()).slice(0, rng.int(...B.towns))) {
    const i = a.path.find((c) => uOf(c) >= D + 10 && uOf(c) <= D + 18);
    if (i == null || map.towns.some((t) => Math.hypot(xOf(t.i) - xOf(i), rowOf(t.i) - rowOf(i)) < 8)) continue;
    kind[i] = TOWN;
    for (const j of nbs(i)) if (!map.river[j]) kind[j] = TOWN;
    map.towns.push({ i, col: i % W, row: rowOf(i), name: placeName(rng, usedNames) });
  }
  map.towns.sort((a, b) => a.col - b.col);
  map.cityName = placeName(rng, usedNames).replace(/(ovka|ivka|anka|enka|aya)$/, '') + 'grad';

  // Accostages des bacs de nuit (frontmetro.js) : les cases des quais et des usines au bord de l'eau.
  map.landing = new Uint8Array(N);
  for (const d of map.districts) {
    if (d.type !== 'quai' && d.type !== 'usine') continue;
    for (const i of d.cells) if (nbs(i).some((j) => map.river[j])) map.landing[i] = 1;
  }
  // Rive gauche : la terre ferme au-delà du fleuve, côté défenseur (ses batteries, frontguns.js et frontai.js).
  map.farBank = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (!map.river[i] && uOf(i) < 0) map.farBank[i] = 1;
  // Maisons-forteresses : un îlot remarquable par type voulu, côté défenseur (stronghold : 2 l'îlot, 1 ses abords).
  map.stronghold = new Uint8Array(N);
  map.strongholds = [];
  const towns = new Set(map.towns.map((t) => t.i));
  for (const F of FORTRESSES) {
    const cands = map.districts.filter((d) => F.types.includes(d.type)).flatMap((d) => d.cells).filter((i) => {
      const u = uOf(i);
      return u >= F.u[0] && u <= F.u[1] && !map.avenue[i] && !towns.has(i) && !map.stronghold[i] && (!F.corner || nbs(i).some((j) => map.avenue[j])) && (!F.top || elev[i] === 3);
    });
    if (!cands.length) continue;
    const i = cands[rng.int(0, cands.length - 1)];
    map.strongholds.push({ i, name: F.name, district: map.district[i] });
    map.stronghold[i] = 2;
    for (const j of nbs(i)) if (map.district[j] >= 0 && !map.stronghold[j]) map.stronghold[j] = 1;
  }
  return map;
}

// Maisons-forteresses : nom, types de quartier, profondeur depuis la rive ; corner : à l'angle d'une avenue ; top :
// au sommet de la hauteur.
const FORTRESSES = [
  { name: 'Silo à grain', types: ['quai', 'usine'], u: [1, 4] },
  { name: 'Grand magasin', types: ['centre'], u: [4, 11] },
  { name: 'Maison d\'angle', types: ['ouvrier', 'gare', 'centre'], u: [8, 13], corner: true },
  { name: 'Château d\'eau', types: ['hauteur'], u: [1, 30], top: true },
];

// Chaque quartier d'un seul tenant (les morceaux détachés rejoignent le voisin le plus présent), puis les trop petits
// fondus dans le voisin avec lequel ils partagent le plus de bord.
function tidyDistricts(map, district, seeds, nbs) {
  const { N } = map;
  const neighbourOf = (cells, own) => {
    const count = new Map();
    for (const i of cells) for (const j of nbs(i)) { const d = district[j]; if (d >= 0 && d !== own) count.set(d, (count.get(d) ?? 0) + 1); }
    let best = -1, bc = 0;
    for (const [d, c] of count) if (c > bc) { bc = c; best = d; }
    return best;
  };
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const comp = new Int32Array(N).fill(-1);
    const parts = [];
    for (let i = 0; i < N; i++) {
      if (district[i] < 0 || comp[i] >= 0) continue;
      const cells = [i], d = district[i];
      comp[i] = parts.length;
      for (let k = 0; k < cells.length; k++) for (const j of nbs(cells[k])) if (comp[j] < 0 && district[j] === d) { comp[j] = parts.length; cells.push(j); }
      parts.push({ d, cells });
    }
    const biggest = new Map();
    for (const p of parts) if (!biggest.has(p.d) || p.cells.length > biggest.get(p.d).cells.length) biggest.set(p.d, p);
    for (const p of parts) {
      const small = p.cells.length < (seeds[p.d].type === 'quai' ? METRO.minCells / 2 : METRO.minCells);
      if (biggest.get(p.d) === p && !small) continue;
      const to = neighbourOf(p.cells, p.d);
      if (to < 0) continue;
      for (const i of p.cells) district[i] = to;
      changed = true;
    }
    if (!changed) break;
  }
}
