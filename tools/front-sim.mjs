// Batailles stratégiques IA contre IA : équilibre attaquant / défenseur et entre camps.
// node tools/front-sim.mjs [batailles=40] [graine=sim]
// Réglages par l'environnement : RULES, SETUP, AI, SCORE, GUNS (JSON) ; SCORES=1 affiche le score de chaque bataille.
import { createFront, runDay, FRONT_SETUP, townsHeld } from '../src/front.js';
import { installAI, AI_TUNING } from '../src/frontai.js';
import { FRONT_RULES } from '../src/combat.js';
import { scoreBreakdown, GRADES, SCORE } from '../src/frontscore.js';
import { scenarioOf } from '../src/frontscenario.js';
import { createRng } from '../src/rng.js';
import { GUN_RULES } from '../src/frontguns.js';
const YEAR = process.env.YEAR ? Number(process.env.YEAR) : null;

Object.assign(FRONT_RULES, JSON.parse(process.env.RULES ?? '{}'));
Object.assign(FRONT_SETUP, JSON.parse(process.env.SETUP ?? '{}'));
Object.assign(AI_TUNING, JSON.parse(process.env.AI ?? '{}'));
Object.assign(SCORE, JSON.parse(process.env.SCORE ?? '{}'));
Object.assign(GUN_RULES, JSON.parse(process.env.GUNS ?? '{}'));
if (process.env.JSON) process.on('exit', () => {});
const N = Number(process.argv[2] ?? 40), SEED = process.argv[3] ?? 'sim';
const BIOMES = ['steppe', 'bocage', 'polesie', 'bourg', 'montagne', 'foret', 'fleuve', 'metropole'];
const tally = { att: 0, def: 0, nul: 0, DE: 0, SU: 0, deAtt: 0, deAttWin: 0, deDefWin: 0 };
const reasons = {};
let days = 0, pockets = 0, towns = 0, ms = 0, early = 0;
const perBiome = {};
const grades = {}, scores = [];
for (let k = 0; k < N; k++) {
  // Avec YEAR : le camp qui attaque est tiré selon le scénario ; sinon, les rôles alternent.
  const attacker = YEAR ? createRng(`sim-att:${SEED}${k}`).weighted(scenarioOf(YEAR).attacker) : k % 2 ? 'SU' : 'DE';
  const biome = BIOMES[k % BIOMES.length];
  const t0 = performance.now();
  const f = createFront({ seed: `${SEED}${k}`, playerSide: null, attacker, biome, season: k % 5, year: YEAR });
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
  grades[f.result.grade] = (grades[f.result.grade] ?? 0) + 1;
  scores.push(scoreBreakdown(f, true).total);
  if (w === null) tally.nul++;
  else { tally[w === f.attacker ? 'att' : 'def']++; tally[w === 0 ? 'DE' : 'SU']++; }
  if (f.attacker === 0) { tally.deAtt++; if (w === 0) tally.deAttWin++; } else if (w === 0) tally.deDefWin++;
  const r = f.result.reason.replace(/\d+/g, '#').replace(/(la Wehrmacht|l'Armée rouge|La Wehrmacht|L'Armée rouge)/g, 'X').slice(0, 60);
  reasons[r] = (reasons[r] ?? 0) + 1;
  perBiome[biome] ??= { n: 0, att: 0 };
  perBiome[biome].n++;
  if (w === f.attacker) perBiome[biome].att++;
}
if (process.env.JSON) { console.log(JSON.stringify({ n: N, ...tally, days, pockets, towns, early })); process.exit(0); }
if (process.env.SCORES) console.log("scores", JSON.stringify(scores));
const p = (x) => `${Math.round((100 * x) / N)} %`;
console.log(`${N} batailles · attaquant ${p(tally.att)} · défenseur ${p(tally.def)} · nuls ${p(tally.nul)} · Wehrmacht ${p(tally.DE)} · Armée rouge ${p(tally.SU)}`);
console.log(`durée moyenne ${(days / N).toFixed(1)} jours (${early} finies avant le terme) · villes prises par l'attaquant ${(towns / N).toFixed(1)} · encerclements ${(pockets / N).toFixed(1)} par bataille · ${(ms / N / 1000).toFixed(1)} s de calcul par bataille`);
console.log('par biome (victoires de l\'attaquant) :', Object.entries(perBiome).map(([b, v]) => `${b} ${v.att}/${v.n}`).join(' · '));
scores.sort((a, b) => a - b);
console.log('issues :', Object.entries(grades).map(([g, n]) => `${GRADES[g].label} ${n}`).join(' · '));
console.log('score (attaquant) : quantiles 10/25/50/75/90 =', [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => scores[Math.floor(q * (scores.length - 1))].toFixed(1)).join(' / '));
for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${r}`);
