// Frontline stratégique : état de bataille et boucle WEGO.
// Le matin (phase « plan »), le jeu est en pause : chaque camp déploie ses réserves et trace ses vecteurs d'ordres,
// sans voir ceux de l'adversaire. La journée (phase « resolve ») s'exécute seule sur un nombre fixe de ticks ;
// elle s'arrête plus tôt si une condition de victoire est atteinte.
// Les unités ont disparu : chaque case de la micro-grille porte une densité de troupes de son propriétaire.

import { createRng, hashString } from './rng.js';
import { generateFrontMap, makeNoise } from './mapgen.js';
import { cellCenters, pixelToHex } from './hex.js';
import { MOUNTAIN, computeTerrain } from './terrain.js';
import { SEASON } from './conditions.js';
import { findPockets, bfsDistance } from './path.js';
import { emptyField, frontNeed, frontTick } from './combat.js';
import { FRONT_TRAITS, scenarioOf, DEFAULT_YEAR } from './frontscenario.js';
import { initSupply, updateSupplyK, advanceRails, restTroops } from './frontsupply.js';
import { createArmor, armorAfter, armorNight, updateArmorSightings, ARMOR_SETUP } from './frontarmor.js';
import { WORKS, initWorks, defenderBelt, barrageWorks, captureWorks, buildTick, trenchFor } from './frontworks.js';
import { initScore, eveningScore, noteCapture, scoreBreakdown, GRADES } from './frontscore.js';
import { GUN_KINDS, GUN_RULES, createGuns, gunFor, gunPower, moveGuns, supportFire, gunsNight, updateGunSightings } from './frontguns.js';

export const FRONT_SIDES = ['DE', 'SU'];
export const sideIndex = (s) => (s === 'DE' ? 0 : 1);

// Réglages d'une bataille (index 0 : Wehrmacht, 1 : Armée rouge ; qualité contre quantité).
export const FRONT_SETUP = {
  days: 15,
  ticks: 24, // ticks par journée
  // Valeurs par défaut = scénario 1943 (frontscenario.js) ; createFront({ year }) applique celles d'une autre année.
  troops: [5800, 6000], // densité totale sur la carte au départ
  reserve: [600, 800], // pool logistique initial
  reinforce: [240, 300], // renforts quotidiens, au prorata du bord de carte ravitaillé
  townBonus: 25, // renforts quotidiens par ville tenue
  quality: [1.38, 1], // qualité (les atouts propres à chaque camp sont dans FRONT_TRAITS)
  maxVectors: 16, // garde-fou seulement : la vraie limite est la part des troupes engagées (engageCap)
  maxArmor: 2, // ancien vecteur blindé (moteur et tests)
  engageCap: 0.6, // part au plus des troupes d'un camp engagée sur ses vecteurs ; au-delà, tous sont réduits d'autant
  maxLines: 2, // lignes de défense par jour
  lineLen: 30, // longueur maximale d'une ligne, en cases
  lineWidth: 1.8, // demi-largeur de la bande retranchée (unités de grille ; deux cases voisines sont à 1,73)
  // Groupes d'artillerie (frontguns.js) : une mission de barrage par groupe et par jour, dans sa portée.
  guns: [['div', 'div', 'heavy'], ['div', 'mortar', 'rocket']],
  barrageTicks: 5, // le barrage martèle la zone pendant les premiers ticks de la journée
  retreatCover: 0.33, // usure subie par les troupes qui décrochent en bon ordre
  chunk: 80, // densité déposée par clic de déploiement
  vision: 5, // portée de reconnaissance, en cases, depuis toute case occupée
  drain: 0.012, // malus logistique d'une poche : part de sa densité perdue à chaque tick (~30 % par jour)
  festungDrain: 0.6, // une poche en Festung, resserrée et rationnée, perd ses troupes moins vite
  men: 10, // hommes par unité de densité (affichage)
  // Rôles : l'attaquant a plus de réserves et de renforts ; le défenseur part retranché.
  attackReserve: 1.8, // multiplicateur du pool logistique initial de l'attaquant
  attackReinforce: 1.3, // multiplicateur de ses renforts quotidiens
  entrenchDepth: 6, // profondeur (en cases depuis le front) du retranchement initial du défenseur
  recover: 0.2, // part des pertes du jour qui rejoint la nuit (réserves)
  entrenchDef: 0.4, // bonus de défense d'une case pleinement retranchée (+40 %)
  goalShare: 0.75, // part des villes du défenseur que l'attaquant doit tenir au dernier jour (arrondie au-dessus)
};

