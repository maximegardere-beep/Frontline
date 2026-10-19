// Regroupement de nuit : l'état-major de chaque camp déplace seul des troupes d'un secteur calme vers le secteur le
// plus menacé, derrière les lignes (pas sans PC en état, voir fronthq.js). Affiché le matin.
// La route décide de tout : par une route tenue, on emmène beaucoup d'hommes loin ; à travers champs, peu et près.
// Le chemin de marche passe par nos propres cases (Dijkstra) ; une case de route coûte 4 fois moins qu'une case de
// steppe, la forêt et le marais davantage.

import { staffBlocked } from './fronthq.js';
import { bfsDistance } from './path.js';
import { priorityCell } from './frontregiment.js';

export const NIGHT = {
  reach: 6, // coût de marche d'une nuit (une case de steppe = 1, de route = 0,25)
  roadCost: 0.25,
  roadShare: 0.5, // part de route du chemin au-delà de laquelle le transfert compte « par la route »
  cap: { road: 60, field: 15 }, // densité transportée au plus (× 10 hommes)
  take: 0.5, // part au plus de chaque case de départ
  radius: 2, // cases autour du départ et de l'arrivée
  auto: [1, 2], // transferts de l'état-major par nuit : camp du joueur, camp de l'IA
  band: 8, // lignes de carte par secteur (état-major)
  spare: 1, // vers le secteur prioritaire : on ne prélève que là où l'on tient au moins à égalité (menace < spare)
};

let nextTransferId = 1;

// Chemin de marche de la case a à la case b dans les lignes du camp s : { cells, cost, road } ou null. maxCost : coût
// au-delà duquel on cesse de chercher (une nuit par défaut ; les régiments motorisés roulent plusieurs jours).
export function transferPath(front, s, a, b, maxCost = NIGHT.reach * 2) {
  const { N, nb } = front.map;
  if (front.owner[a] !== s || front.owner[b] !== s) return null;
  const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  dist[a] = 0;
  const heap = [[0, a]];
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  const push = (e) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  while (heap.length) {
    const [d, k] = pop();
    if (d > dist[k]) continue;
    if (k === b) break;
    if (d > maxCost) break; // inutile de chercher bien au-delà
    for (let q = 0; q < 6; q++) {
      const j = nb[k * 6 + q];
      if (j < 0 || front.owner[j] !== s || front.map.flow[j] <= 0) continue;
      const step = front.map.road?.[j] && front.map.road?.[k] ? NIGHT.roadCost : 1 / Math.max(0.35, front.map.flow[j]);
      const nd = d + step;
      if (nd < dist[j]) { dist[j] = nd; prev[j] = k; push([nd, j]); }
    }
  }
  if (!Number.isFinite(dist[b])) return null;
  const cells = [];
  for (let k = b; k >= 0; k = prev[k]) cells.push(k);
  cells.reverse();
  const roads = cells.filter((k) => front.map.road?.[k]).length;
  return { cells, cost: dist[b], road: cells.length > 2 && roads / cells.length >= NIGHT.roadShare };
}

// Cases du camp s à moins de NIGHT.radius de i (pondérées par la proximité).
function around(front, s, i) {
  const dist = bfsDistance(front.map.nb, front.map.N, [i], (j) => front.owner[j] === s, NIGHT.radius);
  const out = [];
  for (let j = 0; j < front.map.N; j++) if (dist[j] <= NIGHT.radius && front.owner[j] === s) out.push([j, Math.exp(-((dist[j] / 1.5) ** 2))]);
  return out;
}

