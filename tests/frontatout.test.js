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

test('atouts : tirage du joueur en attente, confirmation, bataille des airs après, déploiement', async () => {
  const { confirmAtouts, autoConfirm, placeable, placeUnit, endPlacement } = await import('../src/frontatout.js');
  const f = createFront({ seed: 'manuel', playerSide: 'SU', attacker: 'DE', year: 1943, setup: { atoutsManual: true } });
  assert.deepEqual(f.atouts.pending, [false, true]);
  assert.equal(f.airWar, undefined, 'la bataille des airs attend le choix du joueur');
  assert.equal(f.guns.filter((g) => g.side === 1).length, 0, 'pas encore d\'unités pour le joueur');
  const hand = f.atouts.hands[1];
  assert.ok(confirmAtouts(f, 1, hand.slice(0, 2).map((c) => c.id)).error, 'il faut en garder 3');
  const r = confirmAtouts(f, 1, hand.slice(0, 3).map((c) => c.id));
  assert.ok(!r.error);
  assert.ok(r.airWar && f.airWar === r.airWar, 'bataille des airs une fois les deux camps servis');
  assert.ok(f.placing[1]);
  const items = placeable(f, 1);
  assert.equal(items[0].kind, 'hq');
  for (const list of [f.guns, f.armor, f.aa, f.support]) assert.equal(new Set(list.map((u) => u.id)).size, list.length);
  // Placer le PC ailleurs dans nos lignes ; pas chez l'ennemi.
  let to = -1;
  for (let i = 0; i < f.map.N && to < 0; i++) if (f.owner[i] === 1 && f.supplied[1][i] && f.map.flow[i] > 0 && Math.hypot(f.centers.x[i] - f.hq[1].x, f.centers.y[i] - f.hq[1].y) > 20) to = i;
  assert.ok(!placeUnit(f, 1, 'hq', 0, { x: f.centers.x[to], y: f.centers.y[to] }).error);
  assert.equal(f.hq[1].cell, to);
  assert.ok(placeUnit(f, 1, 'hq', 0, { x: f.centers.x[0], y: f.centers.y[0] }).error);
  // Point d'appui : ouvrages seulement à la fin du déploiement.
  for (const p of f.strong[1]) assert.equal(p.built, false);
  endPlacement(f, 1);
  assert.equal(f.placing[1], false);
  for (const p of f.strong[1]) assert.equal(p.built, true);
  assert.equal(placeable(f, 1).length, 0);
  assert.equal(autoConfirm(f, 1), null, 'plus rien en attente');
  // Sans réponse du joueur, la journée part avec le choix automatique.
  const g = createFront({ seed: 'manuel2', playerSide: 'DE', attacker: 'DE', year: 1943, setup: { atoutsManual: true } });
  runDay(g);
  assert.equal(g.atouts.pending[0], false);
  assert.equal(g.atouts.kept[0].length, ATOUT_RULES.keep[0]);
  assert.ok(g.airWar);
});