// Types de vecteurs. sigma : demi-largeur du couloir ; catch : rayon de ramassage autour de l'origine
// (les troupes proches s'y engagent, pondérées par leur proximité) ; speed : part de la densité engagée
// qui avance à chaque tick ; atk : puissance de choc ; maxLen : longueur maximale, en cases.
// Les blindés, rapides, drainent fort leur point de départ : si la réserve s'assèche, la percée s'arrête.
export const VECTOR_TYPES = {
  infantry: { label: 'Infanterie', sigma: 3.2, catch: 5.5, speed: 0.3, atk: 1.2, maxLen: 22 },
  armor: { label: 'Blindés', sigma: 1.8, catch: 6.5, speed: 0.7, atk: 1.8, maxLen: 42 },
  // Repli ordonné : vers l'arrière, sans pousser l'ennemi ; le terrain cédé n'est perdu que s'il vient l'occuper.
  retreat: { label: 'Repli', sigma: 2.8, catch: 5, speed: 0.3, atk: 0, maxLen: 20, retreat: true },
  // Fixation : une bande large qui presse l'ennemi sans chercher à prendre de cases, à pertes réduites ; les cases
  // ennemies pressées ne peuvent plus envoyer de troupes ailleurs et appellent des renforts.
  fix: { label: 'Fixation', sigma: 4.5, catch: 4, speed: 0.04, atk: 0.55, maxLen: 14, fix: true },
};

// Météo du jour : tirée chaque matin selon le mois (même table que le mode tactique), avec une chance sur deux de
// garder le temps de la veille. Effets : vitesse des vecteurs, portée de reconnaissance, efficacité des barrages
// (le brouillard les prive d'observation) ; la neige gèle les marais.
export const FRONT_WEATHER = {
  clear: { label: 'Temps clair', armor: 1, infantry: 1, vision: 0, barrage: 1, text: 'Bonne visibilité, terrain sec.' },
  rain: { label: 'Pluie', armor: 0.6, infantry: 0.9, vision: -1, barrage: 1, text: 'Les blindés s\'enlisent (vitesse × 0,6) ; reconnaissance −1.' },
  fog: { label: 'Brouillard', armor: 0.9, infantry: 1, vision: -3, barrage: 0.7, text: 'Reconnaissance réduite à 2 cases ; barrages sans observation, 30 % moins efficaces.' },
  snow: { label: 'Neige', armor: 0.75, infantry: 0.85, vision: -1, barrage: 1, frozen: true, text: 'Progression ralentie ; marais gelés, praticables.' },
};

// Poches : comportements possibles (statu quo, forteresse, percée d'évasion).
export const POCKET_MODES = {
  hold: 'statu quo',
  festung: 'Festung : contraction',
  breakout: 'percée d\'évasion',
};

let nextVectorId = 1;

