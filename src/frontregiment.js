// Régiments motorisés et secteur prioritaire du front stratégique.
//
// Régiment motorisé : une réserve mobile, un pion (quelques camions) qui porte ses hommes hors de la densité du front.
// Le matin, on lui donne une destination dans ses lignes ravitaillées : il y roule pendant la journée, vite par la
// route, lentement à travers champs (chemin le plus rapide par nos propres cases, comme les regroupements de nuit).
// Engagé, il verse d'un coup ses hommes dans les cases autour du point choisi (près de lui) ; le pion disparaît et le
// régiment se reconstitue deux jours plus tard au PC, en puisant ses hommes dans le pool logistique (il attend si le
// pool n'y suffit pas). Vulnérable : une frappe aérienne ennemie sur sa case lui coûte des hommes ; si sa case tombe,
// il est perdu (une part des hommes se sauve dans la case amie voisine).
// Secteur prioritaire : un fanion par camp. La nuit, l'état-major regroupe vers lui plutôt que vers le secteur le plus
// menacé (frontnight.js), et les blessés rétablis y rejoignent directement le front, jusqu'à PRIORITY.cap.
// Positions en unités de grille, comme les ordres.

import { pixelToHex } from './hex.js';
import { bfsDistance } from './path.js';
import { transferPath } from './frontnight.js';

export const REGIMENT = {
  men: 600, // hommes par régiment (densité : men / cfg.men)
  speed: 0.45, // coût de marche par tick (case de steppe 1, de route 0,25) : ~40 cases par jour sur route, ~10 à travers champs
  search: 80, // coût de marche au plus pour chercher un chemin (plusieurs journées)
  engage: 5.3, // rayon d'engagement autour du régiment (~3 cases)
  spread: 3, // cases autour du point d'engagement
  rebuild: 2, // jours avant la reconstitution au PC
  air: 0.12, // part des hommes perdue par tick de frappe aérienne ennemie sur sa case, à pleine puissance
  airR: 0.6, // marge autour de la zone frappée
  escape: 1 / 3, // part des hommes qui se sauvent quand sa case tombe
  back: 12, // placement initial derrière le contact, sans PC
};

export const PRIORITY = { cap: 40 }; // blessés rétablis déposés autour du fanion chaque nuit, au plus (densité)

// Numéros des régiments, par camp (noms à la suite si la bataille en compte plus).
const REG_NUMBERS = [[33, 52, 104, 115], [17, 26, 44, 59]];
const regName = (s, n) => (s === 0 ? `Schützen-Rgt. (mot.) ${n}` : `Rgt. de fusiliers motorisés ${n}`);

let nextRegOrder = 300000;

export const regimentDens = (front) => REGIMENT.men / front.cfg.men;
// Densité retirée de la répartition initiale pour former les régiments du camp s.
export const regimentTroops = (cfg, s) => ((cfg.regiments?.[s] ?? 0) * REGIMENT.men) / cfg.men;
export const regimentReady = (r) => r && !r.lost && !r.engaged;
// Hommes (densité) des régiments en état du camp s : ils comptent dans ses effectifs.
export const regimentMenOf = (front, s) => (front.regiments ?? []).filter((r) => r.side === s && regimentReady(r)).reduce((a, r) => a + r.dens, 0);

function regCellAt(front, p) {
  const h = pixelToHex(p.x, p.y, 1), { W, H } = front.map;
  return h.col < 0 || h.row < 0 || h.col >= W || h.row >= H ? -1 : h.row * W + h.col;
}

const regPlace = (front, r, i) => { r.cell = i; r.x = front.centers.x[i]; r.y = front.centers.y[i]; };

// Case de repos d'un régiment près du point want : à soi, ravitaillée, praticable, de préférence sur une route.
function parkingNear(front, s, want, taken = []) {
  const cx = front.centers.x, cy = front.centers.y;
  let best = -1, bv = Infinity;
  for (let i = 0; i < front.map.N; i++) {
    if (front.owner[i] !== s || front.map.flow[i] <= 0 || !front.supplied[s][i] || taken.includes(i)) continue;
    const v = Math.hypot(cx[i] - want.x, cy[i] - want.y) - (front.map.road?.[i] ? 2.5 : 0);
    if (v < bv) { bv = v; best = i; }
  }
  return best;
}

