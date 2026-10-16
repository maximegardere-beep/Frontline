// Atouts du front stratégique : les moyens de chaque camp (artillerie, formations blindées, DCA, aviation) ne sont
// plus placés d'office ; ils sont tirés au sort avant la bataille, puis au matin du 7e jour (renforts).
// Chaque camp tire une main de cartes selon son rôle (attaquant, défenseur) et l'année, en garde quelques-unes, et
// les pose sur la carte. Une carte a une rareté (commun, rare, élite) ; elle vaut un groupement, pas une seule pièce.
// Le tirage a sa propre suite de hasard (jamais front.rng, qui ferait changer la météo et l'IA) : une main ne dépend
// que de la graine, du camp et du tirage.
// Ici, le choix et le placement sont automatiques (IA, outils de simulation, et le joueur tant que l'interface du
// tirage n'existe pas) ; voir DESIGN.md, « Atouts, poste de commandement, bataille des airs ».

import { createRng } from './rng.js';
import { scenarioOf } from './frontscenario.js';
import { createArmor, ARMOR_SETUP } from './frontarmor.js';
import { createAA } from './frontair.js';
import { createGuns, GUN_KINDS, nextName } from './frontguns.js';
import { createSupport, refreshZones, SUPPORT_LEVELS } from './frontbattalion.js';
import { scoreBreakdown, SCORE } from './frontscore.js';

export const ATOUT_RULES = {
  hand: [5, 4], // cartes tirées : avant la bataille, au 7e jour
  keep: [3, 2], // cartes gardées
  day: 7, // jour des renforts
  trailing: 1, // carte de plus au 7e jour pour le camp mené aux points
  rarity: { commun: 55, rare: 32, elite: 13 }, // poids par défaut (l'année les règle : SCENARIOS[année].rarity)
};

export const RARITY_LABEL = { commun: 'Commun', rare: 'Rare', elite: 'Élite' };
const RARITY_VALUE = { commun: 1, rare: 1.35, elite: 1.7 };

// Cartes. role : 'att', 'def' ou 'both' ; weight : fréquence dans le paquet ; fire : carte de feu (garantie de la
// main) ; value : intérêt pour le choix automatique. tiers : contenu selon la rareté (voir cardForces).
// '%rocket' : lance-roquettes du camp (Nebelwerfer ou Katioucha).
export const ATOUTS = {
  armor: {
    role: 'att', weight: 3, value: 10, label: 'Division blindée',
    tiers: { commun: { armor: 'line' }, rare: { armor: 'veteran' }, elite: { armor: 'heavy' } },
  },
  heavyArt: {
    role: 'att', weight: 3, value: 8, fire: true, label: 'Artillerie lourde',
    tiers: { commun: { guns: ['div', 'div'] }, rare: { guns: ['div', 'heavy'] }, elite: { guns: ['heavy', 'heavy', 'div'] } },
  },
  air: {
    role: 'att', weight: 2, value: 6, label: 'Soutien aérien',
    tiers: { commun: { sorties: 1 }, rare: { sorties: 2 }, elite: { sorties: 2, assault: 1.5 } },
  },
  divArt: {
    role: 'def', weight: 3, value: 8, fire: true, label: 'Artillerie divisionnaire',
    tiers: { commun: { guns: ['div', 'mortar'] }, rare: { guns: ['div', '%rocket'] }, elite: { guns: ['div', 'heavy', 'mortar'] } },
  },
  antitank: {
    role: 'def', weight: 3, value: 9, label: 'Canons antichar',
    tiers: { commun: { guns: ['atLight', 'atLight'] }, rare: { guns: ['atMed', 'atMed'] }, elite: { guns: ['atHeavy', 'atMed'] } },
  },
  support: {
    role: 'def', weight: 2.5, value: 8, label: 'Bataillon de soutien',
    tiers: { commun: { support: [2] }, rare: { support: [3] }, elite: { support: [3, 3] } },
  },
  aa: {
    role: 'both', weight: 1.5, value: 4, label: 'DCA',
    tiers: { commun: { aa: 2 }, rare: { aa: 3 }, elite: { aa: 4 } },
  },
};

// Formations blindées tirées : chiffres de l'année (moyenne des formations historiques du scénario), puis rareté.
// Élite : bataillon de chars lourds quand l'année en a un pour ce camp (Tiger, KV, IS-2…), sinon division d'élite.
export const ARMOR_TIERS = {
  line: { tanks: 0.9, exp: 0 },
  veteran: { tanks: 1.1, exp: 0.9 },
  elite: { tanks: 1.05, exp: 1.4 },
  heavy: { tanks: 0.65, exp: 1.2, heavy: true },
};

const ROCKET = ['nebel', 'rocket'];

const roleOf = (front, s) => (s === front.attacker ? 'att' : 'def');