// attacker : camp attaquant ('DE' ou 'SU'), fixé au briefing ; season : indice du mois (0 juillet … 4 novembre).
export function createFront({ seed, playerSide = 'DE', attacker = 'DE', biome = null, season = 0, days = FRONT_SETUP.days, setup = {}, year = null } = {}) {
  const sc = year ? scenarioOf(year) : null;
  const cfg = { ...FRONT_SETUP, ...FRONT_TRAITS, ...(sc ? { ...sc.setup, guns: sc.guns, armor: sc.armor } : {}), ...setup, days };
  const map = generateFrontMap(seed, { biome, defender: attacker === 'DE' ? 1 : 0 });
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
    year: year ?? DEFAULT_YEAR,
    bias: sc?.bias ?? 0, // exigence du scénario envers l'offensive (frontscore.js)
    map,
    centers: cellCenters(W, H, 1),
    cfg,
    owner,
    dens,
    field: [emptyField(N), emptyField(N)],
    quality: cfg.quality.slice(),
    reserve: cfg.reserve.slice(),
    attacker: sideIndex(attacker),
    season: Math.max(0, Math.min(SEASON.length - 1, season)),
    weather: 'clear',
    entrench: new Float32Array(N), // 0 à 1 : retranchement de chaque case (défense × 1 + entrenchDef × e)
    orders: [[], []],
    lastOrders: [[], []],
    lines: [[], []], // lignes de défense du jour
    barrages: [[], []], // barrages de zone du jour
    lineMask: new Uint8Array(N), // cases couvertes par une ligne de défense aujourd'hui
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
  front.guns = createGuns(front, cfg.guns);
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
    initWorks(front);
    defenderBelt(front, def, dist, (i) => Math.min(1, Math.max(0.1, (works(Math.floor(i / W) * 0.09, 3.3, 2) - 0.3) * 2.2)), nearTown, cfg.entrenchDepth);
  }
  // Villes ★ : celles du défenseur au départ (score de l'offensive, frontscore.js).
  front.defTowns = map.towns.filter((t) => owner[t.i] === def).map((t) => t.i);
  front.goal = Math.max(1, Math.ceil(front.defTowns.length * cfg.goalShare - 1e-9));
  front.initial = [troops(front, 0) + front.reserve[0], troops(front, 1) + front.reserve[1]];
  front.memory = [0, 1].map((s) => ({ owner: Int8Array.from(owner), est: new Float32Array(N), seen: new Int32Array(N).fill(-1) }));
  rollWeather(front);
  updateSupply(front);
  updateMemory(front);
  front.armor = createArmor(front, cfg.armor ?? ARMOR_SETUP);
  updateGunSightings(front);
  updateArmorSightings(front);
  initSupply(front);
  initScore(front);
  flog(front, 'day', `— Jour 1 : ${map.name} · ${FRONT_WEATHER[front.weather].label} —`);
  return front;
}

// ---------- Météo ----------

// Tire le temps du jour (persistance : une chance sur deux de garder celui de la veille) et l'applique au terrain.
function rollWeather(front) {
  const odds = SEASON[front.season].weather;
  const keep = front.day > 1 && odds[front.weather] && front.rng.chance(0.5);
  if (!keep) front.weather = front.rng.weighted(odds);
  applyWeather(front);
}

// Le gel rend les marais et les rivières praticables : terrain recalculé.
export function applyWeather(front) {
  computeTerrain(front.map, !!FRONT_WEATHER[front.weather].frozen);
}

export const visionRange = (front) => Math.max(1, front.cfg.vision + FRONT_WEATHER[front.weather].vision);

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
  if (mine.length >= front.cfg.maxVectors) return { error: `${front.cfg.maxVectors} ordres au plus : regroupez vos attaques.` };
  if (type === 'armor' && mine.filter((v) => v.type === 'armor').length >= front.cfg.maxArmor) return { error: `${front.cfg.maxArmor} percées blindées au plus par journée.` };
  const from = { x: front.centers.x[fromI], y: front.centers.y[fromI] };
  let target = { ...to };
  const L = len(from, target);
  if (L < 2) return { error: 'Vecteur trop court.' };
  if (L > T.maxLen) target = { x: from.x + ((to.x - from.x) * T.maxLen) / L, y: from.y + ((to.y - from.y) * T.maxLen) / L };
  if (T.retreat) {
    const end = cellAtPoint(front, target);
    if (end < 0 || front.owner[end] !== s) return { error: 'Un repli se fait vers vos propres lignes.' };
  }
  const v = { id: nextVectorId++, side: s, type, fromI, from, to: target };
  front.orders[s].push(v);
  return v;
}

