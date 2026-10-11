// Résolution du feu aux dés (d6) et tests de moral.

import { tileAt, terrainDefense } from './terrain.js';
import { hexDistance } from './hex.js';
import { unitStats } from './units.js';

// Calcule le seuil de réussite (« touche sur X+ ») et le nombre de dés, avec le détail des modificateurs.
export function fireOdds(map, attacker, target, { indirect = false, observed = true } = {}) {
  const sa = unitStats(attacker), st = unitStats(target);
  const ta = tileAt(map, attacker.col, attacker.row), tt = tileAt(map, target.col, target.row);
  const dist = hexDistance(attacker, target);
  const mods = [];
  const add = (v, why) => { if (v) mods.push({ v, why }); };

  add(-sa.hitBonus, 'élite');
  add(terrainDefense(tt), tt.river && !tt.road ? (tt.stream ? 'dans le ruisseau' : 'dans la rivière') : `couvert (${tt.terrain === 'village' ? 'village' : tt.terrain === 'forest' ? 'forêt' : 'terrain'})`);
  add(target.entrench, 'retranchée');
  if (!indirect) {
    if (tt.elev > ta.elev) add(1, 'cible en hauteur');
    if (tt.elev < ta.elev) add(-1, 'tir plongeant');
  }
  if ((attacker.movedHexes ?? 0) * 2 > sa.move) add(1, 'tireur en mouvement');
  if ((target.movedHexes ?? 0) >= 3 && (tt.terrain === 'plain' || tt.terrain === 'farm')) add(-1, 'cible à découvert en mouvement');
  if (st.armored && (attacker.type === 'infantry' || attacker.type === 'recon')) {
    const close = dist <= 1 && (tt.terrain === 'forest' || tt.terrain === 'village');
    add(close ? 0 : 2, 'cible blindée');
  }
  if (st.armored && attacker.type === 'artillery') add(1, 'blindage');
  if (indirect && !observed) add(1, 'tir non observé');
  if (ta.terrain === 'marsh') add(1, 'tireur embourbé');
  if (target.status === 'routed') add(-1, 'cible en déroute');
  if (attacker.pinned) add(1, 'tireur cloué');

  const threshold = Math.max(2, Math.min(6, 4 + mods.reduce((s, m) => s + m.v, 0)));
  let dice = Math.max(1, Math.round((sa.attack * attacker.hp) / sa.maxHp));
  if (attacker.type === 'artillery' && dist <= 1) dice = Math.max(1, Math.ceil(dice / 2)); // autodéfense
  if (st.armored) dice += sa.antitank; // canon antichar : obus perforants
  const crits = !(st.armored && (attacker.type === 'infantry' || attacker.type === 'recon'));
  return { threshold, dice, mods, crits };
}

export function rollFire(rng, odds) {
  const rolls = Array.from({ length: odds.dice }, () => rng.d6());
  let damage = 0, hits = 0;
  for (const r of rolls) {
    if (r >= odds.threshold) {
      hits++;
      damage += r === 6 && odds.crits ? 2 : 1;
    }
  }
  return { rolls, hits, damage };
}

// Test de moral après des pertes (ou la destruction d'une unité voisine) : d6 + niveau + modificateurs ≥ 5 pour tenir.
// ctx : forced (test même sans pertes), isolated (aucun allié à 2 hex), pincer (feu venu de côtés opposés),
// support (allié adjacent retranché).
export function moraleCheck(map, unit, hpBefore, rng, { forced = false, isolated = false, pincer = false, support = false } = {}) {
  const s = unitStats(unit);
  const lost = hpBefore - unit.hp;
  const shaken = forced || unit.hp <= s.maxHp * 0.35 || lost >= hpBefore * 0.4;
  if (!shaken) return null;
  const t = tileAt(map, unit.col, unit.row);
  const mods = [];
  const add = (v, why) => { if (v) mods.push({ v, why }); };
  add(unit.entrench > 0 ? 1 : 0, 'retranchée');
  add(t.terrain === 'village' || t.terrain === 'forest' ? 1 : 0, 'à couvert');
  add(support ? 1 : 0, 'soutien retranché');
  add(isolated ? -1 : 0, 'isolée');
  add(pincer ? -1 : 0, 'prise en tenaille');
  const roll = rng.d6();
  const total = roll + unit.level + mods.reduce((a, m) => a + m.v, 0);
  return { roll, total, held: roll !== 1 && total >= 5, mods };
}
