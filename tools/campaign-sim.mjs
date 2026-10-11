// Difficulté de campagne : l'IA joue le camp du joueur (simple repère, un humain joue mieux qu'elle).
// node tools/campaign-sim.mjs [campagnes=200]
import { generateArmy, resetIds } from '../src/units.js';
import { createBattle, executeTurn } from '../src/game.js';
import { planSide } from '../src/ai.js';
import { newCampaign, battleSetup, concludeBattle, campaignOver, campaignVerdict, ENEMY_BUDGETS } from '../src/campaign.js';

const N = Number(process.argv[2] ?? 200);
for (const s of ['DE', 'SU']) if (process.env[`E${s}`]) ENEMY_BUDGETS[s] = Number(process.env[`E${s}`]);
for (const side of ['DE', 'SU']) {
  let battles = 0, won = 0, lost = 0;
  const verdicts = {}, byIndex = [0, 0, 0, 0, 0], playedIdx = [0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) {
    resetIds();
    const c = newCampaign(side, `camp${side}${i}`);
    while (!campaignOver(c)) {
      const setup = battleSetup(c);
      const st = createBattle({ seed: setup.seed, playerSide: side, armies: setup.armies, kind: setup.kind, conditions: setup.conditions });
      st.phase = 'plan';
      while (!st.result) { planSide(st, 'DE'); planSide(st, 'SU'); executeTurn(st); }
      battles++;
      playedIdx[c.index]++;
      if (st.result.winner === side) { won++; byIndex[c.index]++; } else if (st.result.winner) lost++;
      concludeBattle(c, st);
    }
    const v = campaignVerdict(c).title;
    verdicts[v] = (verdicts[v] ?? 0) + 1;
  }
  console.log(`${side} joueur : batailles gagnées ${Math.round(100 * won / battles)} %, perdues ${Math.round(100 * lost / battles)} % ; par bataille ${byIndex.map((w, k) => Math.round(100 * w / Math.max(1, playedIdx[k])) + '%').join(' ')} ; issues`, verdicts);
}
