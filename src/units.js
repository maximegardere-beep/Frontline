// Types d'unités, niveaux d'expérience, génération d'armées aléatoires.

export const SIDES = {
  DE: { name: 'Wehrmacht', country: 'Allemagne', short: 'DE', edge: 'west' },
  SU: { name: 'Armée rouge', country: 'URSS', short: 'SU', edge: 'east' },
};

export const other = (side) => (side === 'DE' ? 'SU' : 'DE');

export const UNIT_TYPES = {
  infantry: { label: 'Infanterie', hp: 10, move: 4, range: 1, attack: 4, vision: 3, entrench: 2, cost: 2 },
  recon: { label: 'Reconnaissance', hp: 6, move: 7, range: 1, attack: 2, vision: 5, entrench: 1, cost: 1 },
  artillery: { label: 'Artillerie', hp: 7, move: 3, range: 4, minRange: 2, attack: 5, vision: 2, entrench: 1, cost: 3, ammo: 6 },
  tank: { label: 'Blindés', hp: 12, move: 6, range: 2, attack: 5, vision: 3, entrench: 1, cost: 4, armored: true },
  // Canon antichar tracté : +2 dés contre les blindés, ne tire pas s'il a bougé, se cache en couvert.
  at: { label: 'Antichar', hp: 6, move: 3, range: 2, attack: 5, vision: 3, entrench: 2, cost: 3, antitank: 2 },
};

export const LEVELS = ['', 'Recrue', 'Vétéran', 'Élite'];
export const XP_FOR_LEVEL = [0, 0, 3, 7];

// Particularités nationales : qualité allemande, masse soviétique.
const SIDE_MODS = {
  DE: { tank: { attack: 1 }, recon: { move: 1 } },
  SU: { infantry: { hp: 2 }, artillery: { attack: 1 } },
};

// Matériel d'élite : une unité qui atteint le niveau Élite est rééquipée selon son camp et son type.
// Le niveau donne déjà +1 Mvt et +1 portée : le matériel ajoute son trait propre, sans cumuler ces bonus.
export const VARIANTS = {
  tiger: { side: 'DE', type: 'tank', label: 'Tigre', short: 'TIGRE', hp: 3, move: -1, heavyArmor: 1, text: 'Blindage épais : +1 au seuil de tous les tirs reçus. PV +3, Mvt −1.' },
  t3485: { side: 'SU', type: 'tank', label: 'T-34/85', short: 'T-34/85', antitank: 1, text: 'Canon de 85 mm : +1 dé contre les blindés.' },
  katyusha: { side: 'SU', type: 'artillery', label: 'Katioucha', short: 'KAT.', salvo: true, text: 'Salve sur 3 hexagones alignés (⅔ des dés sur chacun), puis un tour de rechargement.' },
  pzgren: { side: 'DE', type: 'infantry', label: 'Panzergrenadiers', short: 'PZGREN', antiArmor: 1, text: 'Armes antichars : contre les blindés, malus +1 au lieu de +2.' },
  guards: { side: 'SU', type: 'infantry', label: 'Gardes', short: 'GARDES', antiArmor: 1, text: 'Armes antichars : contre les blindés, malus +1 au lieu de +2.' },
};

export function variantOf(u) {
  if (u.level < 3) return null;
  return Object.keys(VARIANTS).find((k) => VARIANTS[k].side === u.side && VARIANTS[k].type === u.type) ?? null;
}

export function unitLabel(u) {
  const v = variantOf(u);
  return v ? VARIANTS[v].label : UNIT_TYPES[u.type].label;
}

export function unitStats(u) {
  const t = UNIT_TYPES[u.type];
  const mod = SIDE_MODS[u.side]?.[u.type] ?? {};
  const L = u.level;
  const v = VARIANTS[variantOf(u)] ?? {};
  return {
    variant: variantOf(u),
    heavyArmor: v.heavyArmor ?? 0,
    salvo: !!v.salvo,
    antiArmor: v.antiArmor ?? 0,
    maxHp: t.hp + (mod.hp ?? 0) + (L - 1) + (v.hp ?? 0),
    move: t.move + (mod.move ?? 0) + (L >= 3 ? 1 : 0) + (v.move ?? 0),
    range: t.range + (L >= 3 && t.range > 1 ? 1 : 0),
    minRange: t.minRange ?? 1,
    attack: t.attack + (mod.attack ?? 0) + (L - 1),
    vision: t.vision + (L >= 2 && u.type === 'recon' ? 1 : 0),
    entrenchMax: t.entrench + (L >= 2 ? 1 : 0),
    hitBonus: L >= 3 ? 1 : 0,
    armored: !!t.armored,
    antitank: (t.antitank ?? 0) + (v.antitank ?? 0),
  };
}

const NAMES = {
  DE: {
    infantry: (n) => `${n}./Grenadier-Rgt.`,
    recon: (n) => `Aufkl.-Abt. ${n}`,
    artillery: (n) => `Batterie ${n}/AR`,
    tank: (n) => `Panzer-Kp. ${n}`,
    at: (n) => `Pak-Zug ${n}/PzJg.`,
  },
  SU: {
    infantry: (n) => `${n}e bat. de fusiliers`,
    recon: (n) => `${n}e cie d'éclaireurs`,
    artillery: (n) => `${n}e batterie`,
    tank: (n) => `${n}e cie de chars`,
    at: (n) => `${n}e batterie antichar`,
  },
};

let nextId = 1;
export function resetIds(n = 1) { nextId = n; }

export function makeUnit(side, type, level, rng) {
  const u = {
    id: `${side}${nextId++}`,
    side,
    type,
    level,
    xp: XP_FOR_LEVEL[level],
    name: NAMES[side][type](rng.int(1, 99)),
    col: 0,
    row: 0,
    entrench: 0,
    status: 'ok',
    orders: { path: [], entrench: false, fireAt: null },
  };
  u.hp = unitStats(u).maxHp;
  return u;
}

const WEIGHTS = {
  DE: { infantry: 3, tank: 3, artillery: 2, recon: 1, at: 1.5 },
  SU: { infantry: 4, tank: 2, artillery: 3, recon: 1, at: 1 },
};
const LEVEL_ODDS = { DE: { 1: 5, 2: 4, 3: 1 }, SU: { 1: 7, 2: 3, 3: 0.6 } };

// Armée aléatoire sous contrainte de budget : toujours au moins 2 infanteries et une reconnaissance.
export function generateArmy(side, rng, budget, { core = true } = {}) {
  const units = [];
  const add = (type) => {
    units.push(makeUnit(side, type, Number(rng.weighted(LEVEL_ODDS[side])), rng));
    budget -= UNIT_TYPES[type].cost;
  };
  if (core) { add('infantry'); add('infantry'); add('recon'); }
  let guard = 0;
  while (budget > 0 && guard++ < 50) {
    const type = rng.weighted(WEIGHTS[side]);
    if (UNIT_TYPES[type].cost > budget) {
      if (budget >= 2) add('infantry');
      else if (budget >= 1) add('recon');
      break;
    }
    add(type);
  }
  return units;
}

export function gainXp(u, amount) {
  u.xp += amount;
  const before = u.level;
  while (u.level < 3 && u.xp >= XP_FOR_LEVEL[u.level + 1]) u.level++;
  if (u.level > before) u.hp += u.level - before; // le gain de niveau augmente les PV max
  return u.level > before;
}

export function hpState(u) {
  const r = u.hp / unitStats(u).maxHp;
  return r > 0.75 ? 'intacte' : r > 0.45 ? 'entamée' : r > 0.2 ? 'affaiblie' : 'décimée';
}