// Contenu concret d'une carte pour un camp : liste de groupes d'artillerie, formations, DCA, sorties.
function cardContent(front, s, card) {
  const t = ATOUTS[card.key].tiers[card.rarity];
  const out = { guns: [], armor: [], support: (t.support ?? []).map((max) => ({ max })), aa: t.aa ?? 0, sorties: t.sorties ?? 0, assault: t.assault ?? 1 };
  if (t.guns) out.guns = t.guns.map((k) => (k === '%rocket' ? ROCKET[s] : k));
  if (t.armor) out.armor.push(armorSpec(front, s, t.armor));
  return out;
}

function armorSpec(front, s, tier) {
  const sc = scenarioOf(front.year);
  const ref = (sc.armor ?? ARMOR_SETUP)[s];
  const mean = (k) => ref.reduce((a, u) => a + u[k], 0) / ref.length;
  const heavyName = sc.heavy?.[s];
  const key = tier === 'heavy' && !heavyName ? 'elite' : tier;
  const T = ARMOR_TIERS[key];
  return {
    tier: key,
    heavy: !!T.heavy,
    name: T.heavy ? heavyName : null,
    tanks: Math.round((mean('tanks') * T.tanks) / 5) * 5,
    exp: Math.min(3, mean('exp') + T.exp),
    gren: T.heavy ? 40 : Math.round(mean('gren')),
  };
}

// Texte court d'une carte (journal, interface).
export function cardText(front, s, card) {
  const c = cardContent(front, s, card);
  const parts = [];
  if (c.armor.length) parts.push(c.armor.map((a) => `${a.heavy ? 'chars lourds, ' : ''}${a.tanks} chars`).join(', '));
  const at = c.guns.filter((k) => GUN_KINDS[k].at).length;
  if (at) parts.push(`${at} groupes antichar`);
  if (c.guns.length - at) parts.push(`${c.guns.length - at} groupes d'artillerie`);
  if (c.support.length) parts.push(`${c.support.length > 1 ? `${c.support.length} bataillons` : '1 bataillon'}, jusqu'aux ${SUPPORT_LEVELS[c.support[0].max]}`);
  if (c.aa) parts.push(`${c.aa} batteries`);
  if (c.sorties) parts.push(`+${c.sorties} sortie${c.sorties > 1 ? 's' : ''} par jour${c.assault > 1 ? ', avions d\'assaut' : ''}`);
  return parts.join(' · ');
}

const cardLabel = (card) => `${ATOUTS[card.key].label} (${RARITY_LABEL[card.rarity].toLowerCase()})`;

// Main d'un camp. round : 0 avant la bataille, 1 au 7e jour. extra : cartes en plus.
export function drawHand(front, s, round, extra = 0) {
  const rng = createRng(`atout:${front.seed}:${s}:${round}`);
  const role = roleOf(front, s);
  const keys = Object.keys(ATOUTS).filter((k) => ATOUTS[k].role === role || ATOUTS[k].role === 'both');
  const weights = Object.fromEntries(keys.map((k) => [k, ATOUTS[k].weight]));
  const rarity = scenarioOf(front.year).rarity?.[s] ?? ATOUT_RULES.rarity;
  const n = ATOUT_RULES.hand[round] + extra;
  const hand = [];
  for (let k = 0; k < n; k++) hand.push({ key: rng.weighted(weights), rarity: rng.weighted(rarity) });
  // Garanties : une carte de feu ; l'attaquant, une division blindée ; le défenseur, des canons antichar ou un
  // bataillon de soutien. On remplace les dernières cartes au besoin.
  const need = [(c) => ATOUTS[c.key].fire];
  if (role === 'att') need.push((c) => c.key === 'armor');
  else need.push((c) => c.key === 'antitank' || c.key === 'support');
  let slot = n - 1;
  for (const ok of need) {
    if (hand.some(ok)) continue;
    const pick = keys.filter((k) => ok({ key: k }));
    hand[slot--] = { key: rng.pick(pick), rarity: rng.weighted(rarity) };
  }
  return hand.map((c, k) => ({ id: `${round}-${k}`, ...c }));
}

// Choix automatique : les cartes de plus grande valeur, une seconde carte du même genre valant moins.
export function chooseCards(front, s, hand, keep) {
  const left = hand.slice();
  const out = [];
  while (out.length < keep && left.length) {
    let best = 0, bv = -Infinity;
    left.forEach((c, k) => {
      const same = out.filter((o) => o.key === c.key).length;
      const v = ATOUTS[c.key].value * RARITY_VALUE[c.rarity] * 0.55 ** same;
      if (v > bv) { bv = v; best = k; }
    });
    out.push(left.splice(best, 1)[0]);
  }
  return out;
}

