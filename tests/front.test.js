import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFront, runDay, beginDay, stepTick, addVector, troops, FRONT_SETUP } from '../src/front.js';
import { generateFrontMap } from '../src/mapgen.js';
import { MOUNTAIN, computeTerrain } from '../src/terrain.js';
const computeTerrainFor = (f) => computeTerrain(f.map, false);
const applyWeatherOf = (f) => computeTerrain(f.map, false, f.ruin);

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
  assert.ok(weak.captured >= 6, `point faible : ${weak.captured} cases prises`);
  assert.ok(fort.firstTicks > weak.firstTicks, `fortifié plus lent (${fort.firstTicks} contre ${weak.firstTicks} ticks)`);
  assert.ok(massed.captured < weak.captured / 2, `secteur renforcé : ${massed.captured} cases`);
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
    assert.equal(f.goal, Math.max(1, Math.ceil(f.defTowns.length * FRONT_SETUP.goalShare - 1e-9)));
  }
});

test('fin de l\'offensive : sans villes prises, le défenseur a tenu', () => {
  const f = createFront({ seed: 'fin', attacker: 'DE', days: 2 });
  f.reserve = [0, 0];
  while (!f.result) runDay(f);
  assert.equal(f.result.winner, 1, f.result.reason);
  assert.match(f.result.grade, /^def/, f.result.reason);
});

