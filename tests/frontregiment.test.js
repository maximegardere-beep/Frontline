import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFront, beginDay, stepTick, runDay, troops, removeOrder } from '../src/front.js';
import { installAI } from '../src/frontai.js';
import { staffNight } from '../src/frontnight.js';
import { REGIMENT, PRIORITY, regimentsUnderAir, setRegimentOrder, engageRegiment, regimentTick, regimentNight, regimentReady, regimentDens, setPriority, priorityRecover, visibleRegiments, updateRegimentSightings } from '../src/frontregiment.js';

const front = (seed = 'rgt', year = 1943) => createFront({ seed, playerSide: 'DE', attacker: 'DE', year });
const sum = (f, s) => troops(f, s);
const finishDay = (f) => { while (f.phase === 'resolve') stepTick(f); };
const isContact = (f, i) => { for (let d = 0; d < 6; d++) { const j = f.map.nb[i * 6 + d]; if (j >= 0 && f.owner[j] === 1 - f.owner[i]) return true; } return false; };
const put = (f, r, i) => { r.cell = i; r.x = f.centers.x[i]; r.y = f.centers.y[i]; };

test('régiments : trois par camp en 1943, deux en 1941, rassemblés près du PC, pris sur les troupes du départ', () => {
  const f = front();
  const g = createFront({ seed: 'rgt', playerSide: 'DE', attacker: 'DE', year: 1943, setup: { regiments: [0, 0] } });
  for (const s of [0, 1]) {
    const mine = f.regiments.filter((r) => r.side === s);
    assert.equal(mine.length, 3);
    for (const r of mine) {
      assert.equal(f.owner[r.cell], s);
      assert.ok(f.supplied[s][r.cell]);
      assert.ok(Math.hypot(r.x - f.hq[s].x, r.y - f.hq[s].y) < 12, `${r.name} près du PC`);
      assert.equal(r.dens, REGIMENT.men / f.cfg.men);
    }
    // Les hommes des régiments manquent à la ligne, pas au total.
    assert.ok(Math.abs(sum(g, s) - sum(f, s) - 3 * regimentDens(f)) < 1e-2);
    assert.ok(Math.abs(f.initial[s] - g.initial[s]) < 1e-2);
  }
  assert.match(f.regiments[0].name, /^Schützen-Rgt\. \(mot\.\) \d+$/);
  assert.match(f.regiments.find((r) => r.side === 1).name, /^Rgt\. de fusiliers motorisés \d+$/);
  assert.equal(createFront({ seed: 'rgt', playerSide: 'DE', year: 1941 }).regiments.filter((r) => r.side === 0).length, 2);
});

test('régiment : roule vite sur une route, lentement à travers champs', () => {
  const f = front('rgt-route');
  const s = 0;
  // Un tronçon de route à soi, à l'arrière, d'au moins 16 cases.
  let leg = null;
  for (const path of f.map.roads) {
    for (let k = 0; k + 16 < path.length && !leg; k++) {
      const part = path.slice(k, k + 17);
      if (part.every((i) => f.owner[i] === s && f.supplied[s][i] && !isContact(f, i))) leg = part;
    }
    if (leg) break;
  }
  assert.ok(leg, 'une route à l\'arrière');
  const r = f.regiments.find((x) => x.side === s);
  const ticksTo = (g, rg) => {
    beginDay(g);
    for (let t = 1; t <= g.cfg.ticks; t++) { stepTick(g); if (rg.cell === leg[16]) return t; }
    return Infinity;
  };
  put(f, r, leg[0]);
  assert.ok(!setRegimentOrder(f, s, r.id, { x: f.centers.x[leg[16]], y: f.centers.y[leg[16]] }).error);
  assert.ok(r.road, 'chemin par la route');
  const byRoad = ticksTo(f, r);
  assert.ok(byRoad <= 12, `par la route : ${byRoad} ticks`);
  // Même trajet, sans route.
  const g = front('rgt-route');
  g.map.road = new Uint8Array(g.map.N);
  const q = g.regiments.find((x) => x.side === s);
  put(g, q, leg[0]);
  assert.ok(!setRegimentOrder(g, s, q.id, { x: g.centers.x[leg[16]], y: g.centers.y[leg[16]] }).error);
  const byField = ticksTo(g, q);
  assert.ok(byField > byRoad * 2, `à travers champs : ${byField} ticks, par la route ${byRoad}`);
  // Le matin, la destination doit être dans nos lignes ravitaillées.
  const foe = f.map.towns.find((t) => f.owner[t.i] === 1);
  finishDay(f);
  assert.ok(setRegimentOrder(f, s, r.id, { x: f.centers.x[foe.i], y: f.centers.y[foe.i] }).error);
});

