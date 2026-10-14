// IA du front stratégique. Elle ne voit de l'ennemi que ce que montre le brouillard : sa mémoire (propriétaire des
// cases aperçues, densité estimée et arrondie), jamais la vraie densité adverse.
//
// Chaque matin :
// 1. elle lit le front par secteurs : ses forces voisines contre l'estimation de celles d'en face, terrain compris ;
// 2. défense élastique : là où elle est en infériorité, ligne de défense derrière le front, réserves, barrage sur
//    les concentrations qui la menacent ; un saillant intenable loin des villes est raccourci par un repli ;
// 3. attaque : sur les secteurs où elle est la plus forte, blindés (infanterie sous la pluie) vers la ville ennemie
//    la plus proche ; deux percées vers la même ville font une tenaille ; préparation au barrage, réserves en tête.
// L'attaquant engage plus volontiers que le défenseur, qui contre-attaque surtout ce qui est faible.
// Poches : tirage pondéré entre statu quo, Festung et percée d'évasion (troupes piégées, distance aux lignes amies).

import { addVector, addLine, addBarrage, deployReserve, setPocketMode, edgeCol, FRONT_WEATHER, VECTOR_TYPES } from './front.js';
import { bfsDistance } from './path.js';

const SECTOR = 4; // un secteur toutes les 4 lignes

// Réglages de comportement (modifiables par les outils de simulation).
export const AI_TUNING = {
  keep: 0.15, // part du pool logistique gardée chaque matin
  attEngage: 1.0, // rapport de forces minimal pour attaquer (attaquant)
  defEngage: 1.6, // idem pour le défenseur (contre-attaques)
  attVectors: 3, // secteurs attaqués par jour au plus
  defVectors: 2,
};
const REACH = 3; // rayon (en cases) pris en compte de part et d'autre du front

export function installAI(front) {
  front.planAI = planFront;
  front.pocketAI = (f, p) => choosePocket(f, p);
}

// Lecture du front, par secteurs : une case de contact représentative, ses forces et celles d'en face (estimées).
function readFront(front, s) {
  const { map, owner, dens, centers } = front;
  const { W, H, N, nb } = map;
  const mem = front.memory[s];
  const o = 1 - s;
  const contact = [];
  for (let i = 0; i < N; i++) {
    if (owner[i] !== s) continue;
    for (let d = 0; d < 6; d++) {
      const j = nb[i * 6 + d];
      if (j >= 0 && mem.owner[j] === o) { contact.push(i); break; }
    }
  }
  const mine = bfsDistance(nb, N, contact, (i) => owner[i] === s, REACH);
  const theirs = bfsDistance(nb, N, contact, (i) => mem.owner[i] === o, REACH + 1);
  const sectors = [];
  for (let r0 = 0; r0 < H; r0 += SECTOR) {
    const cells = contact.filter((i) => {
      const r = Math.floor(i / W);
      return r >= r0 && r < r0 + SECTOR;
    });
    if (!cells.length) continue;
    // Case la plus avancée du secteur : point de départ naturel d'un vecteur.
    const dir = s === 0 ? 1 : -1;
    const head = cells.reduce((a, b) => (centers.x[b] * dir > centers.x[a] * dir ? b : a));
    let own = 0, foe = 0, foeDef = 0, n = 0;
    for (let i = 0; i < N; i++) {
      const r = Math.floor(i / W);
      if (r < r0 - 1 || r > r0 + SECTOR) continue;
      if (owner[i] === s && mine[i] <= REACH) own += dens[i];
      if (mem.owner[i] === o && theirs[i] <= REACH + 1) { foe += mem.est[i]; foeDef += map.def[i]; n++; }
    }
    sectors.push({ r0, head, own, foe: Math.max(foe, 1), foeDef: n ? foeDef / n : 1, cells });
  }
  return { sectors, contact };
}

