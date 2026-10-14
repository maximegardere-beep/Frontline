// Artillerie du front stratégique : quelques groupes nommés, placés derrière le front, avec une portée.
// Leur puissance de feu dépend de leur posture, inverse de leur vitesse : en batterie (immobile, plein feu),
// appui mobile (mi-vitesse, 40 %), déplacement (rapide, aucun tir). Chaque groupe peut tirer une mission de
// barrage par jour dans sa portée ; sans mission, il appuie la défense en frappant les assaillants à sa portée.
// Un groupe dont la case tombe est perdu ; un barrage ennemi sur sa position l'use (contre-batterie).
// Distances en unités de grille (deux cases voisines sont à 1,73).

import { pixelToHex } from './hex.js';

export const GUN_KINDS = {
  div: { label: 'Artillerie divisionnaire', short: 'Art.', range: 14, r: 3, rate: 0.04, works: 0.12, speed: 0.6 },
  heavy: { label: 'Artillerie lourde', short: 'Art. lourde', range: 20, r: 2.6, rate: 0.05, works: 0.2, speed: 0.4 },
  rocket: { label: 'Lance-roquettes (Katioucha)', short: 'Katioucha', range: 10, r: 3.5, rate: 0.07, works: 0.06, speed: 0.8 },
};

// fire : part de la puissance ; move : part de la vitesse du groupe.
export const GUN_POSTURES = {
  battery: { label: 'En batterie', fire: 1, move: 0 },
  mobile: { label: 'Appui mobile', fire: 0.4, move: 0.5 },
  move: { label: 'Déplacement', fire: 0, move: 1 },
};

export const GUN_RULES = {
  support: 0.008, // appui défensif : part de la densité des assaillants détruite par tick, à pleine puissance
  supportCells: 8, // cases assaillantes frappées au plus par groupe et par tick
  counter: 0.07, // usure d'un groupe par tick de barrage ennemi sur sa position
  regen: 0.15, // récupération nocturne
  minStr: 0.25, // en dessous, le groupe est hors de combat (détruit)
  spot: 5.5, // distance de repérage d'un groupe camouflé (unités de grille, ~3 cases)
};

const ORDINAL = (n) => `${n}${n === 1 ? 'er' : 'e'}`;

function gunCell(front, g) {
  const h = pixelToHex(g.x, g.y, 1);
  const { W, H } = front.map;
  return h.col < 0 || h.row < 0 || h.col >= W || h.row >= H ? -1 : h.row * W + h.col;
}
export { gunCell };

export const gunPower = (g) => (g.lost ? 0 : GUN_POSTURES[g.posture].fire * g.str);

// Groupes de départ : répartis du nord au sud, à mi-portée derrière le front.
export function createGuns(front, kinds) {
  const { W, H, N } = front.map;
  const cx = front.centers.x, cy = front.centers.y;
  const guns = [];
  let id = 1;
  for (const s of [0, 1]) {
    const list = kinds[s];
    // Cases de contact, par ligne : où est le front.
    const frontX = new Float32Array(H).fill(NaN);
    for (let i = 0; i < N; i++) {
      if (front.owner[i] !== s) continue;
      for (let d = 0; d < 6; d++) {
        const j = front.map.nb[i * 6 + d];
        if (j >= 0 && front.owner[j] === 1 - s) {
          const r = Math.floor(i / W);
          frontX[r] = Number.isNaN(frontX[r]) ? cx[i] : s === 0 ? Math.max(frontX[r], cx[i]) : Math.min(frontX[r], cx[i]);
          break;
        }
      }
    }
    list.forEach((kind, k) => {
      const K = GUN_KINDS[kind];
      let row = Math.round(((k + 0.5) / list.length) * H);
      while (Number.isNaN(frontX[row]) && row < H - 1) row++;
      const want = { x: frontX[row] - (s === 0 ? 1 : -1) * Math.max(7, K.range * 0.5), y: cy[row * W] };
      // Case amie la plus proche du point voulu, hors montagne.
      let best = -1, bd = Infinity;
      for (let i = 0; i < N; i++) {
        if (front.owner[i] !== s || front.map.flow[i] <= 0) continue;
        const d = Math.hypot(cx[i] - want.x, cy[i] - want.y);
        if (d < bd) { bd = d; best = i; }
      }
      const n = list.slice(0, k + 1).filter((x) => x === kind).length;
      const name = s === 0
        ? (kind === 'heavy' ? `Art.Abt. ${600 + k * 7}` : `Art.Rgt. ${100 + k * 33}`)
        : (kind === 'rocket' ? `${ORDINAL(n)} rég. de mortiers de la Garde` : `${ORDINAL(n)} rég. d'artillerie`);
      guns.push({ id: id++, side: s, kind, name, x: cx[best], y: cy[best], str: 1, posture: 'battery', dest: null, lost: false, fired: -99, seen: [null, null] });
    });
  }
  return guns;
}

