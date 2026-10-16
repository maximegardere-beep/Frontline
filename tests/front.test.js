import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFront, runDay, beginDay, stepTick, addVector, troops, FRONT_SETUP, applyWeather } from '../src/front.js';
import { generateFrontMap } from '../src/mapgen.js';
import { MOUNTAIN, computeTerrain } from '../src/terrain.js';
// Moyens placés d'office (sans tirage des atouts) : tests de physique sur des formations et des groupes connus.
const LEGACY = { atouts: false, hq: false };
const computeTerrainFor = (f) => computeTerrain(f.map, false);
const cellAtPointOf = (f, p) => { let best = -1, bd = Infinity; for (let i = 0; i < f.map.N; i++) { const d = Math.hypot(f.centers.x[i] - p.x, f.centers.y[i] - p.y); if (d < bd) { bd = d; best = i; } } return best; };
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

test('percée : sans feux elle piétine ; barrage et aviation sur le même point ébranlent la défense et l\'ouvrent', async () => {
  const { addBarrage } = await import('../src/front.js');
  const { addAirMission } = await import('../src/frontair.js');
  // Deux journées de percée blindée au même endroit, avec ou sans préparation (barrage puis appui aérien sur le départ).
  const run = (setup, prep) => {
    const f = createFront({ seed: 'bench1', setup: LEGACY });
    f.weather = 'clear'; applyWeather(f); f.rng.chance = () => true;
    const row = Math.floor(f.map.H / 2), W = f.map.W;
    setup(f, row, W);
    let first = 0, shock = 0;
    for (let d = 0; d < 2; d++) {
      f.reserve = [0, 0];
      const from = frontCell(f, row);
      addVector(f, 0, 'armor', from, { x: f.centers.x[from] + 40, y: f.centers.y[from] });
      const at = { x: f.centers.x[from] + 2.5, y: f.centers.y[from] };
      if (prep) { assert.ok(!addBarrage(f, 0, at).error); assert.ok(!addAirMission(f, 0, at).error); }
      beginDay(f);
      while (f.phase === 'resolve') { stepTick(f); shock = Math.max(shock, ...f.shock); if (!first && f.stats.captured[0] >= 3) first = f.clock; }
    }
    return { captured: f.stats.captured[0], first: first || Infinity, lost: f.stats.losses[0], killed: f.stats.losses[1], shock };
  };
  const band = (f, row, W, e) => { for (let i = 0; i < f.map.N; i++) if (Math.abs(Math.floor(i / W) - row) <= 6 && f.owner[i] === 1) f.entrench[i] = e; };
  const massed = (f, row, W) => {
    band(f, row, W, 1);
    const from = frontCell(f, row);
    for (let dc = 1; dc < 8; dc++) if (f.owner[from + dc] === 1) { f.dens[from + dc] += f.reserve[1]; f.reserve[1] = 0; break; }
  };
  const fortBare = run((f, row, W) => band(f, row, W, 1), false);
  const fortFired = run((f, row, W) => band(f, row, W, 1), true);
  const weakBare = run((f, row, W) => band(f, row, W, 0), false);
  const massBare = run(massed, false), massFired = run(massed, true);
  // Sans feux : un secteur fortifié ne cède que quelques cases, et l'assaut coûte bien plus à l'attaquant.
  assert.equal(fortBare.shock, 0);
  assert.ok(fortBare.captured <= 8, `fortifié sans feux : ${fortBare.captured} cases`);
  assert.ok(fortBare.lost > fortBare.killed * 1.3, `assaut sans feux coûteux (${fortBare.lost.toFixed(0)} contre ${fortBare.killed.toFixed(0)})`);
  // Préparé : le choc ouvre la ligne vite et loin.
  assert.ok(fortFired.shock > 0.5, `choc des feux (${fortFired.shock.toFixed(2)})`);
  assert.ok(fortFired.captured >= fortBare.captured * 3, `préparé : ${fortFired.captured} cases contre ${fortBare.captured}`);
  assert.ok(fortFired.first < fortBare.first, `préparé : brèche plus tôt (${fortFired.first} contre ${fortBare.first} ticks)`);
  // Point faible : il cède même sans feux ; un secteur renforcé tient sans feux, et saigne sous les feux.
  assert.ok(weakBare.captured > fortBare.captured * 2, `point faible : ${weakBare.captured} cases`);
  assert.equal(massBare.captured, 0, 'secteur renforcé, sans feux : rien');
  assert.ok(massFired.killed > massBare.killed * 3, 'secteur renforcé sous les feux : lourdes pertes');
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

test('rôles : réserves de l\'attaquant, retranchement inégal du défenseur', () => {
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
  const f = createFront({ seed: 'ord', setup: LEGACY });
  const mine = f.guns.filter((g) => g.side === 0);
  assert.equal(mine.length, FRONT_SETUP.guns[0].length + FRONT_SETUP.attackGuns.length, 'groupes de départ, plus l\'artillerie de rupture de l\'attaquant');
  assert.equal(f.guns.filter((x) => x.side === 1).length, FRONT_SETUP.guns[1].length, 'le défenseur n\'en a pas');
  assert.equal(f.cfg.sorties[0], FRONT_SETUP.sorties[0] + FRONT_SETUP.attackSorties, 'une sortie aérienne de plus pour l\'attaquant');
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
    return { captured: f.stats.captured[0], lost: f.stats.losses[0] };
  };
  const open = take(0), wired = take(1);
  assert.ok(wired.captured <= open.captured && wired.lost > open.lost, `barbelés : ${wired.captured} cases prises contre ${open.captured}, pertes ${wired.lost.toFixed(0)} contre ${open.lost.toFixed(0)}`);
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
    applyWeather(g);
    assert.equal(g.map.bridge[b], 2);
    assert.ok(g.map.flowA[b] < before * 0.3, 'plus de pont : les blindés ne passent plus');
    assert.equal(g.owner[b], -1, 'plus de pont : la case d\'eau n\'appartient plus à personne');
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

test('terrain : fleuve continu, ponts sur les routes, cols ; blindés freinés hors route', async () => {
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
  // Terrain selon le type : l'eau est infranchissable hors des ponts ; le gel ouvre le fleuve.
  const w = [...water].find((i) => !m.bridge[i]);
  assert.equal(m.flow[w], 0, 'rivière infranchissable');
  assert.equal(m.flowA[w], 0, 'rivière infranchissable aux blindés');
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

test('rivières : tracé libre, ponts seuls passages, gel, pont de bateaux ; ruisseaux', async () => {
  const { addPontoon, addBarrage, waterOpen } = await import('../src/front.js');
  const { barrageWorks } = await import('../src/frontworks.js');
  const { STREAM } = await import('../src/terrain.js');
  const edgeOf = (m, i) => { const c = i % m.W, r = Math.floor(i / m.W); return r === 0 ? 'n' : r === m.H - 1 ? 's' : c === 0 ? 'o' : c === m.W - 1 ? 'e' : null; };
  let rivers = 0, streams = 0;
  for (const seed of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) {
    const f = createFront({ seed, biome: 'polesie' });
    const m = f.map;
    streams += m.streams.length;
    for (const st of m.streams) assert.ok(st.cells.every((i) => m.stream[i] && !m.river[i]), 'un ruisseau est de la terre ferme');
    if (!m.rivers.length) continue;
    rivers++;
    const r = m.rivers[0];
    // Elle entre par un bord et sort par un autre.
    const ends = new Set([edgeOf(m, r.cells[0]), edgeOf(m, r.cells[r.cells.length - 1])]);
    assert.ok(ends.size === 2 && !ends.has(null), `d'un bord à un autre (${[...ends]})`);
    // Au moins deux ponts, chacun sur une route ; ailleurs, l'eau n'appartient à personne.
    let decks = 0;
    for (const i of r.cells) {
      if (m.bridge[i] === 1) { assert.ok(m.road[i], 'un pont porte une route'); assert.ok(f.owner[i] >= 0, 'un pont se tient'); if (![0, 1, 2, 3, 4, 5].some((d) => m.nb[i * 6 + d] >= 0 && m.bridge[m.nb[i * 6 + d]] === 1 && m.nb[i * 6 + d] < i)) decks++; }
      else assert.equal(f.owner[i], -1, 'eau sans pont : à personne');
    }
    assert.ok(decks >= 2, `au moins deux ponts (${decks})`);
    // Pas de poche au départ : la ligne épouse la rivière.
    assert.equal(f.pockets[0].length + f.pockets[1].length, 0, 'aucune poche au premier jour');
  }
  assert.ok(rivers >= 3 && streams >= 6, `rivières ${rivers}, ruisseaux ${streams}`);

  // Une journée d'assaut ne fait passer personne sur l'eau.
  const f = createFront({ seed: 'r1', biome: 'polesie', attacker: 'DE' });
  assert.ok(f.map.rivers.length);
  const water = [...Array(f.map.N).keys()].filter((i) => f.map.river[i] && f.map.bridge[i] !== 1);
  for (let d = 0; d < 2; d++) runDay(f);
  assert.ok(water.every((i) => f.owner[i] === -1), 'l\'eau reste infranchissable');
  // Le gel ouvre la rivière, le dégel la referme (ses occupants refluent).
  f.weather = 'snow'; applyWeather(f);
  assert.ok(water.some((i) => f.owner[i] >= 0), 'rivière gelée : on la tient');
  const k = water.find((i) => f.owner[i] >= 0);
  f.dens[k] = 5;
  const holder = f.owner[k], before = troops(f, holder) + f.stats.losses[holder];
  f.weather = 'clear'; applyWeather(f);
  assert.equal(f.owner[k], -1, 'dégel : la case redevient de l\'eau');
  assert.ok(Math.abs(troops(f, holder) + f.stats.losses[holder] - before) < 1e-3, 'ses occupants refluent (ou sont perdus)');

  // Pont de bateaux : commandé le matin au bord de ses lignes, jeté la nuit, coulé par un barrage.
  const g = createFront({ seed: 'r1', biome: 'polesie', attacker: 'DE' });
  g.reserve = [0, 0];
  let spot = -1, side = -1;
  for (const i of [...Array(g.map.N).keys()]) {
    if (!g.map.river[i] || waterOpen(g, i)) continue;
    const near = [0, 1, 2, 3, 4, 5].map((d) => g.map.nb[i * 6 + d]).filter((j) => j >= 0 && !g.map.river[j]);
    const sides = new Set(near.map((j) => g.owner[j]));
    if (sides.has(0)) { spot = i; side = 0; break; }
  }
  assert.ok(spot >= 0);
  const o = addPontoon(g, side, { x: g.centers.x[spot], y: g.centers.y[spot] });
  assert.ok(!o.error, o.error);
  assert.ok(addPontoon(g, side, { x: g.centers.x[spot], y: g.centers.y[spot] }).error, 'un par nuit');
  runDay(g);
  assert.ok(o.cells.every((c) => g.map.bridge[c] === 1 && g.map.pontoon[c] && g.owner[c] === side), 'pont de bateaux jeté');
  assert.equal(g.pontoons[side], g.cfg.pontoons[side] - 1);
  for (let t = 0; t < 5; t++) for (const c of o.cells) barrageWorks(g, c, 1, false);
  applyWeather(g);
  assert.ok(o.cells.every((c) => g.map.bridge[c] === 0 && !g.map.pontoon[c] && g.owner[c] === -1), 'coulé par un barrage');
  void addBarrage;

  // Ruisseau : progression ralentie, défense accrue.
  const m = generateFrontMap('ruisseau', { biome: 'polesie' });
  const st = [...Array(m.N).keys()].find((i) => m.stream[i] && !m.road[i] && m.kind[i] === 0 && m.elev[i] === 1);
  if (st !== undefined) {
    const plain = [...Array(m.N).keys()].find((i) => !m.stream[i] && !m.river[i] && !m.road[i] && m.kind[i] === 0 && m.elev[i] === 1);
    assert.ok(Math.abs(m.flow[st] - m.flow[plain] * STREAM.flow) < 1e-6, 'ruisseau : progression ralentie');
    assert.ok(Math.abs(m.def[st] - m.def[plain] * STREAM.def) < 1e-6, 'ruisseau : défense accrue');
  }
});

test('IA : un saillant en passe d\'être encerclé décroche vers son goulot (pré-encerclement)', async () => {
  const { planFront, preEncirclement, AI_TUNING } = await import('../src/frontai.js');
  const { findPockets } = await import('../src/path.js');
  // Saillant allemand (défenseur) étroit, enfoncé de 18 colonnes, flanqué de troupes soviétiques denses.
  const make = (salient) => {
    const f = createFront({ seed: 'saillant', playerSide: null, attacker: 'SU' });
    const { W, H, N } = f.map;
    const mid = Math.floor(H / 2);
    let c0 = 0;
    for (let c = 0; c < W; c++) if (f.owner[mid * W + c] === 0) c0 = c;
    if (salient) {
      for (let r = mid - 3; r <= mid + 3; r++) for (let c = c0; c < c0 + 18; c++) { const i = r * W + c; if (f.owner[i] === 1) { f.owner[i] = 0; f.dens[i] = 12; } }
      for (let r = mid - 8; r <= mid + 8; r++) for (let c = c0; c < c0 + 20; c++) { const i = r * W + c; if (f.owner[i] === 1) f.dens[i] = 25; }
    }
    f.memory[0].owner.set(f.owner);
    for (let i = 0; i < N; i++) f.memory[0].est[i] = f.owner[i] === 1 ? f.dens[i] : 0;
    f.supplied[0] = findPockets(f.map, f.owner, 0, 0).supplied;
    return f;
  };
  assert.equal(preEncirclement(make(false), 0).length, 0, 'front ordinaire : rien à craindre');
  const f = make(true);
  const [z] = preEncirclement(f, 0);
  assert.ok(z && z.troops > 100 && z.foe >= z.troops * AI_TUNING.acute, 'saillant menacé repéré');
  assert.equal(f.owner[cellAtPointOf(f, z.exit)], 0, 'la sortie est dans nos lignes');
  const odds = AI_TUNING.retreatOdds;
  AI_TUNING.retreatOdds = 1;
  try { planFront(f, 0); } finally { AI_TUNING.retreatOdds = odds; }
  const retreats = f.orders[0].filter((v) => v.type === 'retreat' && z.cells.includes(v.fromI));
  assert.ok(retreats.length >= 1, 'décrochage depuis le saillant');
  assert.ok(retreats.every((v) => Math.hypot(v.to.x - z.exit.x, v.to.y - z.exit.y) < Math.hypot(v.from.x - z.exit.x, v.from.y - z.exit.y)), 'vers le goulot');
  // Plus de ligne de défense au goulot : les ouvrages viennent des bataillons de soutien (atouts).
  assert.ok(!f.orders[0].some((v) => v.type === 'infantry' && z.cells.includes(v.fromI)), 'pas d\'attaque depuis le saillant évacué');
});

test('alerte SOS : un secteur qui perd plusieurs cases en quelques heures appelle à l\'aide, puis se tait', async () => {
  const { noteLosses, crackingSectors, updateAlerts, ALERT } = await import('../src/frontalert.js');
  const f = createFront({ seed: 'sos', attacker: 'DE' });
  const row = Math.floor(f.map.H / 2);
  // L'Armée rouge perd ALERT.score cases voisines (deux lignes), dans le même tick.
  const lost = [];
  for (const r of [row, row + 1]) {
    const i = frontCell(f, r);
    for (let k = 1; k <= Math.ceil(ALERT.score / 2); k++) { const j = i + k; if (f.owner[j] === 1) { f.owner[j] = 0; lost.push(j); } }
  }
  assert.ok(lost.length >= ALERT.score);
  noteLosses(f, lost.map((j) => ({ kind: 'capture', i: j, side: 0 })));
  const sec = crackingSectors(f, 1);
  assert.equal(sec.length, 1, 'un secteur qui craque');
  assert.equal(f.owner[cellAtPointOf(f, sec[0])], 1, 'l\'officier parle depuis ses lignes');
  assert.equal(crackingSectors(f, 0).length, 0, 'le camp qui avance n\'appelle pas à l\'aide');
  const alerts = [];
  assert.equal(updateAlerts(f, 1, alerts).length, 1, 'nouvelle alerte (son)');
  assert.equal(updateAlerts(f, 1, alerts).length, 0, 'pas deux fois la même');
  // Le secteur se calme : les pertes sortent de la fenêtre, l'alerte reste encore quelques heures, puis disparaît.
  const tick = () => { f.clock++; noteLosses(f, []); updateAlerts(f, 1, alerts); };
  for (let t = 0; t < ALERT.window; t++) tick();
  assert.equal(crackingSectors(f, 1).length, 0, 'plus de pertes récentes');
  assert.equal(alerts.length, 1, 'elle s\'estompe encore');
  for (let t = 0; t < ALERT.hold + 1; t++) tick();
  assert.equal(alerts.length, 0, 'puis disparaît');
});

test('formations blindées : en réserve sans ordre, elles percent vers leur objectif, perdent des chars, se ravitaillent', async () => {
  const { setArmorOrder } = await import('../src/frontarmor.js');
  const f = createFront({ seed: 'panzer', attacker: 'DE', biome: 'steppe', setup: LEGACY });
  f.reserve = [0, 0];
  const a = f.armor.find((x) => x.side === 0);
  assert.ok(a && f.owner[a.cell] === 0, 'formation dans ses lignes');
  const quiet = createFront({ seed: 'panzer', attacker: 'DE', biome: 'steppe', setup: LEGACY });
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

test('regroupement de nuit : la route porte plus loin et davantage, transfert annulable, état-major la nuit', async () => {
  const { NIGHT, transferPath, addTransfer } = await import('../src/frontnight.js');
  const { removeOrder } = await import('../src/front.js');
  const f = createFront({ seed: 'nuit2', attacker: 'DE', biome: 'steppe' });
  // Deux cases d'une même route, dans les lignes allemandes, à 12 cases l'une de l'autre.
  const road = f.map.roads.map((r) => r.filter((i) => f.owner[i] === 0)).find((r) => r.length > 14);
  assert.ok(road, 'une route dans les lignes allemandes');
  const a = road[0], b = road[12];
  const p = transferPath(f, 0, a, b);
  assert.ok(p && p.road && p.cost <= NIGHT.reach, `par la route : coût ${p?.cost.toFixed(2)}`);
  // Le même trajet à travers champs serait hors de portée d'une nuit.
  assert.ok(12 > NIGHT.reach, 'douze cases de steppe dépassent une nuit de marche');
  for (const i of road.slice(0, 3)) f.dens[i] += 80;
  const total = () => f.dens.reduce((x, v) => x + v, 0);
  const t0 = total();
  const t = addTransfer(f, 0, a, b);
  assert.ok(!t.error, t.error);
  assert.ok(t.amount > NIGHT.cap.field && t.amount <= NIGHT.cap.road, `transporté : ${t.amount.toFixed(1)}`);
  assert.ok(Math.abs(total() - t0) < 1e-3, 'rien ne se perd en route');
  const before = f.dens[b];
  removeOrder(f, 0, t.id);
  assert.ok(f.dens[b] < before && f.transfers[0].length === 0, 'transfert annulé');
  // La nuit, l'état-major peut regrouper (aucune erreur, transferts notés pour l'aube).
  runDay(f);
  assert.ok(Array.isArray(f.nightMoves));
});

test('aviation : sorties par jour, la DCA sur la route émousse la mission et se dévoile, brouillard au sol', async () => {
  const { AIR, addAirMission, airTick, sortiesToday } = await import('../src/frontair.js');
  const f = createFront({ seed: 'air', attacker: 'DE', biome: 'steppe', setup: LEGACY });
  f.weather = 'clear';
  assert.equal(sortiesToday(f, 0), f.cfg.sorties[0]);
  // Cible : une case soviétique au contact ; une DCA soviétique posée sur la route des avions.
  const t = sideFront(f, 1, 32);
  const m = addAirMission(f, 0, { x: f.centers.x[t], y: f.centers.y[t] });
  assert.equal(m.kind, 'strike');
  const aa = f.aa.find((a) => a.side === 1);
  aa.x = f.centers.x[t] - 3; aa.y = f.centers.y[t];
  for (let k = 1; k < f.cfg.sorties[0]; k++) addAirMission(f, 0, { x: f.centers.x[t], y: f.centers.y[t] + 8 * k });
  assert.ok(addAirMission(f, 0, { x: 5, y: 5 }).error, 'plus de sortie');
  const before = f.dens[t];
  f.phase = 'resolve';
  for (let tick = 0; tick <= AIR.strikeTicks.at(-1); tick++) { f.tick = tick; airTick(f, []); }
  assert.ok(m.power < 1, 'la DCA a émoussé la mission');
  assert.ok(aa.seen[0], 'en tirant, la DCA s\'est dévoilée');
  assert.ok(f.dens[t] < before, 'la zone a été frappée');
  // Brouillard : au sol.
  const g = createFront({ seed: 'air', attacker: 'DE' });
  g.weather = 'fog';
  assert.equal(sortiesToday(g, 0), 0);
  assert.ok(addAirMission(g, 0, { x: 10, y: 10 }).error);
});
