import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateUrbanMap } from '../src/urbangen.js';
import { createBattle, executeTurn, callFire, fireLeft, cityShare, barrageZone, onMap } from '../src/game.js';
import { moveCost, tileAt, roadEdgeKey, hasLOS } from '../src/terrain.js';
import { fireOdds } from '../src/combat.js';
import { makeUnit, resetIds } from '../src/units.js';
import { createRng } from '../src/rng.js';

const armies = (rng) => ({
  DE: ['infantry', 'infantry', 'infantry', 'tank', 'tank'].map((t) => makeUnit('DE', t, 2, rng)),
  SU: ['infantry', 'infantry', 'infantry', 'at'].map((t) => makeUnit('SU', t, 1, rng)),
});
const battle = (seed, opts = {}) => {
  resetIds();
  const map = generateUrbanMap(seed, { size: 'town', roads: ['W', 'E', 'N'], ...opts });
  const s = createBattle({ seed, playerSide: 'DE', armies: armies(createRng(seed)), kind: 'ville', maxTurns: 6, map, attacker: 'DE', fire: { DE: { barrage: 2, support: 2 } } });
  s.phase = 'plan';
  return s;
};

test('ville tactique : plan reproductible, grand-rue, îlots, église, pont', () => {
  const a = generateUrbanMap('v1', { river: 'east' }), b = generateUrbanMap('v1', { river: 'east' });
  assert.deepEqual(a.tiles.map((t) => t.terrain), b.tiles.map((t) => t.terrain));
  const { cy } = a.town;
  for (let c = 0; c < a.W; c++) assert.ok(tileAt(a, c, cy).road, `grand-rue continue (colonne ${c})`);
  assert.ok(a.roadEdges.has(roadEdgeKey(a, { col: 0, row: cy }, { col: 1, row: cy })));
  assert.ok(a.tiles.some((t) => t.terrain === 'building') && a.tiles.some((t) => t.terrain === 'isba'));
  assert.equal(tileAt(a, a.objective.col, a.objective.row).terrain, 'strong', 'l\'église, objectif de l\'IA');
  assert.ok(a.blocks.length >= 8, `${a.blocks.length} îlots`);
  assert.ok(a.blocks.some((x) => x.bridge), 'le pont compte comme un îlot');
  assert.ok(a.tiles.some((t) => t.river && t.bridge && t.road));
  const city = generateUrbanMap('v1', { size: 'city' });
  assert.ok(city.blocks.some((x) => x.label.startsWith('l\'usine')));
  assert.ok(city.blocks.length > a.blocks.length);
});

test('ville tactique : chars sur les rues, pas dans les pâtés ; gravats ; embuscade et enfilade', () => {
  const s = battle('v2');
  const { map } = s;
  const st = map.tiles.find((t) => t.terrain === 'street' && !t.plaza);
  const house = map.tiles.find((t) => t.terrain === 'building');
  const from = map.tiles.find((t) => t.terrain === 'street' && t !== st);
  assert.ok(moveCost(map, from, house, 'tank') >= 8, 'un char ne traverse pas un pâté de maisons');
  assert.ok(moveCost(map, from, house, 'infantry') <= 3);
  st.rubble = true;
  assert.ok(moveCost(map, from, st, 'tank') > 12, 'gravats : la rue est fermée aux chars');
  assert.ok(moveCost(map, from, st, 'infantry') <= 4);
  // Enfilade : la grand-rue se voit d'un bout à l'autre ; les maisons masquent.
  const cy = map.town.cy;
  assert.ok(hasLOS(map, { col: 2, row: cy }, { col: map.W - 3, row: cy }));
  // Embuscade : une infanterie dans une maison au contact d'un char tire sans malus de blindage, avec un bonus.
  const inf = s.units.find((u) => u.side === 'SU' && u.type === 'infantry');
  const tank = s.units.find((u) => u.side === 'DE' && u.type === 'tank');
  const h = map.tiles.find((t) => t.terrain === 'building' && map.tiles.some((n) => n.terrain === 'street' && Math.abs(n.col - t.col) <= 1 && n.row === t.row));
  Object.assign(inf, { col: h.col, row: h.row });
  const nextTo = map.tiles.find((n) => n.terrain === 'street' && n.row === h.row && Math.abs(n.col - h.col) === 1);
  Object.assign(tank, { col: nextTo.col, row: nextTo.row });
  const odds = fireOdds(map, inf, tank);
  assert.ok(odds.mods.some((m) => m.why === 'embuscade en ville'));
  assert.ok(!odds.mods.some((m) => m.why === 'cible blindée' && m.v > 0));
});