// Ville ennemie (au sens de la mémoire) la plus proche d'un point, dans la direction de l'attaque.
function targetTown(front, s, from) {
  const mem = front.memory[s];
  const { centers } = front;
  let best = null, bd = Infinity;
  for (const t of front.map.towns) {
    if (mem.owner[t.i] === s) continue;
    const d = Math.hypot(centers.x[t.i] - centers.x[from], centers.y[t.i] - centers.y[from]);
    // L'attaquant vise d'abord les villes de l'objectif.
    const w = d * (s === front.attacker && front.defTowns.includes(t.i) ? 0.7 : 1);
    if (w < bd) { bd = w; best = t; }
  }
  return best;
}

function point(front, i) { return { x: front.centers.x[i], y: front.centers.y[i] }; }

// Profil du front, ligne par ligne, tel que le camp s le connaît : avancée (distance depuis son bord de carte) de la
// première case ennemie, case amie juste avant (point de départ naturel), puis avancée de référence (médiane glissante)
// et renflement : > 0, saillant à nous ; < 0, saillant ennemi chez nous.
function frontProfile(front, s) {
  const { W, H } = front.map;
  const mem = front.memory[s];
  const cx = front.centers.x;
  const right = cx[W - 1] + 1;
  const adv = new Float32Array(H).fill(NaN), cell = new Int32Array(H).fill(-1);
  for (let r = 0; r < H; r++) {
    for (let k = 1; k < W; k++) {
      const c = s === 0 ? k : W - 1 - k, i = r * W + c;
      if (mem.owner[i] !== 1 - s) continue;
      adv[r] = s === 0 ? cx[i] : right - cx[i];
      for (let b = 1; b <= 3 && cell[r] < 0; b++) {
        const cc = s === 0 ? c - b : c + b;
        if (cc >= 0 && cc < W && front.owner[r * W + cc] === s) cell[r] = r * W + cc;
      }
      break;
    }
  }
  const base = new Float32Array(H), bulge = new Float32Array(H);
  for (let r = 0; r < H; r++) {
    const win = [];
    for (let q = Math.max(0, r - 8); q <= Math.min(H - 1, r + 8); q++) if (!Number.isNaN(adv[q])) win.push(adv[q]);
    win.sort((a, b) => a - b);
    base[r] = win.length ? win[win.length >> 1] : NaN;
    bulge[r] = Number.isNaN(adv[r]) ? 0 : adv[r] - base[r];
  }
  return { adv, cell, base, bulge };
}

// Étendue d'un renflement autour de la ligne r (signe sg : +1 le nôtre, −1 celui de l'ennemi) : lignes bornes,
// profondeur et ligne la plus avancée.
function bulgeSpan(P, r, sg, H) {
  let tip = r, depth = sg * P.bulge[r];
  for (let q = Math.max(0, r - 3); q <= Math.min(H - 1, r + 3); q++) if (sg * P.bulge[q] > depth) { depth = sg * P.bulge[q]; tip = q; }
  const lim = Math.max(1.5, depth * 0.4);
  let lo = tip, hi = tip;
  while (lo > 0 && sg * P.bulge[lo - 1] > lim) lo--;
  while (hi < H - 1 && sg * P.bulge[hi + 1] > lim) hi++;
  return { lo, hi, tip, depth, width: hi - lo + 1 };
}

// Doctrine : poussée prudente et unifiée. L'IA mène une ou deux opérations suivies d'un jour à l'autre, chacune sur
// un axe : rupture sur un front large (deux vecteurs parallèles, partis de la ligne et non d'une pointe), élargissement
// des épaules tant que la brèche est plus profonde que large, puis exploitation blindée quand la brèche est large et
// les réserves suivent. Elle replie ses doigts de gant isolés et coupe à la base les saillants ennemis étroits.
// Le Reich (s = 0) est plus audacieux : il passe plus tôt à l'exploitation.
export const DOCTRINE = {
  ops: [2, 2], // opérations simultanées de l'attaquant (Wehrmacht, Armée rouge)
  defOps: 1, // du défenseur (contre-offensive)
  exploitWidth: [5, 7], // largeur de brèche (lignes) exigée pour exploiter
  breakLen: 11, // longueur d'un vecteur de rupture
  stall: 2, // jours sans progrès avant d'abandonner une opération
  spacing: 10, // lignes minimales entre deux opérations
};

