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

export function planFront(front, s) {
  const { rng, cfg } = front;
  const attacking = s === front.attacker;
  const weather = FRONT_WEATHER[front.weather];
  const { sectors } = readFront(front, s);
  if (!sectors.length) return;
  const dirX = s === 0 ? 1 : -1;
  for (const sec of sectors) sec.ratio = sec.own / (sec.foe * sec.foeDef);

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
  // Réserves : presque tout le pool monte en ligne chaque matin (en garder trop, c'est les laisser dormir pendant
  // que le front cède). Le défenseur les répartit sur ses secteurs menacés au prorata du déficit ; l'attaquant en
  // garde la moitié pour nourrir ses percées (plus bas).
  const keep = AI_TUNING.keep;
  let budget = front.reserve[s] * (1 - keep);
  const deploy = (i, amount) => {
    amount = Math.min(amount, budget);
    while (amount >= 1) {
      const chunk = Math.min(cfg.chunk, amount);
      if (deployReserve(front, s, i, chunk).error) break;
      amount -= chunk;
      budget -= chunk;
    }
  };
  const defendShare = attacking ? 0.5 : 1;
  const worst = threatened.slice(0, 4);
  const deficit = worst.map((x) => Math.max(0.05, 1 - x.ratio));
  const totalDef = deficit.reduce((a, b) => a + b, 0);
  const defendBudget = budget * defendShare;
  worst.forEach((sec, k) => deploy(sec.head, (defendBudget * deficit[k]) / totalDef));
  const feed = (i, n) => deploy(i, budget / Math.max(1, n));

  // Repli : un saillant très menacé, loin de toute ville amie, est raccourci.
  for (const sec of threatened.slice(0, 1)) {
    if (sec.ratio > 0.35) break;
    const nearTown = front.map.towns.some((t) => front.owner[t.i] === s && Math.hypot(front.centers.x[t.i] - front.centers.x[sec.head], front.centers.y[t.i] - front.centers.y[sec.head]) < 10);
    if (nearTown) continue;
    const h = point(front, sec.head);
    addVector(front, s, 'retreat', sec.head, { x: h.x - dirX * 8, y: h.y });
  }

  // 2. Attaque : les secteurs où le rapport de forces est le meilleur, espacés d'au moins 8 lignes.
  const engage = attacking ? AI_TUNING.attEngage : AI_TUNING.defEngage; // rapport minimal pour engager
  const candidates = [...sectors].filter((x) => x.ratio > engage).sort((a, b) => b.ratio - a.ratio + (rng.next() - 0.5) * 0.3);
  const chosen = [];
  for (const sec of candidates) {
    if (chosen.some((c) => Math.abs(c.r0 - sec.r0) < 8)) continue;
    chosen.push(sec);
    if (chosen.length >= (attacking ? AI_TUNING.attVectors : AI_TUNING.defVectors)) break;
  }
  let armor = 0;
  const attackBudgetShare = chosen.length;
  const armorOK = weather.armor >= 0.75; // sous la pluie, les blindés s'enlisent : l'infanterie mène
  for (const sec of chosen) {
    const town = targetTown(front, s, sec.head);
    const h = point(front, sec.head);
    let to = town ? point(front, town.i) : { x: h.x + dirX * 25, y: h.y };
    // On ne vise pas en arrière : au moins vers l'avant.
    if ((to.x - h.x) * dirX < 4) to = { x: h.x + dirX * 20, y: to.y };
    const type = armorOK && armor < cfg.maxArmor && sec.ratio > engage * 1.15 ? 'armor' : 'infantry';
    if (type === 'armor') armor++;
    const v = addVector(front, s, type, sec.head, to);
    if (v.error) continue;
    // Préparation : barrage sur les cases ennemies juste devant le départ, puis réserves en tête de colonne.
    const L = Math.hypot(to.x - h.x, to.y - h.y) || 1;
    addBarrage(front, s, { x: h.x + ((to.x - h.x) / L) * 3, y: h.y + ((to.y - h.y) / L) * 3 });
    feed(sec.head, attackBudgetShare);
  }

  // 3. Barrages restants : sur les plus fortes concentrations ennemies estimées au contact.
  const mem = front.memory[s];
  const hot = [];
  for (const sec of [...sectors].sort((a, b) => b.foe - a.foe).slice(0, 4)) {
    let best = -1, bv = 0;
    for (let i = 0; i < front.map.N; i++) {
      if (mem.owner[i] !== 1 - s) continue;
      const r = Math.floor(i / front.map.W);
      if (r < sec.r0 || r >= sec.r0 + SECTOR || Math.abs(front.centers.x[i] - front.centers.x[sec.head]) > 4) continue;
      if (mem.est[i] > bv) { bv = mem.est[i]; best = i; }
    }
    if (best >= 0) hot.push(best);
  }
  for (const i of hot) addBarrage(front, s, point(front, i));

  // 4. Poches : réexamen chaque matin d'une poche restée au statu quo.
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
