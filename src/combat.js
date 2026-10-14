// Résolution du feu aux dés (d6) et tests de moral ; et, pour le mode Frontline stratégique,
// la physique du front : flux de densité et pression différentielle (voir frontTick en fin de fichier).

import { tileAt, terrainDefense, edgeFlow } from './terrain.js';
import { bfsDistance } from './path.js';
import { hexDistance, DIR_VECTORS } from './hex.js';
import { unitStats } from './units.js';

// Calcule le seuil de réussite (« touche sur X+ ») et le nombre de dés, avec le détail des modificateurs.
export function fireOdds(map, attacker, target, { indirect = false, observed = true, salvo = false } = {}) {
  const sa = unitStats(attacker), st = unitStats(target);
  const ta = tileAt(map, attacker.col, attacker.row), tt = tileAt(map, target.col, target.row);
  const dist = hexDistance(attacker, target);
  const mods = [];
  const add = (v, why) => { if (v) mods.push({ v, why }); };

  add(-sa.hitBonus, 'élite');
  add(terrainDefense(tt, target.type), tt.river && !tt.road && !tt.frozen ? (tt.stream ? 'dans le ruisseau' : 'dans la rivière') : `couvert (${tt.terrain === 'village' ? (tt.ruined ? 'ruines' : 'village') : tt.terrain === 'forest' ? 'forêt' : tt.craters ? 'cratères' : 'terrain'})`);
  add(target.entrench, 'retranchée');
  if (!indirect) {
    if (tt.elev > ta.elev) add(1, 'cible en hauteur');
    if (tt.elev < ta.elev) add(-1, 'tir plongeant');
  }
  if ((attacker.movedHexes ?? 0) * 2 > sa.move) add(1, 'tireur en mouvement');
  if ((target.movedHexes ?? 0) >= 3 && (tt.terrain === 'plain' || tt.terrain === 'farm')) add(-1, 'cible à découvert en mouvement');
  if (st.armored && (attacker.type === 'infantry' || attacker.type === 'recon')) {
    const close = dist <= 1 && (tt.terrain === 'forest' || tt.terrain === 'village');
    add(close ? 0 : 2 - sa.antiArmor, 'cible blindée'); // Panzergrenadiers, Gardes : armes antichars
  }
  if (st.heavyArmor) add(st.heavyArmor, 'blindage épais');
  if (st.armored && attacker.type === 'artillery') add(1, 'blindage');
  if (indirect && !observed) add(1, 'tir non observé');
  if (ta.terrain === 'marsh' && !ta.frozen) add(1, 'tireur embourbé');
  if (target.status === 'routed') add(-1, 'cible en déroute');
  if (attacker.pinned) add(1, 'tireur cloué');

  const threshold = Math.max(2, Math.min(6, 4 + mods.reduce((s, m) => s + m.v, 0)));
  let dice = Math.max(1, Math.round((sa.attack * attacker.hp) / sa.maxHp));
  if (attacker.type === 'artillery' && dist <= 1) dice = Math.max(1, Math.ceil(dice / 2)); // autodéfense
  if (salvo) dice = Math.max(1, Math.ceil((dice * 2) / 3)); // Katioucha : saturation, moins de coups par case
  if (st.armored) dice += sa.antitank; // canon antichar, 85 mm : obus perforants
  const crits = !(st.armored && (attacker.type === 'infantry' || attacker.type === 'recon'));
  return { threshold, dice, mods, crits };
}

export function rollFire(rng, odds) {
  const rolls = Array.from({ length: odds.dice }, () => rng.d6());
  let damage = 0, hits = 0;
  for (const r of rolls) {
    if (r >= odds.threshold) {
      hits++;
      damage += r === 6 && odds.crits ? 2 : 1;
    }
  }
  return { rolls, hits, damage };
}

