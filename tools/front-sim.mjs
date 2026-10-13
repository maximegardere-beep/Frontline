// Batailles stratégiques IA contre IA : équilibre attaquant / défenseur et entre camps.
// node tools/front-sim.mjs [batailles=40] [graine=sim]
import { createFront, runDay, FRONT_SETUP, townsHeld } from '../src/front.js';
import { installAI, AI_TUNING } from '../src/frontai.js';
import { FRONT_RULES } from '../src/combat.js';

Object.assign(FRONT_RULES, JSON.parse(process.env.RULES ?? '{}'));
Object.assign(FRONT_SETUP, JSON.parse(process.env.SETUP ?? '{}'));
Object.assign(AI_TUNING, JSON.parse(process.env.AI ?? '{}'));
if (process.env.JSON) process.on('exit', () => {});
const N = Number(process.argv[2] ?? 40), SEED = process.argv[3] ?? 'sim';
const BIOMES = ['steppe', 'bocage', 'polesie', 'bourg'];
const tally = { att: 0, def: 0, nul: 0, DE: 0, SU: 0 };
const reasons = {};
let days = 0, pockets = 0, towns = 0, ms = 0, early = 0;
const perBiome = {};
for (let k = 0; k < N; k++) {
  const attacker = k % 2 ? 'SU' : 'DE';
  const biome = BIOMES[k % 4];
  const t0 = performance.now();
  const f = createFront({ seed: `${SEED}${k}`, playerSide: null, attacker, biome, season: k % 5 });
  installAI(f);
  let seenPockets = 0;
  while (!f.result) {
    runDay(f);
    seenPockets += f.log.filter((l) => l.day === f.day - 1 && /Encerclement/.test(l.text)).length;
  }
  ms += performance.now() - t0;
  pockets += f.log.filter((l) => /Encerclement/.test(l.text)).length;
  towns += f.defTowns.filter((i) => f.owner[i] === f.attacker).length;
  days += Math.min(f.day - 1, f.cfg.days);
  if (f.day - 1 < f.cfg.days) early++;
  const w = f.result.winner;
  if (w === null) tally.nul++;
  else { tally[w === f.attacker ? 'att' : 'def']++; tally[w === 0 ? 'DE' : 'SU']++; }
  const r = f.result.reason.replace(/\d+/g, '#').replace(/(la Wehrmacht|l'Armée rouge|La Wehrmacht|L'Armée rouge)/g, 'X').slice(0, 60);
  reasons[r] = (reasons[r] ?? 0) + 1;
  perBiome[biome] ??= { n: 0, att: 0 };
  perBiome[biome].n++;
  if (w === f.attacker) perBiome[biome].att++;
}
if (process.env.JSON) { console.log(JSON.stringify({ n: N, ...tally, days, pockets, towns, early })); process.exit(0); }
const p = (x) => `${Math.round((100 * x) / N)} %`;
console.log(`${N} batailles · attaquant ${p(tally.att)} · défenseur ${p(tally.def)} · nuls ${p(tally.nul)} · Wehrmacht ${p(tally.DE)} · Armée rouge ${p(tally.SU)}`);
console.log(`durée moyenne ${(days / N).toFixed(1)} jours (${early} finies avant le terme) · villes prises par l'attaquant ${(towns / N).toFixed(1)} · encerclements ${(pockets / N).toFixed(1)} par bataille · ${(ms / N / 1000).toFixed(1)} s de calcul par bataille`);
console.log('par biome (victoires de l\'attaquant) :', Object.entries(perBiome).map(([b, v]) => `${b} ${v.att}/${v.n}`).join(' · '));
for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${r}`);
