// Métropole sur le front stratégique (la carte vient de metrogen.js) : contrôle des quartiers et points de victoire,
// bacs de nuit qui ravitaillent le défenseur par les quais, maisons-forteresses.
//
// Ce module ne dépend d'aucun autre module du front : il lit l'état du front directement (frontscore.js,
// frontsupply.js et front.js l'importent).

export const METRO_RULES = {
  hold: 0.6, // part des cases d'un quartier à tenir pour le posséder (entre les deux : disputé, à personne)
  // Issue : points de quartiers gagnés par l'attaquant pendant la bataille (pris moins perdus, objectifs secondaires
  // compris), calés sur des batailles IA contre IA (tools/metro-sim.mjs) : victoire décisive, victoire, indécis,
  // victoire défensive ; en dessous, victoire défensive décisive.
  attDecisive: 5,
  attWin: 2,
  draw: 1,
  defWin: 0,
  objective: 1, // points d'un objectif secondaire rempli (pour ou contre l'attaquant)
  attackBarrages: 2, // barrages focalisés de plus pour l'attaquant (Stalingrad : artillerie et aviation massées)
  reinforce: 9, // renforts quotidiens par quartier possédé (une carte ordinaire : 25 par ville, pour 5 à 7 villes)
  ferryDay: 0.85, // ravitaillement de jour des cases qui ne tiennent que par les bacs (ils passent de nuit)
  strongDef: 1.3, // défense de l'îlot d'une maison-forteresse
  strongDrain: 1 / 6, // une poche fond six fois moins vite sur une maison-forteresse et ses abords (~5 % par jour)
  strongHinder: 0.85, // ravitaillement de l'attaquant autour d'une maison-forteresse que le défenseur tient encore
  strongReach: 4, // portée de cette gêne (unités de grille, ~2 cases)
};

export const isMetro = (front) => !!front.map.districts;

// Camp qui possède le quartier d (plus de METRO_RULES.hold de ses cases), ou null s'il est disputé.
export function districtOwner(front, d) {
  let a = 0, b = 0;
  for (const i of d.cells) { if (front.owner[i] === 0) a++; else if (front.owner[i] === 1) b++; }
  const need = d.cells.length * METRO_RULES.hold;
  return a > need ? 0 : b > need ? 1 : null;
}

export const districtTotal = (front) => front.map.districts.reduce((a, d) => a + d.value, 0);
export const districtPoints = (front, s) => front.map.districts.reduce((a, d) => a + (districtOwner(front, d) === s ? d.value : 0), 0);
export const districtsHeld = (front, s) => front.map.districts.filter((d) => districtOwner(front, d) === s).length;

// Issue d'une métropole selon les points gagnés par l'attaquant.
export function metroGrade(gain) {
  const R = METRO_RULES;
  return gain >= R.attDecisive ? 'attDecisive' : gain >= R.attWin ? 'attWin' : gain >= R.draw ? 'draw' : gain >= R.defWin ? 'defWin' : 'defDecisive';
}

// Bacs de nuit : les accostages (quais et usines au bord de l'eau) que tient le défenseur ravitaillent la ville comme
// son bord de carte. Rien pour l'attaquant, rien hors métropole.
export function ferryLandings(front, s) {
  const { map } = front;
  if (!map.landing || s === front.attacker) return [];
  const out = [];
  for (let i = 0; i < map.N; i++) if (map.landing[i] && front.owner[i] === s) out.push(i);
  return out;
}

// Ravitaillement (frontsupply.js, updateSupplyK) : cases qui ne tiennent que par les bacs, gêne autour des
// maisons-forteresses que le défenseur tient encore.
export function metroSupply(front) {
  const { map } = front;
  if (!map.districts) return;
  const R = METRO_RULES, def = 1 - front.attacker;
  if (front.ferried) {
    const K = front.supplyK[def];
    for (let i = 0; i < map.N; i++) if (front.ferried[i] && front.owner[i] === def) K[i] = Math.min(K[i], R.ferryDay);
  }
  const K = front.supplyK[front.attacker], cx = front.centers.x, cy = front.centers.y;
  for (const f of map.strongholds) {
    if (front.owner[f.i] !== def) continue;
    for (let i = 0; i < map.N; i++) {
      if (front.owner[i] !== front.attacker) continue;
      if (Math.hypot(cx[i] - cx[f.i], cy[i] - cy[f.i]) <= R.strongReach) K[i] *= R.strongHinder;
    }
  }
}

export const gunSiteOk = (front, s, i, range = Infinity) => !front.map.farBank || s === front.attacker || range < LONG_RANGE || front.map.farBank[i] === 1;

// Fonte d'une poche sur la case i (part du malus logistique ordinaire) : la maison-forteresse ne tient que pour le
// défenseur.
export const pocketDrainAt = (front, i) => (front.map.stronghold?.[i] && front.owner[i] !== front.attacker ? METRO_RULES.strongDrain : 1);

// Batteries de l'IA : en métropole, celles du défenseur à longue portée (divisionnaire, lourde) restent sur la rive
// gauche ; mortiers et lance-roquettes, trop courts, tirent depuis la ville.
export const LONG_RANGE = 15;