// Test de moral après des pertes (ou la destruction d'une unité voisine) : d6 + niveau + modificateurs ≥ 5 pour tenir.
// ctx : forced (test même sans pertes), isolated (aucun allié à 2 hex), pincer (feu venu de côtés opposés),
// support (allié adjacent retranché).
export function moraleCheck(map, unit, hpBefore, rng, { forced = false, isolated = false, pincer = false, support = false } = {}) {
  const s = unitStats(unit);
  const lost = hpBefore - unit.hp;
  const shaken = forced || unit.hp <= s.maxHp * 0.35 || lost >= hpBefore * 0.4;
  if (!shaken) return null;
  const t = tileAt(map, unit.col, unit.row);
  const mods = [];
  const add = (v, why) => { if (v) mods.push({ v, why }); };
  add(unit.entrench > 0 ? 1 : 0, 'retranchée');
  add(t.terrain === 'village' || t.terrain === 'forest' ? 1 : 0, 'à couvert');
  add(support ? 1 : 0, 'soutien retranché');
  add(isolated ? -1 : 0, 'isolée');
  add(pincer ? -1 : 0, 'prise en tenaille');
  const roll = rng.d6();
  const total = roll + unit.level + mods.reduce((a, m) => a + m.v, 0);
  return { roll, total, held: roll !== 1 && total >= 5, mods };
}

// ---------- Frontline stratégique : pression différentielle ----------
// Plus de jets de dés : chaque case porte une densité de troupes de son propriétaire. À chaque tick,
// 1. la densité coule : le long des vecteurs d'ordres (part w de la case), sinon par colmatage élastique
//    vers les cases de front qui en ont besoin ;
// 2. aux contacts, chaque camp use l'autre (escarmouche) et les vecteurs poussent : la pression P d'une case
//    ennemie est la somme des densités qui la visent ; elle inflige des pertes, subit la riposte, et si
//    P > BREAK × défense (densité × terrain × qualité), la case est conquise, l'assaillant y entre ;
// 3. une case vidée au contact d'une densité ennemie suffisante est réoccupée sans ordre.
// Tout est calculé sur l'état de début de tick puis appliqué : aucun camp ne joue « avant » l'autre.

export const FRONT_RULES = {
  SKIRMISH: 0.0006, // usure mutuelle au contact, par tick (front calme : ~1,5 % de pertes par jour)
  ASSAULT: 0.06, // pertes infligées par unité de pression
  DEF_FIRE: 0.8, // riposte de la case assaillie
  BREAK: 1.6, // la pression doit dépasser BREAK × la défense pour entamer la case
  BREACH: 0.35, // remplissage de la jauge de brèche par tick, par point de rapport pression / défense au-delà de BREAK
  BREACH_DECAY: 0.7, // la jauge se vide quand la pression cesse
  FORT_EXP: 3, // seuil de la jauge = (terrain × retranchement) ^ FORT_EXP : forcer une ligne fortifiée prend du temps
  ADVANCE: 0.4, // part de la densité des assaillants qui entre dans la case conquise
  ELASTIC: 0.25, // vitesse du colmatage élastique (trop rapide, il rendait toute percée impossible)
  FRONT_NEED: 7, // besoin d'une case de front (le besoin décroît de moitié environ par case vers l'arrière)
  REAR_NEED: 0.4, // besoin d'une case d'arrière
  THREAT: 0.15, // besoin supplémentaire par unité de densité ennemie au contact
  EMPTY: 0.3, // en dessous : case considérée vide
  HOLD_MIN: 2, // densité minimale pour réoccuper une case vide sans ordre
  LINE_NEED: 0.8, // besoin supplémentaire des cases d'une ligne de défense
  // Cohésion : une case engagée dont l'ennemi tient plus de deux voisines (pointe ou flanc découvert) avance et frappe
  // moins fort, jusqu'à −COHESION quand elle est presque cernée. Les blindés n'en subissent qu'une part (ARMOR_DARE) :
  // la Blitzkrieg reste possible, au prix de flancs fragiles.
  COHESION: 0.6,
  ARMOR_DARE: 0.35,
  // Saillant d'une case de large : feux croisés (usure × 1 + CROSSFIRE par voisine ennemie au-delà de deux) et
  // étranglement : une case dont l'ennemi tient au moins SQUEEZE_N voisines tombe si leur densité dépasse
  // SQUEEZE × sa défense. Les doigts de gant ne survivent plus sans être élargis.
  CROSSFIRE: 0.8,
  SQUEEZE_N: 4,
  SQUEEZE: 3,
};

