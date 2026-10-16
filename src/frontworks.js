// Ouvrages du front stratégique : tranchées, barbelés, obstacles antichar (hérissons, fossé), ponts.
//
// Chaque case porte trois niveaux de 0 à 1 :
// - front.entrench : tranchées (défense de l'infanterie, + entrenchDef au plein ; à moitié pour qui les prend à
//   l'ennemi, car elles regardent du mauvais côté) ; front.trenchSide : camp qui les a creusées ;
// - front.wire : barbelés, neutres : l'assaut d'infanterie qui les traverse perd de sa pression et paie plus cher ;
// - front.at : obstacles antichar, neutres : le choc et l'avance des blindés y fondent.
// Un barrage les détruit (les barbelés d'abord, les hérissons à peine sauf l'artillerie lourde), un assaut qui prend
// la case les abîme. Un ouvrage qui a été solide puis tombe en ruine laisse une trace persistante (front.wreck, bits
// 1 tranchée, 2 barbelés, 4 antichar), dessinée jusqu'à la fin de la bataille ou jusqu'à sa reconstruction.
// Les lignes de défense sont des chantiers qui durent plusieurs jours : tranchées en un jour, barbelés en deux,
// obstacles antichar en trois ; le travail avance trois fois moins vite au contact de l'ennemi.

export const WORKS = {
  levels: { 1: 'Tranchées', 2: 'Tranchées et barbelés', 3: 'Tranchées, barbelés et antichar' },
  build: { trench: 1, wire: 0.5, at: 0.34 }, // par journée de travail
  contact: 0.33, // rythme au contact de l'ennemi
  wireAssault: 0.4, // pression d'infanterie perdue au plein des barbelés
  wireCost: 0.5, // riposte supplémentaire contre l'assaut qui les traverse
  atShock: 0.6, // choc blindé perdu au plein des obstacles antichar
  atFlow: 0.7, // avance blindée perdue
  barrage: { trench: 0.1, wire: 0.25, at: 0.02, atHeavy: 0.08, bridge: 0.1, bridgeHeavy: 0.2 }, // par tick de barrage
  capture: { trench: 0.3, wire: 0.5 }, // dégâts d'un assaut qui prend la case
  wreckFrom: 0.4, // un ouvrage qui a dépassé ce niveau…
  wreckAt: 0.15, // … et retombe sous celui-ci est une ruine
  maxSites: 4, // chantiers simultanés par camp
};

export function initWorks(front) {
  const { N } = front.map;
  front.trenchSide = new Int8Array(N).fill(-1);
  front.wire = new Float32Array(N);
  front.at = new Float32Array(N);
  front.peak = new Uint8Array(N); // bits : ouvrage qui a dépassé wreckFrom
  front.wreck = new Uint8Array(N);
  front.bridgeHp = new Float32Array(N).fill(1);
  front.trenchLine = new Uint8Array(N); // cases où court une tranchée continue (dessinée) ; ailleurs, trous individuels
  front.worksVersion = 1;
}

// Ceinture initiale du défenseur : tranchées sur la profondeur (selon les secteurs), barbelés devant les secteurs
// solides, fossé et hérissons aux abords des villes. dist : distance au front ; sector(i) : solidité du secteur.
export function defenderBelt(front, def, dist, sector, nearTown, depth) {
  for (let i = 0; i < front.map.N; i++) {
    if (front.owner[i] !== def || dist[i] >= depth) continue;
    const sec = sector(i);
    front.entrench[i] = nearTown[i] <= 3 ? 1 : sec;
    front.trenchSide[i] = def;
    // Deux lignes continues : la première au contact, la seconde quelques cases en arrière.
    if (dist[i] === 1 || dist[i] === 4) front.trenchLine[i] = 1;
    if (dist[i] === 1 && sec > 0.55) front.wire[i] = Math.min(1, sec);
    if (nearTown[i] === 2 || nearTown[i] === 3) front.at[i] = 1;
  }
  for (let i = 0; i < front.map.N; i++) notePeak(front, i);
}

function notePeak(front, i) {
  const W = WORKS;
  if (front.entrench[i] >= W.wreckFrom) front.peak[i] |= 1;
  if (front.wire[i] >= W.wreckFrom) front.peak[i] |= 2;
  if (front.at[i] >= W.wreckFrom) front.peak[i] |= 4;
}

function noteWreck(front, i) {
  const W = WORKS;
  const before = front.wreck[i];
  if (front.peak[i] & 1 && front.entrench[i] < W.wreckAt) front.wreck[i] |= 1;
  if (front.peak[i] & 2 && front.wire[i] < W.wreckAt) front.wreck[i] |= 2;
  if (front.peak[i] & 4 && front.at[i] < W.wreckAt) front.wreck[i] |= 4;
  if (front.wreck[i] !== before) front.worksVersion++;
}

