import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFront, beginDay, stepTick, rebuildFields, addVector } from '../src/front.js';
import { HQ, hqState, moveHQ, hqAfter, hqSightings, hqNight } from '../src/fronthq.js';

const front = (seed = 'pc') => createFront({ seed, playerSide: 'DE', attacker: 'DE', year: 1943 });
const finishDay = (f) => { while (f.phase === 'resolve') stepTick(f); };
// Case amie au contact, au plus près du PC.
function contactNear(f, s, h) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < f.map.N; i++) {
    if (f.owner[i] !== s) continue;
    let c = false;
    for (let d = 0; d < 6; d++) { const j = f.map.nb[i * 6 + d]; if (j >= 0 && f.owner[j] === 1 - s) c = true; }
    const d = Math.hypot(f.centers.x[i] - h.x, f.centers.y[i] - h.y);
    if (c && d < bd) { bd = d; best = i; }
  }
  return best;
}

test('PC : bonus de coordination dans son rayon, rien sans liaison, malus une fois pris', () => {
  const f = front();
  const h = f.hq[0];
  assert.equal(f.owner[h.cell], 0);
  assert.equal(hqState(h), 'ok');
  const far = f.map.N - 1 - [...Array(f.map.N).keys()].reverse().findIndex((i) => f.owner[i] === 0 && Math.hypot(f.centers.x[i] - h.x, f.centers.y[i] - h.y) > h.radius + 2);
  const fort = (i) => { rebuildFields(f, 0); return f.field[0].fort[i]; };
  const ok = fort(h.cell), farOk = fort(far);
  h.link = 0.2;
  assert.equal(hqState(h), 'disorg');
  const none = fort(h.cell);
  assert.ok(ok > none * (1 + HQ.def * 0.95), `bonus au PC (${ok} contre ${none})`);
  assert.equal(fort(far), farOk, 'hors du rayon : aucun effet');
  h.captured = true;
  assert.ok(fort(h.cell) < none, 'PC pris : malus');
});

test('PC : barrages ennemis sur lui, désorganisation, pas de regroupement de nuit, liaison rétablie', () => {
  const f = front('pc-barrage');
  const h = f.hq[0];
  const guns = f.guns.filter((g) => g.side === 1).slice(0, 2);
  assert.equal(guns.length, 2);
  for (const g of guns) f.barrages[1].push({ id: 900 + g.id, side: 1, x: h.x, y: h.y, r: 3, gun: g.id });
  beginDay(f);
  assert.equal(h.late, false, 'opérationnel au matin');
  for (let t = 0; t < f.cfg.barrageTicks; t++) stepTick(f);
  assert.equal(hqState(h), 'disorg');
  assert.ok(f.log.some((l) => l.kind === 'hq' && /désorganisé/.test(l.text)));
  assert.ok(h.seen[1], 'pilonné, il est repéré');
  finishDay(f);
  assert.equal(f.transfers[0].filter((t) => t.auto).length, 0, 'aucun regroupement de l\'état-major');
  assert.ok(h.link >= HQ.disorg && h.link <= 1, 'la nuit rétablit la liaison');
  assert.equal(hqState(h), 'ok');
});

test('PC : capturé (documents saisis), repris, puis PC de secours après deux nuits', () => {
  const f = front('pc-prise');
  const h = f.hq[0];
  const ev = [];
  f.owner[h.cell] = 1;
  hqAfter(f, ev);
  assert.equal(hqState(h), 'captured');
  assert.equal(ev[0].kind, 'hqLost');
  assert.ok(f.docs[1] > f.clock, 'documents lisibles une journée');
  assert.ok(moveHQ(f, 0, { x: h.x - 5, y: h.y }).error, 'un PC pris ne se déplace plus');
  hqSightings(f);
  for (const a of f.armor.filter((x) => x.side === 0)) assert.ok(a.seen[1], `${a.name} révélée par les documents`);
  // Repris : désorganisé jusqu'à la nuit.
  f.owner[h.cell] = 0;
  hqAfter(f, ev);
  assert.equal(hqState(h), 'disorg');
  assert.equal(ev[1].kind, 'hqRetaken');
  // Pris de nouveau, et jamais repris : PC de secours à l'arrière.
  f.owner[h.cell] = 1;
  hqAfter(f, ev);
  const x0 = h.x, r0 = h.radius;
  hqNight(f);
  assert.equal(hqState(h), 'captured', 'une nuit ne suffit pas');
  hqNight(f);
  assert.equal(h.backup, true);
  assert.equal(hqState(h), 'ok');
  assert.ok(h.x < x0, 'à l\'arrière');
  assert.equal(h.radius, r0 * HQ.backupRadius);
  assert.equal(f.owner[h.cell], 0);
});

test('PC : déplacement de jour (vecteurs à midi), saut de nuit (liaison réduite)', () => {
  const f = front('pc-saut');
  const h = f.hq[0];
  assert.ok(moveHQ(f, 0, { x: f.centers.x[f.map.W * 30 + f.map.W - 1], y: h.y }).error, 'pas chez l\'ennemi');
  // Loin : de jour.
  let to = -1;
  for (let i = 0; i < f.map.N && to < 0; i++) if (f.owner[i] === 0 && f.map.flow[i] > 0 && Math.hypot(f.centers.x[i] - h.x, f.centers.y[i] - h.y) > HQ.hop * 1.3) to = i;
  const r = moveHQ(f, 0, { x: f.centers.x[to], y: f.centers.y[to] });
  assert.equal(r.dest.night, false);
  const from = contactNear(f, 0, h);
  assert.ok(!addVector(f, 0, 'infantry', from, { x: f.centers.x[from] + 8, y: f.centers.y[from] }).error);
  beginDay(f);
  assert.equal(h.cell, to, 'il roule de jour');
  assert.equal(h.late, true);
  stepTick(f);
  assert.equal(f.field[0].w.reduce((a, b) => a + b, 0), 0, 'vecteurs à l\'arrêt le matin');
  while (f.tick <= HQ.noon) stepTick(f);
  assert.ok(f.field[0].w.reduce((a, b) => a + b, 0) > 0, 'ils partent à midi');
  finishDay(f);
  // Court : de nuit, au soir.
  const cell = h.cell;
  let hop = -1;
  for (let i = 0; i < f.map.N && hop < 0; i++) { const d = Math.hypot(f.centers.x[i] - h.x, f.centers.y[i] - h.y); if (f.owner[i] === 0 && f.map.flow[i] > 0 && d > 5 && d < HQ.hop) hop = i; }
  assert.equal(moveHQ(f, 0, { x: f.centers.x[hop], y: f.centers.y[hop] }).dest.night, true);
  beginDay(f);
  assert.equal(h.cell, cell, 'il reste en place pendant la journée');
  finishDay(f);
  assert.equal(h.cell, hop);
  assert.ok(h.link <= HQ.hopLink);
});
