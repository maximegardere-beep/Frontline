import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFront, runDay } from '../src/front.js';
import { installAI } from '../src/frontai.js';
import { drawHand, chooseCards, ATOUTS, ATOUT_RULES, dealAtouts } from '../src/frontatout.js';

test('atouts : main reproductible, garanties, choix des cartes', () => {
  for (const year of [1941, 1942, 1943, 1944]) {
    for (let k = 0; k < 12; k++) {
      const f = createFront({ seed: `main${k}`, attacker: k % 2 ? 'SU' : 'DE', year });
      for (const s of [0, 1]) {
        const hand = drawHand(f, s, 0);
        assert.deepEqual(hand, drawHand(f, s, 0), 'même graine, même main');
        assert.equal(hand.length, ATOUT_RULES.hand[0]);
        const role = s === f.attacker ? 'att' : 'def';
        for (const c of hand) assert.ok([role, 'both'].includes(ATOUTS[c.key].role), `${c.key} dans le paquet ${role}`);
        assert.ok(hand.some((c) => ATOUTS[c.key].fire), 'une carte de feu');
        if (role === 'att') assert.ok(hand.some((c) => c.key === 'armor'), 'une division blindée pour l\'attaquant');
        const kept = chooseCards(f, s, hand, 3);
        assert.equal(kept.length, 3);
        for (const c of kept) assert.ok(hand.includes(c));
        assert.equal(f.atouts.kept[s].length, 3);
        for (const c of f.atouts.kept[s]) assert.ok(hand.some((h) => h.id === c.id), 'cartes gardées : de la main');
        const again = createFront({ seed: `main${k}`, attacker: k % 2 ? 'SU' : 'DE', year });
        assert.deepEqual(again.atouts.kept[s], f.atouts.kept[s], 'même graine, mêmes cartes gardées');
      }
    }
  }
});

test('atouts : ils remplacent les moyens placés d\'office', () => {
  const f = createFront({ seed: 'remplace', attacker: 'DE', year: 1943 });
  const legacy = createFront({ seed: 'remplace', attacker: 'DE', year: 1943, setup: { atouts: false } });
  for (const s of [0, 1]) {
    const again = createFront({ seed: 'remplace', attacker: 'DE', year: 1943 });
    const deal = dealAtouts(again);
    assert.deepEqual(f.guns.filter((g) => g.side === s).map((g) => g.kind), deal.guns[s], 'artillerie : celle des cartes seulement');
    assert.equal(f.armor.filter((a) => a.side === s).length, deal.armor[s].length, 'blindés : ceux des cartes seulement');
    assert.equal(f.aa.filter((a) => a.side === s).length, deal.aa[s], 'DCA : celle des cartes seulement');
  }
  // Le défenseur n'a pas de formations blindées ; sans atouts, il garde celles du scénario.
  assert.equal(f.armor.filter((a) => a.side === 1).length, 0);
  assert.ok(legacy.armor.some((a) => a.side === 1));
  // Les unités ne partagent pas de numéro.
  for (const list of [f.guns, f.armor, f.aa]) assert.equal(new Set(list.map((u) => u.id)).size, list.length);
});

test('atouts : chars lourds d\'élite et noms des formations', () => {
  let heavy = null;
  for (let k = 0; k < 200 && !heavy; k++) {
    const f = createFront({ seed: `lourd${k}`, attacker: 'DE', year: 1943 });
    heavy = f.armor.find((a) => a.heavy);
  }
  assert.ok(heavy, 'un bataillon lourd finit par sortir');
  assert.match(heavy.name, /Tiger/);
  assert.equal(heavy.tier, 'heavy');
  // 1941 : pas de Tiger, l'élite allemande est une division d'élite.
  for (let k = 0; k < 120; k++) {
    const f = createFront({ seed: `n41-${k}`, attacker: 'DE', year: 1941 });
    for (const a of f.armor) if (a.side === 0) assert.ok(!a.heavy);
    assert.equal(new Set(f.armor.map((a) => a.name)).size, f.armor.length, 'noms distincts');
  }
});

test('atouts : renforts du 7e jour, tirés et posés une seule fois', () => {
  const f = createFront({ seed: 'renforts', playerSide: null, attacker: 'SU', year: 1944 });
  installAI(f);
  const before = { guns: f.guns.length, armor: f.armor.length, aa: f.aa.length, kept: f.atouts.kept.map((k) => k.length) };
  while (f.day < ATOUT_RULES.day && !f.result) runDay(f);
  assert.equal(f.day, ATOUT_RULES.day);
  assert.equal(f.atouts.round, 1);
  for (const s of [0, 1]) assert.equal(f.atouts.kept[s].length, before.kept[s] + ATOUT_RULES.keep[1]);
  const added = f.guns.length + f.armor.length + f.aa.length - before.guns - before.armor - before.aa;
  assert.ok(added > 0, 'de nouvelles unités ont rejoint');
  for (const list of [f.guns, f.armor, f.aa]) assert.equal(new Set(list.map((u) => u.id)).size, list.length, 'numéros uniques');
  for (const u of [...f.guns, ...f.armor, ...f.aa].slice(-added)) if (!u.lost) assert.ok(u.x > 0 && u.y > 0);
  const n = f.guns.length;
  runDay(f);
  assert.equal(f.guns.length, n, 'pas de second tirage');
  while (!f.result) runDay(f);
  assert.ok(f.log.some((l) => l.kind === 'atout' && /Renforts du 7e jour/.test(l.text)));
});

test('atouts : le joueur ne voit que ses cartes au journal', () => {
  const f = createFront({ seed: 'secret', playerSide: 'SU', attacker: 'DE', year: 1943 });
  const lines = f.log.filter((l) => l.kind === 'atout');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].side, 1);
});
