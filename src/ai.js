// IA de l'état-major adverse. Elle ne voit que ce que voient ses unités (brouillard + mémoire)
// et anticipe les mouvements ennemis à partir des dernières observations.

import { hexDistance, neighborCoords, sameHex } from './hex.js';
import { tileAt, terrainDefense, TERRAIN } from './terrain.js';
import { unitStats, other, UNIT_TYPES } from './units.js';
import { reachable, pathFrom, hexKey, keyHex } from './path.js';
import { active, onMap, predictPosition, retreatCol, callFire, fireLeft, barrageZone } from './game.js';

const VALUE = { infantry: 2, recon: 1, artillery: 3, tank: 4, at: 3 };

export const DIRECTIVES = {
  attack: { label: 'Attaquer', verb: 'attaquer' },
  defend: { label: 'Défendre', verb: 'défendre' },
  retreat: { label: 'Repli', verb: 'se replier sur' },
};

// Répartit les unités entre les directives : chacune prend les plus proches, à parts à peu près égales.
export function assignDirectives(units, directives) {
  const out = new Map();
  if (!directives?.length) return out;
  const cap = Math.ceil(units.length / directives.length);
  const load = directives.map(() => 0);
  const pairs = [];
  for (const u of units) directives.forEach((d, i) => pairs.push({ u, i, d: hexDistance(u, d) }));
  pairs.sort((a, b) => a.d - b.d);
  for (const p of pairs) {
    if (out.has(p.u.id) || load[p.i] >= cap) continue;
    out.set(p.u.id, p.i);
    load[p.i]++;
  }
  return out;
}

