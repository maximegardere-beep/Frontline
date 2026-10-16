// Bataillons de soutien (atout du défenseur) : une unité posée en arrière du front qui projette une zone de travaux
// sur le secteur devant elle. Chaque jour passé sans bouger, la zone se retranche davantage : tranchées le premier
// jour, puis barbelés, puis obstacles antichar (les ouvrages des lignes de défense, frontworks.js), jusqu'au niveau
// que permet sa rareté. Les ouvrages restent quand le bataillon part ; déplacé, il recommence au premier niveau.
// Un bataillon dont la case tombe est perdu. Positions en unités de grille.

import { pixelToHex } from './hex.js';
import { bfsDistance } from './path.js';
import { buildSite } from './frontworks.js';

export const SUPPORT = {
  half: 9, // demi-hauteur de la zone (≈ 6 lignes de cases)
  reach: 16, // portée de la zone vers le front, depuis le bataillon
  depth: 2, // profondeur de la zone, en cases depuis le contact
  back: 7, // placement derrière le contact
  move: 17, // déplacement d'une nuit
  spot: 5.5, // repérage par des troupes ennemies proches
};

export const SUPPORT_LEVELS = ['', 'tranchées', 'barbelés', 'obstacles antichar'];

const ORDINAL = (n) => `${n}${n === 1 ? 'er' : 'e'}`;

function cellAt(front, x, y) {
  const h = pixelToHex(x, y, 1), { W, H } = front.map;
  return h.col < 0 || h.row < 0 || h.col >= W || h.row >= H ? -1 : h.row * W + h.col;
}

function contactCells(front, s) {
  const out = [];
  for (let i = 0; i < front.map.N; i++) {
    if (front.owner[i] !== s) continue;
    for (let d = 0; d < 6; d++) { const j = front.map.nb[i * 6 + d]; if (j >= 0 && front.owner[j] === 1 - s) { out.push(i); break; } }
  }
  return out;
}

// specs[s] : [{ max }] (niveau d'ouvrage au plus). Répartis du nord au sud, derrière le front. ids : à partir de first.
export function createSupport(front, specs, first = 1) {
  const { W, H, N } = front.map;
  const cx = front.centers.x, cy = front.centers.y;
  const out = [];
  let id = first;
  for (const s of [0, 1]) {
    const list = specs[s] ?? [];
    const contact = contactCells(front, s);
    list.forEach((spec, k) => {
      const row = Math.round(((k + 0.5) / list.length) * H);
      const y = cy[Math.min(H - 1, row) * W];
      let fx = NaN;
      for (const i of contact) if (Math.abs(cy[i] - y) < 1) fx = Number.isNaN(fx) ? cx[i] : s === 0 ? Math.max(fx, cx[i]) : Math.min(fx, cx[i]);
      if (Number.isNaN(fx)) fx = cx[W - 1] / 2;
      const want = { x: fx - (s === 0 ? 1 : -1) * SUPPORT.back, y };
      let best = -1, bd = Infinity;
      for (let i = 0; i < N; i++) {
        if (front.owner[i] !== s || front.map.flow[i] <= 0) continue;
        const d = Math.hypot(cx[i] - want.x, cy[i] - want.y);
        if (d < bd) { bd = d; best = i; }
      }
      if (best < 0) return;
      const n = (front.support?.filter((b) => b.side === s).length ?? 0) + out.filter((b) => b.side === s).length + 1;
      out.push({
        id: id++, side: s, name: s === 0 ? `Bau-Btl. ${100 + n * 17}` : `${ORDINAL(n)} bataillon du génie`,
        max: spec.max ?? 2, level: 1, cell: best, x: cx[best], y: cy[best], dest: null, lost: false, seen: [null, null], cells: [], core: new Set(),
      });
    });
  }
  return out;
}

// Zone d'un bataillon : cases amies à moins de SUPPORT.depth cases du contact, dans sa bande, devant lui.
export function supportZone(front, b, dist = null) {
  const s = b.side;
  const cx = front.centers.x, cy = front.centers.y;
  dist ??= bfsDistance(front.map.nb, front.map.N, contactCells(front, s), (i) => front.owner[i] === s, SUPPORT.depth);
  const cells = [], core = new Set();
  const dir = s === 0 ? 1 : -1;
  for (let i = 0; i < front.map.N; i++) {
    if (front.owner[i] !== s || dist[i] > SUPPORT.depth) continue;
    if (Math.abs(cy[i] - b.y) > SUPPORT.half || Math.hypot(cx[i] - b.x, cy[i] - b.y) > SUPPORT.reach) continue;
    if ((cx[i] - b.x) * dir < -2) continue;
    cells.push(i);
    if (dist[i] === 1) core.add(i);
  }
  return { cells, core };
}

// Zones recalculées (le front a bougé) : à la création, au soir et au matin.
export function refreshZones(front) {
  if (!front.support?.length) return;
  for (const s of [0, 1]) {
    const own = front.support.filter((b) => b.side === s && !b.lost);
    if (!own.length) continue;
    const dist = bfsDistance(front.map.nb, front.map.N, contactCells(front, s), (i) => front.owner[i] === s, SUPPORT.depth);
    for (const b of own) Object.assign(b, supportZone(front, b, dist));
  }
}

// Au matin : les zones attirent les troupes voisines comme une ligne de défense.
export function supportDawn(front) {
  refreshZones(front);
  for (const b of front.support ?? []) if (!b.lost) for (const i of b.cells) front.lineMask[i] = 1;
}

