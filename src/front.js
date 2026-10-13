// Frontline stratégique : état de bataille et boucle WEGO.
// Le matin (phase « plan »), le jeu est en pause : chaque camp déploie ses réserves et trace ses vecteurs d'ordres,
// sans voir ceux de l'adversaire. La journée (phase « resolve ») s'exécute seule sur un nombre fixe de ticks ;
// elle s'arrête plus tôt si une condition de victoire est atteinte.
// Les unités ont disparu : chaque case de la micro-grille porte une densité de troupes de son propriétaire.

import { createRng, hashString } from './rng.js';
import { generateFrontMap, makeNoise } from './mapgen.js';
import { cellCenters } from './hex.js';
import { MOUNTAIN } from './terrain.js';
import { findPockets, bfsDistance } from './path.js';
import { emptyField, frontNeed, frontTick } from './combat.js';

export const FRONT_SIDES = ['DE', 'SU'];
export const sideIndex = (s) => (s === 'DE' ? 0 : 1);

// Réglages d'une bataille (index 0 : Wehrmacht, 1 : Armée rouge ; qualité contre quantité).
export const FRONT_SETUP = {
  days: 10,
  ticks: 30, // ticks par journée
  troops: [5200, 6200], // densité totale sur la carte au départ
  reserve: [600, 700], // pool logistique initial
  reinforce: [240, 280], // renforts quotidiens, au prorata du bord de carte ravitaillé
  townBonus: 25, // renforts quotidiens par ville tenue
  quality: [1.15, 1],
  maxVectors: 4,
  maxArmor: 2,
  chunk: 80, // densité déposée par clic de déploiement
  vision: 5, // portée de reconnaissance, en cases, depuis toute case occupée
  drain: 0.012, // malus logistique d'une poche : part de sa densité perdue à chaque tick (~30 % par jour)
  men: 10, // hommes par unité de densité (affichage)
  // Rôles : l'attaquant a plus de réserves et de renforts ; le défenseur part retranché.
  attackReserve: 1.8, // multiplicateur du pool logistique initial de l'attaquant
  attackReinforce: 1.3, // multiplicateur de ses renforts quotidiens
  entrenchDepth: 6, // profondeur (en cases depuis le front) du retranchement initial du défenseur
  entrenchDef: 0.4, // bonus de défense d'une case pleinement retranchée (+40 %)
};

// Types de vecteurs. sigma : demi-largeur du couloir ; catch : rayon de ramassage autour de l'origine
// (les troupes proches s'y engagent, pondérées par leur proximité) ; speed : part de la densité engagée
// qui avance à chaque tick ; atk : puissance de choc ; maxLen : longueur maximale, en cases.
// Les blindés, rapides, drainent fort leur point de départ : si la réserve s'assèche, la percée s'arrête.
export const VECTOR_TYPES = {
  infantry: { label: 'Infanterie', sigma: 3.2, catch: 5.5, speed: 0.3, atk: 1.2, maxLen: 22 },
  armor: { label: 'Blindés', sigma: 1.8, catch: 6.5, speed: 0.7, atk: 1.8, maxLen: 42 },
};

// Poches : comportements possibles (statu quo, forteresse, percée d'évasion).
export const POCKET_MODES = {
  hold: 'statu quo',
  festung: 'Festung : contraction',
  breakout: 'percée d\'évasion',
};

let nextVectorId = 1;

