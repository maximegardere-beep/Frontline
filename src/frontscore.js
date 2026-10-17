// Objectifs du front stratégique : victoire graduée aux points et objectifs secondaires tirés au briefing.
//
// Le score se lit du côté de l'attaquant (positif : l'offensive réussit). Il additionne :
// - villes ★ tenues au soir du dernier jour (3 points par bourg, 9 par grande ville) ;
// - contrôle dans la durée : chaque soir, 1 point par bourg ★ tenu (3 par grande ville) — perdre une ville tard coûte
//   moins cher que la perdre tôt ;
// - terrain gagné (0,5 point par % de la carte) ;
// - rapport des pertes (20 points par écart de 100 % entre les parts d'armée perdues) et prisonniers des poches ;
// - exploitation : des troupes ravitaillées sur le bord ennemi de la carte ;
// - objectifs secondaires (6 points chacun, pour ou contre l'attaquant).
// Les seuils des cinq issues sont calés sur des batailles IA contre IA (tools/front-sim.mjs).
//
// Métropole (frontmetro.js) : le score est la somme des points des quartiers que l'attaquant a pris pendant la bataille,
// moins ceux qu'il possédait au départ et a perdus, plus 1 point par objectif secondaire rempli (pour ou contre lui).
//
// Ce module ne dépend pas de front.js (il est importé par lui) : il lit l'état du front directement.

import { GUN_KINDS } from './frontguns.js';
import { createRng } from './rng.js';
import { isMetro, districtOwner, districtTotal, metroGrade, METRO_RULES } from './frontmetro.js';

export const SCORE = {
  townEnd: 3, // par bourg ★ tenu au dernier soir (grande ville : × 3)
  townDay: 1, // par bourg ★ tenu chaque soir
  terrain: 0.5, // par % de carte gagné
  losses: 20, // par écart de 100 % entre les parts d'armée perdues
  prisoners: 30, // par 100 % de l'armée adverse perdue dans des poches
  exploit: 6, // bord ennemi atteint et tenu (au moins 3 lignes ravitaillées)
  secondary: 6, // par objectif secondaire rempli
  // Issues (le score attendu d'une offensive moyenne est positif : elle gagne toujours un peu de terrain et de
  // contrôle) : ≥ attDecisive, victoire décisive de l'attaquant ; ≥ attWin, victoire ; ≥ draw, indécis ;
  // ≥ defWin, victoire défensive ; en dessous, victoire défensive décisive.
  attDecisive: 36,
  attWin: 16,
  draw: 11,
  defWin: 2,
};

export const GRADES = {
  attDecisive: { label: 'Victoire décisive', att: true },
  attWin: { label: 'Victoire', att: true },
  draw: { label: 'Issue indécise', att: null },
  defWin: { label: 'Victoire défensive', att: false },
  defDecisive: { label: 'Victoire défensive décisive', att: false },
};

export function gradeOf(score) {
  if (score >= SCORE.attDecisive) return 'attDecisive';
  if (score >= SCORE.attWin) return 'attWin';
  if (score >= SCORE.draw) return 'draw';
  if (score >= SCORE.defWin) return 'defWin';
  return 'defDecisive';
}

const scoreTownValue = (t) => (t.city ? 3 : 1);
const scoreShare = (front, s) => {
  let own = 0, open = 0;
  for (let i = 0; i < front.map.N; i++) { if (front.owner[i] < 0) continue; open++; if (front.owner[i] === s) own++; }
  return own / Math.max(1, open);
};
const scoreStrength = (front, s) => {
  let t = front.reserve[s];
  for (let i = 0; i < front.map.N; i++) if (front.owner[i] === s) t += front.dens[i];
  return t;
};

// ---------- Objectifs secondaires ----------
// Chaque objectif : { id, side, kind, label, ...paramètres } ; évalué par OBJECTIVES[kind].check(front, o) →
// { done (rempli maintenant), final (définitivement rempli ou manqué : true / false / null), text (avancement) }.