export function planFront(front, s) {
  const { rng, cfg, map } = front;
  const { H } = map;
  const attacking = s === front.attacker;
  const weather = FRONT_WEATHER[front.weather];
  const { sectors } = readFront(front, s);
  if (!sectors.length) return;
  const dirX = s === 0 ? 1 : -1;
  for (const sec of sectors) sec.ratio = sec.own / (sec.foe * sec.foeDef);
  const P = frontProfile(front, s);
  const rowOf = (i) => Math.floor(i / map.W);
  const sectorAt = (r) => sectors.reduce((b, x) => (Math.abs(x.r0 + SECTOR / 2 - r) < Math.abs(b.r0 + SECTOR / 2 - r) ? x : b));
  // Case de départ d'une ligne r (ou d'une voisine) ; -1 si la ligne n'a pas de contact.
  const startAt = (r) => {
    for (const d of [0, 1, -1, 2, -2, 3, -3]) { const q = r + d; if (q >= 0 && q < H && P.cell[q] >= 0) return P.cell[q]; }
    return -1;
  };
  let vectors = 0;
  const canVector = () => vectors < cfg.maxVectors;
  const order = (type, fromI, to) => {
    if (!canVector() || fromI < 0) return null;
    const v = addVector(front, s, type, fromI, to);
    if (v.error) return null;
    vectors++;
    return v;
  };
  // Point vers l'avant depuis la case i, incliné vers (tx, ty) d'au plus maxAng, à distance len.
  const aim = (i, target, len, maxAng = 0.5) => {
    const h = point(front, i);
    let ang = target ? Math.atan2(target.y - h.y, (target.x - h.x) * dirX) : 0;
    ang = Math.max(-maxAng, Math.min(maxAng, ang));
    return { x: h.x + dirX * Math.cos(ang) * len, y: h.y + Math.sin(ang) * len };
  };

  // 1. Défense : secteurs menacés (l'ennemi y est nettement plus fort).
  const threatened = [...sectors].filter((x) => x.ratio < (attacking ? 0.7 : 0.9)).sort((a, b) => a.ratio - b.ratio);
  let lines = 0;
  for (const sec of threatened) {
    if (lines >= cfg.maxLines) break;
    // Ligne de défense parallèle au front, 2 à 3 cases en arrière.
    const h = point(front, sec.head);
    const back = -dirX * 3;
    const r = addLine(front, s, { x: h.x + back, y: h.y - 6 }, { x: h.x + back, y: h.y + 6 });
    if (!r.error) lines++;
  }
  // Réserves : presque tout le pool monte en ligne chaque matin. Le défenseur les répartit sur ses secteurs menacés
  // au prorata du déficit ; l'attaquant en garde la moitié pour nourrir ses opérations.
  let budget = front.reserve[s] * (1 - AI_TUNING.keep);
  const deploy = (i, amount) => {
    amount = Math.min(amount, budget);
    while (amount >= 1) {
      const chunk = Math.min(cfg.chunk, amount);
      if (deployReserve(front, s, i, chunk).error) break;
      amount -= chunk;
      budget -= chunk;
    }
  };
  const worst = threatened.slice(0, 4);
  const deficit = worst.map((x) => Math.max(0.05, 1 - x.ratio));
  const totalDef = deficit.reduce((a, b) => a + b, 0);
  const defendBudget = budget * (attacking ? 0.5 : 1);
  worst.forEach((sec, k) => deploy(sec.head, (defendBudget * deficit[k]) / totalDef));

  // 2. Opérations en cours : progrès, abandon, phase.
  front.aiOps ??= [[], []];
  const engage = attacking ? AI_TUNING.attEngage : AI_TUNING.defEngage;
  const mem = front.memory[s];
  let ops = front.aiOps[s].filter((op) => {
    const span = bulgeSpan(P, op.r, 1, H);
    const reach = Math.max(...[-2, -1, 0, 1, 2].map((d) => P.adv[Math.max(0, Math.min(H - 1, span.tip + d))] || 0));
    if (reach > op.best + 1) { op.best = reach; op.stall = 0; } else op.stall++;
    op.r = Math.round((op.r + span.tip) / 2); // l'axe suit la brèche
    op.span = span;
    const taken = op.target != null && mem.owner[op.target] === s;
    return op.stall < DOCTRINE.stall && !taken && sectorAt(op.r).ratio > engage * 0.8;
  });
  // Nouvelles opérations : secteurs les plus favorables, loin des opérations existantes, de préférence là où le front
  // est droit (on ne relance pas depuis une pointe).
  const maxOps = attacking ? DOCTRINE.ops[s] : DOCTRINE.defOps;
  const candidates = [...sectors]
    .map((x) => ({ sec: x, r: x.r0 + SECTOR / 2, score: x.ratio - 0.12 * Math.max(0, P.bulge[Math.min(H - 1, x.r0 + 2)]) + (rng.next() - 0.5) * 0.3 }))
    .filter((c) => c.sec.ratio > engage)
    .sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    if (ops.length >= maxOps) break;
    if (ops.some((op) => Math.abs(op.r - c.r) < DOCTRINE.spacing)) continue;
    const town = targetTown(front, s, c.sec.head);
    ops.push({ r: Math.round(c.r), target: town?.i ?? null, best: P.adv[Math.round(c.r)] || 0, stall: 0, day: front.day, span: bulgeSpan(P, Math.round(c.r), 1, H) });
  }
  front.aiOps[s] = ops;

  // 3. Ordres de chaque opération selon sa phase.
  const armorOK = weather.armor >= 0.75; // sous la pluie, les blindés s'enlisent : l'infanterie mène
  let armor = 0;
  const fed = [];
  for (const op of ops) {
    const sec = sectorAt(op.r);
    const target = op.target != null ? point(front, op.target) : null;
    const { lo, hi, tip, depth, width } = op.span;
    const deep = depth > 3;
    if (deep && width < depth * 0.9 + 3) {
      // Élargissement : les épaules avancent jusqu'à la hauteur de la pointe ; des lignes tiennent les flancs.
      op.phase = 'widen';
      for (const r of [lo - 2, hi + 2]) {
        const i = startAt(Math.max(0, Math.min(H - 1, r)));
        if (i >= 0) order('infantry', i, aim(i, null, depth * 1.6 + 6, 0));
      }
      for (const r of [lo, hi]) {
        if (lines >= cfg.maxLines) break;
        const a = P.cell[r], b = P.cell[tip];
        if (a < 0 || b < 0) continue;
        const pa = point(front, a), pb = point(front, b);
        const back = { x: pa.x - dirX * depth * 1.5, y: pa.y };
        if (!addLine(front, s, back, { x: pb.x - dirX * 2, y: pa.y }).error) lines++;
      }
      fed.push(startAt(tip));
    } else if (deep && armorOK && armor < cfg.maxArmor && width >= DOCTRINE.exploitWidth[s] && sec.ratio > engage) {
      // Exploitation : les blindés foncent depuis la pointe vers l'objectif, l'infanterie suit sur le même axe.
      op.phase = 'exploit';
      const i = startAt(tip);
      if (order('armor', i, target ? aim(i, target, 40, 0.8) : aim(i, null, 30))) armor++;
      const j = startAt(Math.round((lo + hi) / 2));
      order('infantry', j, aim(j, target, 16, 0.6));
      fed.push(i);
    } else {
      // Rupture : sur un front large, deux vecteurs parallèles partis de la ligne, courts, avec préparation.
      op.phase = 'break';
      const i = startAt(op.r);
      if (i < 0) continue;
      const type = armorOK && armor < cfg.maxArmor && sec.ratio > engage * 1.15 ? 'armor' : 'infantry';
      const to = aim(i, target, DOCTRINE.breakLen, 0.45);
      const v = order(type, i, to);
      if (!v) continue;
      if (type === 'armor') armor++;
      const side = target && target.y < point(front, i).y ? -1 : 1;
      const k = startAt(Math.max(0, Math.min(H - 1, op.r + side * 5)));
      if (k >= 0 && k !== i) order('infantry', k, aim(k, target, DOCTRINE.breakLen - 2, 0.45));
      const h = point(front, i), L = Math.hypot(to.x - h.x, to.y - h.y) || 1;
      addBarrage(front, s, { x: h.x + ((to.x - h.x) / L) * 3, y: h.y + ((to.y - h.y) / L) * 3 });
      fed.push(i);
    }
  }
  for (const i of fed) if (i >= 0) deploy(i, budget / Math.max(1, fed.length));

  // 4. Redresser le front : couper à la base les saillants ennemis étroits, replier nos doigts de gant hors opération.
  const done = new Set();
  for (let r = 0; r < H && canVector(); r++) {
    if (done.has(r) || P.bulge[r] > -5) continue;
    const span = bulgeSpan(P, r, -1, H);
    for (let q = span.lo; q <= span.hi; q++) done.add(q);
    if (span.width > span.depth * 0.8 + 2 || sectorAt(span.tip).ratio < 1) continue;
    // Tenaille : depuis les épaules, vers la base du saillant.
    const baseX = P.base[span.tip];
    for (const [r0, toward] of [[span.lo - 2, span.hi], [span.hi + 2, span.lo]]) {
      if (r0 < 0 || r0 >= H) continue;
      const i = startAt(r0);
      if (i < 0) continue;
      const j = map.W * Math.max(0, Math.min(H - 1, toward)) + 0;
      const to = { x: s === 0 ? baseX - 1 : front.centers.x[map.W - 1] + 1 - baseX + 1, y: front.centers.y[j] };
      order('infantry', i, to);
    }
  }
  for (let r = 0; r < H && canVector(); r++) {
    if (P.bulge[r] < 6 || ops.some((op) => r >= op.span.lo - 2 && r <= op.span.hi + 2)) continue;
    const span = bulgeSpan(P, r, 1, H);
    r = span.hi + 1;
    if (span.width > 3) continue;
    const i = P.cell[span.tip];
    if (i < 0) continue;
    const h = point(front, i);
    order('retreat', i, { x: h.x - dirX * span.depth, y: h.y });
  }

  // 5. Barrages restants : sur les plus fortes concentrations ennemies estimées au contact.
  const hot = [];
  for (const sec of [...sectors].sort((a, b) => b.foe - a.foe).slice(0, 4)) {
    let best = -1, bv = 0;
    for (let i = 0; i < map.N; i++) {
      if (mem.owner[i] !== 1 - s) continue;
      const r = rowOf(i);
      if (r < sec.r0 || r >= sec.r0 + SECTOR || Math.abs(front.centers.x[i] - front.centers.x[sec.head]) > 4) continue;
      if (mem.est[i] > bv) { bv = mem.est[i]; best = i; }
    }
    if (best >= 0) hot.push(best);
  }
  for (const i of hot) addBarrage(front, s, point(front, i));

  // 6. Poches : réexamen chaque matin d'une poche restée au statu quo.
  for (const p of front.pockets[s]) if (p.info.mode === 'hold') choosePocket(front, p, true);
}

// Comportement d'une poche : tirage pondéré (brief) selon les troupes piégées et la distance aux lignes amies.
export function choosePocket(front, p, morning = false) {
  const s = p.side;
  const { centers, map } = front;
  let near = Infinity, target = null;
  for (let i = 0; i < map.N; i++) {
    if (front.owner[i] !== s || !front.supplied[s][i]) continue;
    const d = Math.hypot(centers.x[i] - p.cx, centers.y[i] - p.cy);
    if (d < near) { near = d; target = { x: centers.x[i], y: centers.y[i] }; }
  }
  if (!target) target = { x: centers.x[edgeCol(front, s)], y: p.cy };
  const T = p.troops;
  const weights = {
    hold: morning ? 1.2 : 0.6,
    festung: 1.5 * Math.min(1, T / 200) * (near > 15 ? 1.5 : 1),
    breakout: 3 * Math.exp(-near / 12) * (T > 30 ? 1 : 0.3),
  };
  const mode = front.rng.weighted(weights);
  if (mode === 'hold') return;
  setPocketMode(front, s, p.id, mode, mode === 'breakout' ? target : null);
}

export { VECTOR_TYPES };
