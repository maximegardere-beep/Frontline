import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexDistance, neighborCoords, pixelToHex, hexToPixel, hexLine } from '../src/hex.js';
import { generateMap } from '../src/mapgen.js';
import { createRng } from '../src/rng.js';
import { generateArmy, unitStats, resetIds, makeUnit } from '../src/units.js';
import { createBattle, executeTurn, onMap, computeVisibility } from '../src/game.js';
import { planSide, assignDirectives } from '../src/ai.js';
import { buildCombatFx } from '../src/fx.js';
import { sound } from '../src/audio.js';
import { moveCost } from '../src/terrain.js';
import { fireOdds, moraleCheck } from '../src/combat.js';
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

test('clouée : tir gêné, aucun mouvement ; le moral tient compte du voisinage', () => {
  const state = createBattle({ seed: 's', playerSide: 'DE', armies: { DE: generateArmy('DE', createRng(2), 6), SU: generateArmy('SU', createRng(3), 6) } });
  const [a] = state.units.filter((u) => u.side === 'DE');
  const [t] = state.units.filter((u) => u.side === 'SU');
  a.entrench = 0;
  const free = fireOdds(state.map, a, t);
  a.pinned = true;
  const pinned = fireOdds(state.map, a, t);
  assert.ok(pinned.mods.some((m) => m.why === 'tireur cloué'));
  assert.ok(pinned.threshold > free.threshold || free.threshold === 6);
  // Un test forcé a lieu même sans pertes ; isolement et tenaille pèsent, le soutien aide.
  assert.equal(moraleCheck(state.map, a, a.hp, createRng(1)), null);
  const worst = moraleCheck(state.map, a, a.hp, createRng(1), { forced: true, isolated: true, pincer: true });
  const best = moraleCheck(state.map, a, a.hp, createRng(1), { forced: true, support: true });
  assert.equal(best.total - worst.total, 3);
});

test('une unité clouée ne bouge pas au tour suivant', () => {
  resetIds();
  let checked = 0;
  for (let i = 0; i < 6; i++) {
    const rng = createRng(`pin${i}`);
    const state = createBattle({ seed: `pin${i}`, playerSide: 'DE', kind: 'rencontre', armies: { DE: generateArmy('DE', rng, 11), SU: generateArmy('SU', rng, 13) } });
    state.phase = 'plan';
    while (!state.result) {
      planSide(state, 'DE');
      planSide(state, 'SU');
      const pinned = state.units.filter((u) => u.pinned && u.status === 'ok').map((u) => ({ u, col: u.col, row: u.row }));
      executeTurn(state);
      for (const p of pinned) {
        assert.deepEqual([p.u.col, p.u.row], [p.col, p.row], `${p.u.name} a bougé alors qu'elle était clouée`);
        checked++;
      }
    }
  }
  assert.ok(checked > 5, `assez de cas de clouage (${checked})`);
});

