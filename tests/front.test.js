import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFront, runDay, beginDay, stepTick, addVector, troops, FRONT_SETUP } from '../src/front.js';
import { generateFrontMap } from '../src/mapgen.js';
import { MOUNTAIN } from '../src/terrain.js';

// Case allemande au contact la plus proche de la ligne row.
function frontCell(f, row) {
  const { W, nb, N } = f.map;
  let best = -1, bd = Infinity;
  for (let i = 0; i < N; i++) {
    if (f.owner[i] !== 0) continue;
    let contact = false;
    for (let d = 0; d < 6; d++) { const j = nb[i * 6 + d]; if (j >= 0 && f.owner[j] === 1) contact = true; }
    if (!contact) continue;
    const dd = Math.abs(Math.floor(i / W) - row);
    if (dd < bd) { bd = dd; best = i; }
  }
  return best;
}

test('micro-grille : reproductible, villes, montagnes franchissables', () => {
  const a = generateFrontMap('m1'), b = generateFrontMap('m1');
  assert.deepEqual(a.kind, b.kind);
  assert.equal(a.N, 96 * 64);
  assert.ok(a.towns.length >= 4, `${a.towns.length} villes`);
  for (let row = 0; row < a.H; row++) {
    assert.notEqual(a.kind[row * a.W], MOUNTAIN, 'bord ouest libre');
    assert.notEqual(a.kind[row * a.W + a.W - 1], MOUNTAIN, 'bord est libre');
  }
});

test('front calme : usure faible et symétrique, aucune case ne change de main', () => {
  for (const seed of ['calme1', 'calme2']) {
    const f = createFront({ seed });
    f.reserve = [0, 0];
    const t = [troops(f, 0), troops(f, 1)];
    runDay(f);
    for (const s of [0, 1]) {
      const pct = f.stats.losses[s] / t[s];
      assert.ok(pct > 0.002 && pct < 0.03, `pertes du jour ${(100 * pct).toFixed(1)} %`);
    }
    assert.deepEqual(f.stats.captured, [0, 0]);
  }
});

test('percée blindée : passe un point faible, bute sur un secteur renforcé, ralentit sur des fortifications', () => {
  const day = (seed, setup) => {
    const f = createFront({ seed });
    const row = Math.floor(f.map.H / 2), W = f.map.W;
    setup(f, row, W);
    const from = frontCell(f, row);
    addVector(f, 0, 'armor', from, { x: f.centers.x[from] + 40, y: f.centers.y[from] });
    beginDay(f);
    let firstTicks = 0;
    while (f.phase === 'resolve') { stepTick(f); if (!firstTicks && f.stats.captured[0] >= 5) firstTicks = f.tick; }
    return { captured: f.stats.captured[0], firstTicks: firstTicks || Infinity };
  };
  const band = (f, row, W, e) => { for (let i = 0; i < f.map.N; i++) if (Math.abs(Math.floor(i / W) - row) <= 6 && f.owner[i] === 1) f.entrench[i] = e; };
  const weak = day('bench1', (f, row, W) => band(f, row, W, 0));
  const fort = day('bench1', (f, row, W) => band(f, row, W, 1));
  const massed = day('bench1', (f, row, W) => {
    band(f, row, W, 1);
    // Toutes les réserves soviétiques en face du point d'attaque.
    const from = frontCell(f, row);
    for (let dc = 1; dc < 8; dc++) if (f.owner[from + dc] === 1) { f.dens[from + dc] += f.reserve[1]; f.reserve[1] = 0; break; }
  });
  assert.ok(weak.captured >= 15, `point faible : ${weak.captured} cases prises`);
  assert.ok(fort.firstTicks > weak.firstTicks, `fortifié plus lent (${fort.firstTicks} contre ${weak.firstTicks} ticks)`);
  assert.ok(massed.captured < weak.captured / 3, `secteur renforcé : ${massed.captured} cases`);
});

test('poche : détectée par flood-fill, coupée du ravitaillement, elle fond chaque tick', () => {
  const f = createFront({ seed: 'poche' });
  const { W, H } = f.map;
  // Un îlot soviétique en plein territoire allemand.
  const cells = [];
  for (let r = H / 2 - 2; r <= H / 2 + 2; r++) for (let c = 10; c <= 14; c++) { const i = r * W + c; if (f.owner[i] === 0) { f.owner[i] = 1; f.dens[i] = 10; cells.push(i); } }
  beginDay(f);
  stepTick(f);
  assert.ok(f.pockets[1].length >= 1, 'poche détectée');
  const p = f.pockets[1].find((x) => x.cells.includes(cells[12]));
  assert.ok(p, 'la poche contient l\'îlot');
  const before = p.troops;
  stepTick(f);
  const after = f.pockets[1].find((x) => x.id === p.id)?.troops ?? 0;
  assert.ok(after < before, 'la poche perd des troupes');
  assert.ok(f.log.some((l) => /Encerclement/.test(l.text)), 'encerclement annoncé');
});

test('rôles : réserves de l\'attaquant, retranchement inégal du défenseur, objectif en villes', () => {
  for (const attacker of ['DE', 'SU']) {
    const f = createFront({ seed: 'roles', attacker });
    const att = attacker === 'DE' ? 0 : 1, def = 1 - att;
    assert.equal(f.reserve[att], Math.round(FRONT_SETUP.reserve[att] * FRONT_SETUP.attackReserve));
    assert.equal(f.reserve[def], FRONT_SETUP.reserve[def]);
    let dug = 0, attDug = 0;
    const levels = new Set();
    for (let i = 0; i < f.map.N; i++) {
      if (f.entrench[i] > 0) { if (f.owner[i] === def) dug++; else attDug++; levels.add(Math.round(f.entrench[i] * 10)); }
    }
    assert.ok(dug > 100, 'le défenseur est retranché');
    assert.equal(attDug, 0, 'l\'attaquant ne l\'est pas');
    assert.ok(levels.size > 3, 'fortifications inégales (points faibles)');
    assert.equal(f.goal, Math.max(1, Math.ceil(f.defTowns.length / 2)));
  }
});

test('fin de l\'offensive : sans villes prises, le défenseur a tenu', () => {
  const f = createFront({ seed: 'fin', attacker: 'DE', days: 2 });
  f.reserve = [0, 0];
  while (!f.result) runDay(f);
  assert.equal(f.result.winner, 1, f.result.reason);
  assert.match(f.result.reason, /a tenu/);
});
