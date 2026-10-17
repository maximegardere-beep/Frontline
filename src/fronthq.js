// Poste de commandement (PC) du front stratégique : un par camp, posé derrière le front, déplaçable.
// Il coordonne les troupes dans son rayon : attaque, défense et vitesse y gagnent, d'autant plus près du PC et que la
// liaison (0 à 1) est bonne. Barrages et frappes aériennes ennemis sur le PC coupent la liaison ; la nuit la rétablit.
// Désorganisé (liaison basse, ou déplacé de jour) : plus de bonus, plus de regroupement de l'état-major la nuit,
// moins de troupes engagées, et les vecteurs du jour ne partent qu'à midi. Capturé : le bonus devient un malus, et
// l'ennemi lit les documents saisis (nos formations blindées, une journée). Reprendre sa case rend le PC ; deux nuits
// sans PC, un PC de secours s'installe loin à l'arrière, au rayon réduit.
// Positions en unités de grille, comme les ordres (deux cases voisines sont à 1,73).

import { pixelToHex } from './hex.js';
import { gunPower, missionGuns, GUN_RULES } from './frontguns.js';
import { AIR } from './frontair.js';

export const HQ = {
  radius: 20, // rayon de coordination (~12 cases) ; selon le camp et l'année : cfg.hqRadius
  atk: 0.12, // bonus d'attaque au PC, à pleine liaison, décroissant jusqu'au bord du rayon
  def: 0.1, // bonus de défense
  speed: 0.15, // bonus de vitesse des vecteurs
  disorg: 0.3, // sous cette liaison, le PC est désorganisé
  barrage: 0.4, // liaison perdue par barrage ennemi sur le PC (répartie sur les ticks du barrage)
  air: 0.3, // par frappe aérienne (à pleine puissance)
  hit: 2, // marge autour de la zone pilonnée
  night: 0.5, // liaison rétablie chaque nuit
  hop: 17, // saut de nuit (~10 cases) : au-delà, le déplacement se fait de jour et désorganise
  hopLink: 0.6, // liaison au plus au matin d'un saut de nuit
  moved: 0, // liaison après un déplacement de jour
  retaken: 0.1, // liaison d'un PC repris
  engage: { disorg: 0.45, captured: 0.35 }, // part des troupes engagées au plus (engageCap 0,6)
  noon: 10, // tick de départ des vecteurs d'un PC désorganisé au matin (vers midi)
  spot: 7, // repérage par des troupes ennemies proches
  backupNights: 2, // nuits sans PC avant le PC de secours
  backupRadius: 0.5,
  back: 16, // placement initial, derrière le contact (~9 cases)
  danger: 16, // l'IA recule son PC de nuit quand l'ennemi est plus près ; de jour, en urgence, sous la moitié
};

const HQ_NAMES = [['Gefechtsstand du corps', 'Gefechtsstand de secours'], ['PC de l\'armée', 'PC de secours']];

function hqCellAt(front, x, y) {
  const h = pixelToHex(x, y, 1), { W, H } = front.map;
  return h.col < 0 || h.row < 0 || h.col >= W || h.row >= H ? -1 : h.row * W + h.col;
}