// Dégâts sur une case : amounts { trench, wire, at } (parts de niveau détruites).
export function damageWorks(front, i, { trench = 0, wire = 0, at = 0 }) {
  const t0 = front.entrench[i], w0 = front.wire[i], a0 = front.at[i];
  front.entrench[i] = Math.max(0, t0 - trench);
  front.wire[i] = Math.max(0, w0 - wire);
  front.at[i] = Math.max(0, a0 - at);
  if (Math.floor(t0 * 5) !== Math.floor(front.entrench[i] * 5) || Math.floor(w0 * 5) !== Math.floor(front.wire[i] * 5) || Math.floor(a0 * 5) !== Math.floor(front.at[i] * 5)) front.worksVersion++;
  noteWreck(front, i);
}

// Un tick de barrage d'intensité k (puissance × météo) sur la case i ; heavy : artillerie lourde.
export function barrageWorks(front, i, k, heavy) {
  const B = WORKS.barrage;
  damageWorks(front, i, { trench: B.trench * k, wire: B.wire * k, at: (heavy ? B.atHeavy : B.at) * k });
  if (front.map.bridge[i] === 1) {
    front.bridgeHp[i] -= (heavy ? B.bridgeHeavy : B.bridge) * k;
    if (front.bridgeHp[i] <= 0) return blowBridge(front, i);
  }
  return null;
}

// Pont détruit : la case redevient une rivière (terrain recalculé par l'appelant via applyWeather). Un pont de bateaux
// coulé ne laisse rien : le génie pourra en lancer un autre au même endroit.
export function blowBridge(front, i) {
  if (front.map.bridge[i] !== 1) return null;
  const pontoon = !!front.map.pontoon?.[i];
  // Tout le tablier : les cases de pont voisines sur la même rivière.
  const stack = [i];
  const done = [];
  while (stack.length) {
    const c = stack.pop();
    if (front.map.bridge[c] !== 1) continue;
    front.map.bridge[c] = front.map.pontoon?.[c] ? 0 : 2;
    if (front.map.pontoon) front.map.pontoon[c] = 0;
    front.bridgeHp[c] = 0;
    done.push(c);
    for (let d = 0; d < 6; d++) { const j = front.map.nb[c * 6 + d]; if (j >= 0 && front.map.bridge[j] === 1) stack.push(j); }
  }
  front.worksVersion++;
  return { kind: 'bridge', i, cells: done, pontoon };
}

// Prise d'une case : barbelés coupés, tranchées bouleversées.
export function captureWorks(front, i) {
  damageWorks(front, i, WORKS.capture);
}

// Un tick de chantier pour les lignes du camp s.
export function buildTick(front, s) {
  for (const l of front.lines[s]) buildSite(front, s, l);
}

// Un tick de chantier sur un site { cells, core, level } (ligne de défense, zone d'un bataillon de soutien) :
// tranchées, puis barbelés (niveau 2) et obstacles antichar (3) une fois les tranchées à moitié creusées ; trois fois
// plus lent au contact de l'ennemi. site.done : achevé.
export function buildSite(front, s, l) {
  const { nb } = front.map;
  const B = WORKS.build, ticks = front.cfg.ticks;
  let done = true;
  for (const i of l.cells) {
    if (front.owner[i] !== s) continue;
    let contact = false;
    for (let d = 0; d < 6; d++) { const j = nb[i * 6 + d]; if (j >= 0 && front.owner[j] === 1 - s) { contact = true; break; } }
    const r = (contact ? WORKS.contact : 1) / ticks;
    const before = [front.entrench[i], front.wire[i], front.at[i]];
    if (front.entrench[i] < 1) {
      // Tranchées prises à l'ennemi : on les retourne (elles deviennent les nôtres une fois refaites à moitié).
      if (front.trenchSide[i] !== s) { front.trenchSide[i] = s; front.entrench[i] *= 0.5; }
      front.entrench[i] = Math.min(1, front.entrench[i] + B.trench * r);
    }
    if (l.level >= 2 && front.entrench[i] >= 0.5 && front.wire[i] < 1) front.wire[i] = Math.min(1, front.wire[i] + B.wire * r);
    if (l.level >= 3 && front.entrench[i] >= 0.5 && front.at[i] < 1) front.at[i] = Math.min(1, front.at[i] + B.at * r);
    if (l.core?.has(i) && front.entrench[i] >= 0.08) front.trenchLine[i] = 1;
    if (front.entrench[i] < 1 || (l.level >= 2 && front.wire[i] < 1) || (l.level >= 3 && front.at[i] < 1)) done = false;
    if (before.some((v, k) => Math.floor(v * 5) !== Math.floor([front.entrench[i], front.wire[i], front.at[i]][k] * 5))) {
      front.worksVersion++;
      // Reconstruit : la ruine disparaît.
      if (front.entrench[i] >= WORKS.wreckFrom) front.wreck[i] &= ~1;
      if (front.wire[i] >= WORKS.wreckFrom) front.wreck[i] &= ~2;
      if (front.at[i] >= WORKS.wreckFrom) front.wreck[i] &= ~4;
    }
    notePeak(front, i);
  }
  l.done = done;
}

// Défense d'une case pour son occupant s : tranchées pleines s'il les a creusées, à moitié sinon.
export const trenchFor = (front, i, s) => front.entrench[i] * (front.trenchSide[i] === s || front.trenchSide[i] < 0 ? 1 : 0.5);