// attacker : camp attaquant ('DE' ou 'SU'), fixé au briefing.
export function createFront({ seed, playerSide = 'DE', attacker = 'DE', biome = null, days = FRONT_SETUP.days, setup = {} } = {}) {
  const cfg = { ...FRONT_SETUP, ...setup, days };
  const map = generateFrontMap(seed, { biome });
  const { W, H, N } = map;
  const owner = new Int8Array(N);
  const dens = new Float32Array(N);
  // Ligne de départ : vers le milieu de la carte, avec des ondulations.
  const wiggle = makeNoise(createRng(`frontline:${seed}`));
  for (let i = 0; i < N; i++) {
    const col = i % W, row = Math.floor(i / W);
    const b = W / 2 + (wiggle(row * 0.06, 0.5, 3) - 0.5) * 16;
    owner[i] = map.kind[i] === MOUNTAIN ? -1 : col + 0.5 * (row & 1) < b ? 0 : 1;
  }
  const front = {
    seed,
    map,
    centers: cellCenters(W, H, 1),
    cfg,
    owner,
    dens,
    field: [emptyField(N), emptyField(N)],
    quality: cfg.quality.slice(),
    reserve: cfg.reserve.slice(),
    attacker: sideIndex(attacker),
    entrench: new Float32Array(N), // 0 à 1 : retranchement de chaque case (défense × 1 + entrenchDef × e)
    orders: [[], []],
    lastOrders: [[], []],
    deployments: [[], []],
    supplied: [new Uint8Array(N), new Uint8Array(N)],
    pockets: [[], []],
    pocketTag: [new Int32Array(N), new Int32Array(N)],
    pocketInfo: new Map(),
    nextPocket: 1,
    stats: { losses: [0, 0], captured: [0, 0], byBreach: 0, byEmpty: 0 },
    day: 1,
    tick: 0,
    clock: 0, // ticks écoulés depuis le début (mémoire du brouillard)
    phase: 'plan',
    playerSide: playerSide ? sideIndex(playerSide) : null,
    rng: createRng(`front:battle:${seed}`),
    memory: [null, null],
    vision: [null, null],
    result: null,
    log: [],
    // Crochets de l'IA (frontai.js) : plan du matin et réaction des poches encerclées.
    planAI: null,
    pocketAI: null,
  };
  // Répartition initiale : au prorata du besoin de chaque case (forte au contact, faible à l'arrière).
  for (const s of [0, 1]) {
    const { need } = frontNeed(front, s);
    let total = 0;
    for (let i = 0; i < N; i++) if (owner[i] === s) total += need[i] * map.flow[i] ** 0.5;
    for (let i = 0; i < N; i++) if (owner[i] === s) dens[i] = (cfg.troops[s] * need[i] * map.flow[i] ** 0.5) / total;
  }
  // Rôles : l'attaquant reçoit plus de réserves ; le défenseur est retranché sur quelques cases derrière le front.
  const att = front.attacker, def = 1 - att;
  front.reserve[att] = Math.round(front.reserve[att] * cfg.attackReserve);
  {
    const seeds = [];
    for (let i = 0; i < N; i++) {
      if (owner[i] !== def) continue;
      for (let d = 0; d < 6; d++) { const j = map.nb[i * 6 + d]; if (j >= 0 && owner[j] === att) { seeds.push(i); break; } }
    }
    const dist = bfsDistance(map.nb, N, seeds, (i) => owner[i] === def, cfg.entrenchDepth);
    // Fortifications inégales le long du front : des secteurs solides, d'autres à peine tenus (points faibles à
    // découvrir), et toujours les abords des villes.
    const works = makeNoise(createRng(`works:${seed}`));
    const nearTown = bfsDistance(map.nb, N, map.towns.map((t) => t.i), () => true, 3);
    for (let i = 0; i < N; i++) {
      if (owner[i] !== def || dist[i] >= cfg.entrenchDepth) continue;
      const row = Math.floor(i / W);
      const sector = Math.min(1, Math.max(0.1, (works(row * 0.09, 3.3, 2) - 0.3) * 2.2));
      front.entrench[i] = nearTown[i] <= 3 ? 1 : sector;
    }
  }
  // Objectif de l'attaquant : tenir au 10e jour au moins la moitié des villes que le défenseur avait au départ.
  front.defTowns = map.towns.filter((t) => owner[t.i] === def).map((t) => t.i);
  front.goal = Math.max(1, Math.ceil(front.defTowns.length / 2));
  front.initial = [troops(front, 0) + front.reserve[0], troops(front, 1) + front.reserve[1]];
  front.memory = [0, 1].map((s) => ({ owner: Int8Array.from(owner), est: new Float32Array(N), seen: new Int32Array(N).fill(-1) }));
  updateSupply(front);
  updateMemory(front);
  flog(front, 'day', `— Jour 1 : ${map.name} —`);
  return front;
}

// ---------- Mesures ----------

export function troops(front, s) {
  let t = 0;
  for (let i = 0; i < front.map.N; i++) if (front.owner[i] === s) t += front.dens[i];
  return t;
}

export function territory(front, s) {
  let own = 0, open = 0;
  for (let i = 0; i < front.map.N; i++) {
    if (front.owner[i] < 0) continue;
    open++;
    if (front.owner[i] === s) own++;
  }
  return own / Math.max(1, open);
}

export const townsHeld = (front, s) => front.map.towns.filter((t) => front.owner[t.i] === s).length;

export function edgeCol(front, s) { return s === 0 ? 0 : front.map.W - 1; }

function flog(front, kind, text, side = null) {
  front.log.push({ day: front.day, tick: front.tick, kind, text, side });
}

