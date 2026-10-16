// Banc de calibrage du front stratégique : quatre scénarios fixes sur plusieurs cartes, mesures par jour.
// node tools/front-bench.mjs [cartes=6] [jours=2]
// Cibles (DESIGN.md, « front mobile ») : front calme 1 à 2 % de pertes par jour ; percée blindée sur un secteur
// ordinaire 10 à 15 cases de profondeur par jour ; attaque frontale sur un secteur renforcé : peu de gain et
// l'assaillant perd plus que le défenseur ; tenaille : encerclement en 2 à 3 jours.
import { createFront as baseCreate, runDay, beginDay, stepTick, troops, addVector, addBarrage, deployReserve, VECTOR_TYPES, FRONT_SETUP, applyWeather } from '../src/front.js';
import { addAirMission } from '../src/frontair.js';

// Temps clair forcé (WEATHER=rain… pour mesurer une météo) : le calibrage reste comparable d'une version à l'autre.
const createFront = (o) => {
  const f = baseCreate({ ...o, setup: { atouts: false, ...o.setup } }); // moyens placés d'office : mesures comparables
  f.weather = o.weather ?? process.env.WEATHER ?? 'clear';
  applyWeather(f);
  f.rng.chance = () => true; // la météo garde le temps forcé d'un jour à l'autre
  return f;
};
import { FRONT_RULES } from '../src/combat.js';

// Essais de réglages sans toucher au code : RULES='{"SKIRMISH":0.001}' ARMOR='{"speed":0.5}' SETUP='{"quality":[1.2,1]}'
Object.assign(FRONT_RULES, JSON.parse(process.env.RULES ?? '{}'));
Object.assign(VECTOR_TYPES.armor, JSON.parse(process.env.ARMOR ?? '{}'));
Object.assign(VECTOR_TYPES.infantry, JSON.parse(process.env.INF ?? '{}'));
Object.assign(FRONT_SETUP, JSON.parse(process.env.SETUP ?? '{}'));

const MAPS = Number(process.argv[2] ?? 6), DAYS = Number(process.argv[3] ?? 2);

// Case allemande au contact la plus proche de la ligne row.
function frontCell(f, row) {
  const { W, nb, N } = f.map;
  let best = -1, bd = Infinity;
  for (let i = 0; i < N; i++) {
    if (f.owner[i] !== 0) continue;
    let contact = false;
    for (let d = 0; d < 6; d++) { const j = nb[i * 6 + d]; if (j >= 0 && f.owner[j] === 1) contact = true; }
    if (!contact) continue;
    const r = Math.floor(i / W), dd = Math.abs(r - row);
    if (dd < bd) { bd = dd; best = i; }
  }
  return best;
}

// Profondeur de pénétration : avance maximale (en colonnes) de la ligne allemande dans une bande de lignes.
function lineCol(f, r0, r1) {
  const { W } = f.map;
  let m = 0;
  for (let r = r0; r <= r1; r++) {
    let c = 0;
    for (let col = 0; col < W; col++) if (f.owner[r * W + col] === 0) c = col;
    m = Math.max(m, c);
  }
  return m;
}

const pct = (a, b) => `${(100 * a / b).toFixed(1)} %`;
const out = { calme: [], percee: [], frontale: [], infanterie: [], tenaille: [], traversee: [[], []] };
const islets = [];