test('régiment engagé : ses hommes montent en ligne tout de suite, retour au PC deux jours plus tard sur le pool', () => {
  const f = front('rgt-engage');
  const s = 0;
  const r = f.regiments.find((x) => x.side === s);
  const before = sum(f, s);
  // Trop loin de lui : refusé.
  const far = f.map.towns.find((t) => f.owner[t.i] === s && Math.hypot(f.centers.x[t.i] - r.x, f.centers.y[t.i] - r.y) > REGIMENT.engage + 1);
  assert.ok(engageRegiment(f, s, r.id, { x: f.centers.x[far.i], y: f.centers.y[far.i] }).error);
  const res = engageRegiment(f, s, r.id, { x: r.x + 1, y: r.y });
  assert.ok(!res.error, res.error);
  assert.ok(Math.abs(sum(f, s) - before - r.dens) < 1e-3, 'toute la densité versée');
  assert.equal(regimentReady(r), false);
  assert.equal(r.back, f.day + REGIMENT.rebuild);
  assert.equal(visibleRegiments(f, s).some((v) => v.r === r), false, 'le pion disparaît');
  // Retrait de l'ordre le matin : tout revient.
  removeOrder(f, s, r.engaged.id);
  assert.ok(regimentReady(r));
  assert.ok(Math.abs(sum(f, s) - before) < 1e-3);
  engageRegiment(f, s, r.id);
  // Jour 1, puis jour 2 : il revient au soir du jour 2 (au matin du jour 3), en puisant dans le pool.
  runDay(f);
  assert.equal(regimentReady(r), false, 'pas avant deux jours');
  beginDay(f);
  finishDay(f);
  assert.equal(f.day, 3);
  assert.ok(regimentReady(r), 'reconstitué');
  assert.ok(Math.hypot(r.x - f.hq[s].x, r.y - f.hq[s].y) < 8, 'près du PC');
  // Sans assez d'hommes au pool, il attend.
  engageRegiment(f, s, r.id);
  r.back = f.day + 1;
  f.reserve[s] = regimentDens(f) - 1;
  regimentNight(f);
  assert.equal(regimentReady(r), false, 'le pool n\'y suffit pas');
  f.reserve[s] = regimentDens(f) + 10;
  regimentNight(f);
  assert.ok(regimentReady(r));
  assert.ok(Math.abs(f.reserve[s] - 10) < 1e-6, 'ses hommes sortent du pool');
});

test('régiment débordé : perdu, une part des hommes se sauve ; frappé par l\'aviation ; caché par le brouillard', () => {
  const f = front('rgt-perdu');
  const s = 0;
  const r = f.regiments.find((x) => x.side === s);
  const back = [...f.map.nb.subarray(r.cell * 6, r.cell * 6 + 6)].find((j) => j >= 0 && f.owner[j] === s);
  const d0 = f.dens[back], lost0 = f.stats.losses[s];
  f.owner[r.cell] = 1 - s;
  regimentTick(f);
  assert.equal(r.lost, true);
  const saved = f.dens[back] - d0;
  assert.ok(saved > 0 && Math.abs(saved - r.dens * REGIMENT.escape) < 1e-3, `rescapés : ${saved}`);
  assert.ok(Math.abs(f.stats.losses[s] - lost0 - r.dens * (1 - REGIMENT.escape)) < 1e-3);
  assert.ok(f.log.some((l) => l.kind === 'regiment' && /détruit/.test(l.text)));
  assert.equal(visibleRegiments(f, s).some((v) => v.r === r), false);
  const q = f.regiments.find((x) => x.side === s && !x.lost);
  // Frappe aérienne ennemie sur sa case : des hommes perdus, et le voilà repéré.
  const d1 = q.dens;
  regimentsUnderAir(f, 1, { x: q.x + 1, y: q.y, power: 1 }, 2.4);
  assert.ok(Math.abs(q.dens - d1 * (1 - REGIMENT.air)) < 1e-6);
  regimentsUnderAir(f, 1, { x: q.x + 9, y: q.y, power: 1 }, 2.4);
  assert.ok(Math.abs(q.dens - d1 * (1 - REGIMENT.air)) < 1e-6, 'hors de la zone : rien');
  // Brouillard : l'ennemi ne voit un régiment que si sa case est en vue.
  f.vision[1][q.cell] = 0;
  q.seen[1] = null;
  updateRegimentSightings(f);
  assert.equal(visibleRegiments(f, 1).some((v) => v.r === q), false);
  f.vision[1][q.cell] = 1;
  updateRegimentSightings(f);
  assert.ok(visibleRegiments(f, 1).some((v) => v.r === q));
});

