import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFront, runDay } from '../src/front.js';
import { installAI } from '../src/frontai.js';
import { sortiesToday } from '../src/frontair.js';
import { airBattle, airShare, AIRWAR } from '../src/frontairwar.js';
import { ATOUT_RULES } from '../src/frontatout.js';

test('bataille des airs : manches de dés reproductibles, suprématie à qui en gagne le plus', () => {
  const f = createFront({ seed: 'ciel', year: 1943 });
  const a = airBattle(f, [3, 2], 0), b = airBattle(f, [3, 2], 0);
  assert.deepEqual(a, b, 'même graine, même bataille');
  assert.equal(a.rounds.length, AIRWAR.rounds);
  for (const r of a.rounds) {
    assert.deepEqual(r.hits, r.rolls.map((x) => x.filter((d) => d >= AIRWAR.hit).length));
    if (r.winner !== null) assert.ok(r.hits[r.winner] > r.hits[1 - r.winner]);
  }
  assert.equal(a.sup, a.won[0] > a.won[1] ? 0 : a.won[1] > a.won[0] ? 1 : null);
  // Le perdant d'une manche perd un avion.
  const lost = [0, 1].map((s) => a.rounds.filter((r) => r.winner === 1 - s).length);
  assert.deepEqual(a.force, [Math.max(0, 3 - lost[0]), Math.max(0, 2 - lost[1])]);
  // Sans avions, on ne touche rien.
  const z = airBattle(f, [4, 0], 1);
  assert.equal(z.sup, z.won[0] > 0 ? 0 : null);
  assert.ok(z.rounds.every((r) => r.hits[1] === 0));
});

test('bataille des airs : sorties du vainqueur, aucune pour le vaincu, moitié si le ciel est disputé', () => {
  const seen = { sup: 0, contested: 0 };
  for (let k = 0; k < 30; k++) {
    const f = createFront({ seed: `ciel${k}`, attacker: k % 2 ? 'SU' : 'DE', year: 1942 });
    f.weather = 'clear';
    const w = f.airWar;
    assert.ok(w && f.log.some((l) => l.kind === 'airwar'));
    for (const s of [0, 1]) {
      const n = f.cfg.sorties[s];
      if (w.sup === null) assert.equal(sortiesToday(f, s), Math.ceil(n / 2));
      else assert.equal(sortiesToday(f, s), w.sup === s ? n : 0);
      assert.equal(airShare(f, s), w.sup === null ? 0.5 : w.sup === s ? 1 : 0);
    }
    seen[w.sup === null ? 'contested' : 'sup']++;
  }
  assert.ok(seen.sup > 0 && seen.contested >= 0);
  // Sans atouts : pas de bataille des airs, toutes les sorties.
  const legacy = createFront({ seed: 'ciel', year: 1942, setup: { atouts: false } });
  legacy.weather = 'clear';
  assert.equal(legacy.airWar, undefined);
  assert.equal(sortiesToday(legacy, 0), legacy.cfg.sorties[0]);
});

test('bataille des airs : rejouée au 7e jour avec la force restante et les nouvelles cartes', () => {
  const f = createFront({ seed: 'ciel7', playerSide: null, attacker: 'DE', year: 1943 });
  installAI(f);
  const first = f.airWar;
  while (f.day < ATOUT_RULES.day && !f.result) runDay(f);
  assert.equal(f.airWars.length, 2);
  const second = f.airWar;
  assert.equal(second.round, 1);
  for (const s of [0, 1]) assert.ok(second.start[s] >= first.force[s], 'force restante, plus les renforts');
  assert.equal(f.log.filter((l) => l.kind === 'airwar').length, 2);
});