// Ordre de déplacement (ou de mise en batterie, dest = null).
export function setGunOrder(front, s, id, { posture, dest } = {}) {
  if (front.phase !== 'plan') return { error: 'Les ordres se donnent le matin.' };
  const g = front.guns.find((x) => x.id === id && x.side === s && !x.lost);
  if (!g) return { error: 'Groupe d\'artillerie introuvable.' };
  if (dest !== undefined) {
    if (dest) {
      const h = pixelToHex(dest.x, dest.y, 1);
      const i = h.row * front.map.W + h.col;
      if (h.col < 0 || h.row < 0 || h.col >= front.map.W || h.row >= front.map.H || front.owner[i] !== s) return { error: 'L\'artillerie se déplace dans vos lignes.' };
    }
    g.dest = dest ? { x: dest.x, y: dest.y } : null;
    if (!g.dest) g.posture = 'battery';
    else if (!posture) {
      // Posture par défaut : mobile si l'on arrive dans la journée à mi-vitesse, sinon déplacement.
      const reach = GUN_KINDS[g.kind].speed * GUN_POSTURES.mobile.move * front.cfg.ticks;
      g.posture = Math.hypot(g.dest.x - g.x, g.dest.y - g.y) <= reach ? 'mobile' : 'move';
    }
  }
  if (posture) {
    if (!GUN_POSTURES[posture]) return { error: 'Posture inconnue.' };
    g.posture = posture;
    if (posture === 'battery') g.dest = null;
  }
  // Un groupe qui ne tire plus perd sa mission du jour.
  if (gunPower(g) <= 0) front.barrages[s] = front.barrages[s].filter((b) => b.gun !== g.id);
  return g;
}

// Groupe qui tirera un barrage sur at : à portée, capable de tirer, sans mission ; le plus puissant d'abord.
export function gunFor(front, s, at) {
  let best = null;
  for (const g of front.guns) {
    if (g.side !== s || gunPower(g) <= 0 || front.barrages[s].some((b) => b.gun === g.id)) continue;
    if (Math.hypot(g.x - at.x, g.y - at.y) > GUN_KINDS[g.kind].range) continue;
    if (!best || gunPower(g) * GUN_KINDS[g.kind].rate > gunPower(best) * GUN_KINDS[best.kind].rate) best = g;
  }
  return best;
}

// Un tick de déplacement : vers la destination, sans quitter ses lignes ; puis perte des groupes débordés.
export function moveGuns(front, events) {
  for (const g of front.guns) {
    if (g.lost) continue;
    if (g.dest) {
      const step = GUN_KINDS[g.kind].speed * GUN_POSTURES[g.posture].move;
      const dx = g.dest.x - g.x, dy = g.dest.y - g.y, d = Math.hypot(dx, dy);
      if (step > 0) {
        const k = d <= step ? 1 : step / d;
        const nx = g.x + dx * k, ny = g.y + dy * k;
        const i = gunCell(front, { x: nx, y: ny });
        if (i >= 0 && front.owner[i] === g.side) { g.x = nx; g.y = ny; }
        if (d <= step) g.dest = null;
      }
    }
    const i = gunCell(front, g);
    if (i >= 0 && front.owner[i] === 1 - g.side) {
      g.lost = true;
      events.push({ kind: 'gunLost', side: g.side, id: g.id, i });
    }
  }
}