// Plan d'un camp. Options :
// - directives : [{ kind: 'attack' | 'defend' | 'retreat', col, row }] données par le joueur ; l'état-major en tire les ordres ;
// - fixed : identifiants des unités dont les ordres ont été donnés à la main (on ne les touche pas).
export function planSide(state, side, { directives = null, fixed = null, rng = state.rng } = {}) {
  const { map } = state;
  const foe = other(side);
  const all = state.units.filter((u) => u.side === side && active(u));
  const mine = fixed ? all.filter((u) => !fixed.has(u.id)) : all;
  const assignment = assignDirectives(mine, directives);
  const known = Object.entries(state.memory[side])
    .map(([id, m]) => ({ id, ...m, pred: predictPosition(state, m), age: state.turn - m.turn }))
    .filter((k) => k.age <= 4);

  // Rapport de force estimé : les ennemis jamais vus comptent pour une infanterie moyenne.
  const myPower = all.reduce((s, u) => s + UNIT_TYPES[u.type].cost * (u.hp / unitStats(u).maxHp), 0);
  const foeAlive = state.units.filter((u) => u.side === foe && active(u)).length; // effectif connu par l'ordre de bataille
  const seenPower = known.reduce((s, k) => s + UNIT_TYPES[k.type].cost * ({ intacte: 1, entamée: 0.6, affaiblie: 0.35, décimée: 0.15 }[k.hpState] ?? 1), 0);
  const foePower = seenPower + Math.max(0, foeAlive - known.length) * 2;
  const ratio = myPower / Math.max(1, foePower);
  const stance = ratio > 1.25 ? 'attack' : ratio < 0.75 ? 'defend' : 'balanced';

  const obj = state.objective;
  const enemyEdge = retreatCol(state, foe);
  const ownEdge = retreatCol(state, side);
  const reserved = new Set();
  // Les unités commandées à la main occupent déjà leur destination.
  for (const u of all) {
    if (mine.includes(u)) continue;
    reserved.add(hexKey(map, u.orders.path.length ? u.orders.path[u.orders.path.length - 1] : u));
  }
  const enemyKeys = new Set(known.filter((k) => k.age === 0).map((k) => hexKey(map, k)));
  const knownDanger = (h) => known.reduce((s, k) => s + (hexDistance(h, k.pred) <= 2 ? VALUE[k.type] : 0), 0);

  // Garnison : l'unité d'infanterie la plus proche de l'objectif s'y installe.
  let garrison = null;
  if (obj && !directives?.length) {
    const inf = mine.filter((u) => u.type === 'infantry' || u.type === 'tank');
    inf.sort((a, b) => hexDistance(a, obj) - hexDistance(b, obj));
    garrison = inf[0] ?? null;
  }

  const order = ['recon', 'tank', 'infantry', 'at', 'artillery'];
  for (const u of [...mine].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))) {
    const s = unitStats(u);
    u.orders = { path: [], entrench: false, fireAt: null };
    const hpRatio = u.hp / s.maxHp;
    const dir = assignment.has(u.id) ? directives[assignment.get(u.id)] : null;
    const falling = dir?.kind === 'retreat' && hexDistance(u, dir) > 1;

    // Artillerie : barrage sur la position anticipée de la cible la plus intéressante
    // (de préférence autour du point d'attaque ou de défense désigné).
    // Munitions comptées : plus le stock baisse, plus la cible doit valoir le coup ; le tir à vue est coupé en fin de stock.
    if (u.type === 'artillery' && side !== state.playerSide) u.holdFire = u.ammo <= 2; // côté joueur, c'est son réglage
    const onFire = tileAt(map, u.col, u.row).fire > 0; // une batterie dans une forêt en feu déménage d'abord
    if (u.type === 'artillery' && !falling && u.ammo > 0 && !onFire && !u.reloading) {
      const minValue = u.ammo >= 4 ? 0 : u.ammo >= 2 ? 3.5 : 5;
      let best = null, bestV = 0;
      for (const k of known) {
        const d = hexDistance(u, k.pred);
        if (d < s.minRange || d > s.range) continue;
        const near = all.some((m) => m !== u && hexDistance(m, k.pred) <= 1);
        const focus = dir && dir.kind !== 'retreat' && hexDistance(k.pred, dir) <= 3 ? 2 : 0;
        // Katioucha : la salve couvre aussi les cases est et ouest, autant viser là où les ennemis se serrent.
        const flank = s.salvo ? known.filter((o) => o !== k && o.pred.row === k.pred.row && Math.abs(o.pred.col - k.pred.col) === 1).reduce((a, o) => a + VALUE[o.type], 0) : 0;
        const v = VALUE[k.type] * (k.age === 0 ? 1.5 : 1) + flank + (near ? 1 : 0) + focus + rng.next() * 0.5;
        if (v > bestV) { bestV = v; best = k; }
      }
      if (best && bestV >= minValue) {
        u.orders.fireAt = { col: best.pred.col, row: best.pred.row };
        u.orders.entrench = true;
        reserved.add(hexKey(map, u));
        continue;
      }
    }

    // Clouée : elle ne bougera pas de toute façon, autant creuser.
    if (u.pinned && u.status === 'ok') {
      u.orders.entrench = true;
      reserved.add(hexKey(map, u));
      continue;
    }

    let goal;
    let aggressive = false;
    let wGoal = { attack: 1, balanced: 0.65, defend: 0.3 }[stance] * (u.type === 'recon' && state.turn <= 3 ? 1.4 : 1);
    let dangerW = u.type === 'artillery' || u.type === 'recon' ? 0.8 : u.type === 'at' ? 0.5 : 0.25;
    let holdBonus = stance === 'defend' ? 1 : 0;
    if (hpRatio < 0.35 && dir?.kind !== 'defend') goal = { col: ownEdge, row: u.row };
    else if (dir) {
      const near = known.filter((k) => k.status !== 'routed' && hexDistance(k.pred, dir) <= 3);
      near.sort((a, b) => hexDistance(u, a.pred) - hexDistance(u, b.pred));
      const there = hexDistance(u, dir) <= 2;
      if (dir.kind === 'attack') {
        // Attaquer : marcher sur le point désigné, puis sur les ennemis qui le tiennent.
        goal = near[0] && u.type !== 'artillery' ? near[0].pred : dir;
        aggressive = u.type === 'tank' || u.type === 'infantry';
        wGoal = 1.1;
        if (aggressive) dangerW = 0.05;
      } else if (dir.kind === 'defend') {
        // Défendre : rejoindre la position, s'y couvrir et s'y retrancher ; ne pas poursuivre.
        goal = dir;
        wGoal = there ? 0.35 : 1;
        dangerW = there ? 0.1 : 0.4;
        holdBonus = there ? 2 : 0;
      } else {
        // Repli : rompre le contact et rejoindre le point de ralliement.
        goal = dir;
        wGoal = 1.3;
        dangerW = 1.2;
        holdBonus = there ? 1.5 : -1;
      }
    } else if (u === garrison) goal = obj;
    else {
      const targets = known.filter((k) => k.status !== 'routed' || u.type === 'tank');
      targets.sort((a, b) => hexDistance(u, a.pred) - hexDistance(u, b.pred));
      const tgt = targets[0];
      const armor = u.type === 'at' && targets.find((k) => k.type === 'tank');
      if (armor) { goal = armor.pred; wGoal = Math.max(wGoal, 0.8); }
      else if (tgt && (u.type === 'tank' || u.type === 'infantry' || u.type === 'at') && stance !== 'defend') {
        goal = tgt.pred;
        aggressive = u.type !== 'at'; // l'antichar suit le mouvement sans se jeter au contact
      } else if (obj && stance !== 'defend') goal = obj;
      else if (tgt) goal = tgt.pred;
      else goal = { col: stance === 'defend' ? Math.round((ownEdge * 2 + enemyEdge) / 3) : enemyEdge, row: u.row };
    }

    const blocked = new Set([...enemyKeys, ...reserved]);
    blocked.delete(hexKey(map, u));
    const reach = reachable(map, u, { blocked });
    let best = null, bestScore = -Infinity;
    for (const [k] of reach) {
      const h = keyHex(map, k);
      const t = tileAt(map, h.col, h.row);
      if (t.terrain === 'marsh' && u.type === 'tank') continue;
      let score = -hexDistance(h, goal) * wGoal + terrainDefense(t, u.type) * 0.9 + t.elev * 0.25 + rng.next() * 0.3;
      // Incendie : quitter une forêt en feu, se méfier des forêts voisines d'un feu.
      if (t.fire > 0) score -= 50;
      else if (t.terrain === 'forest' && neighborCoords(h.col, h.row).some((n) => tileAt(map, n.col, n.row)?.fire > 0)) score -= 2;
      const danger = knownDanger(h);
      if (!aggressive || u.type === 'artillery' || u.type === 'recon') score -= danger * dangerW;
      if (aggressive) {
        const inRange = known.some((e) => { const d = hexDistance(h, e.pred); return d >= 1 && d <= s.range; });
        if (inRange) score += 1.5 * (ratio > 1 ? 1.3 : 0.8);
      }
      if (u.type === 'artillery' && u.ammo > 0) {
        const covers = known.some((e) => { const d = hexDistance(h, e.pred); return d >= s.minRange && d <= s.range; });
        if (covers) score += 2;
      }
      // Antichar : un couvert d'où il bat les blindés connus ; bouger l'empêche de tirer ce tour-ci.
      if (u.type === 'at') {
        const inRange = known.filter((e) => e.status !== 'routed' && hexDistance(h, e.pred) >= 1 && hexDistance(h, e.pred) <= s.range);
        if (TERRAIN[t.terrain].conceal) score += 0.7;
        if (inRange.length) score += 1.5 + (inRange.some((e) => e.type === 'tank') ? 1.5 : 0) + (k === hexKey(map, u) ? 1.5 : 0);
      }
      if (dir?.kind === 'defend' && hexDistance(h, dir) <= 2) score += 0.6;
      if (k === hexKey(map, u)) score += 0.4 + u.entrench * 0.6 + holdBonus;
      if (obj && u === garrison && h.col === obj.col && h.row === obj.row) score += 5;
      if (score > bestScore) { bestScore = score; best = h; }
    }
    reserved.add(hexKey(map, best));
    if (best.col === u.col && best.row === u.row) u.orders.entrench = true;
    else u.orders.path = pathFrom(map, reach, best);
  }
  if (side !== state.playerSide) planFire(state, side);
  return { assignment };
}