// Champs d'ordres d'un camp (calculés par front.js) : w (part engagée sur un vecteur), dx, dy (direction),
// speed (part de la densité engagée qui avance par tick), atk (puissance de choc), fort (bonus défensif),
// skirm (multiplicateur d'usure infligée : forteresses).
export function emptyField(N) {
  return {
    w: new Float32Array(N), dx: new Float32Array(N), dy: new Float32Array(N),
    speed: new Float32Array(N), atk: new Float32Array(N), fort: new Float32Array(N).fill(1), skirm: new Float32Array(N).fill(1),
    cover: new Float32Array(N).fill(1), // usure subie (repli ordonné : < 1)
  };
}

// Besoin de troupes de chaque case de son camp (colmatage élastique) : fort au contact, d'autant plus
// que l'ennemi y est dense, faible à l'arrière.
export function frontNeed(front, s) {
  const { map, owner, dens } = front;
  const { N, nb } = map;
  const R = FRONT_RULES;
  const seeds = [];
  const threat = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (owner[i] !== s) continue;
    let t = 0, contact = false;
    for (let d = 0; d < 6; d++) {
      const j = nb[i * 6 + d];
      if (j >= 0 && owner[j] === 1 - s) { contact = true; t += dens[j]; }
    }
    if (contact) { seeds.push(i); threat[i] = t; }
  }
  const dist = bfsDistance(nb, N, seeds, (i) => owner[i] === s, 12);
  const need = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (owner[i] !== s) continue;
    need[i] = R.REAR_NEED + R.FRONT_NEED * 0.55 ** dist[i] + R.THREAT * threat[i];
    // Ligne de défense : les cases tracées attirent les troupes voisines.
    if (front.lineMask?.[i]) need[i] *= 1 + R.LINE_NEED;
  }
  return { need, dist, threat };
}

