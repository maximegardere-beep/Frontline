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

const pt = (f, i) => ({ x: f.centers.x[i], y: f.centers.y[i] });
const sideFront = (f, side, row) => {
  const { W, nb, N } = f.map;
  let best = -1, bd = Infinity;
  for (let i = 0; i < N; i++) {
    if (f.owner[i] !== side) continue;
    let c = false;
    for (let d = 0; d < 6; d++) { const j = nb[i * 6 + d]; if (j >= 0 && f.owner[j] === 1 - side) c = true; }
    if (!c) continue;
    const dd = Math.abs(Math.floor(i / W) - row);
    if (dd < bd) { bd = dd; best = i; }
  }
  return best;
};

test('ligne de défense : retranchement complet au soir, les troupes s\'y portent', async () => {
  const { addLine } = await import('../src/front.js');
  const f = createFront({ seed: 'ord', attacker: 'SU' });
  f.reserve = [0, 0];
  const a = pt(f, sideFront(f, 0, 20)), b = pt(f, sideFront(f, 0, 40));
  const line = addLine(f, 0, { x: a.x - 2, y: a.y }, { x: b.x - 2, y: b.y });
  assert.ok(!line.error && line.cells.length > 20, line.error);
  const before = line.cells.reduce((s, i) => s + f.dens[i], 0);
  runDay(f);
  assert.ok(line.cells.every((i) => f.owner[i] !== 0 || f.entrench[i] > 0.95), 'retranchée au soir');
  assert.ok(line.cells.reduce((s, i) => s + f.dens[i], 0) > before, 'renforcée');
  const east = pt(f, 32 * f.map.W + f.map.W - 8), east2 = pt(f, 44 * f.map.W + f.map.W - 8);
  assert.ok(addLine(f, 0, east, east2).error, 'pas de ligne en territoire ennemi');
});

test('barrage de zone : densité et fortifications ennemies entamées, portée limitée', async () => {
  const { addBarrage } = await import('../src/front.js');
  const f = createFront({ seed: 'ord' });
  f.reserve = [0, 0];
  const at = pt(f, sideFront(f, 1, 32));
  const zone = () => { let d = 0; for (let i = 0; i < f.map.N; i++) if (f.owner[i] === 1 && Math.hypot(f.centers.x[i] - at.x, f.centers.y[i] - at.y) <= 3) d += f.dens[i]; return d; };
  const d0 = zone();
  assert.ok(!addBarrage(f, 0, at).error);
  assert.ok(addBarrage(f, 0, { x: at.x + 30, y: at.y }).error, 'hors de portée');
  beginDay(f);
  for (let t = 0; t < 6; t++) stepTick(f);
  assert.ok(zone() < d0 * 0.88, `densité ${d0.toFixed(0)} → ${zone().toFixed(0)}`);
});

test('repli ordonné : moins de pertes qu\'en tenant face à une percée', () => {
  const losses = (retreat) => {
    const f = createFront({ seed: 'ord', attacker: 'SU' });
    f.reserve = [0, 0];
    const su = sideFront(f, 1, 32);
    addVector(f, 1, 'armor', su, { x: pt(f, su).x - 35, y: pt(f, su).y });
    if (retreat) {
      const de = sideFront(f, 0, 32);
      assert.ok(!addVector(f, 0, 'retreat', de, { x: pt(f, de).x - 12, y: pt(f, de).y }).error);
      assert.ok(addVector(f, 0, 'retreat', de, { x: pt(f, de).x + 20, y: pt(f, de).y }).error, 'un repli va vers ses lignes');
    }
    runDay(f);
    return f.stats.losses[0];
  };
  const hold = losses(false), back = losses(true);
  assert.ok(back < hold * 0.8, `repli ${back.toFixed(0)} contre ${hold.toFixed(0)}`);
});