// Somme du contenu des cartes gardées, par camp.
function forcesOf(front, kept) {
  return [0, 1].map((s) => {
    const f = { guns: [], armor: [], support: [], aa: 0, sorties: 0, assault: 1 };
    for (const card of kept[s]) {
      const c = cardContent(front, s, card);
      f.guns.push(...c.guns);
      f.support.push(...c.support);
      f.armor.push(...c.armor);
      f.aa += c.aa;
      f.sorties += c.sorties;
      f.assault = Math.max(f.assault, c.assault);
    }
    return f;
  });
}

// Noms des formations : ceux du scénario d'abord, puis numérotés.
function nameArmor(front, s, spec) {
  const used = new Set(front.armor?.map((a) => a.name) ?? []);
  for (const l of front.atouts.named[s]) used.add(l);
  if (spec.name) {
    let name = spec.name;
    while (used.has(name)) name = nextName(name);
    return name;
  }
  const sc = scenarioOf(front.year);
  for (const u of (sc.armor ?? ARMOR_SETUP)[s]) if (!used.has(u.name)) return u.name;
  for (let n = s === 0 ? 1 : 2; ; n += s === 0 ? 3 : 4) {
    const name = s === 0 ? `${n}. Panzer-Division` : `${n}${n === 1 ? 'er' : 'e'} corps blindé`;
    if (!used.has(name)) return name;
  }
}

function armorLists(front, forces) {
  return forces.map((f, s) => f.armor.map((spec) => {
    const name = nameArmor(front, s, spec);
    front.atouts.named[s].push(name);
    return { ...spec, name };
  }));
}

function logDeal(front, kept, round) {
  for (const s of [0, 1]) {
    if (front.playerSide != null && s !== front.playerSide) continue; // les cartes de l'ennemi restent secrètes
    const when = round ? `Renforts du ${ATOUT_RULES.day}e jour` : 'Atouts';
    front.log.push({ day: front.day, tick: 0, kind: 'atout', side: s, text: `${when} : ${kept[s].map(cardLabel).join(', ')}.` });
  }
}

// Avant la bataille (createFront, avant la création des unités) : tirage, choix, et moyens qui en découlent.
// Renvoie les listes à passer à createGuns, createArmor, createAA, et les sorties en plus par camp.
export function dealAtouts(front) {
  front.atouts = { round: 0, hands: [[], []], kept: [[], []], named: [[], []], assault: [1, 1] };
  const kept = [0, 1].map((s) => {
    const hand = drawHand(front, s, 0);
    front.atouts.hands[s] = hand;
    return chooseCards(front, s, hand, ATOUT_RULES.keep[0]);
  });
  front.atouts.kept = kept;
  const forces = forcesOf(front, kept);
  front.atouts.assault = forces.map((f) => f.assault);
  logDeal(front, kept, 0);
  return { guns: forces.map((f) => f.guns), armor: armorLists(front, forces), support: forces.map((f) => f.support), aa: forces.map((f) => f.aa), sorties: forces.map((f) => f.sorties) };
}

// Camp mené aux points au soir du 6e jour : l'attaquant en dessous d'une issue indécise, le défenseur quand
// l'attaquant tient déjà une victoire ; sinon personne.
export function trailingSide(front) {
  const total = scoreBreakdown(front).total;
  if (total < SCORE.draw) return front.attacker;
  if (total >= SCORE.attWin) return 1 - front.attacker;
  return null;
}

// Au matin du 7e jour : nouveau tirage, et les unités des cartes gardées rejoignent derrière le front.
export function reinforceAtouts(front) {
  const A = front.atouts;
  if (!A || A.round >= 1) return;
  A.round = 1;
  const trail = trailingSide(front);
  const kept = [0, 1].map((s) => {
    const hand = drawHand(front, s, 1, s === trail ? ATOUT_RULES.trailing : 0);
    A.hands[s] = hand;
    return chooseCards(front, s, hand, ATOUT_RULES.keep[1]);
  });
  A.kept = [0, 1].map((s) => [...A.kept[s], ...kept[s]]);
  const forces = forcesOf(front, kept);
  // Numéros à la suite, et noms distincts de ceux déjà sur la carte (on avance le premier nombre du nom).
  const renumber = (list, old) => {
    let id = Math.max(0, ...old.map((u) => u.id)) + 1;
    const names = new Set(old.map((u) => u.name));
    for (const u of list) {
      u.id = id++;
      while (names.has(u.name)) u.name = nextName(u.name);
      names.add(u.name);
    }
    return list;
  };
  front.guns.push(...renumber(createGuns(front, forces.map((f) => f.guns)), front.guns));
  front.armor.push(...renumber(createArmor(front, armorLists(front, forces)), front.armor));
  front.aa.push(...renumber(createAA(front, forces.map((f) => f.aa)), front.aa));
  front.support.push(...renumber(createSupport(front, forces.map((f) => f.support)), front.support));
  refreshZones(front);
  front.cfg.sorties = front.cfg.sorties.map((n, s) => n + forces[s].sorties);
  A.assault = A.assault.map((v, s) => Math.max(v, forces[s].assault));
  logDeal(front, kept, 1);
}