// Case la plus proche d'un point de la carte (coordonnées de grille).
export function cellAtPoint(front, p) {
  const h = pixelToHex(p.x, p.y, 1);
  const { W, H } = front.map;
  if (h.col < 0 || h.row < 0 || h.col >= W || h.row >= H) return -1;
  return h.row * W + h.col;
}

// Distance (grille) du segment [a, b] au point (x, y).
function segDist(a, b, x, y) {
  const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / l2));
  return Math.hypot(x - (a.x + t * vx), y - (a.y + t * vy));
}

// Ligne de défense : un chantier sur plusieurs jours (frontworks.js). Les cases amies le long du trait se
// retranchent (niveau 1), puis se couvrent de barbelés (2) et d'obstacles antichar (3) ; elles attirent les troupes
// voisines tant que le chantier dure.
export function addLine(front, s, a, b, level = 2) {
  if (front.phase !== 'plan') return { error: 'Les ordres se donnent le matin.' };
  if (front.lines[s].filter((l) => l.day === front.day).length >= front.cfg.maxLines) return { error: `${front.cfg.maxLines} nouvelles lignes de défense au plus par journée.` };
  if (front.lines[s].length >= WORKS.maxSites) return { error: `${WORKS.maxSites} chantiers au plus en même temps : attendez qu'une ligne soit achevée, ou retirez-en une.` };
  let L = len(a, b);
  if (L < 3) return { error: 'Ligne trop courte.' };
  if (L > front.cfg.lineLen) { b = { x: a.x + ((b.x - a.x) * front.cfg.lineLen) / L, y: a.y + ((b.y - a.y) * front.cfg.lineLen) / L }; L = front.cfg.lineLen; }
  const cells = [];
  let foreign = 0;
  for (let i = 0; i < front.map.N; i++) {
    if (segDist(a, b, front.centers.x[i], front.centers.y[i]) > front.cfg.lineWidth) continue;
    if (front.owner[i] === s) cells.push(i);
    else if (front.owner[i] >= 0) foreign++;
  }
  if (cells.length < foreign) return { error: 'Une ligne de défense se trace dans vos lignes.' };
  // Axe du chantier : la tranchée continue (dessinée) court sur les cases les plus proches du trait.
  const core = new Set(cells.filter((i) => segDist(a, b, front.centers.x[i], front.centers.y[i]) <= 0.9));
  const line = { id: nextVectorId++, side: s, a: { ...a }, b: { ...b }, cells, core, level: Math.max(1, Math.min(3, level)), day: front.day };
  front.lines[s].push(line);
  return line;
}

// Barrage de zone : un cercle martelé pendant les premiers ticks de la journée, même dans le brouillard, par le groupe
// d'artillerie disponible le plus puissant qui l'a à portée (gunId pour en imposer un).
export function addBarrage(front, s, at, gunId = null) {
  if (front.phase !== 'plan') return { error: 'Les ordres se donnent le matin.' };
  const free = front.guns.filter((g) => g.side === s && gunPower(g) > 0 && !front.barrages[s].some((b) => b.gun === g.id));
  if (!free.length) return { error: 'Aucun groupe d\'artillerie disponible : tous ont leur mission, ou sont en déplacement.' };
  const g = gunId != null ? free.find((x) => x.id === gunId && Math.hypot(x.x - at.x, x.y - at.y) <= GUN_KINDS[x.kind].range) : gunFor(front, s, at);
  if (!g) return { error: 'Hors de portée de vos groupes d\'artillerie disponibles.' };
  const K = GUN_KINDS[g.kind];
  const b = { id: nextVectorId++, side: s, x: at.x, y: at.y, r: K.r, gun: g.id };
  front.barrages[s].push(b);
  return b;
}

// Niveau d'ouvrage d'un chantier : 1 tranchées, 2 + barbelés, 3 + antichar.
export function setLineLevel(front, s, id, level) {
  const l = front.lines[s].find((x) => x.id === id);
  if (!l) return { error: 'Ligne introuvable.' };
  if (front.phase !== 'plan') return { error: 'Les ordres se donnent le matin.' };
  l.level = Math.max(1, Math.min(3, level));
  return l;
}