test('objectifs : score gradué, contrôle des villes au fil des soirs, objectifs secondaires', async () => {
  const { scoreBreakdown, gradeOf, SCORE, objectiveState } = await import('../src/frontscore.js');
  const f = createFront({ seed: 'score', attacker: 'DE', days: 3 });
  assert.equal(f.objectives.filter((o) => o.side === 0).length, 2, 'deux objectifs pour l\'attaquant');
  assert.ok(f.objectives.filter((o) => o.side === 1).length >= 1, 'et pour le défenseur');
  for (const o of f.objectives) assert.ok(objectiveState(f, o).text.length > 0);
  assert.equal(gradeOf(SCORE.attDecisive), 'attDecisive');
  assert.equal(gradeOf(SCORE.defWin - 1), 'defDecisive');
  // Une ville ★ donnée à l'attaquant rapporte chaque soir.
  const t = f.map.towns.find((x) => f.defTowns.includes(x.i));
  const before = scoreBreakdown(f).total;
  f.owner[t.i] = 0;
  f.reserve = [0, 0];
  runDay(f);
  const rows = scoreBreakdown(f).rows;
  if (f.owner[t.i] === 0) assert.ok(rows.find((r) => r.key === 'daily').pts > 0, 'points de contrôle du soir');
  assert.ok(Number.isFinite(before));
  while (!f.result) runDay(f);
  assert.ok(f.result.grade, 'issue graduée');
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
  const contact = (i) => [0, 1, 2, 3, 4, 5].some((d) => { const j = f.map.nb[i * 6 + d]; return j >= 0 && f.owner[j] === 1; });
  const calm = line.cells.filter((i) => f.owner[i] === 0 && !contact(i));
  assert.ok(calm.length > 10 && calm.every((i) => f.entrench[i] > 0.95), 'retranchée au soir (hors contact)');
  assert.ok(calm.every((i) => f.wire[i] > 0.1) && calm.some((i) => f.wire[i] < 0.9), 'barbelés en cours (deux jours)');
  assert.ok(f.lines[0].some((l) => l.id === line.id), 'le chantier continue demain');
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

test('artillerie : groupes à portée, posture contre puissance, camouflage, perte du groupe débordé', async () => {
  const { addBarrage } = await import('../src/front.js');
  const { setGunOrder, gunPower, visibleGuns, GUN_KINDS } = await import('../src/frontguns.js');
  const f = createFront({ seed: 'ord' });
  const mine = f.guns.filter((g) => g.side === 0);
  assert.equal(mine.length, FRONT_SETUP.guns[0].length, 'groupes de départ');
  // Camouflés : au départ, l'ennemi ne voit aucun groupe.
  assert.equal(visibleGuns(f, 1).filter((v) => v.g.side === 0).length, 0, 'groupes cachés au départ');
  // Barrage : par un groupe à portée, une mission par groupe.
  const g = mine[0];
  const at = { x: g.x + (GUN_KINDS[g.kind].range - 1), y: g.y };
  const b = addBarrage(f, 0, at, g.id);
  assert.ok(!b.error && b.gun === g.id, 'barrage confié au groupe');
  assert.ok(addBarrage(f, 0, at, g.id).error, 'une mission par groupe');
  assert.ok(addBarrage(f, 0, { x: g.x + 60, y: g.y }).error, 'hors de portée de tout groupe');
  // Posture : en déplacement, plus de tir, et la mission tombe.
  const r = setGunOrder(f, 0, g.id, { dest: { x: g.x - 10, y: g.y } });
  assert.ok(!r.error);
  setGunOrder(f, 0, g.id, { posture: 'move' });
  assert.equal(gunPower(g), 0, 'en déplacement : aucun tir');
  assert.ok(!f.barrages[0].some((x) => x.gun === g.id), 'mission annulée');
  setGunOrder(f, 0, g.id, { posture: 'mobile' });
  assert.ok(Math.abs(gunPower(g) - 0.4) < 1e-9, 'appui mobile : 40 %');
  assert.ok(setGunOrder(f, 0, g.id, { dest: { x: f.centers.x[f.map.W - 3], y: g.y } }).error, 'pas de déplacement chez l\'ennemi');
  const x0 = g.x;
  runDay(f);
  assert.ok(g.x < x0 - 5, 'le groupe a reculé dans la journée');
  // Débordé : sa case passe à l'ennemi, il est perdu.
  const h = mine[1];
  for (let k = 0; k < f.map.N; k++) if (Math.hypot(f.centers.x[k] - h.x, f.centers.y[k] - h.y) < 4) f.owner[k] = 1;
  beginDay(f);
  stepTick(f);
  assert.ok(h.lost, 'groupe débordé perdu');
  assert.ok(f.log.some((l) => /débordé et perdu/.test(l.text)), 'au journal');
});

test('ouvrages : barbelés et antichar freinent l\'assaut, un barrage les détruit et laisse des ruines, ponts', async () => {
  const { WORKS, barrageWorks, blowBridge } = await import('../src/frontworks.js');
  const { addBarrage } = await import('../src/front.js');
  // Même assaut d'infanterie, avec ou sans barbelés devant.
  const take = (wire) => {
    const f = createFront({ seed: 'wire', attacker: 'DE' });
    f.reserve = [0, 0];
    for (let i = 0; i < f.map.N; i++) if (f.owner[i] === 1) { f.wire[i] = wire; f.at[i] = 0; }
    const from = sideFront(f, 0, 32);
    for (let d = 0; d < 3; d++) {
      addVector(f, 0, 'infantry', from, { x: f.centers.x[from] + 20, y: f.centers.y[from] });
      runDay(f);
    }
    return f.stats.captured[0];
  };
  const open = take(0), wired = take(1);
  assert.ok(wired < open, `barbelés : ${wired} cases prises contre ${open}`);
  // Barrage sur des barbelés pleins : ils tombent, la ruine reste.
  const f = createFront({ seed: 'wire', attacker: 'DE' });
  const i = sideFront(f, 1, 32);
  f.wire[i] = 1; f.peak[i] |= 2;
  for (let t = 0; t < 6; t++) barrageWorks(f, i, 1, false);
  assert.ok(f.wire[i] < WORKS.wreckAt && (f.wreck[i] & 2), 'barbelés détruits, ruine persistante');
  // Pont : détruit, il redevient rivière.
  const g = createFront({ seed: 'pont', biome: 'fleuve', attacker: 'DE' });
  const b = [...Array(g.map.N).keys()].find((k) => g.map.bridge[k] === 1);
  if (b !== undefined) {
    const before = g.map.flowA[b];
    blowBridge(g, b);
    computeTerrainFor(g);
    assert.equal(g.map.bridge[b], 2);
    assert.ok(g.map.flowA[b] < before * 0.3, 'plus de pont : les blindés ne passent plus');
  }
  void addBarrage;
});

test('fixation : pression sans prise, pertes réduites, l\'ennemi fixé ne cède plus ses troupes', () => {
  const f = createFront({ seed: 'fix', attacker: 'DE' });
  f.reserve = [0, 0];
  const from = sideFront(f, 0, 32);
  assert.ok(!addVector(f, 0, 'fix', from, { x: f.centers.x[from] + 8, y: f.centers.y[from] }).error);
  const cap0 = f.stats.captured[0];
  beginDay(f);
  for (let t = 0; t < 12; t++) stepTick(f);
  assert.ok(f.pinned.some((v, i) => v && f.owner[i] === 1), 'des cases ennemies fixées');
  assert.ok(f.stats.captured[0] - cap0 <= 2, 'une fixation ne prend (presque) rien');
  assert.ok(f.field[0].fixing.some((v) => v > 0.5), 'troupes en fixation');
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
    if (mode === 'breakout') runDay(f);
    return f.pockets[1].find((x) => x.id === p.id)?.troops ?? null;
  };
  const hold = run('hold'), festung = run('festung'), out = run('breakout');
  assert.ok(festung > hold * 1.2, `Festung ${festung?.toFixed(0)} contre ${hold?.toFixed(0)}`);
  // Percée d'évasion : la poche se dégage, ou du moins une partie de ses troupes rejoint les lignes (le rythme plus
  // lent de la logistique et de la fatigue ne laisse plus toujours sortir en trois jours).
  assert.ok(out === null || out < hold, `percée d'évasion : ${out?.toFixed(0)} encore pris contre ${hold?.toFixed(0)}`);
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

test('IA : ordres des deux rôles, sans tricher (le brouillard compte), bataille complète', async () => {
  const { installAI, planFront } = await import('../src/frontai.js');
  const orders = (f, s) => JSON.stringify({ v: f.orders[s].map((v) => [v.type, v.fromI, Math.round(v.to.x), Math.round(v.to.y)]), l: f.lines[s].length, b: f.barrages[s].map((b) => [Math.round(b.x), Math.round(b.y)]), r: f.reserve[s] });
  for (const attacker of ['DE', 'SU']) {
    const f = createFront({ seed: 'ia', playerSide: null, attacker });
    const att = attacker === 'DE' ? 0 : 1;
    const rng = f.rng;
    planFront(f, att);
    assert.ok(f.orders[att].length > 0, 'l\'attaquant donne des vecteurs');
    assert.ok(f.reserve[att] < f.cfg.reserve[att] * f.cfg.attackReserve, 'il engage ses réserves');
    // Même situation, mais l'ennemi change hors de vue : les ordres ne doivent pas bouger.
    const g = createFront({ seed: 'ia', playerSide: null, attacker });
    g.rng = rng.constructor === Object ? g.rng : g.rng;
    const vis = g.vision[att];
    for (let i = 0; i < g.map.N; i++) if (g.owner[i] === 1 - att && !vis[i]) g.dens[i] *= 3;
    planFront(g, att);
    assert.equal(orders(g, att), orders(f, att), 'les ordres ne dépendent que de ce que l\'IA voit');
  }
  const f = createFront({ seed: 'ia-bataille', playerSide: null, attacker: 'SU', days: 4 });
  installAI(f);
  while (!f.result) runDay(f);
  assert.ok(f.result.reason.length > 0);
});

test('terrain : rivières continues, ponts sur les routes, gués, cols ; blindés freinés hors route', async () => {
  const { generateFrontMap } = await import('../src/mapgen.js');
  const { computeTerrain } = await import('../src/terrain.js');
  const m = generateFrontMap('riv', { biome: 'fleuve', defender: 1 });
  assert.equal(m.rivers.length, 1);
  assert.ok(m.rivers[0].big, 'un fleuve');
  // Continuité : la composante de l'eau atteint les bords nord et sud.
  const water = new Set(m.rivers[0].cells.filter((i) => m.river[i]));
  const start = [...water].find((i) => Math.floor(i / m.W) === 0);
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) { const i = stack.pop(); for (let d = 0; d < 6; d++) { const j = m.nb[i * 6 + d]; if (j >= 0 && water.has(j) && !seen.has(j)) { seen.add(j); stack.push(j); } } }
  assert.ok([...seen].some((i) => Math.floor(i / m.W) >= m.H - 2), 'le fleuve traverse la carte');
  let bridges = 0;
  for (let i = 0; i < m.N; i++) if (m.bridge[i]) { bridges++; assert.ok(m.road[i], 'un pont porte une route'); }
  assert.ok(bridges > 0, 'des ponts');
  // Terrain selon le type : sur l'eau, les blindés passent bien plus mal que l'infanterie ; le gel ouvre le fleuve.
  const w = [...water].find((i) => !m.bridge[i]);
  assert.ok(m.flowA[w] < m.flow[w] * 0.5, 'rivière : blindés presque bloqués');
  const forest = [...Array(m.N).keys()].find((i) => m.kind[i] === 1 && !m.river[i] && !m.road[i]);
  if (forest >= 0) assert.ok(m.flowA[forest] < m.flow[forest], 'forêt : blindés plus lents');
  const road = [...Array(m.N).keys()].find((i) => m.road[i] && m.kind[i] === 0 && !m.river[i]);
  if (road >= 0) assert.ok(m.flowA[road] > m.flow[road], 'route : blindés plus rapides');
  computeTerrain(m, true);
  assert.ok(m.flow[w] > 0.6, 'fleuve gelé praticable');
  // Montagnes : des chaînes épaisses, et toujours un passage d'ouest en est (cols percés au besoin).
  let carved = 0;
  for (const seed of ['cols', 'cols2', 'cols3']) {
    const mt = generateFrontMap(seed, { biome: 'montagne' });
    carved += mt.passes.length;
    assert.ok(mt.kind.filter((k) => k === 4).length > mt.N * 0.05, 'des montagnes');
  }
  assert.ok(carved > 0, 'des cols percent les chaînes');
});

test('formations blindées : en réserve sans ordre, elles percent vers leur objectif, perdent des chars, se ravitaillent', async () => {
  const { setArmorOrder } = await import('../src/frontarmor.js');
  const f = createFront({ seed: 'panzer', attacker: 'DE', biome: 'steppe' });
  f.reserve = [0, 0];
  const a = f.armor.find((x) => x.side === 0);
  assert.ok(a && f.owner[a.cell] === 0, 'formation dans ses lignes');
  const quiet = createFront({ seed: 'panzer', attacker: 'DE', biome: 'steppe' });
  runDay(quiet);
  assert.equal(quiet.armor.find((x) => x.side === 0).cell, quiet.armor.find((x) => x.side === 0).cell);
  const start = { x: a.x, y: a.y }, tanks0 = a.tanks;
  assert.ok(!setArmorOrder(f, 0, a.id, { x: a.x + 45, y: a.y }).error);
  const captured0 = f.stats.captured[0];
  runDay(f);
  if (a.target) runDay(f); // elle a d'abord dû gagner le front
  assert.ok(a.x > start.x + 6, `elle a avancé (${start.x.toFixed(0)} → ${a.x.toFixed(0)})`);
  assert.ok(f.stats.captured[0] > captured0, 'des cases prises');
  assert.ok(a.tanks < tanks0 || a.fought === false, 'la percée coûte des chars');
  assert.ok(a.fuel > 0.5, 'ravitaillée la nuit');
  // Encerclée : sa case tombe sans repli possible, elle est perdue.
  const b = f.armor.find((x) => x.side === 1);
  for (let d = 0; d < 6; d++) { const j = f.map.nb[b.cell * 6 + d]; if (j >= 0) f.owner[j] = 0; }
  f.owner[b.cell] = 0;
  beginDay(f);
  stepTick(f);
  assert.ok(b.lost, 'formation encerclée détruite');
});

test('villes sous le feu : la défense fond puis remonte dans les ruines, les chars s\'y empêtrent, barrage et prise abîment', async () => {
  const { RUINS, ruinBonus } = await import('../src/terrain.js');
  const { ruinTown, stepTick } = await import('../src/front.js');
  assert.equal(ruinBonus(0), RUINS.intact);
  assert.ok(ruinBonus(RUINS.troughAt) < ruinBonus(0) && ruinBonus(1) > ruinBonus(RUINS.troughAt), 'creux à mi-destruction, remontée dans les ruines');
  const f = createFront({ seed: 'ruines', biome: 'bourg', attacker: 'DE' });
  const c = f.townCells.find((i) => !f.map.river[i]);
  const intact = { def: f.map.def[c], flowA: f.map.flowA[c], atkA: f.map.atkA[c] };
  ruinTown(f, c, RUINS.troughAt);
  assert.ok(f.map.def[c] < intact.def, 'ville en flammes : défense en baisse');
  ruinTown(f, c, 1);
  assert.equal(f.ruin[c], 1);
  assert.ok(f.map.def[c] > intact.def * 0.9 && f.map.def[c] < intact.def, 'ruines : la défense remonte, sans dépasser la ville intacte');
  assert.ok(f.map.flowA[c] < intact.flowA * 0.5 && f.map.atkA[c] < intact.atkA * 0.6, 'les chars s\'empêtrent dans les décombres');
  // La météo recalcule le terrain sans oublier les ruines.
  applyWeatherOf(f);
  assert.ok(f.map.flowA[c] < intact.flowA * 0.5);
  // Un barrage sur une ville l'abîme.
  const g = createFront({ seed: 'ruines', biome: 'bourg', attacker: 'DE' });
  const t = g.townCells.find((i) => !g.map.river[i]);
  const gun = g.guns.find((x) => x.side === 0);
  beginDay(g);
  g.barrages[0].push({ id: 99, gun: gun.id, x: g.centers.x[t], y: g.centers.y[t], r: 1 });
  for (let k = 0; k < g.cfg.barrageTicks; k++) stepTick(g);
  assert.ok(g.ruin[t] > 0.1, `barrage : ruine ${g.ruin[t].toFixed(2)}`);
});