// ---------- Ordres (phase de planification) ----------

const len = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

// Ajoute un vecteur depuis la case de départ fromI vers un point de la carte (coordonnées de grille, taille 1).
// Renvoie le vecteur, ou { error } si l'ordre est refusé.
export function addVector(front, s, type, fromI, to) {
  const T = VECTOR_TYPES[type];
  if (!T) return { error: 'Type d\'ordre inconnu.' };
  if (front.phase !== 'plan') return { error: 'Les ordres se donnent le matin.' };
  if (front.owner[fromI] !== s) return { error: 'Un vecteur part de vos lignes.' };
  const mine = front.orders[s].filter((v) => !v.pocket);
  if (mine.length >= front.cfg.maxVectors) return { error: `${front.cfg.maxVectors} vecteurs au plus par journée.` };
  if (type === 'armor' && mine.filter((v) => v.type === 'armor').length >= front.cfg.maxArmor) return { error: `${front.cfg.maxArmor} percées blindées au plus par journée.` };
  const from = { x: front.centers.x[fromI], y: front.centers.y[fromI] };
  let target = { ...to };
  const L = len(from, target);
  if (L < 2) return { error: 'Vecteur trop court.' };
  if (L > T.maxLen) target = { x: from.x + ((to.x - from.x) * T.maxLen) / L, y: from.y + ((to.y - from.y) * T.maxLen) / L };
  const v = { id: nextVectorId++, side: s, type, fromI, from, to: target };
  front.orders[s].push(v);
  return v;
}

export function removeVector(front, s, id) {
  front.orders[s] = front.orders[s].filter((v) => v.id !== id);
}

// Troupes qu'un vecteur ramasse au départ (pondérées par la proximité) : estimation montrée pendant le plan.
export function vectorCatchment(front, v) {
  const T = VECTOR_TYPES[v.type];
  const { x, y } = front.centers;
  let sum = 0;
  for (let i = 0; i < front.map.N; i++) {
    if (front.owner[i] !== v.side) continue;
    const d = Math.hypot(x[i] - v.from.x, y[i] - v.from.y);
    if (d < T.catch * 2) sum += front.dens[i] * Math.exp(-((d / T.catch) ** 2));
  }
  return sum;
}

// Déploie des réserves du pool logistique autour de la case i (cases à soi et ravitaillées seulement).
export function deployReserve(front, s, i, amount = front.cfg.chunk) {
  if (front.phase !== 'plan' && front.phase !== 'ai') return { error: 'Les réserves montent en ligne le matin.' };
  amount = Math.min(amount, front.reserve[s]);
  if (amount < 1) return { error: 'Pool logistique épuisé.' };
  if (front.owner[i] !== s || !front.supplied[s][i]) return { error: 'Déploiement impossible : case hors de vos lignes ravitaillées.' };
  const { map } = front;
  const dist = bfsDistance(map.nb, map.N, [i], (j) => front.owner[j] === s && front.supplied[s][j], 3);
  const cells = [];
  let tw = 0;
  for (let j = 0; j < map.N; j++) {
    if (dist[j] > 3) continue;
    const w = Math.exp(-((dist[j] / 2) ** 2)) * map.flow[j];
    if (w > 0) { cells.push([j, w]); tw += w; }
  }
  const placed = cells.map(([j, w]) => [j, (amount * w) / tw]);
  for (const [j, a] of placed) front.dens[j] += a;
  front.reserve[s] -= amount;
  front.deployments[s].push({ i, amount, placed });
  return { amount };
}

export function undoDeployment(front, s) {
  const d = front.deployments[s].pop();
  if (!d) return false;
  for (const [j, a] of d.placed) front.dens[j] = Math.max(0, front.dens[j] - a);
  front.reserve[s] += d.amount;
  return true;
}

// Reprend les vecteurs de la veille dont le départ est toujours dans nos lignes.
export function repeatOrders(front, s) {
  for (const v of front.lastOrders[s]) {
    if (front.orders[s].some((o) => o.id === v.id)) continue;
    const r = addVector(front, s, v.type, v.fromI, v.to);
    if (r.error) continue;
  }
}

// ---------- Champs d'ordres ----------