for (let k = 0; k < MAPS; k++) {
  const seed = `bench${k}`;
  // 1. Front calme.
  {
    const f = createFront({ seed });
    const t = [troops(f, 0), troops(f, 1)], cap = f.stats.captured.slice(), l0 = f.stats.losses.slice();
    for (let d = 0; d < DAYS; d++) { f.reserve = [0, 0]; runDay(f); }
    out.calme.push({ de: (f.stats.losses[0] - l0[0]) / t[0] / DAYS, su: (f.stats.losses[1] - l0[1]) / t[1] / DAYS, cases: f.stats.captured[0] + f.stats.captured[1] - cap[0] - cap[1] });
  }
  // 2 et 3. Percée blindée, sur secteur ordinaire puis renforcé de toutes les réserves soviétiques.
  // Le défenseur (Armée rouge) est retranché ; « point faible » : on retire ses fortifications autour de la ligne visée.
  for (const [key, type, reinforced, weak] of [['percee', 'armor', false, true], ['frontale', 'armor', true, false], ['infanterie', 'infantry', false, true]]) {
    const f = createFront({ seed });
    const row = Math.floor(f.map.H / 2);
    if (weak) for (let i = 0; i < f.map.N; i++) if (Math.abs(Math.floor(i / f.map.W) - row) <= 6) f.entrench[i] = 0;
    else if (!reinforced) for (let i = 0; i < f.map.N; i++) if (f.entrench[i] > 0 && Math.abs(Math.floor(i / f.map.W) - row) <= 6) f.entrench[i] = 1;
    const start = lineCol(f, row - 2, row + 2);
    const l0 = f.stats.losses.slice();
    for (let d = 0; d < DAYS; d++) {
      const from = frontCell(f, row);
      addVector(f, 0, type, from, { x: f.centers.x[from] + 40, y: f.centers.y[from] });
      if (reinforced && d === 0) {
        // Les réserves soviétiques montent en face du point d'attaque.
        let tgt = -1;
        for (let dc = 1; dc < 8 && tgt < 0; dc++) { const j = from + dc; if (f.owner[j] === 1) tgt = j; }
        while (f.reserve[1] >= 1 && tgt >= 0) if (deployReserve(f, 1, tgt).error) break;
      }
      runDay(f);
    }
    const r = { profondeur: (lineCol(f, row - 2, row + 2) - start) / DAYS, pertesDE: (f.stats.losses[0] - l0[0]) / DAYS, pertesSU: (f.stats.losses[1] - l0[1]) / DAYS };
    out[key].push(r);
  }
  // Traversée de la zone retranchée : ticks pour avancer de 7 cases, sur un point faible puis sur un secteur fortifié.
  for (const fort of [0, 1]) {
    const f = createFront({ seed });
    const row = Math.floor(f.map.H / 2), W = f.map.W;
    for (let i = 0; i < f.map.N; i++) if (Math.abs(Math.floor(i / W) - row) <= 6 && f.owner[i] === 1) f.entrench[i] = fort;
    const from = frontCell(f, row), c0 = from % W;
    addVector(f, 0, 'armor', from, { x: f.centers.x[from] + 40, y: f.centers.y[from] });
    beginDay(f);
    let t = 0, crossed = Infinity;
    while (f.phase === 'resolve' && crossed === Infinity) {
      stepTick(f);
      t++;
      if (lineCol(f, row - 2, row + 2) - c0 >= 7) crossed = t;
    }
    out.traversee[fort].push(crossed);
  }
  // 4. Tenaille : deux blindés partent de part et d'autre d'un saillant et se rejoignent derrière lui.
  // Chaque jour, chaque bras repart de sa case la plus avancée vers le même point de jonction.
  {
    const f = createFront({ seed });
    const mid = Math.floor(f.map.H / 2);
    const o = frontCell(f, mid);
    const meet = { x: f.centers.x[o] + 20, y: f.centers.y[o] };
    const arms = [-11, 11].map((dr) => frontCell(f, mid + dr));
    let pocketDay = 0;
    for (let d = 0; d < 4 && !pocketDay; d++) {
      for (let a = 0; a < 2; a++) {
        let best = arms[a], bd = Infinity;
        for (let i = 0; i < f.map.N; i++) {
          if (f.owner[i] !== 0 || (Math.floor(i / f.map.W) - mid) * (a ? 1 : -1) < 0) continue;
          const dd = Math.hypot(f.centers.x[i] - meet.x, f.centers.y[i] - meet.y);
          if (dd < bd) { bd = dd; best = i; }
        }
        addVector(f, 0, 'armor', best, meet);
      }
      runDay(f);
      const big = Math.max(0, ...f.pockets[1].map((p) => p.troops));
      if (big > 150) pocketDay = `${d + 1}(${Math.round(big * f.cfg.men)} h)`;
      else if (big > 0 && !pocketDay) islets.push(Math.round(big * f.cfg.men));
    }
    out.tenaille.push(pocketDay);
  }
}