test('ville tactique : barrage focalisé (stock, zone, ruines, clouage) et tir d\'appui (case vue)', () => {
  const s = battle('v3');
  assert.equal(fireLeft(s, 'DE', 'barrage'), 2);
  assert.equal(fireLeft(s, 'SU', 'barrage'), 0);
  assert.ok(callFire(s, 'SU', 'barrage', { col: 5, row: 5 }).error, 'pas de stock');
  // Défenseur dans un pâté de pierre : le barrage le décime et ruine les maisons.
  const inf = s.units.find((u) => u.side === 'SU' && u.type === 'infantry');
  const house = s.map.tiles.find((t) => t.terrain === 'building' && !s.units.some((u) => u !== inf && onMap(u) && Math.abs(u.col - t.col) <= 2 && Math.abs(u.row - t.row) <= 2));
  Object.assign(inf, { col: house.col, row: house.row });
  const hp0 = inf.hp;
  assert.ok(!callFire(s, 'DE', 'barrage', house).error);
  assert.equal(fireLeft(s, 'DE', 'barrage'), 1);
  assert.equal(barrageZone(s, house).length, 7);
  // Tir d'appui : seulement sur une case vue.
  const unseen = s.map.tiles.find((t) => !s.visibility.DE.hexes.has(t.row * s.map.W + t.col));
  assert.ok(callFire(s, 'DE', 'support', unseen).error);
  executeTurn(s);
  assert.equal(s.fire.DE.barrage, 1, 'stock débité');
  assert.ok(inf.hp < hp0 || inf.status !== 'ok', 'défenseur touché malgré les murs');
  assert.ok(tileAt(s.map, house.col, house.row).ruined, 'pâté en ruines');
  if (inf.status === 'ok') assert.ok(inf.pinned, 'survivants cloués');
});

test('ville tactique : îlots pris par l\'infanterie seule, victoire à la part de ville tenue', () => {
  const s = battle('v4');
  assert.equal(cityShare(s), 0, 'tout au défenseur au départ');
  // On vide la ville de ses défenseurs et l'on pose l'infanterie allemande sur trois îlots.
  for (const u of s.units) if (u.side === 'SU') { u.col = s.map.W - 1; u.row = u.id.length % s.map.H; }
  const inf = s.units.filter((u) => u.side === 'DE' && u.type === 'infantry');
  const blocks = s.blocks.filter((b) => !b.bridge).slice(0, 3);
  blocks.forEach((b, k) => { const i = b.tiles[0]; Object.assign(inf[k], { col: i % s.map.W, row: Math.floor(i / s.map.W) }); });
  for (const u of s.units) u.orders = { path: [], entrench: true, fireAt: null };
  executeTurn(s);
  for (const b of blocks) assert.equal(s.blocks[b.id].owner, 'DE', b.label);
  assert.ok(cityShare(s) > 0);
  while (!s.result) { for (const u of s.units) u.orders = { path: [], entrench: true, fireAt: null }; executeTurn(s); }
  assert.ok(/ville/.test(s.result.reason));
  assert.equal(s.result.winner, cityShare(s) >= 0.5 ? 'DE' : 'SU');
});

test('ville tactique : l\'IA attaquante prend des îlots, la défenseure reprend les siens', async () => {
  const { planSide } = await import('../src/ai.js');
  let share = 0;
  for (let k = 0; k < 3; k++) {
    resetIds();
    const rng = createRng(`ia${k}`);
    const mk = (side, list) => list.map((t) => makeUnit(side, t, 2, rng));
    const map = generateUrbanMap(`ia${k}`, { size: 'town' });
    const s = createBattle({ seed: `ia${k}`, playerSide: null, armies: { DE: mk('DE', [...Array(9).fill('infantry'), 'tank', 'tank']), SU: mk('SU', [...Array(6).fill('infantry'), 'at']) }, kind: 'ville', maxTurns: 10, map, attacker: 'DE', fire: { DE: { barrage: 2, support: 3 } } });
    s.phase = 'plan';
    while (!s.result) { planSide(s, 'DE'); planSide(s, 'SU'); executeTurn(s); }
    share += cityShare(s);
  }
  assert.ok(share / 3 > 0.2, `part moyenne de la ville prise : ${(share / 3).toFixed(2)}`);
});