// Traduit les vecteurs (et les comportements des poches) en champ par case : part engagée, direction, vitesse.
// - couloir (0 ≤ t ≤ 1 le long du vecteur) : poids gaussien selon l'écart à l'axe, direction = l'axe + rappel vers lui ;
// - ramassage (t < 0, derrière l'origine) : les troupes proches convergent vers l'origine ; c'est le drainage ;
// - au-delà de la cible : rien, les troupes arrivées tiennent (défense élastique).
export function rebuildFields(front, s) {
  const { map, owner, centers } = front;
  const { N } = map;
  const F = front.field[s];
  const wsum = new Float32Array(N);
  F.w.fill(0); F.dx.fill(0); F.dy.fill(0); F.speed.fill(0); F.atk.fill(0); F.skirm.fill(1);
  // Retranchement : bonus de défense des cases fortifiées (défenseur au départ, puis lignes de défense).
  for (let i = 0; i < N; i++) F.fort[i] = owner[i] === s ? 1 + front.cfg.entrenchDef * front.entrench[i] : 1;
  const add = (i, w, dx, dy, speed, atk) => {
    const l = Math.hypot(dx, dy) || 1;
    wsum[i] += w;
    F.dx[i] += (w * dx) / l;
    F.dy[i] += (w * dy) / l;
    F.speed[i] += w * speed;
    F.atk[i] += w * atk;
  };
  for (const v of front.orders[s]) {
    const T = VECTOR_TYPES[v.type];
    const L = len(v.from, v.to);
    const ux = (v.to.x - v.from.x) / L, uy = (v.to.y - v.from.y) / L;
    for (let i = 0; i < N; i++) {
      if (owner[i] !== s) continue;
      const rx = centers.x[i] - v.from.x, ry = centers.y[i] - v.from.y;
      const t = (rx * ux + ry * uy) / L;
      if (t > 1) continue;
      if (v.pocket?.has(i)) {
        // Percée d'évasion : toute la poche converge vers le point de rupture, quitte à dégarnir ses flancs.
        const d = Math.hypot(rx, ry);
        if (d > 1.2) { add(i, 0.85, -rx, -ry, 0.3, 0.4); continue; }
      }
      if (t >= 0) {
        const perp = rx * -uy + ry * ux;
        const w = Math.exp(-((perp / T.sigma) ** 2));
        if (w < 0.02) continue;
        const pull = -Math.sign(perp) * Math.min(1, Math.abs(perp) / T.sigma) * 0.9;
        add(i, w, ux - uy * pull, uy + ux * pull, T.speed, T.atk);
      } else {
        const d = Math.hypot(rx, ry);
        const w = Math.exp(-((d / T.catch) ** 2));
        if (w < 0.02) continue;
        add(i, w, -rx / (d || 1) * 0.8 + ux * 0.4, -ry / (d || 1) * 0.8 + uy * 0.4, T.speed, T.atk);
      }
    }
  }
  for (let i = 0; i < N; i++) {
    const w = wsum[i];
    if (!w) continue;
    F.speed[i] /= w;
    F.atk[i] /= w;
    F.w[i] = Math.min(1, w);
  }
  // Festung : la poche se contracte vers son centre, plus dense, plus meurtrière, mais cède du terrain.
  for (const p of front.pockets[s]) {
    if (p.mode !== 'festung') continue;
    for (const i of p.cells) {
      const dx = p.cx - centers.x[i], dy = p.cy - centers.y[i];
      const d = Math.hypot(dx, dy);
      if (d > 1) { F.w[i] = 0.55; F.dx[i] = dx / d; F.dy[i] = dy / d; F.speed[i] = 0.12; F.atk[i] = 0.3; }
      F.fort[i] = Math.max(F.fort[i], 1.4);
      F.skirm[i] = 2.5;
    }
  }
}

// ---------- Ravitaillement et poches ----------