test('secteur prioritaire : la nuit, l\'état-major regroupe vers le fanion ; blessés rétablis déposés autour', () => {
  const f = front('rgt-prio');
  const s = 0;
  const dens0 = Float32Array.from(f.dens);
  staffNight(f);
  const plain = f.nightMoves.filter((t) => t.side === s);
  // Fanion sur un secteur du front, à une nuit de marche d'un secteur calme.
  const cands = [];
  for (let i = 0; i < f.map.N; i++) if (f.owner[i] === s && f.supplied[s][i] && isContact(f, i)) cands.push(i);
  let got = null;
  for (const i of cands.filter((_, k) => k % 4 === 0)) {
    if (plain.some((t) => Math.hypot(t.to.x - f.centers.x[i], t.to.y - f.centers.y[i]) < 4)) continue; // pas déjà le plus menacé
    f.dens.set(dens0);
    assert.ok(!setPriority(f, s, { x: f.centers.x[i], y: f.centers.y[i] }, false).error);
    staffNight(f);
    const t = f.nightMoves.find((m) => m.side === s);
    if (t?.priority) { got = { t, i }; break; }
  }
  assert.ok(got, 'un regroupement vers le fanion');
  assert.ok(Math.hypot(got.t.to.x - f.centers.x[got.i], got.t.to.y - f.centers.y[got.i]) < 1e-6, 'arrivée sur le fanion');
  assert.equal(f.nightMoves.filter((m) => m.side === s).length, 1, 'au lieu du plus menacé (une nuit, un regroupement)');
  // Blessés rétablis : PRIORITY.cap autour du fanion, le reste au pool.
  const near = () => { let t = 0; for (let j = 0; j < f.map.N; j++) if (f.owner[j] === s && Math.hypot(f.centers.x[j] - f.centers.x[got.i], f.centers.y[j] - f.centers.y[got.i]) < 6) t += f.dens[j]; return t; };
  const n0 = near();
  assert.equal(priorityRecover(f, s, PRIORITY.cap + 25), 25);
  assert.ok(Math.abs(near() - n0 - PRIORITY.cap) < 1e-2);
  // Toucher de nouveau le fanion le retire ; sans fanion, tout va au pool.
  setPriority(f, s, { x: f.centers.x[got.i], y: f.centers.y[got.i] });
  assert.equal(f.priority[s], null);
  assert.equal(priorityRecover(f, s, 30), 30);
});

test('IA : fanion sur son effort, régiments en route ou engagés', () => {
  const f = createFront({ seed: 'rgt-ia', playerSide: null, attacker: 'SU' });
  installAI(f);
  let moved = 0, engaged = 0, flagged = 0;
  for (let d = 0; d < 6 && !f.result; d++) {
    beginDay(f);
    for (const r of f.regiments) { if (r.dest) moved++; if (r.engaged?.day === f.day) engaged++; }
    flagged += f.priority.filter((p) => p != null).length;
    finishDay(f);
  }
  assert.ok(moved > 0, 'des régiments roulent');
  assert.ok(engaged > 0, 'des régiments s\'engagent');
  assert.ok(flagged > 0, 'un secteur prioritaire');
});
