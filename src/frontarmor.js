// Formations blindées du front stratégique : divisions de Panzer, corps blindés soviétiques.
//
// Contrairement à l'infanterie (une densité qui coule), une formation est une unité : une position, des chars, une
// expérience, du carburant, et des grenadiers portés qu'elle dépose dans les cases qu'elle prend. Le matin, on lui
// donne un objectif ; dans la journée, elle rejoint le front par ses propres lignes (plus vite sur route, mal en
// forêt, pas du tout à travers une rivière sans pont), puis elle frappe la case ennemie devant elle (et, plus
// légèrement, ses deux voisines) : sa pression s'ajoute à celle de l'infanterie dans le moteur (combat.js).
// Quand la case tombe, elle y entre ; face au vide, elle exploite et file. La riposte, les obstacles antichar, les
// villes et les forêts lui coûtent des chars ; à sec de carburant elle s'arrête ; coupée de ses arrières, elle ne se
// ravitaille plus ; si sa case tombe sans repli possible, elle est perdue.
// Positions en unités de grille, comme les ordres.

export const ARMOR_SETUP = [
  [
    { name: '3. Panzer-Division', tanks: 160, exp: 1.4, gren: 130 },
    { name: '11. Panzer-Division', tanks: 140, exp: 1.8, gren: 120 },
  ],
  [
    { name: '1er corps blindé', tanks: 150, exp: 0.4, gren: 110 },
    { name: '5e corps blindé de la Garde', tanks: 170, exp: 0.9, gren: 120 },
    { name: '18e corps blindé', tanks: 120, exp: 0.2, gren: 90 },
  ],
];

export const ARMOR_RULES = {
  shock: 0.55, // pression par char sur la case visée (× qualité, expérience, terrain)
  flank: 0.35, // part portée sur les deux cases voisines de la visée
  defense: 0.08, // densité défensive équivalente par char, dans sa propre case
  tankLoss: 0.9, // chars perdus par unité de riposte reçue
  wear: 0.3, // part des pertes de densité de sa case qui touchent aussi ses chars
  speed: 0.8, // unités de grille par tick en marche (× fluidité blindée)
  cooldown: 2, // ticks au moins entre deux cases prises
  fuelAttack: 0.025, // carburant par tick d'attaque
  fuelMove: 0.008, // par tick de marche
  refuel: 0.6, // la nuit, ravitaillée
  repair: 0.05, // la nuit, part des chars perdus remis en ligne (ravitaillée, sans avoir combattu le soir)
  drop: 3, // grenadiers déposés dans une case prise
  expPerCell: 0.02,
  levels: [[0.5, 'Bleue'], [1.5, 'Aguerrie'], [2.5, 'Vétéran'], [Infinity, 'Élite']],
};

export const expLabel = (e) => ARMOR_RULES.levels.find(([lim]) => e < lim)[1];
export const expFactor = (e) => 1 + 0.15 * e;

const cellOf = (front, x, y) => {
  // Case la plus proche (grille hexagonale « pointy-top », taille 1).
  const { W, H } = front.map;
  const row = Math.max(0, Math.min(H - 1, Math.round((y - 1) / 1.5)));
  const col = Math.max(0, Math.min(W - 1, Math.round((x - Math.sqrt(3) / 2) / Math.sqrt(3) - 0.5 * (row & 1))));
  let best = row * W + col, bd = Infinity;
  for (const r of [row - 1, row, row + 1]) {
    if (r < 0 || r >= H) continue;
    for (const c of [col - 1, col, col + 1]) {
      if (c < 0 || c >= W) continue;
      const i = r * W + c, d = Math.hypot(front.centers.x[i] - x, front.centers.y[i] - y);
      if (d < bd) { bd = d; best = i; }
    }
  }
  return best;
};

export function createArmor(front, setup = ARMOR_SETUP) {
  const { W, H, N } = front.map;
  const cx = front.centers.x, cy = front.centers.y;
  const out = [];
  let id = 1;
  for (const s of [0, 1]) {
    const list = setup[s];
    list.forEach((u, k) => {
      // Derrière le front, réparties du nord au sud, à ~8 cases de la ligne (en arrière de l'artillerie).
      const row = Math.round(((k + 0.5) / list.length) * H);
      let edge = -1;
      for (let c = 0; c < W; c++) {
        const i = row * W + (s === 0 ? c : W - 1 - c);
        if (front.owner[i] === 1 - s) break;
        if (front.owner[i] === s) edge = i;
      }
      const want = edge >= 0 ? { x: cx[edge] - (s === 0 ? 15 : -15), y: cy[edge] } : { x: s === 0 ? 20 : cx[W - 1] - 20, y: cy[row * W] };
      let best = -1, bd = Infinity;
      for (let i = 0; i < N; i++) {
        if (front.owner[i] !== s || front.map.flowA[i] <= 0.3) continue;
        const d = Math.hypot(cx[i] - want.x, cy[i] - want.y);
        if (d < bd) { bd = d; best = i; }
      }
      out.push({ id: id++, side: s, name: u.name, tanks: u.tanks, max: u.tanks, exp: u.exp, gren: u.gren, fuel: 1, cell: best, x: cx[best], y: cy[best], target: null, cool: 0, lost: false, fought: false, dir: s === 0 ? 0 : Math.PI, seen: [null, null], trail: [] });
    });
  }
  return out;
}