// Part des troupes du camp s engagée par ses ordres du matin (avant plafonnement), pour la jauge de l'interface.
export function engagement(front, s) {
  rebuildFields(front, s);
  return { share: front.engaged[s], cap: front.cfg.engageCap };
}

export function removeOrder(front, s, id) {
  front.orders[s] = front.orders[s].filter((v) => v.id !== id);
  front.lines[s] = front.lines[s].filter((v) => v.id !== id);
  front.barrages[s] = front.barrages[s].filter((v) => v.id !== id);
}

// Comportement d'une poche, choisi le matin (par le joueur pour les siennes, par l'IA pour les autres).
// mode : 'hold' (statu quo), 'festung' (contraction), 'breakout' (percée d'évasion vers target). Il reste en vigueur
// tant qu'on ne le change pas ; la percée est relancée chaque matin vers son point de sortie.
export function setPocketMode(front, s, id, mode, target = null) {
  const p = front.pockets[s].find((x) => x.id === id);
  if (!p) return { error: 'Poche introuvable.' };
  if (!POCKET_MODES[mode]) return { error: 'Comportement inconnu.' };
  if (mode === 'breakout' && !target) return { error: 'Indiquez la direction de la percée.' };
  p.info.mode = mode;
  p.mode = mode;
  p.info.target = mode === 'breakout' ? { ...target } : null;
  front.orders[s] = front.orders[s].filter((v) => v.pocket !== p.id);
  if (mode === 'breakout') front.orders[s].push(breakoutVector(front, p));
  return p;
}

