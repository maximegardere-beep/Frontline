// IA du front stratégique. Elle ne voit de l'ennemi que ce que montre le brouillard : sa mémoire (propriétaire des
// cases aperçues, densité estimée et arrondie), jamais la vraie densité adverse.
//
// Chaque matin :
// 1. elle lit le front par secteurs : ses forces voisines contre l'estimation de celles d'en face, terrain compris ;
// 2. défense élastique : là où elle est en infériorité, ligne de défense derrière le front, réserves, barrage sur
//    les concentrations qui la menacent ; un saillant intenable loin des villes est raccourci par un repli ;
// 3. attaque : sur les secteurs où elle est la plus forte, blindés (infanterie sous la pluie) vers la ville ennemie
//    la plus proche ; deux percées vers la même ville font une tenaille ; préparation au barrage et par l'aviation sur
//    le même point de départ (leur choc se cumule), réserves en tête ; sans aucun feu disponible, pas d'assaut.
// L'attaquant engage plus volontiers que le défenseur, qui contre-attaque surtout ce qui est faible.
// Poches : tirage pondéré entre statu quo, Festung et percée d'évasion (troupes piégées, distance aux lignes amies).

import { planAir, addAirMission } from './frontair.js';
import { addVector, addLine, addBarrage, addPontoon, deployReserve, setPocketMode, edgeCol, cellAtPoint, waterOpen, FRONT_WEATHER, VECTOR_TYPES } from './front.js';
import { bfsDistance } from './path.js';
import { GUN_KINDS, setGunOrder } from './frontguns.js';
import { setArmorOrder } from './frontarmor.js';

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
  // Rive : l'ennemi n'est qu'en face, de l'autre côté de l'eau (il faut un pont pour l'atteindre).
  const closed = (j) => map.river?.[j] && !waterOpen(front, j);
  const wet = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (owner[i] !== s) continue;
    let dry = false, across = false;
    for (let d = 0; d < 6; d++) {
      const j = nb[i * 6 + d];
      if (j < 0) continue;
      if (mem.owner[j] === o) { dry = true; break; }
      if (closed(j)) for (let e = 0; e < 6 && !across; e++) { const k = nb[j * 6 + e]; if (k >= 0 && mem.owner[k] === o) across = true; }
    }
    if (dry || across) { contact.push(i); if (!dry) wet[i] = 1; }
  }
  const mine = bfsDistance(nb, N, contact, (i) => owner[i] === s, REACH);
  const theirs = bfsDistance(nb, N, contact, (i) => mem.owner[i] === o || closed(i), REACH + 2);
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
      if (mem.owner[i] === o && theirs[i] <= REACH + 2) { foe += mem.est[i]; foeDef += map.def[i]; n++; }
    }
    // Secteur de rive : l'eau le protège (et protège l'ennemi d'en face) tant qu'on n'a pas de pont.
    const wetShare = cells.filter((i) => wet[i]).length / cells.length;
    sectors.push({ r0, head, own, foe: Math.max(foe, 1), foeDef: n ? foeDef / n : 1, water: 1 + 2 * wetShare, cells });
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
  // ratio : rapport de forces pour attaquer (l'eau devant soi le dégrade) ; hold : pour tenir (l'eau protège).
  for (const sec of sectors) { sec.ratio = sec.own / (sec.foe * sec.foeDef * sec.water); sec.hold = (sec.own * sec.water) / (sec.foe * sec.foeDef); }
  planGuns(front, s);

  // 1. Défense : secteurs menacés (l'ennemi y est nettement plus fort).
  const threatened = [...sectors].filter((x) => x.hold < (attacking ? 0.7 : 0.9)).sort((a, b) => a.hold - b.hold);
  let lines = 0;
  for (const sec of threatened) {
    if (lines >= cfg.maxLines) break;
    // Ligne de défense parallèle au front, 2 à 3 cases en arrière.
    const h = point(front, sec.head);
    const back = -dirX * 3;
    const r = addLine(front, s, { x: h.x + back, y: h.y - 6 }, { x: h.x + back, y: h.y + 6 }, sec.hold < 0.5 ? 3 : 2);
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
  const deficit = worst.map((x) => Math.max(0.05, 1 - x.hold));
  const totalDef = deficit.reduce((a, b) => a + b, 0);
  const defendBudget = budget * defendShare;
  worst.forEach((sec, k) => deploy(sec.head, (defendBudget * deficit[k]) / totalDef));
  const feed = (i, n) => deploy(i, budget / Math.max(1, n));

  // Repli : un saillant très menacé, loin de toute ville amie, est raccourci.
  for (const sec of threatened.slice(0, 1)) {
    if (sec.hold > 0.35) break;
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
  const attackBudgetShare = chosen.length;
  // Formations blindées disponibles : assez de chars et de carburant pour une journée d'attaque.
  const free = (front.armor ?? []).filter((a) => a.side === s && !a.lost && a.tanks > a.max * 0.3 && a.fuel > 0.3);
  for (const a of front.armor ?? []) if (a.side === s && !a.lost) setArmorOrder(front, s, a.id, null);
  const dist = (a, i) => Math.hypot(a.x - front.centers.x[i], a.y - front.centers.y[i]);
  const armorOK = weather.armor >= 0.75; // sous la pluie, les blindés s'enlisent : l'infanterie mène
  for (const sec of chosen) {
    const town = targetTown(front, s, sec.head);
    const h = point(front, sec.head);
    let to = town ? point(front, town.i) : { x: h.x + dirX * 25, y: h.y };
    // On ne vise pas en arrière : au moins vers l'avant.
    if ((to.x - h.x) * dirX < 4) to = { x: h.x + dirX * 20, y: to.y };
    // Rivière sur l'axe, au bord de nos lignes : on passe par le pont le plus proche ; faute de pont, le génie lance un
    // pont de bateaux cette nuit et l'assaut attend demain.
    const cross = waterOnAxis(front, s, h, to);
    if (cross) {
      const br = nearestBridge(front, cross, 14);
      if (br) {
        const bx = front.centers.x[br], by = front.centers.y[br];
        const L0 = Math.hypot(bx - h.x, by - h.y) || 1;
        to = { x: bx + ((bx - h.x) / L0) * 8, y: by + ((by - h.y) / L0) * 8 };
      } else {
        if (front.pontoons[s] > 0 && !front.pontoonOrders[s].length) addPontoon(front, s, point(front, cross));
        continue;
      }
    }
    // Les blindés ne s'engagent que sur un axe praticable pour eux (ni forêt profonde, ni marais, ni rivière sans pont).
    let goA = 0, n = 0;
    for (let k = 1; k <= 10; k++) {
      const i = cellAtPoint(front, { x: h.x + ((to.x - h.x) * k) / 10, y: h.y + ((to.y - h.y) * k) / 10 });
      if (i >= 0) { goA += Math.min(1, front.map.flowA[i]); n++; }
    }
    const armorGround = n ? goA / n : 1;
    // Préparation, sur le point de départ : barrage au lever du jour puis appui aérien en fin de matinée, au même endroit
    // (le choc des deux se cumule, combat.js). Sans aucun feu, un assaut piétine : on ne l'engage qu'écrasant.
    const L = Math.hypot(to.x - h.x, to.y - h.y) || 1;
    const at = { x: h.x + ((to.x - h.x) / L) * 3, y: h.y + ((to.y - h.y) / L) * 3 };
    const fired = !addBarrage(front, s, at).error;
    const flown = !addAirMission(front, s, at).error;
    if (!fired && !flown && sec.ratio < engage * 2) continue;
    // Fer de lance : la formation la plus proche mène l'attaque vers l'objectif ; l'infanterie pousse sur le même axe.
    if (armorOK && armorGround > 0.6 && free.length && sec.ratio > engage * 1.1) {
      const a = free.reduce((b, x) => (dist(x, sec.head) < dist(b, sec.head) ? x : b));
      if (dist(a, sec.head) < 45) {
        setArmorOrder(front, s, a.id, to);
        free.splice(free.indexOf(a), 1);
      }
    }
    const v = addVector(front, s, 'infantry', sec.head, to);
    if (v.error) continue;
    // Réserves en tête de colonne.
    feed(sec.head, attackBudgetShare);
  }

  // Concentration : les groupes d'artillerie restés sans mission rejoignent l'axe d'attaque principal, à mi-portée
  // derrière son départ, pour que demain leurs barrages tombent ensemble au même endroit.
  if (chosen.length) {
    const main = chosen[0], h = point(front, main.head);
    for (const g of front.guns) {
      if (g.side !== s || g.lost || g.dest || front.barrages[s].some((b) => b.gun === g.id)) continue;
      const R = GUN_KINDS[g.kind].range;
      if (Math.hypot(g.x - h.x, g.y - h.y) <= R * 0.75) continue;
      const want = { x: h.x - dirX * R * 0.45, y: h.y };
      let best = null, bd = Infinity;
      for (let i = 0; i < front.map.N; i++) {
        if (front.owner[i] !== s || front.map.flow[i] <= 0) continue;
        const d = Math.hypot(front.centers.x[i] - want.x, front.centers.y[i] - want.y);
        if (d < bd) { bd = d; best = point(front, i); }
      }
      if (best) setGunOrder(front, s, g.id, { dest: best });
    }
  }

  // Front de rive sans attaque possible : l'attaquant prépare un franchissement sur son secteur le plus fort.
  if (attacking && front.pontoons[s] > 0 && !front.pontoonOrders[s].length && !chosen.length) {
    const wetSec = sectors.filter((x) => x.water > 2).sort((a, b) => b.own / b.foe - a.own / a.foe)[0];
    if (wetSec && wetSec.own > wetSec.foe * 1.2) addPontoon(front, s, point(front, wetSec.head));
  }
  // Ponts : le défenseur fait sauter ceux que l'ennemi tient ou touche déjà.
  if (!attacking) for (const i of threatenedBridges(front, s).slice(0, 1)) addBarrage(front, s, point(front, i));

  // Fixations : sur les secteurs voisins de ses attaques (à 6 à 14 lignes), l'ennemi est pressé pour qu'il n'y
  // prélève pas ses renforts.
  if (chosen.length) {
    let fixes = 0;
    for (const sec of sectors) {
      if (fixes >= (attacking ? 2 : 1)) break;
      if (chosen.includes(sec) || threatened.includes(sec) || sec.hold < 0.7) continue;
      const gap = Math.min(...chosen.map((c) => Math.abs(c.r0 - sec.r0)));
      if (gap < 6 || gap > 14) continue;
      const h = point(front, sec.head);
      if (!addVector(front, s, 'fix', sec.head, { x: h.x + dirX * 8, y: h.y }).error) fixes++;
    }
  }

  // Formations restantes : contre-attaque sur le secteur le plus menacé (défenseur, ou attaquant débordé), sinon
  // en réserve derrière lui.
  for (const a of free) {
    const sec = threatened.find((x) => dist(a, x.head) < 45) ?? null;
    if (!sec) continue;
    const h = point(front, sec.head);
    if (armorOK && sec.hold < 0.85 && a.tanks > a.max * 0.5) {
      // Contre-attaque préparée elle aussi : barrage et aviation sur les cases ennemies devant le secteur.
      const at = { x: h.x + dirX * 3, y: h.y };
      addBarrage(front, s, at);
      addAirMission(front, s, at);
      setArmorOrder(front, s, a.id, { x: h.x + dirX * 10, y: h.y });
    }
    else setArmorOrder(front, s, a.id, { x: h.x - dirX * 6, y: h.y });
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

  // 5. Aviation.
  planAir(front, s);
}

// Première case d'eau infranchissable sur l'axe [h, to], si la terre juste avant elle est à nous (on est sur la rive).
function waterOnAxis(front, s, h, to) {
  const L = Math.hypot(to.x - h.x, to.y - h.y);
  let prev = -1;
  for (let t = 0; t <= L; t += 0.5) {
    const i = cellAtPoint(front, { x: h.x + ((to.x - h.x) * t) / L, y: h.y + ((to.y - h.y) * t) / L });
    if (i < 0 || i === prev) continue;
    if (front.map.river?.[i] && !waterOpen(front, i)) return prev >= 0 && front.owner[prev] === s ? i : null;
    prev = i;
  }
  return null;
}

// Case de pont intacte la plus proche de la case i, à moins de r.
function nearestBridge(front, i, r) {
  let best = null, bd = r;
  for (let k = 0; k < front.map.N; k++) {
    if (front.map.bridge?.[k] !== 1) continue;
    const d = Math.hypot(front.centers.x[k] - front.centers.x[i], front.centers.y[k] - front.centers.y[i]);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

// Ponts intacts que l'ennemi tient ou touche : le défenseur les fait sauter avant qu'ils ne servent.
function threatenedBridges(front, s) {
  const out = [];
  const { nb } = front.map;
  const mem = front.memory[s];
  for (let i = 0; i < front.map.N; i++) {
    if (front.map.bridge?.[i] !== 1) continue;
    let hot = mem.owner[i] === 1 - s;
    for (let d = 0; d < 6 && !hot; d++) { const j = nb[i * 6 + d]; if (j >= 0 && mem.owner[j] === 1 - s) hot = true; }
    if (hot) out.push(i);
  }
  return out;
}

// Artillerie : chaque groupe se tient à mi-portée derrière le front connu. Trop près (menacé d'être débordé), il
// recule ; trop loin pour tirer au-delà du front, il avance, en appui mobile si l'étape tient dans la journée.
function planGuns(front, s) {
  const { map, centers } = front;
  const mem = front.memory[s];
  const dirX = s === 0 ? 1 : -1;
  for (const g of front.guns) {
    if (g.side !== s || g.lost) continue;
    const R = GUN_KINDS[g.kind].range;
    let near = Infinity, nx = 0, ny = 0;
    for (let i = 0; i < map.N; i++) {
      if (mem.owner[i] !== 1 - s) continue;
      const d = Math.hypot(centers.x[i] - g.x, centers.y[i] - g.y);
      if (d < near) { near = d; nx = centers.x[i]; ny = centers.y[i]; }
    }
    if (near === Infinity) continue;
    let want = null;
    if (near < 4) want = { x: g.x - dirX * (R * 0.5 - near), y: g.y };
    else if (near > R * 0.8) want = { x: nx - dirX * R * 0.5, y: ny };
    if (!want) continue;
    // Point d'arrivée : la case amie la plus proche du point voulu.
    let best = null, bd = Infinity;
    for (let i = 0; i < map.N; i++) {
      if (front.owner[i] !== s || map.flow[i] <= 0) continue;
      const d = Math.hypot(centers.x[i] - want.x, centers.y[i] - want.y);
      if (d < bd) { bd = d; best = { x: centers.x[i], y: centers.y[i] }; }
    }
    if (best) setGunOrder(front, s, g.id, { dest: best, posture: near < 2.5 ? 'move' : undefined });
  }
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