export function setArmorOrder(front, s, id, target) {
  if (front.phase !== 'plan') return { error: 'Les ordres se donnent le matin.' };
  const a = front.armor.find((x) => x.id === id && x.side === s && !x.lost);
  if (!a) return { error: 'Formation introuvable.' };
  a.target = target ? { x: target.x, y: target.y } : null;
  return a;
}

// Case voisine de c la mieux alignée sur la direction (dx, dy) ; filtre : condition sur la case.
function stepToward(front, c, dx, dy, ok) {
  const { nb } = front.map;
  const L = Math.hypot(dx, dy) || 1;
  let best = -1, bv = 0.15;
  for (let d = 0; d < 6; d++) {
    const j = nb[c * 6 + d];
    if (j < 0 || !ok(j)) continue;
    const ex = front.centers.x[j] - front.centers.x[c], ey = front.centers.y[j] - front.centers.y[c];
    const v = (ex * dx + ey * dy) / (L * Math.hypot(ex, ey));
    if (v > bv) { bv = v; best = j; }
  }
  return best;
}

// Avant les assauts du tick : pression des formations au contact de l'ennemi, ajoutée à push. Renvoie les poussées
// [formation, case visée, valeur] et la défense ajoutée par les chars à leur propre case.
export function armorPressure(front, push) {
  const R = ARMOR_RULES;
  const { nb } = front.map;
  const hits = [];
  const def = new Map();
  for (const a of front.armor) {
    if (a.lost) continue;
    def.set(a.cell, (def.get(a.cell) ?? 0) + a.tanks * R.defense * expFactor(a.exp));
    a.attacking = false;
    if (!a.target || a.fuel <= 0 || a.cool > 0 || front.owner[a.cell] !== a.side) continue;
    const dx = a.target.x - front.centers.x[a.cell], dy = a.target.y - front.centers.y[a.cell];
    if (Math.hypot(dx, dy) < 1.2) continue;
    const j = stepToward(front, a.cell, dx, dy, (k) => front.owner[k] === 1 - a.side);
    if (j < 0) continue;
    // Ne frappe que si la case visée est bien devant (sinon elle avance d'abord dans ses lignes).
    const own = stepToward(front, a.cell, dx, dy, (k) => front.owner[k] === a.side && front.map.flowA[k] > 0.05);
    if (own >= 0) {
      const dj = (front.centers.x[j] - front.centers.x[a.cell]) * dx + (front.centers.y[j] - front.centers.y[a.cell]) * dy;
      const dn = (front.centers.x[own] - front.centers.x[a.cell]) * dx + (front.centers.y[own] - front.centers.y[a.cell]) * dy;
      if (dn > dj * 1.05) continue;
    }
    // Ravitaillement (dépôts loin derrière) et fatigue réduisent le choc.
    const sup = front.supplyK?.[a.side][a.cell] ?? 1;
    const base = a.tanks * R.shock * front.quality[a.side] * expFactor(a.exp) * sup * (1 - 0.4 * (a.fatigue ?? 0));
    const hit = (k, share) => {
      const v = base * share * front.map.atkA[k] * (1 - 0.6 * (front.at?.[k] ?? 0));
      if (v <= 0) return;
      push[k] += v;
      hits.push(a.id, k, v);
    };
    hit(j, 1);
    for (let d = 0; d < 6; d++) {
      const k = nb[a.cell * 6 + d];
      if (k < 0 || k === j || front.owner[k] !== 1 - a.side) continue;
      const n = nb.subarray(j * 6, j * 6 + 6);
      if (n.includes(k)) hit(k, R.flank);
    }
    a.attacking = true;
    a.aim = j;
    a.fuel = Math.max(0, a.fuel - R.fuelAttack / Math.max(0.5, sup));
    a.fatigue = Math.min(1, (a.fatigue ?? 0) + 0.04);
  }
  return { hits, def };
}

// Riposte d'une case assaillie : la part qui revient aux formations (au prorata de leur poussée) coûte des chars.
export function armorRiposte(front, hits, j, riposte, F) {
  for (let k = 0; k < hits.length; k += 3) {
    if (hits[k + 1] !== j) continue;
    const a = front.armor.find((x) => x.id === hits[k]);
    const harsh = (1 + 1.5 * (front.at?.[j] ?? 0)) * (2 - front.map.atkA[j]);
    a.tanks = Math.max(0, a.tanks - riposte * (hits[k + 2] / F) * ARMOR_RULES.tankLoss * harsh / expFactor(a.exp));
    a.fought = true;
  }
}