export const OBJECTIVES = {
  // Encercler : des hommes ennemis perdus dans des poches.
  encircle: {
    check(front, o) {
      const got = front.stats.pocket[1 - o.side];
      return { done: got >= o.amount, final: got >= o.amount ? true : null, text: `${Math.round(got * front.cfg.men).toLocaleString('fr-FR')} / ${Math.round(o.amount * front.cfg.men).toLocaleString('fr-FR')} h` };
    },
  },
  // Tenir une case (hauteur, carrefour) au dernier soir.
  holdCell: {
    check(front, o) {
      const held = front.owner[o.i] === o.side;
      return { done: held, final: null, text: held ? 'tenue' : 'aux mains de l\'ennemi' };
    },
  },
  // Prendre une ville avant un jour donné (rempli dès qu'elle est prise à temps).
  takeTownBy: {
    check(front, o) {
      if (o.reached) return { done: true, final: true, text: `prise le jour ${o.reached}` };
      return { done: false, final: front.day > o.by ? false : null, text: `avant le soir du jour ${o.by}` };
    },
  },
  // Réduire au silence des groupes d'artillerie ennemis.
  guns: {
    check(front, o) {
      const lost = front.guns.filter((g) => g.side !== o.side && g.lost && !GUN_KINDS[g.kind].at).length;
      return { done: lost >= o.count, final: lost >= o.count ? true : null, text: `${lost} / ${o.count}` };
    },
  },
  // Perdre moins d'une part de ses forces.
  thrift: {
    check(front, o) {
      const share = front.stats.losses[o.side] / front.initial[o.side];
      return { done: share < o.share, final: share >= o.share ? false : null, text: `${Math.round(share * 100)} % perdus (plafond ${Math.round(o.share * 100)} %)` };
    },
  },
  // Garder tous ses groupes d'artillerie.
  keepGuns: {
    check(front, o) {
      const lost = front.guns.filter((g) => g.side === o.side && g.lost && !GUN_KINDS[g.kind].at).length;
      return { done: lost === 0, final: lost > 0 ? false : null, text: lost ? `${lost} perdu${lost > 1 ? 's' : ''}` : 'aucun perdu' };
    },
  },
};

// Hauteur ou case remarquable près du front, côté du camp `owner`, à `depth` cases environ de la ligne.
function pickHeight(front, owner, depth, rng, avoid = []) {
  const { map } = front;
  const cands = [];
  for (let i = 0; i < map.N; i++) {
    if (front.owner[i] !== owner || map.elev[i] < 2 || map.flow[i] <= 0) continue;
    if (map.towns.some((t) => t.i === i)) continue;
    if (avoid.some((j) => Math.hypot(front.centers.x[i] - front.centers.x[j], front.centers.y[i] - front.centers.y[j]) < 14)) continue;
    // Distance à la ligne de départ, approchée par l'écart de colonne au plus proche ennemi sur la même ligne.
    const W = map.W, row = Math.floor(i / W), col = i % W;
    let d = Infinity;
    for (let c = 0; c < W; c++) if (front.owner[row * W + c] === 1 - owner) d = Math.min(d, Math.abs(c - col));
    if (d >= depth - 3 && d <= depth + 3) cands.push(i);
  }
  return cands.length ? cands[rng.int(0, cands.length - 1)] : -1;
}

const heightName = (front, i) => `la cote ${150 + front.map.elev[i] * 40 + (i % 37)}`;

