import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFront, beginDay, stepTick, addBarrage } from '../src/front.js';
import { createGuns, inCone, atFire, GUN_KINDS } from '../src/frontguns.js';
import { createSupport, supportDawn, supportTick, supportNight, moveSupport, SUPPORT } from '../src/frontbattalion.js';
import { drawHand } from '../src/frontatout.js';

const base = (seed) => createFront({ seed, playerSide: 'DE', attacker: 'SU', year: 1943, setup: { atouts: false, hq: false } });

test('canon antichar : cône face au contact, pertes et choc pour les blindés, pas de barrage', () => {
  const f = base('pak');
  const [g] = createGuns(f, [['atMed'], []]);
  g.id = 999;
  f.guns.push(g);
  const foe = f.armor.find((a) => a.side === 1);
  // Formation posée dans le cône, puis derrière le canon.
  atFire(f);
  const K = GUN_KINDS.atMed;
  const ahead = { x: g.x + Math.cos(g.face) * K.range * 0.5, y: g.y + Math.sin(g.face) * K.range * 0.5 };
  const behind = { x: g.x - Math.cos(g.face) * K.range * 0.5, y: g.y - Math.sin(g.face) * K.range * 0.5 };
  assert.ok(inCone(g, ahead.x, ahead.y) > 0.5);
  assert.equal(inCone(g, behind.x, behind.y), 0);
  assert.equal(inCone(g, g.x + Math.cos(g.face) * K.range * 1.2, g.y + Math.sin(g.face) * K.range * 1.2), 0, 'hors de portée');
  Object.assign(foe, { x: ahead.x, y: ahead.y });
  const t0 = foe.tanks;
  atFire(f);
  assert.ok(foe.tanks < t0, 'chars détruits');
  assert.ok(foe.underAT > 0, 'choc');
  assert.ok(f.stats.atKills[0] > 0);
  assert.equal(g.fired, f.clock, 'en tirant, il se dévoile');
  // Chars lourds : moins de pertes.
  const t1 = foe.tanks;
  foe.heavy = true;
  atFire(f);
  assert.ok(t1 - foe.tanks < t0 - t1);
  // Pas de mission de barrage pour un canon antichar.
  f.guns = [g];
  assert.ok(addBarrage(f, 0, { x: g.x + 3, y: g.y }).error);
});

test('bataillon de soutien : zone au contact, ouvrages selon les jours en place, effet qui reste', () => {
  const f = base('genie');
  f.support = createSupport(f, [[{ max: 3 }], []]);
  const [b] = f.support;
  supportDawn(f);
  assert.ok(b.cells.length > 10, `zone de ${b.cells.length} cases`);
  for (const i of b.cells) assert.equal(f.owner[i], 0);
  const i0 = b.cells[0];
  f.entrench.fill(0); f.wire.fill(0); f.at.fill(0);
  f.phase = 'resolve';
  for (let t = 0; t < f.cfg.ticks; t++) supportTick(f, []);
  const deep = b.cells.filter((i) => f.entrench[i] > 0.9).length;
  assert.ok(deep > b.cells.length / 3, 'tranchées au premier jour');
  assert.equal(b.cells.reduce((a, i) => a + f.wire[i], 0), 0, 'pas encore de barbelés');
  supportNight(f);
  assert.equal(b.level, 2);
  for (let t = 0; t < f.cfg.ticks * 2; t++) supportTick(f, []);
  assert.ok(b.cells.some((i) => f.wire[i] > 0.5), 'barbelés');
  supportNight(f);
  assert.equal(b.level, 3);
  supportNight(f);
  assert.equal(b.level, 3, 'plafond de sa carte');
  // Déplacé : niveau 1 ailleurs, les ouvrages restent.
  f.phase = 'plan';
  const wire = Float32Array.from(f.wire);
  let to = -1;
  for (let i = 0; i < f.map.N && to < 0; i++) { const d = Math.hypot(f.centers.x[i] - b.x, f.centers.y[i] - b.y); if (f.owner[i] === 0 && f.map.flow[i] > 0 && d > 12 && d < SUPPORT.move) to = i; }
  assert.ok(moveSupport(f, 0, b.id, { x: f.centers.x[to] + 60, y: f.centers.y[to] }).error, 'trop loin pour une nuit');
  assert.ok(!moveSupport(f, 0, b.id, { x: f.centers.x[to], y: f.centers.y[to] }).error);
  supportNight(f);
  assert.equal(b.cell, to);
  assert.equal(b.level, 1);
  assert.deepEqual(f.wire, wire, 'les ouvrages restent');
  void i0;
  // Débordé : perdu.
  f.owner[b.cell] = 1;
  const ev = [];
  supportTick(f, ev);
  assert.equal(b.lost, true);
  assert.equal(ev[0].kind, 'supportLost');
});

test('atouts du défenseur : canons antichar et bataillons dans le paquet, garantis', () => {
  let at = 0, sup = 0;
  for (let k = 0; k < 40; k++) {
    const f = createFront({ seed: `def${k}`, attacker: 'DE', year: 1942 });
    const hand = drawHand(f, 1, 0);
    assert.ok(hand.some((c) => c.key === 'antitank' || c.key === 'support'));
    at += f.guns.filter((g) => g.side === 1 && GUN_KINDS[g.kind].at).length;
    sup += f.support.filter((b) => b.side === 1).length;
    assert.equal(f.support.filter((b) => b.side === 0).length, 0, 'l\'attaquant n\'en tire pas');
  }
  assert.ok(at > 0 && sup > 0, `${at} canons antichar, ${sup} bataillons`);
});

test('journée complète avec les nouveaux atouts', () => {
  const f = createFront({ seed: 'jour', playerSide: 'DE', attacker: 'SU', year: 1944 });
  beginDay(f);
  while (f.phase === 'resolve') stepTick(f);
  assert.equal(f.day, 2);
});