// Flood-fill depuis le bord de carte de chaque camp : ce qui n'y est pas relié par ses propres cases est encerclé.
// Une poche garde son identité (et son comportement) d'un tick à l'autre tant qu'elle existe.
function updateSupply(front) {
  const fresh = [];
  for (const s of [0, 1]) {
    const { supplied, pockets } = findPockets(front.map, front.owner, s, edgeCol(front, s));
    front.supplied[s] = supplied;
    const tag = front.pocketTag[s];
    const next = new Int32Array(front.map.N);
    const out = [];
    for (const cells of pockets) {
      const votes = new Map();
      for (const i of cells) if (tag[i]) votes.set(tag[i], (votes.get(tag[i]) ?? 0) + 1);
      let id = 0, best = 0;
      for (const [k, n] of votes) if (n > best && !out.some((p) => p.id === k)) { best = n; id = k; }
      const isNew = !id;
      if (isNew) { id = front.nextPocket++; front.pocketInfo.set(id, { mode: 'hold', born: front.clock }); }
      const info = front.pocketInfo.get(id);
      let cx = 0, cy = 0, t = 0;
      for (const i of cells) { next[i] = id; cx += front.centers.x[i]; cy += front.centers.y[i]; t += front.dens[i]; }
      const p = { id, side: s, cells, cx: cx / cells.length, cy: cy / cells.length, troops: t, mode: info.mode, info };
      out.push(p);
      if (isNew && t > 1) fresh.push(p);
    }
    // Poches disparues : délivrées ou anéanties.
    for (const p of front.pockets[s]) {
      if (out.some((o) => o.id === p.id)) continue;
      const relieved = p.cells.some((i) => front.owner[i] === s && supplied[i]);
      if (p.troops > 5) flog(front, 'pocket', relieved ? `La poche ${pocketName(front, p)} est dégagée.` : `La poche ${pocketName(front, p)} est réduite.`, s);
      front.pocketInfo.delete(p.id);
    }
    front.pocketTag[s] = next;
    front.pockets[s] = out;
  }
  return fresh;
}

export function pocketName(front, p) {
  let best = null, bd = Infinity;
  for (const t of front.map.towns) {
    const d = Math.hypot(front.centers.x[t.i] - p.cx, front.centers.y[t.i] - p.cy);
    if (d < bd) { bd = d; best = t; }
  }
  return best ? (bd < 4 ? `de ${best.name}` : `près de ${best.name}`) : `n° ${p.id}`;
}

// ---------- Brouillard de guerre ----------

// Un camp voit ses cases et, autour de toute case occupée, une bande de reconnaissance de quelques cases.
// Il ne lit jamais la densité ennemie exacte : une estimation bruitée et arrondie, que le rendu traduit en opacité.
export function computeVision(front, s) {
  const { map, owner, dens } = front;
  const seeds = [];
  for (let i = 0; i < map.N; i++) if (owner[i] === s && dens[i] > 0.5) seeds.push(i);
  const dist = bfsDistance(map.nb, map.N, seeds, (i) => owner[i] >= 0 || true, front.cfg.vision);
  const vis = new Uint8Array(map.N);
  for (let i = 0; i < map.N; i++) vis[i] = owner[i] === s || dist[i] <= front.cfg.vision ? 1 : 0;
  return vis;
}

export function estimate(front, s, i) {
  const n = (hashString(`${front.seed}:${s}:${front.day}:${i}`) % 1000) / 1000; // erreur d'appréciation du jour
  return Math.round((front.dens[i] * (0.75 + 0.5 * n)) / 2.5) * 2.5;
}

function updateMemory(front) {
  for (const s of [0, 1]) {
    const vis = computeVision(front, s);
    front.vision[s] = vis;
    const m = front.memory[s];
    for (let i = 0; i < front.map.N; i++) {
      if (!vis[i]) continue;
      m.owner[i] = front.owner[i];
      m.est[i] = front.owner[i] === 1 - s ? estimate(front, s, i) : 0;
      m.seen[i] = front.clock;
    }
  }
}

// ---------- Résolution (journée) ----------

// Fin du plan : l'IA donne ses ordres (en même temps que le joueur, sans les voir), puis la journée commence.
export function beginDay(front) {
  if (front.phase !== 'plan') return;
  for (const s of [0, 1]) if (s !== front.playerSide) front.planAI?.(front, s);
  front.phase = 'resolve';
  front.tick = 0;
  front.dayStart = { troops: [troops(front, 0), troops(front, 1)], territory: [territory(front, 0), territory(front, 1)], losses: front.stats.losses.slice() };
}