// Un tick de résolution. front : { map, owner, dens, field: [champ DE, champ SU], quality: [qDE, qSU], stats }.
// Renvoie les événements du tick (cases conquises, troupes anéanties faute de repli).
export function frontTick(front) {
  const { map, owner, dens, field, quality } = front;
  const { N, nb } = map;
  const R = FRONT_RULES;
  const delta = new Float32Array(N);
  const loss = new Float32Array(N);
  const push = new Float32Array(N); // pression des vecteurs reçue par chaque case
  const edges = []; // poussées : [i assaillant, j visé, valeur]
  const q = new Float32Array(6);
  const needs = [frontNeed(front, 0), frontNeed(front, 1)];
  // Voisines ennemies de chaque case (saillants : feux croisés, étranglement, cohésion des poussées).
  const foesOf = new Uint8Array(N), cross = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const s = owner[i];
    if (s < 0) continue;
    let k = 0;
    for (let d = 0; d < 6; d++) { const j = nb[i * 6 + d]; if (j >= 0 && owner[j] === 1 - s) k++; }
    foesOf[i] = k;
    cross[i] = 1 + R.CROSSFIRE * Math.max(0, k - 2);
  }

  for (let i = 0; i < N; i++) {
    const s = owner[i];
    if (s < 0 || dens[i] <= 1e-4) continue;
    const S = field[s], o = 1 - s;
    const w = S.w[i];
    // 1a. Vecteurs : la part engagée avance dans la direction de l'ordre ; ce qui bute sur l'ennemi le pousse.
    if (w > 0.01) {
      let sum = 0;
      const foes = foesOf[i];
      // Part blindée de la poussée, déduite de sa puissance de choc (1,2 infanterie, 1,8 blindés).
      const armored = Math.max(0, Math.min(1, (S.atk[i] - 1.2) / 0.6));
      const cohesion = 1 - R.COHESION * (Math.max(0, foes - 2) / 4) * (1 - armored * (1 - R.ARMOR_DARE));
      for (let d = 0; d < 6; d++) {
        const j = nb[i * 6 + d];
        q[d] = 0;
        if (j < 0 || owner[j] < 0) continue;
        const dot = DIR_VECTORS[d].x * S.dx[i] + DIR_VECTORS[d].y * S.dy[i];
        if (dot <= 0.05) continue;
        q[d] = dot * dot * (owner[j] === s ? edgeFlow(map, i, j) : Math.max(0.25, map.flow[j]));
        sum += q[d];
      }
      if (sum > 0) {
        const moving = dens[i] * w * S.speed[i] * cohesion;
        for (let d = 0; d < 6; d++) {
          if (!q[d]) continue;
          const j = nb[i * 6 + d], share = q[d] / sum;
          if (owner[j] === s) { delta[i] -= moving * share; delta[j] += moving * share; }
          else {
            const v = dens[i] * w * S.atk[i] * quality[s] * share * cohesion;
            push[j] += v;
            edges.push(i, j, v);
          }
        }
      }
    }
    // 1b. Colmatage élastique (part non engagée) : la densité relative (densité / besoin) s'égalise.
    const e = 1 - w;
    const { need } = needs[s];
    if (e > 0.01) {
      const rho = dens[i] / need[i];
      let out = 0;
      for (let d = 0; d < 6; d++) {
        const j = nb[i * 6 + d];
        q[d] = 0;
        if (j < 0 || owner[j] !== s) continue;
        const gap = rho - dens[j] / need[j];
        if (gap <= 0) continue;
        q[d] = (R.ELASTIC / 6) * e * edgeFlow(map, i, j) * gap * Math.min(need[i], need[j]);
        out += q[d];
      }
      const k = out > dens[i] * 0.45 ? (dens[i] * 0.45) / out : 1;
      for (let d = 0; d < 6; d++) {
        if (!q[d]) continue;
        delta[i] -= q[d] * k;
        delta[nb[i * 6 + d]] += q[d] * k;
      }
    }
    // 2a. Escarmouche : usure lente et mutuelle de part et d'autre du front. Elle dépend des deux densités face
    // à face (moyenne géométrique), du rapport des qualités, et elle est freinée par le terrain du défenseur.
    for (let d = 0; d < 6; d++) {
      const j = nb[i * 6 + d];
      if (j < 0 || owner[j] !== o) continue;
      loss[j] += (R.SKIRMISH * Math.sqrt(dens[i] * dens[j]) * (quality[s] / quality[o]) * S.skirm[i] * field[o].cover[j] * cross[j]) / (map.def[j] * field[o].fort[j]);
    }
  }

  // 2b. Assauts : pertes du défenseur, riposte répartie sur les assaillants au prorata de leur poussée.
  const defense = (j) => dens[j] * map.def[j] * quality[owner[j]] * field[owner[j]].fort[j];
  for (let j = 0; j < N; j++) {
    if (!push[j]) continue;
    const F = push[j], D = defense(j);
    // Une troupe qui décroche en bon ordre (repli) subit moins de pertes d'assaut : elle cède le terrain au lieu de le tenir.
    loss[j] += (R.ASSAULT * F * field[owner[j]].cover[j]) / (map.def[j] * field[owner[j]].fort[j]);
    const riposte = R.ASSAULT * R.DEF_FIRE * D * Math.sqrt(Math.min(1, F / Math.max(D, 1e-6)));
    for (let k = 0; k < edges.length; k += 3) if (edges[k + 1] === j) loss[edges[k]] += riposte * (edges[k + 2] / F);
  }

  // Application des flux et des pertes.
  for (let i = 0; i < N; i++) {
    if (owner[i] < 0) continue;
    const l = Math.min(Math.max(0, dens[i] + delta[i]), loss[i]);
    front.stats.losses[owner[i]] += l;
    dens[i] = Math.max(0, dens[i] + delta[i] - loss[i]);
  }

  // 3. Conquêtes : pression supérieure à BREAK × défense restante, ou case vide face à une densité suffisante.
  const events = [];
  const captured = new Uint8Array(N);
  if (!front.breach) front.breach = new Float32Array(N);
  const breach = front.breach;
  const pressed = new Uint8Array(N);
  const tryCapture = (j, s, attackers) => {
    const o = owner[j];
    // Les survivants refluent vers leurs propres cases voisines ; sans repli possible, ils sont perdus.
    const back = [];
    for (let d = 0; d < 6; d++) { const n = nb[j * 6 + d]; if (n >= 0 && owner[n] === o) back.push(n); }
    if (back.length) for (const n of back) dens[n] += dens[j] / back.length;
    else if (dens[j] > 0) { front.stats.losses[o] += dens[j]; events.push({ kind: 'trapped', i: j, side: o, amount: dens[j] }); }
    owner[j] = s;
    captured[j] = 1;
    let enter = 0;
    for (const [i, share] of attackers) { const m = dens[i] * R.ADVANCE * share; dens[i] -= m; enter += m; }
    dens[j] = enter;
    front.stats.captured[s]++;
    events.push({ kind: 'capture', i: j, side: s });
  };
  for (let j = 0; j < N; j++) {
    const o = owner[j];
    if (o < 0 || captured[j]) continue;
    const s = 1 - o;
    if (push[j] > 0) {
      // Pression restante des assaillants encore en place (ils ont pu fondre sous la riposte).
      let F = 0;
      const att = [];
      for (let k = 0; k < edges.length; k += 3) {
        if (edges[k + 1] !== j) continue;
        const i = edges[k];
        if (owner[i] !== s || captured[i] === 2) continue;
        const v = edges[k + 2] * Math.min(1, dens[i] / Math.max(1e-6, dens[i] + loss[i]));
        F += v;
        att.push([i, v]);
      }
      // Brèche : tant que la pression dépasse BREAK × la défense, la jauge de la case se remplit, d'autant plus vite que
      // le rapport des forces est écrasant ; la case tombe quand elle est pleine. Fortifications et hauteurs, qui
      // gonflent la défense, retardent ainsi la percée au lieu de seulement coûter plus cher.
      const ratio = F / Math.max(defense(j), 1e-6);
      if (F > 0.3 && ratio > R.BREAK) {
        breach[j] += R.BREACH * (ratio - R.BREAK);
        pressed[j] = 1;
        if (breach[j] >= (map.def[j] * field[o].fort[j]) ** R.FORT_EXP * field[o].cover[j]) {
          breach[j] = 0;
          tryCapture(j, s, att.map(([i, v]) => [i, v / F]));
          front.stats.byBreach++;
          continue;
        }
      }
    }
    // Étranglement d'un saillant étroit, sans ordre : les voisines ennemies se referment sur lui.
    if (foesOf[j] >= R.SQUEEZE_N) {
      let F = 0;
      const att = [];
      for (let d = 0; d < 6; d++) {
        const n = nb[j * 6 + d];
        if (n >= 0 && owner[n] === s && !captured[n]) { F += dens[n] * quality[s]; att.push([n, dens[n]]); }
      }
      if (F > R.SQUEEZE * defense(j) + R.HOLD_MIN) {
        tryCapture(j, s, att.map(([n, v]) => [n, (0.6 * v * quality[s]) / F]));
        front.stats.bySqueeze = (front.stats.bySqueeze ?? 0) + 1;
        continue;
      }
    }
    if (dens[j] < R.EMPTY) {
      let best = -1;
      for (let d = 0; d < 6; d++) {
        const n = nb[j * 6 + d];
        if (n >= 0 && owner[n] === s && !captured[n] && dens[n] > R.HOLD_MIN && (best < 0 || dens[n] > dens[best])) best = n;
      }
      if (best >= 0 && dens[best] * quality[s] > R.BREAK * defense(j) + R.HOLD_MIN) {
        tryCapture(j, s, [[best, 0.6]]);
        front.stats.byEmpty++;
      }
    }
  }
  for (let j = 0; j < N; j++) if (!pressed[j] && breach[j] > 0) breach[j] = breach[j] * R.BREACH_DECAY < 0.01 ? 0 : breach[j] * R.BREACH_DECAY;
  front.tickLoss = loss; // pertes par case de ce tick (sons et effets du front)
  front.tickEdges = edges; // poussées de ce tick : [assaillant, visé, pression] × n (obus des blindés)
  return events;
}