// Pression restante des formations sur la case j (pour la jauge de brèche).
export function armorRemaining(front, hits, j) {
  let F = 0;
  for (let k = 0; k < hits.length; k += 3) {
    if (hits[k + 1] !== j) continue;
    const a = front.armor.find((x) => x.id === hits[k]);
    if (a.tanks > 1) F += hits[k + 2];
  }
  return F;
}

// Après le tick : usure des chars dans leur case, entrée dans la case prise (grenadiers déposés), marche dans ses
// lignes vers l'objectif, repli ou perte si sa case est tombée.
export function armorAfter(front, lossBefore, densBefore, events) {
  const R = ARMOR_RULES;
  const { nb } = front.map;
  for (const a of front.armor) {
    if (a.lost) continue;
    const c = a.cell;
    if (densBefore[c] > 0.5 && lossBefore[c] > 0) a.tanks = Math.max(0, a.tanks - (lossBefore[c] / densBefore[c]) * a.tanks * R.wear);
    if (a.cool > 0) a.cool--;
    // Case tombée : repli sur une case amie voisine, ou perte.
    if (front.owner[c] !== a.side) {
      let back = -1;
      for (let d = 0; d < 6; d++) { const j = nb[c * 6 + d]; if (j >= 0 && front.owner[j] === a.side && (back < 0 || front.dens[j] > front.dens[back])) back = j; }
      if (back < 0) { a.lost = true; events.push({ kind: 'armorLost', side: a.side, id: a.id }); continue; }
      a.tanks *= 0.8;
      moveTo(front, a, back);
    }
    if (a.tanks < a.max * 0.08) { a.lost = true; events.push({ kind: 'armorLost', side: a.side, id: a.id, spent: true }); continue; }
    // Entrée dans la case visée si elle vient de tomber.
    if (a.attacking && a.aim >= 0 && front.owner[a.aim] === a.side) {
      moveTo(front, a, a.aim);
      const drop = Math.min(a.gren, R.drop);
      a.gren -= drop;
      front.dens[a.aim] += drop;
      a.exp = Math.min(3, a.exp + R.expPerCell);
      a.cool = Math.ceil(R.cooldown / Math.max(0.3, front.map.flowA[a.aim]));
      continue;
    }
    // Marche dans ses lignes vers l'objectif.
    if (a.target && !a.attacking && a.fuel > 0) {
      const dx = a.target.x - a.x, dy = a.target.y - a.y;
      if (Math.hypot(dx, dy) < 1.2) { a.target = null; continue; }
      a.progress = (a.progress ?? 0) + R.speed * Math.max(0.1, front.map.flowA[c]);
      if (a.progress >= 1.7) {
        const j = stepToward(front, c, dx, dy, (k) => front.owner[k] === a.side && front.map.flowA[k] > 0.05);
        if (j >= 0) { moveTo(front, a, j); a.fuel = Math.max(0, a.fuel - R.fuelMove); }
        a.progress = 0;
      }
    }
  }
}

function moveTo(front, a, j) {
  const px = front.centers.x[a.cell], py = front.centers.y[a.cell];
  a.cell = j;
  a.x = front.centers.x[j];
  a.y = front.centers.y[j];
  a.dir = Math.atan2(a.y - py, a.x - px);
  a.trail.push(j);
  if (a.trail.length > 40) a.trail.shift();
}

// Nuit : plein et remise en état si la formation est ravitaillée (reliée à son bord de carte).
export function armorNight(front) {
  const R = ARMOR_RULES;
  for (const a of front.armor) {
    if (a.lost) continue;
    const supplied = front.supplied[a.side][a.cell];
    if (supplied) {
      a.fuel = Math.min(1, a.fuel + (front.cfg.refuel?.[a.side] ?? R.refuel));
      a.tanks = Math.min(a.max, a.tanks + (a.max - a.tanks) * R.repair * (a.fought ? 0.5 : 1));
      a.gren = Math.min(a.gren + 10, 200);
    }
    a.fought = false;
    a.trail = [];
  }
}

// Ce que le camp s sait des formations ennemies : repérées si leur case est en vue.
export function updateArmorSightings(front) {
  for (const a of front.armor) {
    const s = 1 - a.side;
    if (a.lost) { a.seen[s] = null; continue; }
    if (front.vision[s]?.[a.cell]) a.seen[s] = { x: a.x, y: a.y, dir: a.dir, clock: front.clock, tanks: a.tanks };
  }
}

export function visibleArmor(front, viewer) {
  const out = [];
  for (const a of front.armor ?? []) {
    if (a.lost) continue;
    if (viewer === null || a.side === viewer) { out.push({ a, x: a.x, y: a.y, dir: a.dir, tanks: a.tanks, known: true }); continue; }
    const s = a.seen[viewer];
    if (s && front.clock - s.clock <= front.cfg.ticks) out.push({ a, x: s.x, y: s.y, dir: s.dir, tanks: s.tanks, known: front.clock - s.clock <= 1 });
  }
  return out;
}

export { cellOf as armorCellAt };
