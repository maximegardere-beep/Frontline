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
import { addSpecial } from './frontspecial.js';
import { fightAirWar } from './frontairwar.js';
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
    tiers: { commun: { sorties: 1, air: 1 }, rare: { sorties: 2, air: 2 }, elite: { sorties: 2, air: 3, assault: 1.5 } },
  },
  fighters: {
    role: 'def', weight: 2, value: 5, label: 'Chasseurs',
    tiers: { commun: { air: 1 }, rare: { air: 2 }, elite: { air: 3, sorties: 1 } },
  },
  sappers: {
    role: 'att', weight: 2, value: 6, label: 'Génie d\'assaut',
    tiers: { commun: { sappers: [{ r: 5.2, rate: 1.2 }] }, rare: { sappers: [{ r: 7, rate: 1.2 }], pontoons: 1 }, elite: { sappers: [{ r: 8.7, rate: 2.4 }] } },
  },
  rockets: {
    role: 'att', weight: 2, value: 7, fire: true, label: 'Lance-roquettes',
    tiers: { commun: { salvos: { n: 1, r: 3 } }, rare: { salvos: { n: 1, r: 4 } }, elite: { salvos: { n: 2, r: 4 } } },
  },
  paras: {
    role: 'att', weight: 1.5, value: 7, label: 'Parachutistes',
    tiers: { commun: { paras: [30] }, rare: { paras: [40] }, elite: { paras: [70] } },
  },
  strongpoint: {
    role: 'def', weight: 2, value: 7, label: 'Point d\'appui',
    tiers: { commun: { strong: [{ mul: 1.4, level: 1 }] }, rare: { strong: [{ mul: 1.7, level: 2 }] }, elite: { strong: [{ mul: 2, level: 3, garrison: 30 }] } },
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
  const out = {
    guns: [], armor: [], support: [...(t.support ?? []).map((max) => ({ max })), ...(t.sappers ?? []).map((sp) => ({ kind: 'sapper', ...sp }))],
    aa: t.aa ?? 0, sorties: t.sorties ?? 0, air: t.air ?? 0, assault: t.assault ?? 1, pontoons: t.pontoons ?? 0,
    special: { salvos: t.salvos ?? null, paras: t.paras ?? [], strong: t.strong ?? [] },
  };
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
  const bat = c.support.filter((b) => b.kind !== 'sapper');
  if (bat.length) parts.push(`${bat.length > 1 ? `${bat.length} bataillons` : '1 bataillon'}, jusqu'aux ${SUPPORT_LEVELS[bat[0].max]}`);
  for (const sp of c.support.filter((b) => b.kind === 'sapper')) parts.push(`rayon de ${Math.round(sp.r / 1.73)} cases${sp.rate > 1.5 ? ', ouvrages rasés deux fois plus vite' : ''}`);
  if (c.pontoons) parts.push(`+${c.pontoons} pont de bateaux`);
  const S = c.special;
  if (S.salvos) parts.push(`${S.salvos.n} salve${S.salvos.n > 1 ? 's' : ''}, zone de ${Math.round((S.salvos.r * 2) / 1.73)} cases de large`);
  for (const d of S.paras) parts.push(`largage de ${d * front.cfg.men} hommes`);
  for (const st of S.strong) parts.push(`ville ★ : défense ×${String(st.mul).replace('.', ',')}${st.garrison ? `, garnison de ${st.garrison * front.cfg.men} hommes` : ''}`);
  if (c.aa) parts.push(`${c.aa} batteries`);
  if (c.air) parts.push(`+${c.air} en bataille des airs`);
  if (c.sorties) parts.push(`+${c.sorties} sortie${c.sorties > 1 ? 's' : ''} par jour${c.assault > 1 ? ', avions d\'assaut' : ''}${c.air && !ATOUTS[card.key].tiers.commun.sorties ? ' en cas de victoire' : ''}`);
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

// Intérêt d'une carte selon la situation (choix automatique : IA, et joueur tant que l'interface n'existe pas).
// - les feux d'abord : sans artillerie ni salve, un assaut piétine ; l'attaquant garde aussi une division blindée ;
// - le ciel : celui qui part moins fort dans la bataille des airs y met des cartes d'aviation ;
// - le terrain : génie d'assaut (pont de bateaux) sur une carte à rivière, point d'appui s'il y a des villes ★ à tenir ;
// - au 7e jour, on remplace ce qu'on a perdu (artillerie, blindés, canons antichar, le ciel).
export function cardValue(front, s, card, chosen) {
  const key = card.key, A = ATOUTS[key];
  let v = A.value * RARITY_VALUE[card.rarity] * 0.55 ** chosen.filter((o) => o.key === key).length;
  const att = s === front.attacker;
  const have = (k) => chosen.some((o) => o.key === k);
  const fireNow = chosen.some((o) => ATOUTS[o.key].fire) || (front.guns ?? []).some((g) => g.side === s && !g.lost && !GUN_KINDS[g.kind].at);
  if (A.fire && !fireNow) v *= 1.6;
  if (att && key === 'armor' && !have('armor') && !(front.armor ?? []).some((a) => a.side === s && !a.lost && a.tanks > a.max * 0.4)) v *= 1.3;
  const base = front.airWar ? front.airWar.force : front.cfg.airBase ?? front.cfg.sorties;
  if ((key === 'air' || key === 'fighters') && base[s] + (att ? front.cfg.airInitiative ?? 0 : 0) <= base[1 - s]) v *= 1.4;
  if (front.airWar && front.airWar.sup !== s && (key === 'air' || key === 'fighters')) v *= 1.3;
  if (key === 'sappers' && front.map.rivers?.length && card.rarity === 'rare') v *= 1.2;
  if (key === 'strongpoint') v *= (front.defTowns?.length ?? 0) >= 3 ? 1.2 : 0.85;
  if (key === 'antitank' && (front.guns ?? []).some((g) => g.side === s && g.lost && GUN_KINDS[g.kind].at)) v *= 1.3;
  return v;
}

// Choix automatique : les cartes de plus grand intérêt, une à une (une seconde carte du même genre vaut moins).
export function chooseCards(front, s, hand, keep) {
  const left = hand.slice();
  const out = [];
  while (out.length < keep && left.length) {
    let best = 0, bv = -Infinity;
    left.forEach((c, k) => {
      const v = cardValue(front, s, c, out);
      if (v > bv) { bv = v; best = k; }
    });
    out.push(left.splice(best, 1)[0]);
  }
  return out;
}

// Somme du contenu des cartes gardées, par camp.
function forcesOf(front, kept) {
  return [0, 1].map((s) => {
    const f = { guns: [], armor: [], support: [], aa: 0, sorties: 0, air: 0, assault: 1, pontoons: 0, special: { salvos: { n: 0, r: 0 }, paras: [], strong: [] } };
    for (const card of kept[s]) {
      const c = cardContent(front, s, card);
      f.guns.push(...c.guns);
      f.support.push(...c.support);
      f.pontoons += c.pontoons;
      if (c.special.salvos) { f.special.salvos.n += c.special.salvos.n; f.special.salvos.r = Math.max(f.special.salvos.r, c.special.salvos.r); }
      f.special.paras.push(...c.special.paras);
      f.special.strong.push(...c.special.strong);
      f.armor.push(...c.armor);
      f.aa += c.aa;
      f.sorties += c.sorties;
      f.air += c.air;
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
  for (const s of [0, 1]) front.pontoons[s] += forces[s].pontoons;
  return { guns: forces.map((f) => f.guns), armor: armorLists(front, forces), support: forces.map((f) => f.support), special: forces.map((f) => f.special), aa: forces.map((f) => f.aa), sorties: forces.map((f) => f.sorties), air: forces.map((f) => f.air) };
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
  addSpecial(front, forces.map((f) => f.special));
  for (const s of [0, 1]) front.pontoons[s] += forces[s].pontoons;
  front.cfg.sorties = front.cfg.sorties.map((n, s) => n + forces[s].sorties);
  if (front.airWar) fightAirWar(front, forces.map((f) => f.air), 1); // la bataille des airs reprend
  A.assault = A.assault.map((v, s) => Math.max(v, forces[s].assault));
  logDeal(front, kept, 1);
}