// Appui défensif : chaque groupe sans mission (ou après le barrage du matin) frappe les cases ennemies qui
// poussent sur les siennes, à portée, au prorata de sa puissance.
export function supportFire(front, edges) {
  if (!edges?.length) return;
  const cx = front.centers.x, cy = front.centers.y;
  for (const g of front.guns) {
    const p = gunPower(g);
    if (p <= 0) continue;
    const busy = front.tick < front.cfg.barrageTicks && front.barrages[g.side].some((b) => b.gun === g.id);
    if (busy) continue;
    const R = GUN_KINDS[g.kind].range;
    const hits = new Map();
    for (let k = 0; k < edges.length; k += 3) {
      const i = edges[k], j = edges[k + 1];
      if (front.owner[i] !== 1 - g.side || front.owner[j] !== g.side) continue;
      if (Math.hypot(cx[i] - g.x, cy[i] - g.y) > R) continue;
      hits.set(i, (hits.get(i) ?? 0) + edges[k + 2]);
    }
    if (!hits.size) continue;
    const targets = [...hits].sort((a, b) => b[1] - a[1]).slice(0, GUN_RULES.supportCells);
    for (const [i] of targets) {
      // Les blindés (puissance de choc élevée) encaissent mieux le tir indirect que l'infanterie à découvert.
      const F = front.field[1 - g.side];
      const armored = Math.max(0, Math.min(1, (F.atk[i] - 1.2) / 0.6));
      const l = front.dens[i] * GUN_RULES.support * p * (GUN_KINDS[g.kind].rate / 0.04) * (1 - 0.7 * armored);
      front.dens[i] -= l;
      front.stats.losses[1 - g.side] += l;
    }
    g.fired = front.clock;
  }
}

// Nuit : les groupes en route qui n'ont pas de destination se remettent en batterie ; l'usure se répare un peu.
export function gunsNight(front) {
  for (const g of front.guns) {
    if (g.lost) continue;
    if (!g.dest) g.posture = 'battery';
    g.str = Math.min(1, g.str + GUN_RULES.regen);
  }
}

// Ce que le camp s sait des groupes ennemis : camouflés, ils ne sont repérés qu'à courte distance de ses troupes
// (SPOT, moins que la reconnaissance ordinaire) ou quand ils tirent. Position mise à jour à chaque tick.
export function updateGunSightings(front) {
  const cx = front.centers.x, cy = front.centers.y;
  for (const g of front.guns) {
    const s = 1 - g.side;
    if (g.lost) { g.seen[s] = null; continue; }
    let spotted = g.fired >= front.clock - 1;
    for (let i = 0; i < front.map.N && !spotted; i++) {
      if (front.owner[i] !== s || front.dens[i] <= 0.5) continue;
      if (Math.abs(cx[i] - g.x) <= GUN_RULES.spot && Math.hypot(cx[i] - g.x, cy[i] - g.y) <= GUN_RULES.spot) spotted = true;
    }
    if (spotted) g.seen[s] = { x: g.x, y: g.y, clock: front.clock };
  }
}

// Groupes visibles pour viewer (null : tous) : les siens, et les ennemis repérés depuis moins d'un jour.
export function visibleGuns(front, viewer) {
  const out = [];
  for (const g of front.guns) {
    if (g.lost) continue;
    if (viewer === null || g.side === viewer) { out.push({ g, x: g.x, y: g.y, known: true }); continue; }
    const seen = g.seen[viewer];
    if (seen && front.clock - seen.clock <= front.cfg.ticks) out.push({ g, x: seen.x, y: seen.y, known: front.clock - seen.clock <= 1 });
  }
  return out;
}
