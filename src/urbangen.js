// Ville tactique : une ville du front stratégique vue de près (hexagones d'environ 50 m), pour les batailles de rue.
// Même structure de carte que generateMap (mapgen.js), plus map.urban, map.blocks (les îlots qui comptent pour le
// résultat) et map.town (l'emprise bâtie).
//
// Plan : la grand-rue court d'ouest en est ; des rues transversales tous les quatre hexagones et des rues parallèles
// tous les trois rangs découpent des îlots. Au centre, des maisons en pierre ; une place au carrefour principal,
// l'église sur la place ; en périphérie, des isbas en bois et leurs jardins, qui s'égrènent aussi le long des routes
// d'accès. Une grande ville a deux couronnes d'îlots de plus et une usine. Une rivière éventuelle coupe la carte du
// nord au sud, avec un pont sur chaque rue qui la franchit.

import { createRng } from './rng.js';
import { makeNoise } from './mapgen.js';
import { tileAt, roadEdgeKey } from './terrain.js';
import { neighborCoords } from './hex.js';
import { placeName } from './names.js';

// hw, hh : demi-emprise de la ville (colonnes, rangs) ; core : part centrale bâtie en pierre.
export const URBAN_SIZES = {
  village: { label: 'Village', hw: 4, hh: 3, core: 0.35, cross: [0, -4, 4], rows: [] },
  town: { label: 'Ville', hw: 7, hh: 4, core: 0.55, cross: [0, -4, 4], rows: [-3, 3] },
  city: { label: 'Grande ville', hw: 9, hh: 6, core: 0.6, cross: [0, -4, 4, -8, 8], rows: [-3, 3, -6, 6], factory: true },
};

const DIRS = { 'nord-ouest': [-1, -1], nord: [0, -1], 'nord-est': [1, -1], ouest: [-1, 0], centre: [0, 0], est: [1, 0], 'sud-ouest': [-1, 1], sud: [0, 1], 'sud-est': [1, 1] };

// Quartiers de métropole (metrogen.js) : leur trame tactique. core : part centrale en pierre ; landmark : l'îlot fort
// au carrefour (à la place de l'église) ; halls : part du bâti en halles d'usine ; park : part en jardins et bosquets ;
// tracks : rues parallèles en plus (voies de la gare) ; hill : relief (château d'eau au sommet).
export const URBAN_STYLES = {
  centre: { core: 0.75, landmark: 'église' },
  usine: { core: 0.3, landmark: 'usine', halls: 0.6 },
  ouvrier: { core: 0.15, landmark: 'église' },
  gare: { core: 0.4, landmark: 'gare', tracks: [-2, 2] },
  hauteur: { core: 0.35, landmark: 'château d\'eau', hill: true },
  parc: { core: 0.1, landmark: 'kiosque', park: 0.75 },
  quai: { core: 0.5, landmark: 'entrepôt' },
};
const LANDMARK_BLOCK = { église: 'l\'église', usine: 'l\'usine', gare: 'la gare', 'château d\'eau': 'le château d\'eau', kiosque: 'le kiosque', entrepôt: 'l\'entrepôt' };