// Case amie la plus proche d'un point (hors montagne ; ravitaillée si demandé).
function ownCellNear(front, s, p, supplied = false) {
  const cx = front.centers.x, cy = front.centers.y;
  let best = -1, bd = Infinity;
  for (let i = 0; i < front.map.N; i++) {
    if (front.owner[i] !== s || front.map.flow[i] <= 0 || (supplied && !front.supplied[s][i])) continue;
    const d = Math.hypot(cx[i] - p.x, cy[i] - p.y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Abscisse du contact sur une ligne (ou NaN).
function contactX(front, s, row) {
  const { W, nb } = front.map;
  let x = NaN;
  for (let col = 0; col < W; col++) {
    const i = row * W + col;
    if (front.owner[i] !== s) continue;
    for (let d = 0; d < 6; d++) {
      const j = nb[i * 6 + d];
      if (j >= 0 && front.owner[j] === 1 - s) { x = Number.isNaN(x) ? front.centers.x[i] : s === 0 ? Math.max(x, front.centers.x[i]) : Math.min(x, front.centers.x[i]); break; }
    }
  }
  return x;
}

const place = (front, h, i) => { h.cell = i; h.x = front.centers.x[i]; h.y = front.centers.y[i]; };

// PC de départ : derrière le front, à hauteur des blindés de l'attaquant (son effort), au centre pour le défenseur.
export function createHQ(front) {
  const { W, H } = front.map;
  return [0, 1].map((s) => {
    const own = (front.armor ?? []).filter((a) => a.side === s && !a.lost);
    let row = own.length ? Math.round(((own.reduce((a, u) => a + u.y, 0) / own.length) - 1) / 1.5) : Math.floor(H / 2);
    row = Math.max(2, Math.min(H - 3, row));
    let x = contactX(front, s, row);
    if (Number.isNaN(x)) x = s === 0 ? front.centers.x[W - 1] / 2 : front.centers.x[W - 1] / 2;
    const want = { x: x - (s === 0 ? 1 : -1) * HQ.back, y: front.centers.y[row * W] };
    const h = {
      side: s, name: HQ_NAMES[s][0], x: 0, y: 0, cell: -1, link: 1, captured: false, capturedNights: 0, backup: false,
      radius: front.cfg.hqRadius?.[s] ?? HQ.radius, loss: front.cfg.hqLoss?.[s] ?? 1, dest: null, late: false, seen: [null, null],
    };
    place(front, h, ownCellNear(front, s, want));
    return h;
  });
}

export const hqState = (h) => (!h ? 'none' : h.captured ? 'captured' : h.link < HQ.disorg ? 'disorg' : 'ok');
export const HQ_STATE_LABEL = { ok: 'opérationnel', disorg: 'désorganisé', captured: 'capturé', none: 'aucun' };

// Coefficient de coordination au PC (−loss à +1) : multiplié ensuite par la proximité.
function amplitude(h) {
  const st = hqState(h);
  return st === 'captured' ? -h.loss : st === 'disorg' ? 0 : h.link;
}

// Coordination d'une case (pour l'affichage et les tests) : de −loss à +1.
export function hqCoord(front, s, i) {
  const h = front.hq?.[s];
  if (!h) return 0;
  const d = Math.hypot(front.centers.x[i] - h.x, front.centers.y[i] - h.y);
  return d >= h.radius ? 0 : amplitude(h) * (1 - d / h.radius);
}

// Dans rebuildFields : bonus (ou malus) de coordination sur le champ du camp s.
export function applyHQ(front, s, F) {
  const h = front.hq?.[s];
  if (!h) return;
  const amp = amplitude(h);
  if (!amp) return;
  const cx = front.centers.x, cy = front.centers.y, R = h.radius;
  for (let i = 0; i < front.map.N; i++) {
    if (front.owner[i] !== s || Math.abs(cx[i] - h.x) >= R) continue;
    const d = Math.hypot(cx[i] - h.x, cy[i] - h.y);
    if (d >= R) continue;
    const k = amp * (1 - d / R);
    F.atk[i] *= 1 + HQ.atk * k;
    F.speed[i] *= 1 + HQ.speed * k;
    F.fort[i] *= 1 + HQ.def * k;
  }
}

// Part des troupes engagées au plus, selon l'état du PC.
export function engageCapOf(front, s) {
  const st = hqState(front.hq?.[s]);
  const cap = front.cfg.engageCap;
  return st === 'disorg' || st === 'captured' ? Math.min(cap, HQ.engage[st]) : cap;
}

// Les vecteurs d'un PC désorganisé au matin attendent midi.
export const ordersWait = (front, s) => !!front.hq?.[s]?.late && front.phase === 'resolve' && front.tick < HQ.noon;

// Pas de regroupement de nuit par l'état-major sans PC en état.
export const staffBlocked = (front, s) => !!front.hq && hqState(front.hq[s]) !== 'ok';

// Ordre du matin : déplacer le PC (p = null annule). Un saut court se fait de nuit ; plus loin, de jour, et le PC est
// désorganisé pour la journée.
export function moveHQ(front, s, p) {
  if (front.phase !== 'plan') return { error: 'Les ordres se donnent le matin.' };
  const h = front.hq?.[s];
  if (!h) return { error: 'Pas de poste de commandement.' };
  if (h.captured) return { error: 'Le PC est aux mains de l\'ennemi.' };
  if (!p) { h.dest = null; return h; }
  const i = hqCellAt(front, p.x, p.y);
  if (i < 0 || front.owner[i] !== s || front.map.flow[i] <= 0) return { error: 'Le PC s\'installe dans vos lignes.' };
  if (i === h.cell) { h.dest = null; return h; }
  const d = Math.hypot(front.centers.x[i] - h.x, front.centers.y[i] - h.y);
  h.dest = { cell: i, x: front.centers.x[i], y: front.centers.y[i], night: d <= HQ.hop };
  return h;
}

const hqLog = (front, text, side) => front.log.push({ day: front.day, tick: front.tick, kind: 'hq', text, side });
const HQ_SIDE_NAME = ['la Wehrmacht', 'l\'Armée rouge'];

// Début de journée (après les ordres) : le déplacement de jour se fait, et le PC désorganisé retarde ses vecteurs.
export function hqDawn(front) {
  for (const h of front.hq ?? []) {
    if (h.dest && !h.dest.night && !h.captured) {
      if (front.owner[h.dest.cell] === h.side) {
        place(front, h, h.dest.cell);
        h.link = Math.min(h.link, HQ.moved);
        h.seen[1 - h.side] = { x: h.x, y: h.y, clock: front.clock }; // une colonne d'état-major en plein jour se voit
      }
      h.dest = null;
    }
    h.late = hqState(h) !== 'ok';
  }
}

// Chaque tick (avant le combat) : barrages et frappes ennemis sur le PC coupent la liaison et le dévoilent.
export function hqTick(front, events) {
  for (const h of front.hq ?? []) {
    if (h.captured) continue;
    const o = 1 - h.side;
    const before = hqState(h);
    if (front.tick < front.cfg.barrageTicks) {
      for (const b of front.barrages[o]) {
        // Barrage focalisé : les groupes engagés s'additionnent (une fois et demie un groupe au plus).
        let p = 0;
        for (const id of missionGuns(b)) { const g = front.guns.find((x) => x.id === id); p += g ? gunPower(g) : 0; }
        p = Math.min(1.5, p) * (b.focus ? GUN_RULES.focus : 1);
        if (p <= 0 || Math.hypot(b.x - h.x, b.y - h.y) > b.r + HQ.hit) continue;
        h.link = Math.max(0, h.link - (HQ.barrage * p) / front.cfg.barrageTicks);
        h.seen[o] = { x: h.x, y: h.y, clock: front.clock };
      }
    }
    if (AIR.strikeTicks.includes(front.tick)) {
      for (const m of front.air[o]) {
        if (m.kind !== 'strike' || !(m.power > 0) || Math.hypot(m.x - h.x, m.y - h.y) > AIR.strikeR + HQ.hit) continue;
        h.link = Math.max(0, h.link - (HQ.air * m.power) / AIR.strikeTicks.length);
        h.seen[o] = { x: h.x, y: h.y, clock: front.clock };
      }
    }
    if (before === 'ok' && hqState(h) === 'disorg') {
      events.push({ kind: 'hqDisorg', side: h.side });
      hqLog(front, `${h.name} (${HQ_SIDE_NAME[h.side]}) pilonné : liaisons coupées, le commandement est désorganisé.`, h.side);
    }
  }
}

// Après les prises du tick : PC capturé (documents saisis) ou repris.
export function hqAfter(front, events) {
  for (const h of front.hq ?? []) {
    const own = front.owner[h.cell] === h.side;
    if (!h.captured && !own) {
      h.captured = true;
      h.capturedNights = 0;
      h.dest = null;
      front.docs ??= [-1, -1];
      front.docs[1 - h.side] = front.clock + front.cfg.ticks;
      events.push({ kind: 'hqLost', side: h.side });
      hqLog(front, `${h.name} (${HQ_SIDE_NAME[h.side]}) est pris : l'ennemi saisit ses documents.`, h.side);
    } else if (h.captured && own) {
      h.captured = false;
      h.link = HQ.retaken;
      events.push({ kind: 'hqRetaken', side: h.side });
      hqLog(front, `${h.name} (${HQ_SIDE_NAME[h.side]}) est repris ; les liaisons se rétablissent.`, h.side);
    }
  }
}

// Ce que l'ennemi sait du PC ; documents saisis : les formations blindées du camp qui a perdu son PC.
export function hqSightings(front) {
  const cx = front.centers.x, cy = front.centers.y;
  for (const h of front.hq ?? []) {
    const o = 1 - h.side;
    let spotted = h.captured;
    for (let i = 0; i < front.map.N && !spotted; i++) {
      if (front.owner[i] !== o || front.dens[i] <= 0.5 || Math.abs(cx[i] - h.x) > HQ.spot) continue;
      if (Math.hypot(cx[i] - h.x, cy[i] - h.y) <= HQ.spot) spotted = true;
    }
    if (spotted) h.seen[o] = { x: h.x, y: h.y, clock: front.clock };
  }
  for (const s of [0, 1]) {
    if (!(front.docs?.[s] >= front.clock)) continue;
    for (const a of front.armor ?? []) if (a.side !== s && !a.lost) a.seen[s] = { x: a.x, y: a.y, dir: a.dir, clock: front.clock, tanks: a.tanks };
  }
}

// La nuit : liaison rétablie, saut de nuit, PC de secours après deux nuits sans PC.
export function hqNight(front) {
  for (const h of front.hq ?? []) {
    h.late = false;
    if (h.captured) {
      if (++h.capturedNights < HQ.backupNights) continue;
      const W = front.map.W;
      const i = ownCellNear(front, h.side, { x: h.side === 0 ? 10 : front.centers.x[W - 1] - 10, y: front.centers.y[Math.floor(front.map.H / 2) * W] }, true);
      if (i < 0) continue;
      place(front, h, i);
      Object.assign(h, { captured: false, capturedNights: 0, backup: true, name: HQ_NAMES[h.side][1], radius: h.radius * HQ.backupRadius, link: HQ.night, seen: [null, null] });
      hqLog(front, `${HQ_SIDE_NAME[h.side][0].toUpperCase()}${HQ_SIDE_NAME[h.side].slice(1)} installe un PC de secours loin à l'arrière.`, h.side);
      continue;
    }
    h.link = Math.min(1, h.link + HQ.night);
    if (h.dest?.night) {
      if (front.owner[h.dest.cell] === h.side) { place(front, h, h.dest.cell); h.link = Math.min(h.link, HQ.hopLink); }
      h.dest = null;
    }
  }
}

// IA : recule le PC menacé, le rapproche d'un front qui s'est éloigné ; toujours par sauts de nuit.
export function planHQ(front, s) {
  const h = front.hq?.[s];
  if (!h || h.captured) return;
  const cx = front.centers.x, cy = front.centers.y;
  let dE = Infinity;
  for (let i = 0; i < front.map.N; i++) {
    if (front.owner[i] !== 1 - s) continue;
    const d = Math.hypot(cx[i] - h.x, cy[i] - h.y);
    if (d < dE) dE = d;
  }
  const dir = s === 0 ? 1 : -1;
  let to = null, far = false;
  if (dE < HQ.danger / 2) {
    to = { x: h.x - dir * HQ.hop * 1.8, y: h.y }; // urgence : on décroche de jour, quitte à être désorganisé
    far = true;
  } else if (dE < HQ.danger) {
    to = { x: h.x - dir * HQ.hop * 0.85, y: h.y };
  } else if (dE > h.radius * 0.9) {
    to = { x: h.x + dir * Math.min(HQ.hop * 0.85, dE - HQ.back), y: h.y };
  }
  if (!to) return;
  const i = ownCellNear(front, s, to, true);
  if (i < 0 || (!far && Math.hypot(cx[i] - h.x, cy[i] - h.y) > HQ.hop)) return;
  moveHQ(front, s, { x: cx[i], y: cy[i] });
}

// PC visibles pour viewer (null : tous) : le sien, et celui de l'ennemi repéré depuis moins d'un jour.
export function visibleHQ(front, viewer) {
  const out = [];
  for (const h of front.hq ?? []) {
    if (viewer === null || h.side === viewer) { out.push({ h, x: h.x, y: h.y, known: true, own: true }); continue; }
    const seen = h.seen[viewer];
    if (seen && front.clock - seen.clock <= front.cfg.ticks) out.push({ h, x: seen.x, y: seen.y, known: front.clock - seen.clock <= 1, own: false });
  }
  return out;
}