// Deux objectifs secondaires par camp, tirés selon la carte et la graine.
export function drawObjectives(front) {
  const rng = createRng(`objectives:${front.seed}`);
  const att = front.attacker, def = 1 - att;
  const out = [];
  let id = 1;
  const add = (side, o) => out.push({ id: id++, side, ...o });
  const m = front.cfg.men;
  // Attaquant.
  const pool = ['encircle', 'height', 'early', 'guns'];
  rng.shuffle(pool);
  for (const k of pool) {
    if (out.filter((o) => o.side === att).length >= 2) break;
    if (k === 'encircle') {
      const amount = Math.round((front.initial[def] * 0.08) / 50) * 50;
      add(att, { kind: 'encircle', amount, label: `Encercler au moins ${Math.round(amount * m).toLocaleString('fr-FR')} hommes ennemis` });
    } else if (k === 'height') {
      const i = pickHeight(front, def, 8, rng);
      if (i >= 0) add(att, { kind: 'holdCell', i, name: heightName(front, i).replace('la cote', 'Cote'), label: `Prendre et tenir ${heightName(front, i)} au dernier soir` });
    } else if (k === 'early') {
      const towns = front.map.towns.filter((t) => front.defTowns.includes(t.i));
      if (towns.length) {
        // La ville ★ la plus proche du front (la plus exposée).
        const near = (t) => { let d = Infinity; for (let i = 0; i < front.map.N; i++) if (front.owner[i] === att) d = Math.min(d, Math.hypot(front.centers.x[i] - front.centers.x[t.i], front.centers.y[i] - front.centers.y[t.i])); return d; };
        const t = towns.reduce((a, b) => (near(b) < near(a) ? b : a));
        add(att, { kind: 'takeTownBy', i: t.i, by: Math.ceil(front.cfg.days / 2), label: `Prendre ${t.name} avant le soir du jour ${Math.ceil(front.cfg.days / 2)}` });
      }
    } else if (k === 'guns') add(att, { kind: 'guns', count: 2, label: 'Réduire au silence 2 groupes d\'artillerie ennemis' });
  }
  // Défenseur.
  const dpool = ['height', 'thrift', 'keepGuns', 'encircle'];
  rng.shuffle(dpool);
  for (const k of dpool) {
    if (out.filter((o) => o.side === def).length >= 2) break;
    if (k === 'height') {
      const i = pickHeight(front, def, 4, rng, out.filter((o) => o.kind === 'holdCell').map((o) => o.i));
      if (i >= 0) add(def, { kind: 'holdCell', i, name: heightName(front, i).replace('la cote', 'Cote'), label: `Tenir ${heightName(front, i)} jusqu'au bout` });
    } else if (k === 'thrift') add(def, { kind: 'thrift', share: 0.35, label: 'Perdre moins de 35 % de ses forces' });
    else if (k === 'keepGuns') add(def, { kind: 'keepGuns', label: 'Ne perdre aucun groupe d\'artillerie' });
    else if (k === 'encircle') {
      const amount = Math.round((front.initial[att] * 0.05) / 50) * 50;
      add(def, { kind: 'encircle', amount, label: `Encercler au moins ${Math.round(amount * m).toLocaleString('fr-FR')} assaillants` });
    }
  }
  return out;
}

export function objectiveState(front, o) {
  return OBJECTIVES[o.kind].check(front, o);
}

// Prises de villes dans les temps (appelé à chaque prise).
export function noteCapture(front, i, side) {
  for (const o of front.objectives ?? []) if (o.kind === 'takeTownBy' && o.i === i && o.side === side && !o.reached && front.day <= o.by) o.reached = front.day;
}

// Soir : points de contrôle des villes ★.
export function eveningScore(front) {
  if (isMetro(front)) return; // métropole : seuls comptent les quartiers tenus au dernier soir
  for (const t of front.map.towns) {
    if (!front.defTowns.includes(t.i)) continue;
    if (front.owner[t.i] === front.attacker) front.score.daily += SCORE.townDay * scoreTownValue(t);
  }
}

