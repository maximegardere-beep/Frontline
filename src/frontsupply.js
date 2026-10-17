// Ravitaillement et usure du front stratégique.
//
// Point culminant logistique : chaque camp a une ligne de têtes de ligne (dépôts), une par ligne de carte, mesurée en
// « avancée » depuis son bord. Elle suit le front lentement : de RAIL.step par nuit (davantage s'il y a une route),
// jamais à moins de RAIL.gap du front ; si le front recule, les dépôts reculent avec lui. Au-delà de RAIL.free
// unités de grille en avant des dépôts, la poussée s'affaiblit (jusqu'à RAIL.min), les formations blindées frappent
// moins fort et brûlent plus de carburant : une percée s'essouffle d'elle-même si l'on ne tient pas ses routes.
//
// Fatigue : des troupes qui poussent s'usent (FATIGUE.gain par tick), ce qui réduit leur poussée ; la nuit en efface
// une part. Une case prise hérite de la fatigue de ses assaillants : attaquer jour après jour au même endroit coûte
// de plus en plus cher, il faut alterner les secteurs ou souffler.

import { metroSupply } from './frontmetro.js';

export const RAIL = {
  start: 6, // dépôts au départ : à cette distance derrière le front
  gap: 4, // jamais plus près du front
  step: 3.5, // avancée par nuit (deux cases)
  road: 2.5, // en plus s'il y a une route entre les dépôts et le front sur cette ligne
  free: 9, // portée sans pénalité (~5 cases)
  span: 14, // au-delà, la poussée décroît jusqu'au plancher sur cette distance
  min: 0.35,
};

export const FATIGUE = {
  gain: 0.03, // par tick de poussée
  effect: 0.45, // poussée × (1 − effect × fatigue)
  night: 0.5, // part conservée la nuit
  armorGain: 0.04,
  armorEffect: 0.4,
};

// Avancée d'une case pour le camp s : distance horizontale depuis son bord de carte.
const advOf = (front, s, i) => (s === 0 ? front.centers.x[i] : front.rightX - front.centers.x[i]);

// Avancée du front sur chaque ligne : celle de la première case ennemie depuis son bord.
function frontAdvance(front, s) {
  const { W, H } = front.map;
  const out = new Float32Array(H).fill(Infinity);
  for (let r = 0; r < H; r++) {
    for (let k = 0; k < W; k++) {
      const i = r * W + (s === 0 ? k : W - 1 - k);
      if (front.owner[i] === 1 - s) { out[r] = advOf(front, s, i); break; }
    }
  }
  return out;
}

export function initSupply(front) {
  const { W, H, N } = front.map;
  front.rightX = front.centers.x[W - 1] + 1;
  front.rail = [0, 1].map((s) => {
    const fa = frontAdvance(front, s);
    return Float32Array.from(fa, (a) => (Number.isFinite(a) ? Math.max(1, a - RAIL.start) : 999));
  });
  front.supplyK = [new Float32Array(N).fill(1), new Float32Array(N).fill(1)];
  front.fatigue = new Float32Array(N);
  updateSupplyK(front);
}

// Facteur de ravitaillement de chaque case (recalculé à chaque tick) ; les dépôts reculent si le front recule.
export function updateSupplyK(front) {
  const { W, N } = front.map;
  for (const s of [0, 1]) {
    const fa = frontAdvance(front, s), rail = front.rail[s], K = front.supplyK[s];
    for (let r = 0; r < rail.length; r++) if (Number.isFinite(fa[r])) rail[r] = Math.min(rail[r], fa[r] - RAIL.gap / 2);
    for (let i = 0; i < N; i++) {
      if (front.owner[i] !== s) continue;
      const ahead = advOf(front, s, i) - rail[Math.floor(i / W)];
      K[i] = ahead <= RAIL.free ? 1 : Math.max(RAIL.min, 1 - ((ahead - RAIL.free) / RAIL.span) * (1 - RAIL.min));
      if (!front.supplied[s][i]) K[i] = Math.min(K[i], 0.75); // encerclée : à court de tout
    }
  }
  metroSupply(front); // métropole : bacs de nuit, maisons-forteresses
}

// Nuit : les dépôts avancent vers le front (plus vite le long d'une route), lissés d'une ligne à l'autre.
export function advanceRails(front) {
  const { W, H } = front.map;
  for (const s of [0, 1]) {
    const fa = frontAdvance(front, s), rail = front.rail[s];
    const next = Float32Array.from(rail);
    for (let r = 0; r < H; r++) {
      if (!Number.isFinite(fa[r])) continue;
      let road = false;
      for (let c = 0; c < W && !road; c++) {
        const i = r * W + c;
        if (front.map.road?.[i] && front.owner[i] === s) { const a = advOf(front, s, i); if (a > rail[r] && a < fa[r]) road = true; }
      }
      next[r] = Math.min(rail[r] + RAIL.step + (road ? RAIL.road : 0), fa[r] - RAIL.gap);
      next[r] = Math.max(next[r], Math.min(rail[r], fa[r] - RAIL.gap));
    }
    // Lissage : une tête de ligne ne dépasse pas ses voisines de plus de deux pas.
    for (let r = 0; r < H; r++) {
      let lo = Infinity;
      for (let q = Math.max(0, r - 2); q <= Math.min(H - 1, r + 2); q++) lo = Math.min(lo, next[q]);
      rail[r] = Math.min(next[r], lo + 2 * RAIL.step);
    }
  }
}

// Nuit : la fatigue retombe.
export function restTroops(front) {
  const F = front.fatigue;
  for (let i = 0; i < F.length; i++) F[i] *= FATIGUE.night;
  for (const a of front.armor ?? []) a.fatigue = (a.fatigue ?? 0) * (a.fought ? FATIGUE.night : FATIGUE.night * 0.6);
}

// Point d'une tête de ligne (unités de grille) : pour le dessin.
export function railPoint(front, s, r) {
  const a = front.rail[s][r];
  const y = front.centers.y[r * front.map.W];
  return { x: s === 0 ? a : front.rightX - a, y };
}