// Point de rassemblement du k-ième régiment sur n : près du PC (s'il y en a un), sinon loin derrière le contact.
function musterPoint(front, s, k, n) {
  const h = front.hq?.[s];
  const dy = (k - (n - 1) / 2) * 4.5;
  if (h && !h.captured) return { x: h.x - (s === 0 ? 2 : -2), y: h.y + dy };
  const { W, H } = front.map;
  const row = Math.max(0, Math.min(H - 1, Math.round(((k + 0.5) / n) * H)));
  let edge = -1;
  for (let c = 0; c < W; c++) {
    const i = row * W + (s === 0 ? c : W - 1 - c);
    if (front.owner[i] === 1 - s) break;
    if (front.owner[i] === s) edge = i;
  }
  const x = edge >= 0 ? front.centers.x[edge] - (s === 0 ? 1 : -1) * REGIMENT.back : s === 0 ? 10 : front.centers.x[W - 1] - 10;
  return { x, y: front.centers.y[row * W] };
}

// Régiments de départ : cfg.regiments par camp, rassemblés près du PC, sur les routes autant que possible.
export function createRegiments(front) {
  const out = [];
  let id = 1;
  for (const s of [0, 1]) {
    const n = front.cfg.regiments?.[s] ?? 0;
    const taken = [];
    for (let k = 0; k < n; k++) {
      const i = parkingNear(front, s, musterPoint(front, s, k, n), taken);
      if (i < 0) continue;
      taken.push(i);
      const r = {
        id: id++, side: s, name: regName(s, REG_NUMBERS[s][k] ?? 100 + k * 7), dens: regimentDens(front),
        cell: i, x: 0, y: 0, dir: s === 0 ? 0 : Math.PI, dest: null, route: null, at: 0, budget: 0, from: null,
        engaged: null, back: 0, lost: false, moved: false, seen: [null, null],
      };
      regPlace(front, r, i);
      out.push(r);
    }
  }
  return out;
}

// Ordre du matin : rouler vers le point p, dans ses lignes ravitaillées (p = null : halte).
export function setRegimentOrder(front, s, id, p) {
  if (front.phase !== 'plan') return { error: 'Les ordres se donnent le matin.' };
  const r = front.regiments?.find((x) => x.id === id && x.side === s);
  if (!r || r.lost) return { error: 'Régiment introuvable.' };
  if (r.engaged) return { error: `${r.name} est engagé : il se reconstitue au PC.` };
  if (!p) { r.dest = null; r.route = null; return r; }
  const i = regCellAt(front, p);
  if (i < 0 || front.owner[i] !== s || front.map.flow[i] <= 0 || !front.supplied[s][i]) return { error: 'Un régiment roule vers vos lignes ravitaillées.' };
  if (i === r.cell) { r.dest = null; r.route = null; return r; }
  const path = transferPath(front, s, r.cell, i, REGIMENT.search);
  if (!path) return { error: 'Aucun chemin par vos lignes jusque-là.' };
  r.dest = { cell: i, x: front.centers.x[i], y: front.centers.y[i] };
  r.route = path.cells;
  r.at = 0;
  r.cost = path.cost;
  r.road = path.road;
  r.orderId = nextRegOrder++;
  return r;
}

// Journées de route estimées pour un trajet de coût cost.
export const regimentDays = (front, cost) => cost / (REGIMENT.speed * front.cfg.ticks);

// Verse amount (densité) dans les cases du camp s autour de la case i, au plus à radius cases par ses lignes
// (ravitaillées seulement si supplied), pondérées par la proximité et la fluidité. Renvoie [[case, densité]…] ou null.
export function spreadMen(front, s, i, amount, { radius = 3, supplied = true } = {}) {
  const { map } = front;
  const ok = (j) => front.owner[j] === s && (!supplied || front.supplied[s][j]);
  const dist = bfsDistance(map.nb, map.N, [i], ok, radius);
  const cells = [];
  let tw = 0;
  for (let j = 0; j < map.N; j++) {
    if (dist[j] > radius) continue;
    const w = Math.exp(-((dist[j] / 2) ** 2)) * map.flow[j];
    if (w > 0) { cells.push([j, w]); tw += w; }
  }
  if (!tw) return null;
  const placed = cells.map(([j, w]) => [j, (amount * w) / tw]);
  for (const [j, a] of placed) front.dens[j] += a;
  return placed;
}

// Engagement : les hommes du régiment montent en ligne autour du point p (une case à soi près de lui), tout de suite.
export function engageRegiment(front, s, id, p = null) {
  if (front.phase !== 'plan' && front.phase !== 'ai') return { error: 'Un régiment s\'engage le matin.' };
  const r = front.regiments?.find((x) => x.id === id && x.side === s);
  if (!r || r.lost) return { error: 'Régiment introuvable.' };
  if (r.engaged) return { error: `${r.name} est déjà engagé.` };
  const at = p ?? { x: r.x, y: r.y };
  const i = regCellAt(front, at);
  if (i < 0 || front.owner[i] !== s) return { error: 'Engagez-le dans vos lignes.' };
  if (Math.hypot(front.centers.x[i] - r.x, front.centers.y[i] - r.y) > REGIMENT.engage) return { error: `Trop loin : un régiment s'engage à ${Math.round(REGIMENT.engage / 1.73)} cases de lui au plus ; faites-le rouler d'abord.` };
  const placed = spreadMen(front, s, i, r.dens, { radius: REGIMENT.spread, supplied: false });
  if (!placed) return { error: 'Engagez-le dans vos lignes.' };
  r.engaged = { id: nextRegOrder++, day: front.day, i, x: front.centers.x[i], y: front.centers.y[i], placed, dens: r.dens, dest: r.dest, route: r.route };
  r.back = front.day + REGIMENT.rebuild;
  r.dest = null;
  r.route = null;
  return r;
}