function breakoutVector(front, p) {
  const t = p.info.target;
  let from = p.cells[0], bd = Infinity;
  for (const i of p.cells) {
    const d = Math.hypot(front.centers.x[i] - t.x, front.centers.y[i] - t.y);
    if (d < bd) { bd = d; from = i; }
  }
  const o = { x: front.centers.x[from], y: front.centers.y[from] };
  const L = Math.max(2, len(o, t));
  const to = L > VECTOR_TYPES.armor.maxLen ? { x: o.x + ((t.x - o.x) * VECTOR_TYPES.armor.maxLen) / L, y: o.y + ((t.y - o.y) * VECTOR_TYPES.armor.maxLen) / L } : t;
  return { id: nextVectorId++, side: p.side, type: 'armor', fromI: from, from: o, to, pocket: p.id, pocketCells: new Set(p.cells) };
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
  F.w.fill(0); F.dx.fill(0); F.dy.fill(0); F.speed.fill(0); F.atk.fill(0); F.skirm.fill(1); F.cover.fill(1); F.fixing.fill(0);
  const fsum = new Float32Array(N); // part de chaque case engagée dans une fixation
  const rsum = new Float32Array(N); // part de chaque case engagée dans un repli ordonné
  // Retranchement : bonus de défense des cases fortifiées (défenseur au départ, puis lignes de défense).
  for (let i = 0; i < N; i++) F.fort[i] = owner[i] === s ? 1 + front.cfg.entrenchDef * trenchFor(front, i, s) : 1;
  const add = (i, w, dx, dy, speed, atk) => {
    const l = Math.hypot(dx, dy) || 1;
    wsum[i] += w;
    F.dx[i] += (w * dx) / l;
    F.dy[i] += (w * dy) / l;
    F.speed[i] += w * speed;
    F.atk[i] += w * atk;
  };
  const W8 = FRONT_WEATHER[front.weather];
  for (const v of front.orders[s]) {
    const T0 = VECTOR_TYPES[v.type];
    // Camp aguerri à l'hiver : la neige ne ralentit pas son infanterie, à peine ses chars.
    const winter = W8.frozen && front.cfg.winter?.[s];
    const T = { ...T0, speed: T0.speed * (v.type === 'armor' ? (winter ? Math.max(W8.armor, 0.9) : W8.armor) : winter ? 1 : W8.infantry) };
    const L = len(v.from, v.to);
    const ux = (v.to.x - v.from.x) / L, uy = (v.to.y - v.from.y) / L;
    for (let i = 0; i < N; i++) {
      if (owner[i] !== s) continue;
      const rx = centers.x[i] - v.from.x, ry = centers.y[i] - v.from.y;
      const t = (rx * ux + ry * uy) / L;
      if (t > 1) continue;
      if (v.pocketCells?.has(i)) {
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
        if (T.retreat) rsum[i] += w;
        if (T.fix) fsum[i] += w;
      } else {
        const d = Math.hypot(rx, ry);
        const w = Math.exp(-((d / T.catch) ** 2));
        if (w < 0.02) continue;
        add(i, w, -rx / (d || 1) * 0.8 + ux * 0.4, -ry / (d || 1) * 0.8 + uy * 0.4, T.speed, T.atk);
        if (T.retreat) rsum[i] += w;
        if (T.fix) fsum[i] += w;
      }
    }
  }
  // Repli ordonné : les troupes qui décrochent en bon ordre subissent moins d'usure.
  for (let i = 0; i < N; i++) if (rsum[i] > 0.3) F.cover[i] = front.cfg.retreatCover;
  // Fixation : pertes subies réduites de moitié, et la poussée ne cherche pas la prise.
  for (let i = 0; i < N; i++) if (fsum[i] > 0) { F.fixing[i] = Math.min(1, fsum[i] / Math.max(1e-6, wsum[i])); if (F.fixing[i] > 0.5) F.cover[i] = Math.min(F.cover[i], 0.5); }
  for (let i = 0; i < N; i++) {
    const w = wsum[i];
    if (!w) continue;
    F.speed[i] /= w;
    F.atk[i] /= w;
    F.w[i] = Math.min(1, w);
  }
  // Répartition des troupes : au-delà de engageCap, tous les vecteurs sont réduits d'autant, pour que le front
  // garde de quoi tenir.
  let total = 0, engaged = 0;
  for (let i = 0; i < N; i++) if (owner[i] === s) { total += front.dens[i]; engaged += front.dens[i] * F.w[i]; }
  const share = total > 0 ? engaged / total : 0;
  front.engaged ??= [0, 0];
  front.engaged[s] = share;
  if (share > front.cfg.engageCap) {
    const k = front.cfg.engageCap / share;
    for (let i = 0; i < N; i++) if (F.w[i] > 0) F.w[i] *= k;
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
      if (p.troops >= 20) flog(front, 'pocket', relieved ? `La poche ${pocketName(front, p)} est dégagée.` : `La poche ${pocketName(front, p)} est réduite.`, s);
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
  const range = visionRange(front) + (front.cfg.visionBonus?.[s] ?? 0);
  const dist = bfsDistance(map.nb, map.N, seeds, () => true, range);
  const vis = new Uint8Array(map.N);
  for (let i = 0; i < map.N; i++) vis[i] = owner[i] === s || dist[i] <= range ? 1 : 0;
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
  for (const s of [0, 1]) {
    for (const p of front.pockets[s]) {
      if (p.info.mode === 'breakout' && p.info.target && !front.orders[s].some((v) => v.pocket === p.id)) front.orders[s].push(breakoutVector(front, p));
    }
  }
  front.lineMask.fill(0);
  for (const s of [0, 1]) for (const l of front.lines[s]) for (const i of l.cells) front.lineMask[i] = 1;
  front.phase = 'resolve';
  front.tick = 0;
  front.dayStart = { troops: [troops(front, 0), troops(front, 1)], territory: [territory(front, 0), territory(front, 1)], losses: front.stats.losses.slice(), pocket: front.stats.pocket.slice() };
}

// Un tick : flux et pression (combat.js), puis ravitaillement, malus des poches, brouillard, victoire.
export function stepTick(front) {
  if (front.phase !== 'resolve') return [];
  const early = [];
  updateSupplyK(front);
  applyWorks(front, early);
  rebuildFields(front, 0);
  rebuildFields(front, 1);
  const densBefore = Float32Array.from(front.dens);
  const events = frontTick(front);
  events.push(...early);
  armorAfter(front, front.tickLoss, densBefore, events);
  supportFire(front, front.tickEdges);
  moveGuns(front, events);
  for (const e of events) {
    if (e.kind === 'armorLost') { const a = front.armor.find((x) => x.id === e.id); flog(front, 'armor', `${a.name} (${FRONT_SIDES[a.side] === 'DE' ? 'Wehrmacht' : 'Armée rouge'}) ${e.spent ? 'est saignée à blanc : ses derniers chars sont retirés du front' : 'est encerclée et détruite'}.`, a.side); continue; }
    if (e.kind === 'bridge') { flog(front, 'bridge', `Un pont s'effondre sous les obus, près de ${nearestTownName(front, e.i)}.`, e.side); continue; }
    if (e.kind !== 'gunLost') continue;
    const g = front.guns.find((x) => x.id === e.id);
    flog(front, 'gun', `${g.name} (${FRONT_SIDES[g.side] === 'DE' ? 'Wehrmacht' : 'Armée rouge'}) ${e.counter ? 'réduit au silence par la contre-batterie' : 'débordé et perdu'}.`, g.side);
  }
  for (const e of events) {
    if (e.kind !== 'capture') continue;
    captureWorks(front, e.i); // barbelés coupés, tranchées bouleversées
    const town = front.map.towns.find((t) => t.i === e.i);
    noteCapture(front, e.i, e.side);
    if (town) flog(front, 'town', `${FRONT_SIDES[e.side] === 'DE' ? 'La Wehrmacht' : 'L\'Armée rouge'} prend ${town.name}.`, e.side);
  }
  const fresh = updateSupply(front);
  // Malus logistique immédiat : une poche perd chaque tick une part de sa densité.
  for (const s of [0, 1]) {
    for (const p of front.pockets[s]) {
      let lost = 0;
      const rate = front.cfg.drain * (p.mode === 'festung' ? front.cfg.festungDrain : 1);
      for (const i of p.cells) { const l = front.dens[i] * rate; front.dens[i] -= l; lost += l; }
      front.stats.losses[s] += lost;
      front.stats.pocket[s] += lost;
      p.troops -= lost;
    }
  }
  for (const p of fresh) {
    if (p.side !== front.playerSide) front.pocketAI?.(front, p);
    // Les miettes (enclaves vides, quelques hommes isolés) ne font pas une poche digne du journal.
    if (p.troops >= 20) flog(front, 'pocket', `Encerclement : ${Math.round(p.troops * front.cfg.men).toLocaleString('fr-FR')} hommes pris dans la poche ${pocketName(front, p)}${p.info.mode !== 'hold' ? ` (${POCKET_MODES[p.info.mode]})` : ''}.`, p.side);
    events.push({ kind: 'pocket', side: p.side, id: p.id });
  }
  front.clock++;
  front.tick++;
  updateMemory(front);
  updateGunSightings(front);
  updateArmorSightings(front);
  checkFrontVictory(front);
  if (front.phase === 'resolve' && front.tick >= front.cfg.ticks) endDay(front);
  return events;
}

// Lignes de défense (retranchement qui monte au fil de la journée) et barrages de zone (premiers ticks), dont la
// contre-batterie : un barrage use les groupes ennemis pris dans sa zone.
function applyWorks(front, events) {
  const c = front.cfg;
  let bridges = false;
  for (const s of [0, 1]) {
    buildTick(front, s);
    if (front.tick >= c.barrageTicks) continue;
    for (const b of front.barrages[s]) {
      const g = front.guns.find((x) => x.id === b.gun);
      const p = g ? gunPower(g) : 0;
      if (p <= 0) continue;
      const K = GUN_KINDS[g.kind];
      g.fired = front.clock;
      const k = p * FRONT_WEATHER[front.weather].barrage;
      for (let i = 0; i < front.map.N; i++) {
        if (front.owner[i] < 0) continue;
        if (Math.hypot(front.centers.x[i] - b.x, front.centers.y[i] - b.y) > b.r) continue;
        // Ouvrages (des deux camps) et ponts dans la zone ; les troupes ennemies seulement.
        const blown = barrageWorks(front, i, k * (K.works / 0.12), g.kind === 'heavy');
        if (blown) { bridges = true; events.push({ ...blown, side: s }); }
        if (front.owner[i] !== 1 - s) continue;
        const l = front.dens[i] * K.rate * k;
        front.dens[i] -= l;
        front.stats.losses[1 - s] += l;
      }
      for (const e of front.guns) {
        if (e.side !== 1 - s || e.lost || Math.hypot(e.x - b.x, e.y - b.y) > b.r) continue;
        e.str -= GUN_RULES.counter * k;
        if (e.str < GUN_RULES.minStr) { e.lost = true; events.push({ kind: 'gunLost', side: e.side, id: e.id, counter: true }); }
      }
    }
  }
  if (bridges) applyWeather(front); // pont détruit : le terrain change
}

function nearestTownName(front, i) {
  let best = null, bd = Infinity;
  for (const t of front.map.towns) {
    const d = Math.hypot(front.centers.x[t.i] - front.centers.x[i], front.centers.y[t.i] - front.centers.y[i]);
    if (d < bd) { bd = d; best = t; }
  }
  return best?.name ?? 'la ligne';
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
    front.lines[s] = front.lines[s].filter((l) => !l.done); // chantiers en cours : ils continuent demain
    front.barrages[s] = [];
    front.deployments[s] = [];
  }
  gunsNight(front);
  armorNight(front);
  advanceRails(front);
  restTroops(front);
  // Nuit : une part des pertes du jour rejoint (blessés légers, isolés), hors troupes perdues dans les poches.
  if (front.dayStart) {
    for (const s of [0, 1]) {
      const lost = front.stats.losses[s] - front.dayStart.losses[s] - (front.stats.pocket[s] - (front.dayStart.pocket?.[s] ?? 0));
      if (lost > 0) front.reserve[s] += lost * c.recover;
    }
  }
  eveningScore(front);
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
  rollWeather(front);
  flog(front, 'day', `— Jour ${front.day} : ${FRONT_WEATHER[front.weather].label} —`);
}