// Préparation : la même attaque (point faible, secteur ordinaire), sans feux, après barrages, après barrages et
// appui aérien sur le point de départ. Chaque jour, deux barrages et deux sorties sur les cases ennemies juste devant.
const prepOut = { armor: { none: [], arty: [], both: [] }, infantry: { none: [], arty: [], both: [] } };
for (let k = 0; k < MAPS; k++) {
  for (const type of ['armor', 'infantry']) {
    for (const prep of ['none', 'arty', 'both']) {
      const f = createFront({ seed: `bench${k}` });
      const row = Math.floor(f.map.H / 2);
      const start = lineCol(f, row - 2, row + 2);
      const l0 = f.stats.losses.slice();
      for (let d = 0; d < DAYS; d++) {
        f.reserve = [0, 0];
        const from = frontCell(f, row);
        const at = { x: f.centers.x[from] + 2.5, y: f.centers.y[from] };
        addVector(f, 0, type, from, { x: f.centers.x[from] + 40, y: f.centers.y[from] });
        if (prep !== 'none') for (let b = 0; b < 2; b++) addBarrage(f, 0, at);
        if (prep === 'both') for (let a = 0; a < 2; a++) addAirMission(f, 0, { x: at.x + a * 1.5, y: at.y });
        runDay(f);
      }
      prepOut[type][prep].push({ profondeur: (lineCol(f, row - 2, row + 2) - start) / DAYS, pertesDE: (f.stats.losses[0] - l0[0]) / DAYS, pertesSU: (f.stats.losses[1] - l0[1]) / DAYS });
    }
  }
}

// Percée blindée sur point faible selon la météo.
const byWeather = {};
for (const w of ['clear', 'rain', 'fog', 'snow']) {
  byWeather[w] = [];
  for (let k = 0; k < MAPS; k++) {
    const f = createFront({ seed: `bench${k}`, weather: w });
    const row = Math.floor(f.map.H / 2);
    for (let i = 0; i < f.map.N; i++) if (Math.abs(Math.floor(i / f.map.W) - row) <= 6) f.entrench[i] = 0;
    const start = lineCol(f, row - 2, row + 2);
    const from = frontCell(f, row);
    addVector(f, 0, 'armor', from, { x: f.centers.x[from] + 40, y: f.centers.y[from] });
    runDay(f);
    byWeather[w].push(lineCol(f, row - 2, row + 2) - start);
  }
}

const avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
console.log(`Front calme      pertes/jour DE ${pct(avg(out.calme, 'de'), 1)} · SU ${pct(avg(out.calme, 'su'), 1)} · cases changées ${avg(out.calme, 'cases').toFixed(1)}   (cible 1–2 %, ~0)`);
const LABEL = { percee: ['Percée, pt faible', '≤ 3 sans feux'], frontale: ['Frontale, renfort', '≈ 0, DE > SU'], infanterie: ['Infant., pt faib', '≤ 1 sans feux'] };
for (const k of ['percee', 'frontale', 'infanterie']) {
  const a = out[k];
  const med = [...a.map((x) => x.profondeur)].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  console.log(`${LABEL[k][0]} profondeur/jour médiane ${med.toFixed(1)} [${a.map((x) => x.profondeur.toFixed(0)).join(' ')}] · pertes/jour DE ${avg(a, 'pertesDE').toFixed(0)} · SU ${avg(a, 'pertesSU').toFixed(0)}   (cible ${LABEL[k][1]})`);
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const PREP = { none: 'sans feux', arty: 'artillerie', both: 'art. + avions' };
const PREP_GOAL = { armor: { none: '≤ 3', arty: '4–6', both: '5–8' }, infantry: { none: '≤ 1', arty: '2–3', both: '3–5' } };
for (const type of ['armor', 'infantry']) {
  for (const p of ['none', 'arty', 'both']) {
    const a = prepOut[type][p];
    console.log(`Préparation ${type === 'armor' ? 'blindés' : 'infant.'} · ${PREP[p].padEnd(13)} profondeur/jour médiane ${med(a.map((x) => x.profondeur)).toFixed(1)} [${a.map((x) => x.profondeur.toFixed(0)).join(' ')}] · pertes/jour DE ${avg(a, 'pertesDE').toFixed(0)} · SU ${avg(a, 'pertesSU').toFixed(0)}   (cible ${PREP_GOAL[type][p]})`);
  }
}
const fmtT = (a) => `médiane ${med(a) === Infinity ? '—' : med(a)} [${a.map((x) => (x === Infinity ? '—' : x)).join(' ')}]`;
console.log(`Traversée 7 cases en ticks : point faible ${fmtT(out.traversee[0])} · fortifié ${fmtT(out.traversee[1])}   (cible : fortifié nettement plus long, ~½ journée de plus)`);
console.log(`Percée blindée sur 1 jour selon le temps (médiane) : ${Object.entries(byWeather).map(([w, a]) => `${w} ${med(a)}`).join(' · ')}`);
console.log(`Tenaille         vraie poche (> 1 500 h) au jour ${out.tenaille.map((d) => d || '—').join(' ')}   (cible 2–3) ; îlots : ${islets.length}`);