// opts : size ('village' | 'town' | 'city'), river (null | 'east' | 'west'), roads (entrées : 'W', 'E', 'N', 'S'),
// name, width, height ; style (quartier de métropole, URBAN_STYLES).
export function generateUrbanMap(seed, opts = {}) {
  const style = URBAN_STYLES[opts.style] ?? null;
  const size = { ...(URBAN_SIZES[opts.size] ?? URBAN_SIZES.town), ...(style ? { core: style.core } : {}) };
  const W = opts.width ?? Math.max(24, size.hw * 2 + 12);
  const H = opts.height ?? Math.max(15, size.hh * 2 + 7);
  const rng = createRng(`urban:${seed}`);
  const noise = makeNoise(rng);
  const map = { seed, W, H, biome: null, tiles: [], roadEdges: new Set(), roads: [], rivers: [], villages: [], objective: null, urban: true, blocks: [] };
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const n = noise(col * 0.25 + 3.3, row * 0.25 + 1.7);
      map.tiles.push({ col, row, elev: 1, terrain: n > 0.72 ? 'forest' : n > 0.45 ? 'farm' : 'plain', river: false, road: false, name: null });
    }
  }
  const at = (c, r) => tileAt(map, c, r);
  const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
  const c0 = cx - size.hw, c1 = cx + size.hw, r0 = cy - size.hh, r1 = cy + size.hh;
  map.town = { cx, cy, c0, c1, r0, r1, hw: size.hw, hh: size.hh, size: opts.size ?? 'town' };
  const inTown = (t) => t.col >= c0 && t.col <= c1 && t.row >= r0 && t.row <= r1;

  // Rues : une ligne d'hexagones ; chaque pas est une arête de route.
  const street = (pts) => {
    const path = pts.filter((h) => at(h.col, h.row));
    for (const h of path) { const t = at(h.col, h.row); t.terrain = 'street'; t.road = true; }
    for (let i = 1; i < path.length; i++) map.roadEdges.add(roadEdgeKey(map, path[i - 1], path[i]));
    if (path.length > 1) map.roads.push(path);
  };
  const roads = new Set(opts.roads ?? ['W', 'E']);
  const span = (a, b, f) => Array.from({ length: b - a + 1 }, (_, k) => f(a + k));
  // Grand-rue : d'un bord à l'autre (les routes d'accès ouest et est la prolongent).
  street(span(roads.has('W') ? 0 : c0, roads.has('E') ? W - 1 : c1, (c) => ({ col: c, row: cy })));
  for (const dc of size.cross) {
    const out = dc === 0; // la rue centrale devient la route du nord et du sud
    street(span(out && roads.has('N') ? 0 : r0, out && roads.has('S') ? H - 1 : r1, (r) => ({ col: cx + dc, row: r })));
  }
  for (const dr of size.rows) street(span(c0, c1, (c) => ({ col: c, row: cy + dr })));
  for (const dr of style?.tracks ?? []) street(span(0, W - 1, (c) => ({ col: c, row: cy + dr }))); // voies de la gare

  // Place du carrefour principal : les hexagones voisins deviennent un espace ouvert pavé.
  const plaza = neighborCoords(cx, cy).map((h) => at(h.col, h.row)).filter((t) => t && t.terrain !== 'street');
  plaza.slice(0, 3).forEach((t) => { t.terrain = 'street'; t.plaza = true; });

  // Bâti : maisons en pierre au centre, isbas et jardins autour.
  for (const t of map.tiles) {
    if (!inTown(t) || t.terrain === 'street') continue;
    const d = Math.max(Math.abs(t.col - cx) / size.hw, Math.abs(t.row - cy) / size.hh);
    if (d <= size.core) t.terrain = 'building';
    else t.terrain = rng.chance(0.72) ? 'isba' : 'garden';
    // Quartier de métropole : halles d'usine, parc.
    if (style?.halls && rng.chance(style.halls)) { t.terrain = 'strong'; t.label = 'usine'; }
    else if (style?.park && rng.chance(style.park)) t.terrain = rng.chance(0.6) ? 'garden' : 'forest';
    if (style?.hill) t.elev = d <= 0.4 ? 3 : 2;
  }
  // Église : sur la place, côté nord-est.
  const church = [at(cx + 1, cy - 1), at(cx, cy - 1), at(cx + 1, cy + 1)].find((t) => t && t.terrain !== 'street') ?? plaza.find(Boolean)
    ?? map.tiles.find((t) => inTown(t) && t.terrain !== 'street' && !t.river);
  church.terrain = 'strong';
  church.label = style?.landmark ?? 'église';
  map.objective = { col: church.col, row: church.row };
  // Usine (grande ville) : un îlot entier en périphérie, côté défenseur probable (est).
  if (size.factory) {
    for (const t of map.tiles) if (inTown(t) && t.terrain !== 'street' && t.col > cx + 4 && t.row > cy + 3) { t.terrain = 'strong'; t.label = 'usine'; }
  }
  // Isbas le long des routes d'accès, hors de la ville, jardins derrière.
  for (const t of map.tiles) {
    if (inTown(t) || t.terrain === 'street') continue;
    const nearRoad = neighborCoords(t.col, t.row).some((h) => at(h.col, h.row)?.terrain === 'street');
    const gap = Math.max(c0 - t.col, t.col - c1, r0 - t.row, t.row - r1);
    if (nearRoad && gap <= 4 && rng.chance(0.7 - gap * 0.1)) t.terrain = 'isba';
    else if (gap <= 2 && rng.chance(0.25)) t.terrain = 'garden';
  }

  // Rivière : une colonne, au bord de la ville, côté demandé ; un pont sur chaque rue qui la franchit.
  if (opts.river === 'east' || opts.river === 'west') {
    const rc = opts.river === 'east' ? Math.min(W - 3, c1 + 2) : Math.max(2, c0 - 2);
    const path = span(0, H - 1, (r) => ({ col: rc, row: r }));
    for (const h of path) {
      const t = at(h.col, h.row);
      t.river = true;
      if (t.terrain === 'street') { t.bridge = true; map.bridges = [...(map.bridges ?? []), t]; }
      else t.terrain = 'plain';
    }
    map.rivers.push({ path, stream: false });
  }

  // Îlots : composantes connexes du bâti dans l'emprise de la ville (rues et place exclues).
  const urbanT = (t) => t && inTown(t) && (t.terrain === 'building' || t.terrain === 'isba' || t.terrain === 'strong' || t.terrain === 'garden');
  const seen = new Set();
  for (const t of map.tiles) {
    const k = t.row * W + t.col;
    if (seen.has(k) || !urbanT(t)) continue;
    const tiles = [], stack = [t];
    seen.add(k);
    while (stack.length) {
      const u = stack.pop();
      tiles.push(u.row * W + u.col);
      for (const h of neighborCoords(u.col, u.row)) {
        const v = at(h.col, h.row), kv = h.row * W + h.col;
        if (v && !seen.has(kv) && urbanT(v) && (v.label === 'usine') === (u.label === 'usine')) { seen.add(kv); stack.push(v); }
      }
    }
    if (tiles.length < 2 && !tiles.some((i) => map.tiles[i].terrain === 'strong')) continue;
    const mc = tiles.reduce((a, i) => a + map.tiles[i].col, 0) / tiles.length, mr = tiles.reduce((a, i) => a + map.tiles[i].row, 0) / tiles.length;
    const mark = tiles.map((i) => map.tiles[i].label).find((l) => l && l !== 'usine') ?? (tiles.some((i) => map.tiles[i].label === 'usine') ? 'usine' : null);
    const label = mark ? LANDMARK_BLOCK[mark] : `îlot ${blockDir(mc - cx, mr - cy, size)}`;
    const stone = tiles.filter((i) => map.tiles[i].terrain !== 'isba' && map.tiles[i].terrain !== 'garden').length;
    map.blocks.push({ id: map.blocks.length, tiles, label, col: Math.round(mc), row: Math.round(mr), weight: mark && mark !== 'usine' ? 2 : stone > tiles.length / 2 ? 1.5 : 1 });
  }
  for (const b of map.bridges ?? []) map.blocks.push({ id: map.blocks.length, tiles: [b.row * W + b.col], label: 'le pont', col: b.col, row: b.row, weight: 1, bridge: true });
  // Plusieurs îlots dans la même direction : numérotés.
  const count = {};
  for (const b of map.blocks) count[b.label] = (count[b.label] ?? 0) + 1;
  const nth = {};
  for (const b of map.blocks) if (count[b.label] > 1) { nth[b.label] = (nth[b.label] ?? 0) + 1; b.label = `${b.label} ${nth[b.label]}`; }
  for (const b of map.blocks) for (const i of b.tiles) map.tiles[i].block = b.id;

  const name = opts.name ?? placeName(rng);
  church.name = name;
  map.name = name;
  map.villages = [church]; // étiquette du nom sur la carte
  return map;
}

function blockDir(dx, dy, size) {
  const sx = Math.abs(dx) < size.hw * 0.3 ? 0 : Math.sign(dx), sy = Math.abs(dy) < size.hh * 0.3 ? 0 : Math.sign(dy);
  return Object.keys(DIRS).find((k) => DIRS[k][0] === sx && DIRS[k][1] === sy);
}
