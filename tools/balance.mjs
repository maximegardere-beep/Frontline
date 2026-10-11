// Banc d'équilibrage : batailles IA contre IA avec conditions tirées, armées au budget « joueur ».
// node tools/balance.mjs [batailles=600] [graine=bal]
import { createRng } from '../src/rng.js';
import { generateArmy, resetIds, UNIT_TYPES, unitStats } from '../src/units.js';
import { createBattle, executeTurn } from '../src/game.js';
import { planSide } from '../src/ai.js';
import { rollConditions } from '../src/conditions.js';
import { BUDGETS } from '../src/campaign.js';

const N = Number(process.argv[2] ?? 600), SEED = process.argv[3] ?? 'bal';
// Essais : DE=12 SU=13 node tools/balance.mjs
for (const s of ['DE', 'SU']) if (process.env[s]) BUDGETS[s] = Number(process.env[s]);
const tally = () => ({ n: 0, DE: 0, SU: 0, nul: 0 });
const all = tally(), byKind = {}, byReason = {};
const kills = { DE: {}, SU: {} }, losses = { DE: {}, SU: {} }, fielded = { DE: {}, SU: {} };
let turns = 0;
for (let i = 0; i < N; i++) {
  resetIds();
  const rng = createRng(`${SEED}${i}`);
  const kind = i % 2 ? 'assaut' : 'rencontre';
  const armies = { DE: generateArmy('DE', rng, BUDGETS.DE), SU: generateArmy('SU', rng, BUDGETS.SU) };
  for (const s of ['DE', 'SU']) for (const u of armies[s]) fielded[s][u.type] = (fielded[s][u.type] ?? 0) + 1;
  const st = createBattle({ seed: `${SEED}${i}`, playerSide: 'DE', kind, conditions: rollConditions(`${SEED}${i}`, i % 5, kind), armies });
  st.phase = 'plan';
  while (!st.result) {
    planSide(st, 'DE'); planSide(st, 'SU');
    const r = executeTurn(st);
    for (const e of r.events) if (e.kind === 'destroyed' || e.kind === 'routed') {
      const u = st.units.find((x) => x.id === e.id);
      losses[u.side][u.type] = (losses[u.side][u.type] ?? 0) + 1;
    }
  }
  turns += st.turn - 1;
  const w = st.result.winner ?? 'nul';
  for (const t of [all, (byKind[kind] ??= tally())]) { t.n++; t[w]++; }
  const reason = st.result.reason.replace(/\d+/g, '#').slice(0, 52);
  byReason[reason] ??= tally(); byReason[reason].n++; byReason[reason][w]++;
}
const pct = (t) => `DE ${Math.round(100 * t.DE / t.n)}% · SU ${Math.round(100 * t.SU / t.n)}% · nuls ${Math.round(100 * t.nul / t.n)}% (n=${t.n})`;
console.log('Global      ', pct(all), `· ${(turns / N).toFixed(1)} tours`);
for (const [k, t] of Object.entries(byKind)) console.log(k.padEnd(12), pct(t));
for (const [k, t] of Object.entries(byReason).sort((a, b) => b[1].n - a[1].n)) console.log(' ', k.padEnd(54), pct(t));
for (const s of ['DE', 'SU']) {
  console.log(s, 'unités engagées / perdues (détruites ou en déroute) par bataille :',
    Object.keys(UNIT_TYPES).map((t) => `${t} ${((fielded[s][t] ?? 0) / N).toFixed(2)}/${((losses[s][t] ?? 0) / N).toFixed(2)}`).join('  '));
}