// Un tick : flux et pression (combat.js), puis ravitaillement, malus des poches, brouillard, victoire.
export function stepTick(front) {
  if (front.phase !== 'resolve') return [];
  rebuildFields(front, 0);
  rebuildFields(front, 1);
  const events = frontTick(front);
  for (const e of events) {
    if (e.kind !== 'capture') continue;
    front.entrench[e.i] = 0; // une case prise perd son retranchement
    const town = front.map.towns.find((t) => t.i === e.i);
    if (town) flog(front, 'town', `${FRONT_SIDES[e.side] === 'DE' ? 'La Wehrmacht' : 'L\'Armée rouge'} prend ${town.name}.`, e.side);
  }
  const fresh = updateSupply(front);
  // Malus logistique immédiat : une poche perd chaque tick une part de sa densité.
  for (const s of [0, 1]) {
    for (const p of front.pockets[s]) {
      let lost = 0;
      for (const i of p.cells) { const l = front.dens[i] * front.cfg.drain; front.dens[i] -= l; lost += l; }
      front.stats.losses[s] += lost;
      p.troops -= lost;
    }
  }
  for (const p of fresh) {
    if (p.side !== front.playerSide) front.pocketAI?.(front, p);
    flog(front, 'pocket', `Encerclement : ${Math.round(p.troops * front.cfg.men).toLocaleString('fr-FR')} hommes pris dans la poche ${pocketName(front, p)}${p.info.mode !== 'hold' ? ` (${POCKET_MODES[p.info.mode]})` : ''}.`, p.side);
    events.push({ kind: 'pocket', side: p.side, id: p.id });
  }
  front.clock++;
  front.tick++;
  updateMemory(front);
  checkFrontVictory(front);
  if (front.phase === 'resolve' && front.tick >= front.cfg.ticks) endDay(front);
  return events;
}

// Résout toute la journée d'un coup (tests, simulations IA contre IA).
export function runDay(front) {
  beginDay(front);
  while (front.phase === 'resolve') stepTick(front);
}

function endDay(front) {
  const c = front.cfg;
  for (const s of [0, 1]) {
    // Renforts : au prorata du bord de carte encore ravitaillé, plus un bonus par ville tenue.
    const { W, H } = front.map;
    let edge = 0;
    for (let row = 0; row < H; row++) if (front.supplied[s][row * W + edgeCol(front, s)]) edge++;
    const add = Math.round(c.reinforce[s] * (edge / H) * (s === front.attacker ? c.attackReinforce : 1) + c.townBonus * townsHeld(front, s));
    front.reserve[s] += add;
    front.lastOrders[s] = front.orders[s].filter((v) => !v.pocket);
    front.orders[s] = [];
    front.deployments[s] = [];
  }
  const d = front.dayStart;
  if (d) {
    const fmt = (s) => `${FRONT_SIDES[s]} −${Math.round((front.stats.losses[s] - d.losses[s]) * c.men).toLocaleString('fr-FR')} h`;
    flog(front, 'report', `Bilan du jour ${front.day} : pertes ${fmt(0)}, ${fmt(1)}.`);
  }
  if (front.day >= c.days) {
    front.day++;
    finalVerdict(front);
    return;
  }
  front.day++;
  front.phase = 'plan';
  front.tick = 0;
  flog(front, 'day', `— Jour ${front.day} —`);
}

// ---------- Conditions de victoire ----------

function finish(front, winner, reason) {
  front.result = { winner, reason };
  front.phase = 'over';
  flog(front, 'result', reason, winner);
}

// Vérifiée à chaque tick : la journée s'arrête dès qu'un camp s'effondre ou tient toutes les villes.
export function checkFrontVictory(front) {
  if (front.result) return front.result;
  const name = (s) => (s === 0 ? 'La Wehrmacht' : 'L\'Armée rouge');
  for (const s of [0, 1]) {
    const o = 1 - s;
    if (troops(front, s) + front.reserve[s] < 0.12 * front.initial[s]) return finish(front, o, `${name(s)} est anéantie : ${name(o).toLowerCase()} l'emporte.`);
    if (territory(front, s) < 0.12) return finish(front, o, `Le front de ${name(s).toLowerCase()} s'effondre.`);
  }
  const towns = front.map.towns;
  if (towns.length >= 3) {
    for (const s of [0, 1]) if (towns.every((t) => front.owner[t.i] === s)) return finish(front, s, `${name(s)} tient toutes les villes du secteur.`);
  }
  return null;
}

// Au terme des journées : l'attaquant gagne s'il tient au moins la moitié des villes que le défenseur avait au départ ;
// sinon le défenseur a tenu.
export function attackerTowns(front) {
  return front.defTowns.filter((i) => front.owner[i] === front.attacker).length;
}

function finalVerdict(front) {
  const att = front.attacker, def = 1 - att;
  const name = (s) => (s === 0 ? 'la Wehrmacht' : 'l\'Armée rouge');
  const got = attackerTowns(front);
  if (got >= front.goal) return finish(front, att, `Fin de l'offensive : ${name(att)} a pris ${got} ville${got > 1 ? 's' : ''} sur les ${front.goal} visées.`);
  finish(front, def, `Fin de l'offensive : ${name(def)} a tenu, l'ennemi n'a pris que ${got} ville${got > 1 ? 's' : ''} sur les ${front.goal} visées.`);
}