test('poches : statu quo, Festung (fond moins vite), percée d\'évasion (dégage la poche)', async () => {
  const { setPocketMode } = await import('../src/front.js');
  const run = (mode) => {
    const f = createFront({ seed: 'poche2' });
    const { W, H } = f.map;
    f.reserve = [0, 0];
    for (let r = H / 2 - 3; r <= H / 2 + 3; r++) for (let c = 30; c <= 36; c++) { const i = r * W + c; if (f.owner[i] === 0) { f.owner[i] = 1; f.dens[i] = 8; } }
    runDay(f);
    const p = [...f.pockets[1]].sort((a, b) => b.troops - a.troops)[0];
    if (mode !== 'hold') assert.ok(!setPocketMode(f, 1, p.id, mode, { x: f.centers.x[(H / 2) * W + W - 10], y: f.centers.y[(H / 2) * W] }).error);
    runDay(f);
    runDay(f);
    return f.pockets[1].find((x) => x.id === p.id)?.troops ?? null;
  };
  const hold = run('hold'), festung = run('festung'), out = run('breakout');
  assert.ok(festung > hold * 1.2, `Festung ${festung?.toFixed(0)} contre ${hold?.toFixed(0)}`);
  assert.equal(out, null, 'la percée d\'évasion dégage la poche');
});

test('météo du jour : tirage selon le mois, persistance, effets', async () => {
  const { FRONT_WEATHER, applyWeather, computeVision, visionRange } = await import('../src/front.js');
  const tally = (season) => {
    const c = {};
    for (let k = 0; k < 40; k++) {
      const f = createFront({ seed: `meteo${k}`, season, days: 6 });
      f.reserve = [0, 0];
      for (let d = 0; d < 5; d++) { c[f.weather] = (c[f.weather] ?? 0) + 1; runDay(f); }
    }
    return c;
  };
  const july = tally(0), nov = tally(4);
  assert.ok(!july.snow, 'pas de neige en juillet');
  assert.ok(nov.snow > 20, `neige en novembre : ${nov.snow}`);
  assert.ok(july.clear > nov.clear, 'juillet plus clair que novembre');

  const f = createFront({ seed: 'meteo-x' });
  const seen = (w) => { f.weather = w; applyWeather(f); let n = 0; for (const v of computeVision(f, 0)) n += v; return n; };
  assert.ok(seen('fog') < seen('rain') && seen('rain') < seen('clear'), 'le brouillard et la pluie réduisent la reconnaissance');
  f.weather = 'fog';
  assert.equal(visionRange(f), 2);

  const marsh = [...f.map.kind].findIndex((k) => k === 2);
  if (marsh >= 0) {
    f.weather = 'clear'; applyWeather(f);
    const wet = f.map.flow[marsh];
    f.weather = 'snow'; applyWeather(f);
    assert.ok(f.map.flow[marsh] > wet * 2, 'marais gelé praticable');
  }
  assert.equal(Object.keys(FRONT_WEATHER).length, 4);
});

test('biomes de la micro-grille : steppe ouverte, bocage boisé, Polésie marécageuse, bourg à grande ville', () => {
  const share = (biome, k) => {
    let n = 0, tot = 0;
    for (let s = 0; s < 4; s++) { const m = generateFrontMap(`bio${s}`, { biome }); for (const x of m.kind) { tot++; if (x === k) n++; } }
    return n / tot;
  };
  assert.ok(share('bocage', 1) > 4 * share('steppe', 1), 'forêt : bocage ≫ steppe');
  assert.ok(share('polesie', 2) > 5 * share('steppe', 2), 'marais : Polésie ≫ steppe');
  const m = generateFrontMap('bio0', { biome: 'bourg' });
  const city = m.towns.find((t) => t.city);
  assert.ok(city, 'une grande ville');
  let around = 0;
  for (let d = 0; d < 6; d++) if (m.kind[m.nb[city.i * 6 + d]] === 3) around++;
  assert.equal(around, 6, 'la grande ville couvre ses abords');
});