// Déplace jusqu'à la capacité du chemin, des environs de a vers ceux de b. Renvoie le transfert ou { error }.
export function moveTroops(front, s, a, b, { want = Infinity } = {}) {
  const path = transferPath(front, s, a, b);
  if (!path || path.cells.length < 2) return { error: 'Transfert impossible : départ et arrivée doivent être reliés par vos lignes.' };
  if (path.cost > NIGHT.reach) return { error: `Trop loin pour une nuit de marche (${path.road ? 'même par la route' : 'à travers champs ; une route porte bien plus loin'}).` };
  const cap = Math.min(want, path.road ? NIGHT.cap.road : NIGHT.cap.field);
  const src = around(front, s, a).filter(([j]) => !path.cells.includes(j) || j === a);
  const avail = src.reduce((t, [j, w]) => t + front.dens[j] * NIGHT.take * w, 0);
  const amount = Math.min(cap, avail);
  if (amount < 1) return { error: 'Presque personne à déplacer ici.' };
  const taken = src.map(([j, w]) => [j, (front.dens[j] * NIGHT.take * w * amount) / avail]);
  for (const [j, v] of taken) front.dens[j] -= v;
  const dst = around(front, s, b);
  const tw = dst.reduce((t, [j, w]) => t + w * front.map.flow[j], 0) || 1;
  const placed = dst.map(([j, w]) => [j, (amount * w * front.map.flow[j]) / tw]);
  for (const [j, v] of placed) front.dens[j] += v;
  const c = (k) => ({ x: front.centers.x[k], y: front.centers.y[k] });
  return { id: 100000 + nextTransferId++, side: s, from: c(a), to: c(b), amount, road: path.road, path: path.cells, taken, placed, day: front.day };
}

// La nuit : l'état-major de chaque camp prélève sur son secteur le plus calme pour renforcer le plus menacé.
// Secteurs : bandes de NIGHT.band lignes ; menace = densité ennemie connue au contact / nos troupes au contact.
// Secteur prioritaire (fanion, frontregiment.js) : le premier regroupement va vers lui, quelle que soit la menace,
// pris sur le secteur le plus calme qu'une nuit de marche relie (où l'on tient au moins à égalité) ; les suivants,
// vers les plus menacés.
export function staffNight(front) {
  const { W, H, N, nb } = front.map;
  front.nightMoves = [];
  for (const s of [0, 1]) {
    const n = NIGHT.auto[s === front.playerSide ? 0 : 1];
    if (!n || staffBlocked(front, s)) continue;
    const mem = front.memory?.[s];
    const contact = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (front.owner[i] !== s) continue;
      for (let d = 0; d < 6; d++) { const j = nb[i * 6 + d]; if (j >= 0 && front.owner[j] === 1 - s) { contact[i] = 1; break; } }
    }
    const dist = bfsDistance(nb, N, [...contact.keys()].filter((i) => contact[i]), (i) => front.owner[i] === s, 6);
    const bands = [];
    for (let b0 = 0; b0 < H; b0 += NIGHT.band) {
      let own = 0, foe = 0, src = -1, dst = -1;
      for (let row = b0; row < Math.min(H, b0 + NIGHT.band); row++) {
        for (let col = 0; col < W; col++) {
          const i = row * W + col;
          if (front.owner[i] === s && dist[i] <= 2) own += front.dens[i];
          if (front.owner[i] === 1 - s) {
            let near = false;
            for (let d = 0; d < 6 && !near; d++) { const j = nb[i * 6 + d]; if (j >= 0 && contact[j]) near = true; }
            if (near) foe += mem ? mem.est[i] : front.dens[i];
          }
          // Départ : une case un peu en retrait, bien garnie ; arrivée : une case de contact au milieu du secteur.
          if (front.owner[i] === s && dist[i] === 2 && (src < 0 || front.dens[i] > front.dens[src])) src = i;
          if (contact[i] && (dst < 0 || Math.abs(row - (b0 + NIGHT.band / 2)) < Math.abs(Math.floor(dst / W) - (b0 + NIGHT.band / 2)))) dst = i;
        }
      }
      if (own > 0 && src >= 0 && dst >= 0) bands.push({ ratio: foe / own, src, dst, own, b0 });
    }
    bands.sort((a, b) => b.ratio - a.ratio);
    let made = 0;
    const flag = priorityCell(front, s);
    if (flag >= 0) {
      const row = Math.floor(flag / W);
      for (const calm of [...bands].reverse()) {
        if (calm.ratio >= NIGHT.spare || (row >= calm.b0 && row < calm.b0 + NIGHT.band)) continue;
        const t = moveTroops(front, s, calm.src, flag);
        if (t.error) continue;
        t.priority = true;
        front.nightMoves.push(t);
        made++;
        break;
      }
    }
    for (const hot of bands) {
      if (made >= n || hot.ratio < 0.7) break;
      // Le secteur le plus calme qu'une nuit de marche permet d'atteindre.
      for (const calm of [...bands].reverse()) {
        if (calm === hot || calm.ratio > hot.ratio * 0.6) continue;
        const t = moveTroops(front, s, calm.src, hot.dst);
        if (t.error) continue;
        front.nightMoves.push(t);
        made++;
        break;
      }
    }
  }
}
