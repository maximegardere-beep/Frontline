// Batailles de rue IA contre IA (ville tactique) : node tools/urban-sim.mjs [batailles=40] [graine=ville]
// Armées d'essai, à 1,5 contre 1 : l'attaquant (9 sections, 3 chars, une reconnaissance) entre dans une ville tenue par
// 6 sections et un antichar ; feux hors carte des deux camps. ATT=n : sections de l'attaquant. Affiche la part de victoires de l'attaquant et la ville prise.
import { createBattle, executeTurn, cityShare } from '../src/game.js';
import { generateUrbanMap } from '../src/urbangen.js';
import { planSide } from '../src/ai.js';
import { makeUnit, resetIds } from '../src/units.js';
import { createRng } from '../src/rng.js';

const N = Number(process.argv[2] ?? 40), SEED = process.argv[3] ?? 'ville';

export function testArmies(rng, attacker) {
  const def = attacker === 'DE' ? 'SU' : 'DE';
  const mk = (side, list) => list.map((type) => makeUnit(side, type, rng.int(1, 2), rng));
  return {
    [attacker]: mk(attacker, [...Array(Number(process.env.ATT ?? 9)).fill('infantry'), 'tank', 'tank', 'tank', 'recon']),
    [def]: mk(def, [...Array(6).fill('infantry'), 'at']),
  };
}

let att = 0, share = 0, turns = 0, ruins = 0, rubble = 0;
for (let k = 0; k < N; k++) {
  resetIds();
  const rng = createRng(`${SEED}${k}`);
  const attacker = k % 2 ? 'SU' : 'DE';
  const map = generateUrbanMap(`${SEED}${k}`, { size: ['village', 'town', 'city'][k % 3], river: k % 4 === 0 ? (attacker === 'DE' ? 'east' : 'west') : null, roads: ['W', 'E', 'N', 'S'] });
  const s = createBattle({ seed: `${SEED}${k}`, playerSide: null, armies: testArmies(rng, attacker), kind: 'ville', maxTurns: 10, map, attacker, fire: { [attacker]: { barrage: 2, support: 3 }, [attacker === 'DE' ? 'SU' : 'DE']: { barrage: 1, support: 2 } } });
  s.phase = 'plan';
  while (!s.result) { planSide(s, 'DE'); planSide(s, 'SU'); executeTurn(s); }
  if (s.result.winner === attacker) att++;
  share += cityShare(s);
  turns += s.turn - 1;
  ruins += s.map.tiles.filter((t) => t.ruined).length;
  rubble += s.map.tiles.filter((t) => t.rubble).length;
}
console.log(`${N} batailles de rue · attaquant ${Math.round((100 * att) / N)} % · ville prise ${Math.round((100 * share) / N)} % · ${(turns / N).toFixed(1)} tours · ${(ruins / N).toFixed(1)} hexagones en ruines · ${(rubble / N).toFixed(1)} rues encombrées`);
