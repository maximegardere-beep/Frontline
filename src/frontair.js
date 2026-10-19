// Aviation et DCA du front stratégique.
// Chaque camp a, par jour, un nombre fixe de sorties (cfg.sorties, selon l'année) et, pour la bataille, quelques
// batteries de DCA (cfg.aaBatteries). Deux missions, choisies le matin :
// - appui rapproché : une zone pilonnée en fin de matinée, n'importe où sur la carte, dure pour les blindés ;
// - chasse de batteries : un groupe d'artillerie ou une DCA ennemie repérée.
// Les avions partent de leur bord de carte et filent droit sur l'objectif. Chaque DCA ennemie dont le rayon croise
// leur route émousse la mission et peut abattre un avion ; en tirant, elle se dévoile à l'attaquant. Sinon, une DCA
// reste cachée, comme l'artillerie : on ne la repère qu'à courte distance de ses troupes.
// Brouillard : l'aviation reste au sol ; pluie et neige l'émoussent.

import { airShare } from './frontairwar.js';
import { createRng } from './rng.js';
import { GUN_RULES } from './frontguns.js';
import { blowBridge } from './frontworks.js';
import { pixelToHex } from './hex.js';

// Case sous un point (unités de grille), ou −1.
function airCellAt(front, p) {
  const h = pixelToHex(p.x, p.y, 1), { W, H } = front.map;
  return h.col < 0 || h.row < 0 || h.col >= W || h.row >= H ? -1 : h.row * W + h.col;
}

export const AIR = {
  strikeR: 2.4, // rayon de la zone d'appui rapproché (unités de grille)
  strikeTicks: [6, 7, 8], // ticks où les avions frappent (fin de matinée)
  rate: 0.06, // part de la densité ennemie détruite par tick de frappe, à pleine puissance
  tankRate: 0.07, // part des chars d'une formation prise dans la zone, par tick
  shock: 0.35, // choc infligé aux troupes ennemies de la zone, par tick de frappe à pleine puissance (combat.js)
  bridge: 0.12, // solidité retirée à un pont en dur dans la zone, par tick de frappe (un pont de bateaux est coulé)
  hunt: 0.25, // puissance de feu retirée à un groupe (artillerie ou DCA) par une chasse réussie
  huntR: 2.5, // la cible doit encore être à cette distance du point visé
  aaRange: 6, // rayon d'action d'une DCA
  aaBlunt: 0.35, // part de la mission perdue par DCA traversée (× son état)
  aaHit: 0.4, // chance d'abattre un avion par DCA traversée (× son état)
  aaSpot: 5.5, // distance de repérage d'une DCA camouflée
  aaMove: 10, // déplacement d'une DCA en une nuit
  aaRegen: 0.15,
  pick: 2.5, // un appui à moins de cette distance d'une batterie ennemie connue devient une chasse
  weather: { clear: 1, rain: 0.6, fog: 0, snow: 0.8 },
};

let nextAirId = 1;

// DCA de départ : réparties du nord au sud, quelques cases derrière le front.
export function createAA(front, counts) {
  const { W, H, N } = front.map;
  const cx = front.centers.x, cy = front.centers.y;
  const out = [];
  for (const s of [0, 1]) {
    const n = counts?.[s] ?? 0;
    for (let k = 0; k < n; k++) {
      let row = Math.round(((k + 0.5) / n) * H), fx = NaN;
      for (; row < H && Number.isNaN(fx); row++) {
        for (let col = 0; col < W; col++) {
          const i = row * W + col;
          if (front.owner[i] !== s) continue;
          let contact = false;
          for (let d = 0; d < 6; d++) { const j = front.map.nb[i * 6 + d]; if (j >= 0 && front.owner[j] === 1 - s) contact = true; }
          if (contact) { fx = Number.isNaN(fx) ? cx[i] : s === 0 ? Math.max(fx, cx[i]) : Math.min(fx, cx[i]); }
        }
      }
      if (Number.isNaN(fx)) continue;
      const want = { x: fx - (s === 0 ? 1 : -1) * 7, y: cy[Math.min(H - 1, row) * W] };
      let best = -1, bd = Infinity;
      for (let i = 0; i < N; i++) {
        if (front.owner[i] !== s || front.map.flow[i] <= 0) continue;
        const d = Math.hypot(cx[i] - want.x, cy[i] - want.y);
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) out.push({ id: nextAirId++, side: s, name: s === 0 ? `Flak-Abt. ${30 + k * 11}` : `${k + 1}${k ? 'e' : 'er'} rég. de DCA`, x: cx[best], y: cy[best], str: 1, lost: false, fired: -99, seen: [null, null] });
    }
  }
  return out;
}