// Décompte complet (à tout moment ; « final » : au dernier soir, les objectifs encore ouverts sont jugés).
export function scoreBreakdown(front, final = false) {
  if (isMetro(front)) return metroBreakdown(front, final);
  const att = front.attacker, def = 1 - att;
  const rows = [];
  let townEnd = 0;
  for (const t of front.map.towns) if (front.defTowns.includes(t.i) && front.owner[t.i] === att) townEnd += SCORE.townEnd * scoreTownValue(t);
  rows.push({ key: 'towns', label: 'Villes ★ tenues par l\'attaquant', pts: townEnd });
  rows.push({ key: 'daily', label: 'Contrôle des villes ★, soir après soir', pts: front.score.daily });
  const gain = (scoreShare(front, att) - front.score.share0) * 100;
  rows.push({ key: 'terrain', label: `Terrain ${gain >= 0 ? 'gagné' : 'perdu'} par l'attaquant (${Math.abs(gain).toFixed(1)} %)`, pts: gain * SCORE.terrain });
  const lossA = front.stats.losses[att] / front.initial[att], lossD = front.stats.losses[def] / front.initial[def];
  rows.push({ key: 'losses', label: `Pertes (attaquant ${Math.round(lossA * 100)} %, défenseur ${Math.round(lossD * 100)} %)`, pts: (lossD - lossA) * SCORE.losses });
  const pris = front.stats.pocket[def] / front.initial[def] - front.stats.pocket[att] / front.initial[att];
  rows.push({ key: 'prisoners', label: 'Troupes perdues dans les poches', pts: pris * SCORE.prisoners });
  // Exploitation : lignes du bord ennemi tenues et ravitaillées par l'attaquant.
  const { W, H } = front.map;
  const edge = att === 0 ? W - 1 : 0;
  let rowsHeld = 0;
  for (let r = 0; r < H; r++) { const i = r * W + edge; if (front.owner[i] === att && front.supplied[att][i]) rowsHeld++; }
  rows.push({ key: 'exploit', label: 'Exploitation jusqu\'au bord de la carte', pts: rowsHeld >= 3 ? SCORE.exploit : 0 });
  if (front.bias) rows.push({ key: 'bias', label: `Exigence du scénario ${front.year} : l'offensive part favorite`, pts: -front.bias });
  for (const o of front.objectives) {
    const st = objectiveState(front, o);
    const ok = st.final ?? (final ? st.done : null);
    const sign = o.side === att ? 1 : -1;
    rows.push({ key: `obj${o.id}`, label: `${o.side === att ? 'Attaquant' : 'Défenseur'} : ${o.label}`, pts: ok ? sign * SCORE.secondary : 0, objective: o, state: st, ok });
  }
  const total = rows.reduce((a, r) => a + r.pts, 0);
  return { rows, total, grade: gradeOf(total) };
}

// Métropole : une ligne par quartier pris ou perdu par l'attaquant depuis le départ, puis les objectifs secondaires.
function metroBreakdown(front, final) {
  const att = front.attacker;
  const rows = [];
  for (const d of front.map.districts) {
    const was = front.metroStart[d.id] === att, is = districtOwner(front, d) === att;
    if (is && !was) rows.push({ key: `d${d.id}`, label: `${d.name} pris par l'attaquant`, pts: d.value, district: d });
    if (was && !is) rows.push({ key: `d${d.id}`, label: `${d.name} perdu par l'attaquant`, pts: -d.value, district: d });
  }
  for (const o of front.objectives) {
    const st = objectiveState(front, o);
    const ok = st.final ?? (final ? st.done : null);
    const sign = o.side === att ? 1 : -1;
    rows.push({ key: `obj${o.id}`, label: `${o.side === att ? 'Attaquant' : 'Défenseur'} : ${o.label}`, pts: ok ? sign * METRO_RULES.objective : 0, objective: o, state: st, ok });
  }
  const total = rows.reduce((a, r) => a + r.pts, 0);
  return { rows, total, max: districtTotal(front), grade: metroGrade(total) };
}

export function initScore(front) {
  if (isMetro(front)) front.metroStart = front.map.districts.map((d) => districtOwner(front, d)); // possession au départ
  front.stats.pocket = [0, 0];
  front.score = { daily: 0, share0: scoreShare(front, front.attacker), strength0: [scoreStrength(front, 0), scoreStrength(front, 1)] };
  front.objectives = drawObjectives(front);
}


