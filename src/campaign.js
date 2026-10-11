// Campagne : une succession de batailles sur des cartes différentes, l'armée du joueur persiste.

import { createRng } from './rng.js';
import { generateArmy, gainXp, unitStats, other, variantOf, VARIANTS } from './units.js';
import { rollConditions } from './conditions.js';

export const CAMPAIGN_LENGTH = 5;
// Budgets d'armée (points de coût) : armée de départ du joueur, armée ennemie à la 1re bataille (+2 par bataille).
export const BUDGETS = { DE: 12, SU: 13 };
export const ENEMY_BUDGETS = { DE: 9, SU: 11 };
export const ENEMY_GROWTH = 2;
export const KIND_LABELS = { rencontre: 'Combat de rencontre', assaut: 'Prise de position stratégique' };

export function newCampaign(playerSide, seed) {
  const rng = createRng(`campaign:${seed}`);
  const budget = BUDGETS[playerSide];
  return {
    seed,
    playerSide,
    index: 0,
    army: generateArmy(playerSide, rng, budget),
    results: [],
    kinds: Array.from({ length: CAMPAIGN_LENGTH }, (_, i) => (i === CAMPAIGN_LENGTH - 1 || i % 2 === 1 || rng.chance(0.3) ? 'assaut' : 'rencontre')),
  };
}

export function battleSetup(c) {
  const rng = createRng(`enemy:${c.seed}:${c.index}`);
  const foe = other(c.playerSide);
  const budget = ENEMY_BUDGETS[foe] + c.index * ENEMY_GROWTH;
  const enemy = generateArmy(foe, rng, budget);
  const seed = `${c.seed}-${c.index}`;
  const conditions = rollConditions(seed, c.index, c.kinds[c.index]);
  return {
    seed,
    kind: c.kinds[c.index],
    date: conditions.month,
    conditions,
    armies: { [c.playerSide]: c.army, [foe]: enemy },
  };
}

// Après la bataille : retour des survivants, montée en grade, renforts.
export function concludeBattle(c, state) {
  const won = state.result?.winner === c.playerSide;
  const report = { title: state.title, winner: state.result?.winner ?? null, reason: state.result?.reason, lost: [], promoted: [], reinforcements: [] };
  const survivors = [];
  for (const u of c.army) {
    if (u.status === 'destroyed') { report.lost.push(u.name); continue; }
    const max = unitStats(u).maxHp;
    if (u.status === 'routed' || u.status === 'withdrawn') u.hp = Math.max(u.hp, Math.ceil(max * 0.5));
    else u.hp = Math.min(max, u.hp + Math.ceil((max - u.hp) / 2));
    if (gainXp(u, 0)) {
      // Passée Élite : l'unité reçoit son matériel (Tigre, T-34/85, Katioucha, Panzergrenadiers, Gardes).
      const v = variantOf(u);
      report.promoted.push(v && u.level === 3 ? `${u.name} (Élite, rééquipée : ${VARIANTS[v].label})` : u.name);
    }
    u.status = 'ok';
    survivors.push(u);
  }
  const rng = createRng(`reinf:${c.seed}:${c.index}`);
  const reinf = generateArmy(c.playerSide, rng, won ? 4 : 3, { core: false });
  report.reinforcements = reinf.map((u) => u.name);
  c.army = [...survivors, ...reinf];
  c.results.push({ title: state.title, won, draw: !state.result?.winner });
  c.index++;
  return report;
}

export function campaignOver(c) {
  return c.index >= CAMPAIGN_LENGTH || c.army.length === 0;
}

export function campaignVerdict(c) {
  const wins = c.results.filter((r) => r.won).length;
  const losses = c.results.filter((r) => !r.won && !r.draw).length;
  if (c.army.length === 0) return { title: 'Défaite totale', text: 'Votre formation a été anéantie.' };
  if (wins > losses) return { title: 'Victoire', text: `${wins} victoire(s) sur ${c.results.length} batailles. Le secteur est à vous.` };
  if (wins === losses) return { title: 'Impasse', text: 'Le front s\'est figé. Aucun camp n\'a percé.' };
  return { title: 'Défaite', text: `${losses} défaite(s). Votre formation doit se replier.` };
}