// Retrait d'un ordre du matin (liste des ordres) : la marche prévue, ou l'engagement de ce matin.
export function removeRegimentOrder(front, s, id) {
  for (const r of front.regiments ?? []) {
    if (r.side !== s) continue;
    if (r.dest && r.orderId === id && front.phase === 'plan') { r.dest = null; r.route = null; return true; }
    const e = r.engaged;
    if (e && e.id === id && e.day === front.day && front.phase === 'plan') {
      for (const [j, a] of e.placed) front.dens[j] = Math.max(0, front.dens[j] - a);
      r.engaged = null;
      r.back = 0;
      r.dest = e.dest;
      r.route = e.route;
      return true;
    }
  }
  return false;
}

// Ordres des régiments du camp s ce matin : marches et engagements, pour la liste des ordres.
export function regimentOrders(front, s) {
  const out = [];
  for (const r of front.regiments ?? []) {
    if (r.side !== s || r.lost) continue;
    if (r.dest) out.push({ kind: 'move', id: r.orderId, r });
    if (r.engaged?.day === front.day) out.push({ kind: 'engage', id: r.engaged.id, r });
  }
  return out;
}

const regLog = (front, text, side) => front.log.push({ day: front.day, tick: front.tick, kind: 'regiment', text, side });

// Pas de marche d'une case à la suivante (mêmes coûts que le chemin, frontnight.js).
function stepCost(front, a, b) {
  const road = front.map.road;
  return road?.[a] && road?.[b] ? 0.25 : 1 / Math.max(0.35, front.map.flow[b]);
}

// Chaque tick, après les prises : un régiment dont la case est tombée est perdu ; les autres roulent.
// speedK : météo (la pluie embourbe les camions comme les chars).
export function regimentTick(front, speedK = 1) {
  const { nb } = front.map;
  for (const r of front.regiments ?? []) {
    if (!regimentReady(r)) continue;
    const s = r.side;
    r.from = { x: r.x, y: r.y };
    if (front.owner[r.cell] !== s) {
      let back = -1;
      for (let d = 0; d < 6; d++) { const j = nb[r.cell * 6 + d]; if (j >= 0 && front.owner[j] === s && (back < 0 || front.dens[j] > front.dens[back])) back = j; }
      if (front.owner[r.cell] < 0 && back >= 0) { regPlace(front, r, back); continue; } // pont coupé : il recule sur la rive
      // Débordé : une part des hommes se sauve dans la case amie voisine, le reste est perdu avec les camions.
      const saved = back >= 0 ? r.dens * REGIMENT.escape : 0;
      if (back >= 0) front.dens[back] += saved;
      front.stats.losses[s] += r.dens - saved;
      if (front.stats.pocket) front.stats.pocket[s] += r.dens - saved;
      r.lost = true;
      r.dest = null;
      regLog(front, `${r.name} (${s === 0 ? 'Wehrmacht' : 'Armée rouge'}) est surpris et détruit${saved ? ` ; ${Math.round(saved * front.cfg.men)} hommes rejoignent les lignes` : ''}.`, s);
      continue;
    }
    if (!r.dest) continue;
    r.budget += REGIMENT.speed * speedK;
    for (let guard = 0; guard < 60; guard++) {
      let route = r.route;
      const next = route?.[r.at + 1];
      if (!route || route[r.at] !== r.cell || next == null || front.owner[next] !== s) {
        // Le front a bougé : nouveau chemin (ou halte s'il n'y en a plus).
        const path = front.owner[r.dest.cell] === s ? transferPath(front, s, r.cell, r.dest.cell, REGIMENT.search) : null;
        if (!path || path.cells.length < 2) { r.dest = null; r.route = null; r.budget = 0; break; }
        r.route = route = path.cells;
        r.at = 0;
      }
      const j = route[r.at + 1];
      const c = stepCost(front, r.cell, j);
      if (r.budget < c) break;
      r.budget -= c;
      r.dir = Math.atan2(front.centers.y[j] - r.y, front.centers.x[j] - r.x);
      regPlace(front, r, j);
      r.at++;
      r.moved = true;
      if (j === r.dest.cell) { r.dest = null; r.route = null; r.budget = 0; break; }
    }
  }
}