// Bataille de rue : feux hors carte de l'IA. Tir d'appui sur l'ennemi vu qui vaut le plus ; barrage focalisé sur la
// plus forte concentration ennemie connue, jamais là où sont ses propres unités, un tour sur trois au plus.
export function planFire(state, side) {
  if (state.kind !== 'ville' || !state.fire) return;
  const own = state.units.filter((u) => u.side === side && onMap(u));
  const known = Object.values(state.memory[side]).filter((m) => state.turn - m.turn <= 1 && m.status !== 'routed');
  const seen = known.filter((m) => m.turn === state.turn && state.visibility[side]?.hexes.has(m.row * state.map.W + m.col));
  if (fireLeft(state, side, 'support') > 0 && seen.length) {
    const best = seen.reduce((a, b) => (VALUE[b.type] > VALUE[a.type] ? b : a));
    callFire(state, side, 'support', best);
  }
  state.lastBarrage ??= { DE: -9, SU: -9 };
  if (fireLeft(state, side, 'barrage') <= 0 || state.turn - state.lastBarrage[side] < 3) return;
  let best = null, bv = 0;
  for (const k of known) {
    const zone = barrageZone(state, k);
    if (own.some((u) => zone.some((h) => sameHex(h, u)))) continue;
    const v = known.filter((o) => zone.some((h) => sameHex(h, o))).reduce((a, o) => a + VALUE[o.type], 0);
    if (v > bv) { bv = v; best = k; }
  }
  if (best && bv >= 5 && !callFire(state, side, 'barrage', best).error) state.lastBarrage[side] = state.turn;
}