// Sorties du jour : celles de l'année et des cartes, selon le ciel (bataille des airs, frontairwar.js) ; au sol par
// brouillard. Ciel disputé : la moitié, arrondie au-dessus.
export const sortiesToday = (front, s) => Math.ceil((front.cfg.sorties?.[s] ?? 0) * airShare(front, s) * (AIR.weather[front.weather] > 0 ? 1 : 0));

// Ce que le camp s sait d'une batterie ennemie b (artillerie ou DCA) : sa dernière position vue, de moins d'un jour.
const known = (front, s, b) => {
  const seen = b.seen?.[s];
  return seen && front.clock - seen.clock <= front.cfg.ticks ? seen : null;
};

// Mission du matin sur le point p : chasse si une batterie ennemie connue est tout près, sinon appui rapproché.
export function addAirMission(front, s, p) {
  if (front.phase !== 'plan') return { error: 'Les missions aériennes se décident le matin.' };
  if (AIR.weather[front.weather] <= 0) return { error: 'Brouillard : l\'aviation reste au sol aujourd\'hui.' };
  if (front.air[s].length >= sortiesToday(front, s)) return { error: 'Plus de sortie disponible aujourd\'hui.' };
  let target = null, bd = AIR.pick;
  for (const [type, list] of [['gun', front.guns], ['aa', front.aa]]) {
    for (const b of list) {
      if (b.side === s || b.lost) continue;
      const k = known(front, s, b);
      if (!k) continue;
      const d = Math.hypot(k.x - p.x, k.y - p.y);
      if (d < bd) { bd = d; target = { type, id: b.id, x: k.x, y: k.y }; }
    }
  }
  const m = target
    ? { id: 200000 + nextAirId++, side: s, kind: 'hunt', x: target.x, y: target.y, target }
    : { id: 200000 + nextAirId++, side: s, kind: 'strike', x: p.x, y: p.y };
  front.air[s].push(m);
  return m;
}

// Déplacement d'une DCA, la nuit (appliqué le matin).
export function moveAA(front, s, id, p) {
  if (front.phase !== 'plan') return { error: 'La DCA se déplace la nuit : donnez l\'ordre le matin.' };
  const a = front.aa.find((x) => x.id === id && x.side === s && !x.lost);
  if (!a) return { error: 'Batterie introuvable.' };
  const i = airCellAt(front, p);
  if (i < 0 || front.owner[i] !== s) return { error: 'La DCA se place dans vos lignes.' };
  if (Math.hypot(p.x - a.x, p.y - a.y) > AIR.aaMove) return { error: 'Trop loin pour une nuit.' };
  a.x = front.centers.x[i];
  a.y = front.centers.y[i];
  a.moved = front.day;
  return a;
}

// Distance du point (px, py) au segment (ax, ay)–(bx, by).
function airSegDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2));
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
}

// Bord de carte d'où partent les avions du camp s, à la hauteur de l'objectif.
export const airBase = (front, s, m) => ({ x: s === 0 ? -2 : front.rightX + 2, y: m.y });