// Frappe aérienne du camp s (mission m, rayon R) : les régiments ennemis pris dans la zone perdent des hommes.
export function regimentsUnderAir(front, s, m, R) {
  for (const r of front.regiments ?? []) {
    if (r.side !== 1 - s || !regimentReady(r) || Math.hypot(r.x - m.x, r.y - m.y) > R + REGIMENT.airR) continue;
    const l = r.dens * REGIMENT.air * m.power;
    r.dens -= l;
    front.stats.losses[r.side] += l;
    r.seen[s] = { x: r.x, y: r.y, dir: r.dir, clock: front.clock };
  }
}

// La nuit : les régiments engagés depuis assez longtemps se reconstituent au PC, sur le pool logistique ; les autres
// refont le plein (budget de marche remis à zéro). Le fanion d'un secteur perdu tombe.
export function regimentNight(front) {
  for (const r of front.regiments ?? []) {
    r.budget = 0;
    r.moved = false;
    r.from = null;
    if (r.lost || !r.engaged || front.day + 1 < r.back) continue;
    const s = r.side, need = regimentDens(front);
    if (front.reserve[s] < need) continue; // le pool n'y suffit pas : il attend
    const i = parkingNear(front, s, musterPoint(front, s, 0, 1));
    if (i < 0) continue;
    front.reserve[s] -= need;
    r.dens = need;
    r.engaged = null;
    r.dest = null;
    r.route = null;
    r.seen = [null, null];
    regPlace(front, r, i);
    regLog(front, `${r.name} est reconstitué près du PC.`, s);
  }
  for (const s of [0, 1]) {
    const p = front.priority?.[s];
    if (p != null && front.owner[p] !== s) front.priority[s] = null;
  }
}

// Ce que le camp s sait des régiments ennemis : repérés si leur case est en vue.
export function updateRegimentSightings(front) {
  for (const r of front.regiments ?? []) {
    const s = 1 - r.side;
    if (!regimentReady(r)) { r.seen[s] = null; continue; }
    if (front.vision[s]?.[r.cell]) r.seen[s] = { x: r.x, y: r.y, dir: r.dir, clock: front.clock };
  }
}

// Régiments visibles pour viewer (null : tous) : les siens, et ceux de l'ennemi vus depuis moins d'un jour.
export function visibleRegiments(front, viewer) {
  const out = [];
  for (const r of front.regiments ?? []) {
    if (!regimentReady(r)) continue;
    if (viewer === null || r.side === viewer) { out.push({ r, x: r.x, y: r.y, dir: r.dir, known: true, own: viewer !== null }); continue; }
    const k = r.seen[viewer];
    if (k && front.clock - k.clock <= front.cfg.ticks) out.push({ r, x: k.x, y: k.y, dir: k.dir, known: front.clock - k.clock <= 1, own: false });
  }
  return out;
}

// ---------- Secteur prioritaire ----------

// Fanion du camp s sur le point p (une case à soi) ; toucher de nouveau la même case le retire (toggle).
export function setPriority(front, s, p, toggle = true) {
  if (front.phase !== 'plan' && front.phase !== 'ai') return { error: 'Les ordres se donnent le matin.' };
  front.priority ??= [null, null];
  if (!p) { front.priority[s] = null; return { cell: null }; }
  const i = regCellAt(front, p);
  if (i < 0 || front.owner[i] !== s || front.map.flow[i] <= 0) return { error: 'Le secteur prioritaire se marque dans vos lignes.' };
  const cur = front.priority[s];
  if (toggle && cur != null && Math.hypot(front.centers.x[cur] - front.centers.x[i], front.centers.y[cur] - front.centers.y[i]) < 2) {
    front.priority[s] = null;
    return { cell: null, removed: true };
  }
  front.priority[s] = i;
  return { cell: i };
}

// Fanion du camp s encore valable (dans ses lignes ravitaillées), ou −1.
export function priorityCell(front, s) {
  const p = front.priority?.[s];
  return p != null && front.owner[p] === s && front.supplied[s][p] ? p : -1;
}

// La nuit : les blessés rétablis (amount, densité) rejoignent le front autour du fanion, jusqu'à PRIORITY.cap ;
// renvoie ce qui reste pour le pool logistique.
export function priorityRecover(front, s, amount) {
  const p = priorityCell(front, s);
  if (p < 0 || amount <= 0) return amount;
  const put = Math.min(PRIORITY.cap, amount);
  return spreadMen(front, s, p, put) ? amount - put : amount;
}