// ---------- Conditions de victoire ----------

function finish(front, winner, reason) {
  if (!front.grade) front.grade = winner === null ? 'draw' : winner === front.attacker ? 'attDecisive' : 'defDecisive';
  front.result = { winner, reason, grade: front.grade };
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
    // Percée totale : l'attaquant tient toutes les villes du secteur (le défenseur, lui, gagne aux points).
    const a = front.attacker;
    if (towns.every((t) => front.owner[t.i] === a)) return finish(front, a, `${name(a)} tient toutes les villes du secteur.`);
  }
  return null;
}

// Au terme des journées : l'attaquant gagne s'il tient au moins la moitié des villes que le défenseur avait au départ ;
// sinon le défenseur a tenu.
export function attackerTowns(front) {
  return front.defTowns.filter((i) => front.owner[i] === front.attacker).length;
}

// Au terme des journées : l'issue se lit au score (frontscore.js), de la victoire décisive de l'attaquant à celle du
// défenseur, en passant par une issue indécise.
function finalVerdict(front) {
  const att = front.attacker, def = 1 - att;
  const name = (s) => (s === 0 ? 'la Wehrmacht' : 'l\'Armée rouge');
  const { total, grade } = scoreBreakdown(front, true);
  const G = GRADES[grade];
  const got = attackerTowns(front);
  const towns = `${got} ville${got > 1 ? 's' : ''} ★ sur ${front.defTowns.length}`;
  const pts = `${total >= 0 ? '+' : '−'}${Math.abs(Math.round(total))} points`;
  front.grade = grade;
  if (G.att === true) return finish(front, att, `${G.label} de ${name(att)} (${pts}) : l'offensive a pris ${towns}.`);
  if (G.att === false) return finish(front, def, `${G.label} de ${name(def)} (${pts}) : l'ennemi n'a pris que ${towns}.`);
  finish(front, null, `${G.label} (${pts}) : ${name(att)} a pris ${towns}, sans emporter la décision.`);
}