// Un tick : interception à l'approche (tick précédant la frappe), puis frappes. Renvoie des événements.
export function airTick(front, events) {
  const t = front.tick;
  const first = AIR.strikeTicks[0];
  for (const s of [0, 1]) {
    for (const m of front.air[s]) {
      if (t === first - 1) {
        // Approche : chaque DCA ennemie dont le rayon croise la route émousse la mission et peut abattre un avion.
        const rng = createRng(`air:${front.seed}:${front.clock}:${m.id}`);
        const o = airBase(front, s, m);
        m.power = AIR.weather[front.weather];
        m.downed = 0;
        m.flak = [];
        for (const a of front.aa) {
          if (a.side === s || a.lost) continue;
          if (airSegDist(a.x, a.y, o.x, o.y, m.x, m.y) > AIR.aaRange) continue;
          m.power *= 1 - AIR.aaBlunt * a.str;
          m.flak.push(a.id);
          a.fired = front.clock;
          a.seen[s] = { x: a.x, y: a.y, clock: front.clock }; // en tirant, elle se dévoile
          if (rng.next() < AIR.aaHit * a.str) { m.downed++; events.push({ kind: 'planeDown', side: s, id: m.id, by: a.id }); }
        }
        if (m.downed) m.power *= 0.6;
      }
      if (!AIR.strikeTicks.includes(t) || !(m.power > 0)) continue;
      m.fired = front.clock;
      if (m.kind === 'strike') {
        const R = AIR.strikeR;
        for (let i = 0; i < front.map.N; i++) {
          if (front.owner[i] !== 1 - s) continue;
          if (Math.hypot(front.centers.x[i] - m.x, front.centers.y[i] - m.y) > R) continue;
          const l = front.dens[i] * AIR.rate * m.power;
          front.dens[i] -= l;
          front.stats.losses[1 - s] += l;
          if (front.shock) front.shock[i] = Math.min(1, front.shock[i] + AIR.shock * m.power);
        }
        // Ponts ennemis dans la zone : un pont de bateaux est coulé, un pont en dur s'use (bridgeHp, frontworks.js).
        if (front.map.bridge && front.bridgeHp) {
          for (let i = 0; i < front.map.N; i++) {
            if (front.map.bridge[i] !== 1 || front.owner[i] === s || Math.hypot(front.centers.x[i] - m.x, front.centers.y[i] - m.y) > R) continue;
            front.bridgeHp[i] -= front.map.pontoon?.[i] ? 1 : AIR.bridge * m.power;
            if (front.bridgeHp[i] > 0) continue;
            const blown = blowBridge(front, i);
            if (blown) { events.push({ ...blown, side: s, air: true }); front.terrainDirty = true; }
          }
        }
        for (const a of front.armor ?? []) {
          if (a.side !== 1 - s || a.lost || Math.hypot(a.x - m.x, a.y - m.y) > R + 0.5) continue;
          a.tanks *= 1 - AIR.tankRate * m.power * (front.atouts?.assault[s] ?? 1);
        }
      } else if (t === first) {
        // Chasse : une seule passe ; la cible doit être encore là.
        const list = m.target.type === 'gun' ? front.guns : front.aa;
        const b = list.find((x) => x.id === m.target.id);
        if (!b || b.lost || Math.hypot(b.x - m.x, b.y - m.y) > AIR.huntR) { m.missed = true; continue; }
        b.str -= AIR.hunt * m.power;
        if (b.str < GUN_RULES.minStr) {
          b.lost = true;
          events.push(m.target.type === 'gun' ? { kind: 'gunLost', side: b.side, id: b.id, air: true } : { kind: 'aaLost', side: b.side, id: b.id });
        }
      }
    }
  }
}

