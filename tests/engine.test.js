import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexDistance, neighborCoords, pixelToHex, hexToPixel, hexLine } from '../src/hex.js';
import { generateMap } from '../src/mapgen.js';
import { createRng } from '../src/rng.js';
import { generateArmy, unitStats, resetIds } from '../src/units.js';
import { createBattle, executeTurn, onMap } from '../src/game.js';
import { planSide } from '../src/ai.js';
import { fireOdds } from '../src/combat.js';
import { newCampaign, battleSetup, concludeBattle, campaignOver } from '../src/campaign.js';

test('géométrie hexagonale cohérente', () => {
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      for (const n of neighborCoords(col, row)) assert.equal(hexDistance({ col, row }, n), 1);
      const p = hexToPixel(col, row, 30);
      assert.deepEqual(pixelToHex(p.x, p.y, 30), { col, row });
    }
  }
  const line = hexLine({ col: 0, row: 0 }, { col: 7, row: 5 });
  assert.equal(line.length, hexDistance({ col: 0, row: 0 }, { col: 7, row: 5 }) + 1);
});

test('la génération de carte est déterministe et variée', () => {
  const a = generateMap('abc'), b = generateMap('abc'), c = generateMap('xyz');
  assert.deepEqual(a.tiles, b.tiles);
  assert.notDeepEqual(a.tiles, c.tiles);
  for (const seed of ['1', '2', '3', '4', '5', '6']) {
    const m = generateMap(seed, { objective: true });
    assert.ok(m.villages.length >= 2, 'au moins deux villages');
    assert.ok(m.roadEdges.size > 10, 'un réseau routier');
    assert.ok(m.objective, 'un objectif');
    const elevs = new Set(m.tiles.map((t) => t.elev));
    assert.ok(elevs.size >= 3, 'du relief');
  }
});

test('une armée aléatoire respecte le budget et contient un noyau', () => {
  const army = generateArmy('SU', createRng(1), 12);
  assert.ok(army.filter((u) => u.type === 'infantry').length >= 2);
  assert.ok(army.some((u) => u.type === 'recon'));
  for (const u of army) assert.equal(u.hp, unitStats(u).maxHp);
});

test('le retranchement et le terrain rendent la cible plus difficile à toucher', () => {
  const state = createBattle({ seed: 's', playerSide: 'DE', armies: { DE: generateArmy('DE', createRng(2), 6), SU: generateArmy('SU', createRng(3), 6) } });
  const [a] = state.units.filter((u) => u.side === 'DE');
  const [t] = state.units.filter((u) => u.side === 'SU');
  const base = fireOdds(state.map, a, t).threshold;
  t.entrench = 2;
  assert.ok(fireOdds(state.map, a, t).threshold > base || base === 6);
});

function simulate(seed, kind) {
  resetIds();
  const rng = createRng(seed);
  const state = createBattle({
    seed, playerSide: 'DE', kind,
    armies: { DE: generateArmy('DE', rng, 11), SU: generateArmy('SU', rng, 13) },
  });
  state.phase = 'plan';
  let fires = 0;
  while (!state.result && state.turn <= 40) {
    planSide(state, 'DE');
    planSide(state, 'SU');
    const res = executeTurn(state);
    fires += res.fires.length;
    const occ = new Set();
    for (const u of state.units.filter(onMap)) {
      const k = `${u.col},${u.row}`;
      assert.ok(!occ.has(k), `deux unités sur ${k}`);
      occ.add(k);
      assert.ok(u.col >= 0 && u.col < state.map.W && u.row >= 0 && u.row < state.map.H);
    }
  }
  return { state, fires };
}

test('une bataille IA contre IA se termine avec un résultat', () => {
  let fought = 0;
  const outcomes = {};
  for (let i = 0; i < 12; i++) {
    const { state, fires } = simulate(`sim${i}`, i % 2 ? 'assaut' : 'rencontre');
    assert.ok(state.result, 'la bataille a un résultat');
    if (fires > 0) fought++;
    outcomes[state.result.winner ?? 'nul'] = (outcomes[state.result.winner ?? 'nul'] ?? 0) + 1;
  }
  assert.ok(fought >= 10, 'les armées finissent par se rencontrer');
  console.log('issues :', outcomes);
});

test('une campagne enchaîne les batailles', () => {
  resetIds();
  const c = newCampaign('SU', 'camp');
  while (!campaignOver(c)) {
    const setup = battleSetup(c);
    const state = createBattle({ seed: setup.seed, playerSide: c.playerSide, armies: setup.armies, kind: setup.kind });
    while (!state.result) { planSide(state, 'DE'); planSide(state, 'SU'); executeTurn(state); }
    concludeBattle(c, state);
  }
  assert.ok(c.results.length >= 1);
});
