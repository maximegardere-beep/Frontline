// Front stratégique : logique de saisie et de lecture, sans DOM (testée dans tests/frontui.test.js).
// - choix de la case la plus pertinente autour du doigt ;
// - estimation des forces dans une zone touchée, à travers le brouillard ;
// - foyers de combat d'un tick, pour les sons.

// Case dont la poussée est surtout blindée (puissance de choc moyenne des vecteurs : infanterie 1,2, blindés 1,8).
export const ARMOR_ATK = 1.45;

// Une poche de moins de 200 hommes (enclave de montagne, débris) ne mérite ni contour, ni étiquette, ni ordre.
export const MIN_POCKET = 20;

// Poches qui comptent, les plus grosses d'abord.
export const bigPockets = (front, s) => front.pockets[s].filter((p) => p.troops >= MIN_POCKET).sort((a, b) => b.troops - a.troops);

// Fourchette d'estimation, arrondie à la centaine (au demi-millier au-delà de 4 000) : « 2 000 à 3 000 hommes ».
export function menRange(n, lo = 0.75, hi = 1.3) {
  const step = n >= 4000 ? 500 : 100;
  const a = Math.max(0, Math.floor((n * lo) / step) * step), b = Math.max(step, Math.ceil((n * hi) / step) * step);
  return `${a.toLocaleString('fr-FR')} à ${b.toLocaleString('fr-FR')} hommes`;
}

// Cases du camp s au contact de l'ennemi, tel que le camp le connaît (sa mémoire, pas la vérité).
export function contactCells(front, s) {
  const mem = front.memory[s], { nb, N } = front.map;
  const c = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (front.owner[i] !== s) continue;
    for (let d = 0; d < 6; d++) { const j = nb[i * 6 + d]; if (j >= 0 && mem.owner[j] === 1 - s) { c[i] = 1; break; } }
  }
  return c;
}

// La case la plus pertinente près du point p (unités de grille), dans un rayon R puis 2R :
// - 'push' (départ d'un vecteur) : la plus garnie, de préférence au contact (c'est elle qui poussera) ;
// - 'reserve' : une case ravitaillée, de préférence au contact ;
// - 'near' (ligne, cible d'un repli) : simplement la plus proche dans nos lignes.
// Renvoie -1 si aucune case du camp n'est à portée.
export function pickCell(front, s, p, purpose, R) {
  const { x, y } = front.centers;
  const contact = purpose === 'push' || purpose === 'reserve' ? contactCells(front, s) : null;
  let best = -1, bs = -Infinity;
  for (const radius of [R, R * 2]) {
    for (let i = 0; i < front.map.N; i++) {
      if (front.owner[i] !== s) continue;
      if (purpose === 'reserve' && !front.supplied[s][i]) continue;
      const d = Math.hypot(x[i] - p.x, y[i] - p.y);
      if (d > radius) continue;
      const near = Math.exp(-((d / radius) ** 2));
      let score;
      if (purpose === 'push') score = (front.dens[i] + 2) * (contact[i] ? 1.8 : 1) * near;
      else if (purpose === 'reserve') score = (contact[i] ? 1.6 : 1) * near;
      else score = -d;
      if (score > bs) { bs = score; best = i; }
    }
    if (best >= 0) break;
  }
  return best;
}

// Ce que le camp s sait des forces dans un rayon R autour de p (la zone prend le camp de la case touchée i).
// Nos troupes sont comptées exactement ; l'ennemi, d'après la mémoire (densité estimée), avec l'âge de la plus
// récente observation hors de vue. omni : vue sans brouillard (après la bataille).
// Renvoie { side (−1 : montagne), sum (densité), visible, age (ticks, Infinity si jamais vu) }.
export function areaReport(front, s, p, i, R = 3, omni = false) {
  const mem = front.memory[s];
  const know = (j) => (omni || front.owner[j] === s ? front.owner[j] : mem.owner[j]);
  const side = know(i);
  let sum = 0, age = Infinity, visible = false;
  if (side < 0) return { side, sum, visible, age };
  for (let j = 0; j < front.map.N; j++) {
    if (know(j) !== side) continue;
    if (Math.hypot(front.centers.x[j] - p.x, front.centers.y[j] - p.y) > R) continue;
    if (omni || side === s) { sum += front.dens[j]; continue; }
    sum += mem.est[j];
    if (front.vision[s][j]) visible = true;
    else age = Math.min(age, front.clock - mem.seen[j]);
  }
  return { side, sum, visible: visible || omni || side === s, age };
}

// Foyers de combat du dernier tick, entendus par le camp s : pertes regroupées par blocs de 8 × 8 cases, là où
// il a des troupes ou une vue. Renvoie au plus `max` foyers { x, y, loss, armor } (grille), les plus violents
// d'abord ; armor : pression des poussées blindées dans le bloc (on y entend les canons).
export function combatSpots(front, s, max = 3, block = 8) {
  const loss = front.tickLoss;
  if (!loss) return [];
  const { W, H, N } = front.map;
  const bw = Math.ceil(W / block), bh = Math.ceil(H / block);
  const sum = new Float32Array(bw * bh), sx = new Float32Array(bw * bh), sy = new Float32Array(bw * bh), arm = new Float32Array(bw * bh);
  const blockOf = (i) => Math.floor(Math.floor(i / W) / block) * bw + Math.floor((i % W) / block);
  for (let i = 0; i < N; i++) {
    const l = loss[i];
    if (!(l > 0) || !(front.owner[i] === s || front.vision[s]?.[i])) continue;
    const b = blockOf(i);
    sum[b] += l;
    sx[b] += l * front.centers.x[i];
    sy[b] += l * front.centers.y[i];
  }
  const e = front.tickEdges ?? [];
  for (let k = 0; k < e.length; k += 3) {
    const i = e[k], a = front.owner[i];
    if (a >= 0 && front.field[a].atk[i] >= ARMOR_ATK) arm[blockOf(e[k + 1])] += e[k + 2];
  }
  const spots = [];
  for (let b = 0; b < bw * bh; b++) if (sum[b] > 0.3) spots.push({ x: sx[b] / sum[b], y: sy[b] / sum[b], loss: sum[b], armor: arm[b] });
  return spots.sort((a, b) => b.loss - a.loss).slice(0, max);
}