// Chaque tick : les zones se retranchent ; un bataillon dont la case tombe est perdu.
export function supportTick(front, events) {
  for (const b of front.support ?? []) {
    if (b.lost) continue;
    if (front.owner[b.cell] !== b.side) {
      b.lost = true;
      events.push({ kind: 'supportLost', side: b.side, id: b.id });
      front.log.push({ day: front.day, tick: front.tick, kind: 'gun', side: b.side, text: `${b.name} (${b.side === 0 ? 'Wehrmacht' : 'Armée rouge'}) débordé et perdu.` });
      continue;
    }
    buildSite(front, b.side, b);
  }
}

// La nuit : déplacement (on recommence au premier niveau) ou un jour de plus en place (niveau supérieur).
export function supportNight(front) {
  for (const b of front.support ?? []) {
    if (b.lost) continue;
    if (b.dest && front.owner[b.dest.cell] === b.side) {
      b.cell = b.dest.cell; b.x = b.dest.x; b.y = b.dest.y;
      b.level = 1;
    } else b.level = Math.min(b.max, b.level + 1);
    b.dest = null;
  }
  refreshZones(front);
}

// Ordre du matin : nouvelle position (de nuit, dans ses lignes, à SUPPORT.move au plus) ; p = null annule.
export function moveSupport(front, s, id, p) {
  if (front.phase !== 'plan') return { error: 'Les ordres se donnent le matin.' };
  const b = front.support?.find((x) => x.id === id && x.side === s && !x.lost);
  if (!b) return { error: 'Bataillon introuvable.' };
  if (!p) { b.dest = null; return b; }
  const i = cellAt(front, p.x, p.y);
  if (i < 0 || front.owner[i] !== s || front.map.flow[i] <= 0) return { error: 'Le bataillon s\'installe dans vos lignes.' };
  if (i === b.cell) { b.dest = null; return b; }
  const d = Math.hypot(front.centers.x[i] - b.x, front.centers.y[i] - b.y);
  if (d > SUPPORT.move) return { error: `Trop loin pour une nuit (${Math.round(SUPPORT.move / 1.73)} cases au plus).` };
  b.dest = { cell: i, x: front.centers.x[i], y: front.centers.y[i] };
  return b;
}

export function updateSupportSightings(front) {
  const cx = front.centers.x, cy = front.centers.y;
  for (const b of front.support ?? []) {
    const o = 1 - b.side;
    if (b.lost) { b.seen[o] = null; continue; }
    for (let i = 0; i < front.map.N; i++) {
      if (front.owner[i] !== o || front.dens[i] <= 0.5 || Math.abs(cx[i] - b.x) > SUPPORT.spot) continue;
      if (Math.hypot(cx[i] - b.x, cy[i] - b.y) <= SUPPORT.spot) { b.seen[o] = { x: b.x, y: b.y, clock: front.clock }; break; }
    }
  }
}

export function visibleSupport(front, viewer) {
  const out = [];
  for (const b of front.support ?? []) {
    if (b.lost) continue;
    if (viewer === null || b.side === viewer) { out.push({ b, x: b.x, y: b.y, known: true, own: true }); continue; }
    const seen = b.seen[viewer];
    if (seen && front.clock - seen.clock <= front.cfg.ticks) out.push({ b, x: seen.x, y: seen.y, known: front.clock - seen.clock <= 1, own: false });
  }
  return out;
}

// IA : un bataillon reste sur un secteur menacé (il s'y retranche) ; sinon il rejoint, de nuit, le secteur menacé le
// moins couvert. sectors : ceux de frontai.js (head : case de tête ; hold : rapport pour tenir).
export function planSupport(front, s, sectors) {
  const own = (front.support ?? []).filter((b) => b.side === s && !b.lost);
  if (!own.length || !sectors.length) return;
  const cx = front.centers.x, cy = front.centers.y;
  const sectorAt = (y) => sectors.reduce((a, sec) => (Math.abs(cy[sec.head] - y) < Math.abs(cy[a.head] - y) ? sec : a));
  const covered = (sec, self) => own.some((o) => o !== self && Math.abs((o.dest?.y ?? o.y) - cy[sec.head]) < SUPPORT.half);
  const dir = s === 0 ? 1 : -1;
  for (const b of own) {
    const here = sectorAt(b.y);
    if (here.hold < 1) continue; // déjà sur un secteur menacé : on se retranche
    const want = [...sectors].filter((sec) => sec.hold < 0.8 && !covered(sec, b)).sort((a, c) => a.hold - c.hold)[0];
    if (!want) continue;
    let to = { x: cx[want.head] - dir * SUPPORT.back, y: cy[want.head] };
    const d = Math.hypot(to.x - b.x, to.y - b.y);
    if (d > SUPPORT.move * 0.95) to = { x: b.x + ((to.x - b.x) * SUPPORT.move * 0.95) / d, y: b.y + ((to.y - b.y) * SUPPORT.move * 0.95) / d };
    let best = -1, bd = Infinity;
    for (let i = 0; i < front.map.N; i++) {
      if (front.owner[i] !== s || front.map.flow[i] <= 0) continue;
      const e = Math.hypot(cx[i] - to.x, cy[i] - to.y);
      if (e < bd && Math.hypot(cx[i] - b.x, cy[i] - b.y) <= SUPPORT.move) { bd = e; best = i; }
    }
    if (best >= 0 && best !== b.cell) moveSupport(front, s, b.id, { x: cx[best], y: cy[best] });
  }
}