test('antichar : perce les blindés, embusqué en couvert', () => {
  resetIds();
  const rng = createRng(9);
  const state = createBattle({ seed: 'at', playerSide: 'DE', armies: { DE: [makeUnit('DE', 'at', 1, rng), makeUnit('DE', 'infantry', 1, rng)], SU: [makeUnit('SU', 'tank', 1, rng), makeUnit('SU', 'infantry', 1, rng)] } });
  const [gun, inf] = state.units.filter((u) => u.side === 'DE');
  const [tank, rifles] = state.units.filter((u) => u.side === 'SU');
  assert.equal(fireOdds(state.map, gun, tank).dice, fireOdds(state.map, gun, rifles).dice + 2);
  assert.ok(fireOdds(state.map, inf, tank).threshold > fireOdds(state.map, gun, tank).threshold, 'l\'infanterie peine contre les chars');
  // En forêt, repéré seulement au contact.
  const forest = state.map.tiles.find((t) => t.terrain === 'forest' && t.col > 3 && t.col < state.map.W - 4);
  Object.assign(gun, { col: forest.col, row: forest.row, revealed: false });
  const spotter = state.units.find((u) => u.side === 'SU' && u.type === 'infantry');
  const free = state.map.tiles.find((t) => hexDistance(t, gun) === 2 && t.terrain !== 'forest' && t.terrain !== 'village' && !(t.river && !t.road));
  Object.assign(spotter, { col: free.col, row: free.row });
  Object.assign(tank, { col: -10, row: -10, status: 'destroyed' });
  Object.assign(inf, { col: -10, row: -10, status: 'destroyed' });
  const vis = computeVisibility(state, 'SU');
  if (vis.hexes.has(gun.row * state.map.W + gun.col)) assert.ok(!vis.units.has(gun.id), 'antichar invisible à 2 hex');
  const adj = state.map.tiles.find((t) => hexDistance(t, gun) === 1 && !(t.river && !t.road));
  Object.assign(spotter, { col: adj.col, row: adj.row });
  assert.ok(computeVisibility(state, 'SU').units.has(gun.id), 'repéré au contact');
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

test("toutes les cartes n'ont pas de rivière, et une rivière a des gués", () => {
  const kinds = { none: 0, stream: 0, river: 0 };
  for (let i = 0; i < 60; i++) {
    const m = generateMap(`eau${i}`);
    const r = m.rivers[0];
    kinds[!r ? 'none' : r.stream ? 'stream' : 'river']++;
    if (r && !r.stream) {
      const crossings = r.path.filter((h) => { const t = m.tiles[h.row * m.W + h.col]; return t.road || t.ford; });
      assert.ok(crossings.length >= 2, 'au moins un pont et un gué');
    }
    if (r?.stream) assert.ok(r.path.length < m.H, 'un ruisseau ne traverse pas toute la carte');
  }
  assert.ok(kinds.none >= 10 && kinds.stream >= 10 && kinds.river >= 10, JSON.stringify(kinds));
  assert.ok(kinds.river <= 35, 'la rivière infranchissable ne domine plus');
});

test('un gué coûte moins cher que la rivière', () => {
  const m = generateMap('gue', { river: true });
  const ford = m.tiles.find((t) => t.ford);
  assert.ok(ford, 'la rivière a un gué');
  const from = neighborCoords(ford.col, ford.row).find((n) => n.col >= 0 && n.row >= 0 && n.col < m.W && n.row < m.H);
  const viaFord = moveCost(m, from, ford, 'infantry');
  ford.ford = false;
  assert.equal(moveCost(m, from, ford, 'infantry') - viaFord, 3);
});

test('les directives répartissent les unités et orientent leurs ordres', () => {
  resetIds();
  const rng = createRng('dir');
  const state = createBattle({ seed: 'dir', playerSide: 'DE', armies: { DE: generateArmy('DE', rng, 11), SU: generateArmy('SU', rng, 13) } });
  state.phase = 'plan';
  const mine = state.units.filter((u) => u.side === 'DE');
  const target = { kind: 'attack', col: 14, row: 7 };
  const hold = { kind: 'defend', col: 3, row: 3 };
  const a = assignDirectives(mine, [target, hold]);
  assert.equal(a.size, mine.length);
  const shares = [0, 1].map((i) => [...a.values()].filter((v) => v === i).length);
  assert.ok(Math.abs(shares[0] - shares[1]) <= 1, 'parts égales');

  // Attaque seule : les unités mobiles avancent vers l'est.
  const { assignment } = planSide(state, 'DE', { directives: [target], rng: createRng(1) });
  assert.equal(assignment.size, mine.length);
  const movers = mine.filter((u) => u.type !== 'artillery');
  const closer = movers.filter((u) => u.orders.path.length && hexDistance(u.orders.path.at(-1), target) < hexDistance(u, target));
  assert.ok(closer.length >= movers.length - 1, 'les unités marchent sur l\'objectif');

  // Une unité commandée à la main garde ses ordres.
  const kept = mine[0];
  kept.orders = { path: [], entrench: true, fireAt: null };
  planSide(state, 'DE', { directives: [{ kind: 'retreat', col: 0, row: 7 }], fixed: new Set([kept.id]), rng: createRng(2) });
  assert.deepEqual(kept.orders, { path: [], entrench: true, fireAt: null });
});

test('une bataille pilotée par directives se joue jusqu\'au bout', () => {
  resetIds();
  const rng = createRng('dirsim');
  const state = createBattle({ seed: 'dirsim', playerSide: 'DE', kind: 'assaut', armies: { DE: generateArmy('DE', rng, 11), SU: generateArmy('SU', rng, 13) } });
  state.phase = 'plan';
  const dirs = [{ kind: 'attack', ...state.objective }];
  while (!state.result) {
    planSide(state, 'DE', { directives: dirs });
    planSide(state, 'SU');
    executeTurn(state);
  }
  assert.ok(state.result);
});

test('les effets de combat sont reproductibles et finissent', () => {
  const fires = [
    { a: { x: 0, y: 0 }, b: { x: 200, y: 50 }, type: 'artillery', indirect: true, hidden: false, dice: 6, hits: 2, damage: 3, empty: false, kill: true },
    { a: { x: 0, y: 0 }, b: { x: 50, y: 0 }, type: 'infantry', indirect: false, hidden: true, dice: 4, hits: 0, damage: 0, empty: false, kill: false },
    { a: { x: 0, y: 0 }, b: { x: 90, y: 0 }, type: 'tank', indirect: false, hidden: false, dice: 6, hits: 1, damage: 2, empty: false, kill: false },
  ];
  const a = buildCombatFx(fires, 'x'), b = buildCombatFx(fires, 'x');
  assert.deepEqual(a, b);
  assert.ok(a.duration > 1 && a.duration < 6, `durée ${a.duration}`);
  assert.ok(a.items.some((i) => i.k === 'blast' && i.kill), 'explosion finale');
  const hiddenTracers = a.items.filter((i) => i.k === 'tracer' && Math.abs(i.by) < 15 && i.bx < 70);
  assert.ok(hiddenTracers.every((i) => i.ax > 10), 'le tir d\'un tireur caché ne part pas de sa vraie position');
});

test('la chronologie sonore suit les effets de combat', () => {
  const fires = [
    { a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, type: 'artillery', indirect: true, hidden: false, dice: 5, hits: 2, damage: 3, empty: false, kill: true },
    { a: { x: 0, y: 0 }, b: { x: 50, y: 0 }, type: 'infantry', indirect: false, hidden: true, dice: 4, hits: 0, damage: 0, empty: false, kill: false },
  ];
  const { sounds, duration } = buildCombatFx(fires, 'snd');
  assert.ok(sounds.every((x, i) => i === 0 || x.t >= sounds[i - 1].t), 'triée dans le temps');
  assert.ok(sounds.every((x) => x.t >= 0 && x.t <= duration));
  for (const k of ['cannon', 'whistle', 'blast', 'rifle']) assert.ok(sounds.some((x) => x.k === k), k);
  assert.ok(sounds.some((x) => x.k === 'blast' && x.kill), 'destruction');
  assert.ok(sounds.filter((x) => x.k === 'rifle').every((x) => x.far), 'tireur caché entendu de loin');
  // Sans Web Audio (Node), le module son ne fait rien et ne plante pas.
  sound.unlock();
  sound.combat(sounds);
  sound.movement({ tanks: [{ x: 0, y: 0 }], foot: [] }, 1);
  sound.ambient(true);
  sound.ui('bell');
});

// Petite bataille sur terrain plat : une batterie et un fantassin allemands face à un fantassin soviétique.
function ammoScenario({ enemyAt, ammo = 6, holdFire = false, fireAt = null }) {
  resetIds();
  const rng = createRng('ammo');
  const state = createBattle({ seed: 'ammo', playerSide: 'DE', armies: { DE: [makeUnit('DE', 'artillery', 1, rng), makeUnit('DE', 'infantry', 1, rng)], SU: [makeUnit('SU', 'infantry', 1, rng)] } });
  for (const t of state.map.tiles) Object.assign(t, { terrain: 'plain', elev: 1, river: false, road: false });
  state.map.roadEdges.clear();
  state.objective = null;
  const [gun, rifles] = state.units.filter((u) => u.side === 'DE');
  const [foe] = state.units.filter((u) => u.side === 'SU');
  Object.assign(gun, { col: 3, row: 7, ammo, holdFire });
  Object.assign(foe, enemyAt);
  Object.assign(rifles, { col: enemyAt.col - 1, row: enemyAt.row - 2 });
  gun.orders.fireAt = fireAt;
  state.phase = 'plan';
  const res = executeTurn(state);
  return { gun, res };
}

test("munitions d'artillerie : stock, barrage payant, tir à vue désactivable, autodéfense gratuite", () => {
  const far = { col: 6, row: 7 };
  let r = ammoScenario({ enemyAt: far, holdFire: true, fireAt: { col: 3, row: 4 } });
  assert.equal(r.gun.ammo, 5, 'un barrage sur une case vide coûte un obus');
  assert.ok(r.res.fires.some((f) => f.attacker === r.gun.id && f.empty));

  r = ammoScenario({ enemyAt: far, holdFire: true });
  assert.equal(r.gun.ammo, 6, 'sans tir à vue, la batterie garde ses obus');
  assert.ok(!r.res.fires.some((f) => f.attacker === r.gun.id));

  r = ammoScenario({ enemyAt: far });
  assert.equal(r.gun.ammo, 5, 'le tir à vue coûte un obus');
  assert.ok(r.res.fires.some((f) => f.attacker === r.gun.id && f.indirect));

  r = ammoScenario({ enemyAt: far, ammo: 0, fireAt: { col: 6, row: 7 } });
  assert.equal(r.gun.ammo, 0);
  assert.ok(!r.res.fires.some((f) => f.attacker === r.gun.id), 'plus d\'obus : ni barrage ni tir à vue');

  r = ammoScenario({ enemyAt: { col: 4, row: 7 }, ammo: 0 });
  assert.ok(r.res.fires.some((f) => f.attacker === r.gun.id && !f.indirect), 'autodéfense au contact sans obus');

  const fresh = createBattle({ seed: 'ammo2', playerSide: 'DE', armies: { DE: [r.gun], SU: generateArmy('SU', createRng(1), 6) } });
  assert.equal(fresh.units.find((u) => u.id === r.gun.id).ammo, 6, 'stock rechargé à la bataille suivante');
});

test("l'IA ménage ses obus", () => {
  let spent = 0, batteries = 0, emptied = 0;
  for (let i = 0; i < 20; i++) {
    resetIds();
    const rng = createRng(`ai-ammo${i}`);
    const state = createBattle({ seed: `ai-ammo${i}`, playerSide: 'DE', armies: { DE: generateArmy('DE', rng, 11), SU: generateArmy('SU', rng, 13) } });
    state.phase = 'plan';
    while (!state.result) { planSide(state, 'DE'); planSide(state, 'SU'); executeTurn(state); }
    for (const u of state.units.filter((x) => x.type === 'artillery')) {
      batteries++;
      spent += 6 - u.ammo;
      if (u.ammo === 0) emptied++;
      assert.ok(u.ammo >= 0 && u.ammo <= 6);
    }
  }
  console.log(`obus tirés par batterie : ${(spent / batteries).toFixed(1)} ; batteries à sec : ${emptied}/${batteries}`);
  assert.ok(spent > 0, 'les batteries tirent');
});
