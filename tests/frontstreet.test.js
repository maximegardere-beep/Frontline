import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFront, planOrders, runDay, addVector, FRONT_SIDES } from '../src/front.js';
import { streetCandidates, streetBattle, applyStreetBattle, STREET } from '../src/frontstreet.js';
import { createBattle, executeTurn, cityShare } from '../src/game.js';

// Une ville du défenseur au contact, et une poussée de l'attaquant qui la traverse.
function setup(seed = 'rue') {
  for (let k = 0; k < 30; k++) {
    const r = setupOne(`${seed}${k}`);
    if (r.dist <= STREET.ahead - 3) return r;
  }
  throw new Error('aucune ville au contact');
}

function setupOne(seed) {
  const f = createFront({ seed, setup: { atouts: false, hq: false } });
  const att = f.attacker, def = 1 - att;
  // La ville du défenseur la plus proche des lignes de l'attaquant, et la case de l'attaquant la plus proche d'elle.
  let town = null, from = -1, bd = Infinity;
  for (const t of f.map.towns) {
    if (f.owner[t.i] !== def) continue;
    for (let i = 0; i < f.map.N; i++) {
      if (f.owner[i] !== att) continue;
      const d = Math.hypot(f.centers.x[i] - f.centers.x[t.i], f.centers.y[i] - f.centers.y[t.i]);
      if (d < bd) { bd = d; from = i; town = t; }
    }
  }
  return { f, att, def, town, from, dist: bd };
}

test('bataille de rue : la ville que traverse une poussée devient candidate, après les ordres de l\'IA', () => {
  const { f, att, town, from, dist } = setup();
  assert.ok(dist <= STREET.ahead, `ville au contact (${dist.toFixed(1)})`);
  assert.equal(streetCandidates(f).length, 0, 'sans poussée, pas de bataille');
  const dx = f.centers.x[town.i] - f.centers.x[from];
  assert.ok(!addVector(f, att, 'infantry', from, { x: f.centers.x[town.i] + Math.sign(dx) * 6, y: f.centers.y[town.i] }).error);
  planOrders(f);
  assert.equal(f.aiPlanned, f.day);
  const c = streetCandidates(f).find((x) => x.town === town);
  assert.ok(c, 'la ville est disputée');
  assert.equal(c.attacker, att);
  assert.ok(c.attMen >= STREET.minMen);
});

test('bataille de rue : conversion (terrain, sections, rapport de force, feux) puis résultat réinjecté et ville figée', () => {
  const { f, att, def, town, from } = setup('rue2');
  const dx = f.centers.x[town.i] - f.centers.x[from];
  addVector(f, att, 'infantry', from, { x: f.centers.x[town.i] + Math.sign(dx) * 6, y: f.centers.y[town.i] });
  planOrders(f);
  const c = streetCandidates(f).find((x) => x.town === town);
  const b = streetBattle(f, c);
  assert.equal(b.map.name, town.name);
  assert.equal(b.attacker, FRONT_SIDES[att]);
  const A = b.armies[FRONT_SIDES[att]], D = b.armies[FRONT_SIDES[def]];
  const inf = (l) => l.filter((u) => u.type === 'infantry').length;
  assert.ok(inf(A) >= STREET.minUnits && inf(A) <= STREET.maxUnits);
  assert.ok(inf(D) >= 2 && inf(D) <= STREET.maxUnits);
  // Rapport de force à peu près gardé (à une section près, aux bornes près).
  const ratio = b.link.men[att] / b.link.men[def];
  if (ratio > 0.5 && ratio < 2) assert.ok(Math.abs(inf(A) / inf(D) - ratio) < 0.6 + 1 / inf(D), `${inf(A)}/${inf(D)} pour ${ratio.toFixed(2)}`);
  for (const s of ['DE', 'SU']) assert.ok(b.fire[s].barrage <= 2 && b.fire[s].support >= 0);
  // Bataille jouée « à la main » : l'attaquant prend tous les îlots.
  const st = createBattle({ seed: b.seed, playerSide: null, armies: b.armies, kind: 'ville', maxTurns: 2, map: b.map, attacker: b.attacker, fire: b.fire, conditions: b.conditions });
  st.phase = 'plan';
  executeTurn(st);
  for (const bl of st.blocks) bl.owner = b.attacker;
  st.result = { winner: b.attacker, reason: 'test' };
  assert.equal(cityShare(st), 1);
  const lost0 = f.stats.losses.slice();
  const r = applyStreetBattle(f, b.link, st);
  assert.ok(r.taken > 0, 'des cases de la ville changent de mains');
  for (const i of c.cells) if (f.owner[i] !== -1) assert.equal(f.owner[i], att, 'toute la ville à l\'attaquant');
  assert.ok(f.stats.losses[att] >= lost0[att] && f.stats.losses[def] >= lost0[def]);
  // Figée pour la journée : plus candidate, et rendue au combat le lendemain.
  assert.ok(c.cells.every((i) => f.frozen[i]));
  runDay(f);
  assert.equal(f.frozen, null);
});

test('bataille de rue en métropole : tout le quartier visé, trame de son type ; gagnée, le quartier change de mains', async () => {
  const { districtOwner } = await import('../src/frontmetro.js');
  const { planFront } = await import('../src/frontai.js');
  const f = createFront({ seed: 'metro-rue', playerSide: null, attacker: 'DE', biome: 'metropole', setup: { atouts: false, hq: false } });
  planFront(f, 0);
  planFront(f, 1);
  const c = streetCandidates(f).find((x) => x.town.district != null);
  assert.ok(c, 'un quartier disputé');
  const d = f.map.districts[c.town.district];
  assert.deepEqual([...c.cells].sort(), [...d.cells].sort(), 'tout le quartier');
  const b = streetBattle(f, c);
  assert.equal(b.map.name, d.name);
  assert.ok(b.title.includes(d.name));
  const att = f.attacker;
  const st = createBattle({ seed: b.seed, playerSide: null, armies: b.armies, kind: 'ville', maxTurns: 2, map: b.map, attacker: b.attacker, fire: b.fire, conditions: b.conditions });
  st.phase = 'plan';
  executeTurn(st);
  for (const bl of st.blocks) bl.owner = b.attacker;
  st.result = { winner: b.attacker, reason: 'test' };
  applyStreetBattle(f, b.link, st);
  assert.equal(districtOwner(f, d), att, 'le quartier à l\'attaquant');
  assert.ok(d.cells.every((i) => f.frozen[i]), 'figé pour la journée');
});
