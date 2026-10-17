// Batailles IA contre IA sur la métropole : progression de l'attaquant dans la ville, quartier par quartier.
// node tools/metro-sim.mjs [batailles=12] [graine=metro]
// Réglages par l'environnement : DISTRICT (JSON, par type de quartier), AVENUE, RUINS, RULES, METRO, AI, SETUP (JSON) ;
// JSON=1 n'écrit qu'une ligne de totaux (pour mettre plusieurs séries en commun).
import { createFront, runDay } from '../src/front.js';
import { scoreBreakdown } from '../src/frontscore.js';
import { installAI, AI_TUNING } from '../src/frontai.js';
import { FRONT_RULES } from '../src/combat.js';
import { DISTRICT_TERRAIN, AVENUE, RUINS } from '../src/terrain.js';
import { METRO_RULES, districtPoints, districtTotal } from '../src/frontmetro.js';

for (const [t, v] of Object.entries(JSON.parse(process.env.DISTRICT ?? '{}'))) Object.assign(DISTRICT_TERRAIN[t], v);
Object.assign(AVENUE, JSON.parse(process.env.AVENUE ?? '{}'));
Object.assign(RUINS, JSON.parse(process.env.RUINS ?? '{}'));
Object.assign(FRONT_RULES, JSON.parse(process.env.RULES ?? '{}'));
Object.assign(METRO_RULES, JSON.parse(process.env.METRO ?? '{}'));
Object.assign(AI_TUNING, JSON.parse(process.env.AI ?? '{}'));
// Case d'un groupe d'artillerie (centre le plus proche).
const gunCellOf = (f, g) => { let b = 0, bd = Infinity; for (let i = 0; i < f.map.N; i++) { const d = Math.hypot(f.centers.x[i] - g.x, f.centers.y[i] - g.y); if (d < bd) { bd = d; b = i; } } return b; };
const N = Number(process.argv[2] ?? 12), SEED = process.argv[3] ?? 'metro';

const t = { n: 0, att: 0, def: 0, nul: 0, start: 0, end: 0, districts: 0, avenues: 0, ruin: 0, days: 0, lossAtt: 0, lossDef: 0, river: 0, cols: 0, tanks: 0, pts0: 0, pts1: 0, defPockets: 0, ferried: 0, guns: 0 };
const grades = {}, gains = [];
const byType = {};
for (let k = 0; k < N; k++) {
  const f = createFront({ seed: `${SEED}${k}`, playerSide: null, attacker: k % 2 ? 'SU' : 'DE', biome: 'metropole', season: k % 5, setup: JSON.parse(process.env.SETUP ?? '{}') });
  installAI(f);
  const att = f.attacker, m = f.map;
  const city = m.districts.flatMap((d) => d.cells);
  const share = (cells) => cells.filter((i) => f.owner[i] === att).length / cells.length;
  const before = m.districts.map((d) => share(d.cells));
  t.start += share(city);
  const held0 = f.owner.filter((o) => o === att).length;
  t.pts0 += districtPoints(f, att) / districtTotal(f);
  const pts0 = districtPoints(f, att);
  const def = 1 - att;
  t.guns += f.guns.filter((g) => g.side === def && !g.lost && f.map.farBank[gunCellOf(f, g)]).length / Math.max(1, f.guns.filter((g) => g.side === def).length);
  let pocketed = 0, ferried = 0;
  while (!f.result) {
    runDay(f);
    pocketed = Math.max(pocketed, f.pockets[def].filter((p) => p.troops >= 20).length);
    ferried = Math.max(ferried, f.ferried ? f.ferried.reduce((a, v) => a + v, 0) : 0);
  }
  t.defPockets += pocketed > 0 ? 1 : 0;
  t.ferried += ferried;
  t.pts1 += districtPoints(f, att) / districtTotal(f);
  gains.push(scoreBreakdown(f, true).total); // points gagnés, objectifs compris
  grades[f.result.grade] = (grades[f.result.grade] ?? 0) + 1;
  // Fleuve atteint : l'attaquant tient une case de ville au bord de l'eau ; avance : cases gagnées par ligne.
  if (city.some((i) => f.owner[i] === att && [0, 1, 2, 3, 4, 5].some((d) => m.river[m.nb[i * 6 + d]]))) t.river++;
  t.cols += (f.owner.filter((o) => o === att).length - held0) / m.H;
  t.n++;
  t.end += share(city);
  const w = f.result.winner;
  if (w === null) t.nul++; else if (w === att) t.att++; else t.def++;
  for (const [x, d] of m.districts.entries()) {
    byType[d.type] ??= { n: 0, taken: 0 };
    if (before[x] > 0.6) continue;
    byType[d.type].n++;
    if (share(d.cells) > 0.6) { byType[d.type].taken++; t.districts++; }
  }
  const av = city.filter((i) => m.avenue[i]);
  t.avenues += share(av);
  t.ruin += city.reduce((a, i) => a + f.ruin[i], 0) / city.length;
  t.days += Math.min(f.day - 1, f.cfg.days);
  t.lossAtt += f.stats.losses[att];
  t.lossDef += f.stats.losses[1 - att];
  const own = (f.armor ?? []).filter((a) => a.side === att);
  t.tanks += own.length ? own.reduce((x, a) => x + (a.lost ? a.max : a.max - a.tanks), 0) / own.reduce((x, a) => x + a.max, 0) : 0;
}
if (process.env.JSON) { console.log(JSON.stringify({ ...t, byType, grades, gains })); process.exit(0); }
const p = (x) => `${Math.round((100 * x) / t.n)} %`;
console.log(`${t.n} batailles · attaquant ${p(t.att)} · défenseur ${p(t.def)} · nuls ${p(t.nul)} · ${(t.days / t.n).toFixed(1)} jours`);
console.log(`ville tenue par l'attaquant : ${p(t.start)} au départ → ${p(t.end)} à la fin · avenues ${p(t.avenues)} · quartiers pris ${(t.districts / t.n).toFixed(1)} par bataille · ruine moyenne ${(t.ruin / t.n).toFixed(2)}`);
console.log(`avance moyenne ${(t.cols / t.n).toFixed(1)} colonnes · fleuve atteint dans ${p(t.river)} des batailles`);
console.log(`pertes (densité) : attaquant ${(t.lossAtt / t.n).toFixed(0)} · défenseur ${(t.lossDef / t.n).toFixed(0)} · chars de l'attaquant perdus ${p(t.tanks)}`);
console.log(`points de quartiers de l'attaquant : ${p(t.pts0)} → ${p(t.pts1)} · issues ${JSON.stringify(grades)} · poches du défenseur dans ${p(t.defPockets)} des batailles · cases tenues par les seuls bacs ${(t.ferried / t.n).toFixed(0)} au plus · batteries du défenseur sur la rive gauche au départ ${p(t.guns)}`);
const g = gains.slice().sort((a, b) => a - b);
console.log('points gagnés (quantiles 10/25/50/75/90) :', [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => g[Math.floor(q * (g.length - 1))]).join(' / '));
console.log('quartiers pris par type :', Object.entries(byType).map(([k, v]) => `${k} ${v.taken}/${v.n}`).join(' · '));