// Repérage des DCA ennemies : à courte distance de ses troupes (ou quand elles tirent, voir airTick).
export function updateAASightings(front) {
  const cx = front.centers.x, cy = front.centers.y;
  for (const a of front.aa) {
    const s = 1 - a.side;
    if (a.lost) { a.seen[s] = null; continue; }
    let spotted = false;
    for (let i = 0; i < front.map.N && !spotted; i++) {
      if (front.owner[i] !== s || front.dens[i] <= 0.5) continue;
      if (Math.abs(cx[i] - a.x) <= AIR.aaSpot && Math.hypot(cx[i] - a.x, cy[i] - a.y) <= AIR.aaSpot) spotted = true;
    }
    if (spotted) a.seen[s] = { x: a.x, y: a.y, clock: front.clock };
    // Débordée : sa case tombe.
    const h = airCellAt(front, a);
    if (h >= 0 && front.owner[h] === 1 - a.side) a.lost = true;
  }
}

// Nuit : missions terminées, DCA un peu remise en état.
export function airNight(front) {
  front.air = [[], []];
  for (const a of front.aa) if (!a.lost) a.str = Math.min(1, a.str + AIR.aaRegen);
}

// DCA visibles pour viewer (null : toutes) : les siennes, et les ennemies repérées depuis moins d'un jour.
export function visibleAA(front, viewer) {
  const out = [];
  for (const a of front.aa ?? []) {
    if (a.lost) continue;
    if (viewer === null || a.side === viewer) { out.push({ a, x: a.x, y: a.y, known: true }); continue; }
    const k = known(front, viewer, a);
    if (k) out.push({ a, x: k.x, y: k.y, known: front.clock - k.clock <= 1, age: front.clock - k.clock });
  }
  return out;
}

// IA : chasse d'abord une batterie ennemie connue, puis appuie là où l'ennemi est le plus dense au contact
// (de préférence ses blindés), loin des DCA qu'elle connaît.
export function planAir(front, s) {
  const n = sortiesToday(front, s);
  if (!n) return;
  const mem = front.memory[s];
  // PC ennemi repéré : une frappe sur lui (elle coupe ses liaisons), avant tout le reste.
  const hq = front.hq?.[1 - s];
  if (hq && !hq.captured && hq.seen[s] && front.clock - hq.seen[s].clock <= front.cfg.ticks) addAirMission(front, s, { x: hq.seen[s].x, y: hq.seen[s].y });
  // Une chasse par jour au plus, sur la batterie connue la plus fraîchement repérée (la DCA d'abord), en gardant
  // au moins une sortie pour l'appui.
  if (n > 1 && front.air[s].length < n - 1) {
    let pick = null;
    for (const b of [...front.aa, ...front.guns]) {
      if (b.side === s || b.lost) continue;
      const k = known(front, s, b);
      if (k && (!pick || k.clock > pick.clock)) pick = k;
    }
    if (pick) addAirMission(front, s, { x: pick.x, y: pick.y });
  }
  const threat = (x, y) => {
    let t = 0;
    for (const a of front.aa) {
      if (a.side === s || a.lost || !known(front, s, a)) continue;
      const o = airBase(front, s, { x, y });
      if (airSegDist(a.x, a.y, o.x, o.y, x, y) <= AIR.aaRange) t++;
    }
    return t;
  };
  const cand = [];
  for (const a of front.armor ?? []) if (a.side === 1 - s && !a.lost && a.seen?.[s] && front.clock - a.seen[s].clock <= 2) cand.push({ x: a.seen[s].x, y: a.seen[s].y, v: 40 });
  for (let i = 0; i < front.map.N; i++) {
    if (mem.owner[i] !== 1 - s || !(mem.est[i] > 6)) continue;
    let contact = false;
    for (let d = 0; d < 6; d++) { const j = front.map.nb[i * 6 + d]; if (j >= 0 && front.owner[j] === s) contact = true; }
    if (contact) cand.push({ x: front.centers.x[i], y: front.centers.y[i], v: mem.est[i] });
  }
  cand.sort((a, b) => b.v / (1 + threat(b.x, b.y)) - a.v / (1 + threat(a.x, a.y)));
  for (const c of cand) {
    if (front.air[s].length >= n) break;
    if (front.air[s].some((m) => Math.hypot(m.x - c.x, m.y - c.y) < AIR.strikeR * 2)) continue;
    addAirMission(front, s, c);
  }
}
