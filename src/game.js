// Moteur de bataille : état, déploiement, brouillard de guerre, exécution simultanée des ordres, combat, victoire.

import { createRng } from './rng.js';
import { DEFAULT_CONDITIONS, WEATHER, effectiveVision } from './conditions.js';
import { generateMap, neighbors } from './mapgen.js';
import { hexDistance, hexToPixel, toCube, fromCube, sameHex } from './hex.js';
import { tileAt, moveCost, hasLOS, TERRAIN, isUrban } from './terrain.js';
import { unitStats, other, UNIT_TYPES, hpState } from './units.js';
import { fireOdds, rollFire, moraleCheck } from './combat.js';
import { reachable, pathFrom, hexKey } from './path.js';

export const onMap = (u) => u.status === 'ok' || u.status === 'routed';
export const active = (u) => u.status === 'ok';

export const retreatCol = (state, side) => (side === 'DE' ? 0 : state.map.W - 1);

export function deployZone(state, side) {
  const W = state.map.W;
  return side === 'DE' ? [0, 1, 2] : [W - 3, W - 2, W - 1];
}

// Zone de déploiement : trois colonnes au bord de son camp ; en bataille de rue, le défenseur se poste dans toute la
// ville (et sur ses abords, jusqu'à deux hexagones), l'attaquant arrive par son bord.
export function inDeployZone(state, side, t) {
  const town = state.map.town;
  if (state.kind === 'ville' && town && side === state.defender) {
    return t.col >= town.c0 - 2 && t.col <= town.c1 + 2 && t.row >= town.r0 - 1 && t.row <= town.r1 + 1;
  }
  return deployZone(state, side).includes(t.col);
}

export function unitAt(state, h) {
  return state.units.find((u) => onMap(u) && u.col === h.col && u.row === h.row) ?? null;
}

function strength(units) {
  return units.filter(active).reduce((s, u) => s + UNIT_TYPES[u.type].cost * (u.hp / unitStats(u).maxHp), 0);
}

// Bataille de rue (kind 'ville') : map fournie (urbangen.js), attacker ('DE' ou 'SU'), fire : feux hors carte de chaque
// camp { DE: { barrage, support }, SU: … } (barrages focalisés et tirs d'appui, voir callFire).
export function createBattle({ seed, playerSide, armies, kind = 'rencontre', maxTurns = 12, title = null, conditions = DEFAULT_CONDITIONS, map: given = null, attacker = null, fire = null }) {
  const map = given ?? generateMap(seed, { objective: kind === 'assaut', biome: conditions.biome });
  // Météo : terrain lourd hors route, eau et marais gelés par la neige.
  const weather = WEATHER[conditions.weather];
  map.mud = weather.mud;
  map.weather = conditions.weather;
  if (weather.frozen) for (const t of map.tiles) if (t.river || t.terrain === 'marsh') t.frozen = true;
  const state = {
    seed,
    map,
    conditions,
    rng: createRng(`battle:${seed}`),
    kind,
    title: title ?? map.name,
    turn: 1,
    maxTurns,
    phase: 'deploy',
    playerSide,
    units: [...armies.DE, ...armies.SU],
    memory: { DE: {}, SU: {} },
    visibility: {},
    objective: map.objective ? { ...map.objective, owner: null, hold: 0 } : null,
    result: null,
    log: [],
  };
  if (kind === 'ville') {
    state.attacker = attacker ?? 'DE';
    state.defender = other(state.attacker);
    state.blocks = (map.blocks ?? []).map((b) => ({ ...b, owner: state.defender, contested: false }));
    state.fire = { DE: { barrage: 0, support: 0, ...(fire?.DE ?? {}) }, SU: { barrage: 0, support: 0, ...(fire?.SU ?? {}) } };
    state.calls = { DE: [], SU: [] };
  }
  for (const u of state.units) {
    u.status = 'ok';
    // Retranchement de départ (bataille de rue : ouvrages de la ville sur le front stratégique).
    u.entrench = Math.min(unitStats(u).entrenchMax, u.startDig ?? 0);
    u.pinned = false;
    u.xpGained = 0;
    // Munitions d'artillerie : stock plein au début de chaque bataille ; le tir à vue peut être coupé pour l'économiser.
    u.ammo = UNIT_TYPES[u.type].ammo ?? null;
    u.holdFire = false;
    u.reloading = false; // Katioucha : un tour de rechargement après chaque salve
    u.orders = { path: [], entrench: false, fireAt: null };
  }
  autoDeploy(state, 'DE');
  autoDeploy(state, 'SU');
  state.initialStrength = { DE: strength(armies.DE), SU: strength(armies.SU) };
  updateVisibility(state);
  return state;
}

export function canDeployAt(state, side, h) {
  const t = tileAt(state.map, h.col, h.row);
  return !!t && inDeployZone(state, side, t) && !unitAt(state, h) && !(t.river && !t.road);
}

// Déploiement automatique : reconnaissance et blindés devant, artillerie derrière, en privilégiant le bon terrain.
export function autoDeploy(state, side) {
  if (state.kind === 'ville') return autoDeployUrban(state, side);
  const { map, rng } = state;
  const cols = deployZone(state, side);
  const front = side === 'DE' ? cols[2] : cols[0];
  const back = side === 'DE' ? cols[0] : cols[2];
  const prefCol = { recon: front, tank: front, infantry: cols[1], at: cols[1], artillery: back };
  const units = state.units.filter((u) => u.side === side);
  for (const u of units) { u.col = -10; u.row = -10; }
  const order = ['recon', 'tank', 'infantry', 'at', 'artillery'];
  units.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  units.forEach((u, i) => {
    const wantRow = ((i + 0.5) / units.length) * map.H;
    let best = null, bestScore = -Infinity;
    for (const t of map.tiles) {
      if (!canDeployAt(state, side, t)) continue;
      if (t.terrain === 'marsh') continue;
      const score = -Math.abs(t.col - prefCol[u.type]) * 1.5 - Math.abs(t.row - wantRow) * 0.6
        + TERRAIN[t.terrain].def * 0.8 + t.elev * 0.3 + rng.next() * 0.5;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    u.col = best.col;
    u.row = best.row;
  });
}

// ---------- Brouillard de guerre ----------

// turn : l'heure qui compte pour la lumière (fin d'un tour = début du suivant).
export function computeVisibility(state, side, turn = state.turn) {
  const { map } = state;
  const cond = state.conditions ?? DEFAULT_CONDITIONS;
  const heights = !WEATHER[cond.weather].noHeights; // dans le brouillard, les hauteurs ne voient pas plus loin
  const hexes = new Set();
  const own = state.units.filter((u) => u.side === side && onMap(u));
  for (const u of own) {
    const ut = tileAt(map, u.col, u.row);
    const range = Math.max(1, effectiveVision(unitStats(u).vision + (heights && ut.elev >= 2 ? 1 : 0), cond, turn) - (u.status === 'routed' ? 2 : 0));
    for (const t of map.tiles) {
      const d = hexDistance(u, t);
      if (d <= range && hasLOS(map, u, t)) hexes.add(t.row * map.W + t.col);
    }
  }
  const units = new Set();
  for (const e of state.units) {
    if (e.side === side || !onMap(e)) continue;
    if (!hexes.has(e.row * map.W + e.col)) continue;
    const t = tileAt(map, e.col, e.row);
    // Un antichar embusqué en couvert ne se repère qu'au contact, tant qu'il n'a pas tiré.
    const spot = e.type === 'at' ? 1 : 2;
    const near = own.some((u) => hexDistance(u, e) <= spot);
    if (!TERRAIN[t.terrain].conceal || near || e.revealed) units.add(e.id);
  }
  return { hexes, units };
}

export function updateVisibility(state, turn = state.turn) {
  for (const side of ['DE', 'SU']) {
    const vis = computeVisibility(state, side, turn);
    state.visibility[side] = vis;
    const mem = state.memory[side];
    for (const e of state.units) {
      if (e.side === side) continue;
      if (!onMap(e)) { delete mem[e.id]; continue; }
      if (!vis.units.has(e.id)) continue;
      let vec = null;
      if (e.startPos && (e.movedHexes ?? 0) > 0) {
        const a = toCube(e.startPos.col, e.startPos.row), b = toCube(e.col, e.row);
        vec = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      }
      mem[e.id] = { col: e.col, row: e.row, turn: state.turn, type: e.type, hpState: hpState(e), status: e.status, vec };
    }
  }
}

// Position anticipée d'un ennemi connu : dernière position + dernier mouvement observé.
export function predictPosition(state, m) {
  if (!m.vec || state.turn - m.turn > 1) return { col: m.col, row: m.row };
  const c = toCube(m.col, m.row);
  const p = fromCube(c[0] + m.vec[0], c[1] + m.vec[1], c[2] + m.vec[2]);
  p.col = Math.max(0, Math.min(state.map.W - 1, p.col));
  p.row = Math.max(0, Math.min(state.map.H - 1, p.row));
  return p;
}

// ---------- Exécution d'un tour ----------

function snapshot(state) {
  const pos = {};
  for (const u of state.units) if (onMap(u)) pos[u.id] = { col: u.col, row: u.row, status: u.status };
  return pos;
}

function enemiesAdjacent(state, u) {
  return state.units.filter((e) => e.side !== u.side && onMap(e) && hexDistance(e, u) === 1);
}

function fleePath(state, u) {
  const { map } = state;
  const blocked = new Set(state.units.filter((e) => onMap(e) && e.side !== u.side).map((e) => hexKey(map, e)));
  const reach = reachable(map, u, { blocked });
  const goal = retreatCol(state, u.side);
  let best = null, bestScore = Infinity;
  for (const [k, v] of reach) {
    const h = { col: k % map.W, row: Math.floor(k / map.W) };
    const score = Math.abs(h.col - goal) * 10 + v.cost;
    if (score < bestScore) { bestScore = score; best = h; }
  }
  return best ? pathFrom(map, reach, best) : [];
}

function log(state, kind, text, side = null) {
  state.log.push({ turn: state.turn, kind, text, side });
}

export function validateOrders(state, u) {
  const o = u.orders;
  if (u.type !== 'artillery' || !(u.ammo > 0) || u.reloading) o.fireAt = null;
  if (o.fireAt) {
    const d = hexDistance(u, o.fireAt);
    const s = unitStats(u);
    if (o.path.length || d < s.minRange || d > s.range) o.fireAt = null;
  }
  // Une unité clouée ne bouge pas ce tour-ci (elle peut creuser et tirer).
  if (u.pinned && u.status === 'ok') o.path = [];
  if (o.path.length) o.entrench = false;
}

export function executeTurn(state) {
  const { map, rng } = state;
  const res = { ticks: [], fires: [], events: [], burns: [], terrain: [] };
  const alive = state.units.filter(onMap);
  log(state, 'turn', `— Tour ${state.turn} —`);

  for (const u of alive) {
    validateOrders(state, u);
    u.startPos = { col: u.col, row: u.row };
    u.movedHexes = 0;
    u.mpLeft = unitStats(u).move * 2;
    u.revealed = false;
    u.waits = 0;
    u.plan = u.status === 'routed' ? fleePath(state, u) : u.orders.path.slice();
    u.contactIds = new Set(enemiesAdjacent(state, u).map((e) => e.id));
  }
  res.ticks.push(snapshot(state));

  // Phase 1 : mouvements simultanés, un hexagone par pas.
  for (let tick = 0; tick < 30; tick++) {
    const wants = [];
    for (const u of alive) {
      if (!onMap(u) || !u.plan.length) continue;
      const nx = u.plan[0];
      if (tileAt(map, nx.col, nx.row).fire > 0) { u.plan = []; continue; }
      const c = moveCost(map, u, nx, u.type);
      if (c > u.mpLeft && u.movedHexes > 0) { u.plan = []; continue; }
      wants.push({ u, nx, c });
    }
    if (!wants.length) break;
    rng.shuffle(wants);
    wants.sort((a, b) => b.u.mpLeft - a.u.mpLeft);
    const occupied = new Map(alive.filter(onMap).map((u) => [hexKey(map, u), u]));
    let movedAny = false;
    for (const { u, nx, c } of wants) {
      const k = hexKey(map, nx);
      const occ = occupied.get(k);
      if (occ) {
        if (occ.side !== u.side) {
          u.plan = [];
          res.events.push({ kind: 'blocked', id: u.id });
        } else if (++u.waits > 2) u.plan = [];
        continue;
      }
      occupied.delete(hexKey(map, u));
      occupied.set(k, u);
      u.col = nx.col;
      u.row = nx.row;
      u.mpLeft -= Math.min(c, u.mpLeft);
      u.movedHexes++;
      u.plan.shift();
      movedAny = true;
    }
    // Contact : une unité qui arrive au contact d'un nouvel ennemi s'arrête (sauf en déroute).
    for (const u of alive) {
      if (!onMap(u)) continue;
      const adj = enemiesAdjacent(state, u);
      const fresh = adj.filter((e) => !u.contactIds.has(e.id));
      if (fresh.length && u.status === 'ok') {
        if (u.plan.length) {
          res.events.push({ kind: 'contact', id: u.id });
          log(state, 'move', `${u.name} entre au contact et s'arrête.`, u.side);
        }
        u.plan = [];
      }
      u.contactIds = new Set(adj.map((e) => e.id));
      if (u.status === 'routed' && u.col === retreatCol(state, u.side)) {
        u.status = 'withdrawn';
        u.plan = [];
        log(state, 'morale', `${u.name} quitte le champ de bataille en déroute.`, u.side);
      }
    }
    res.ticks.push(snapshot(state));
    if (!movedAny) break;
  }

  // Retranchement : creuser si l'unité n'a pas bougé et en a reçu l'ordre ; tout mouvement l'annule.
  for (const u of alive) {
    if (u.status !== 'ok') { u.entrench = 0; continue; }
    if (u.movedHexes > 0) u.entrench = 0;
    else if (u.orders.entrench) {
      const max = unitStats(u).entrenchMax;
      if (u.entrench < max) {
        u.entrench++;
        log(state, 'dig', `${u.name} se retranche (niveau ${u.entrench}).`, u.side);
      }
    }
  }

  // Phase 2 : combat simultané (les dégâts sont appliqués après que tout le monde a tiré).
  const vis = { DE: computeVisibility(state, 'DE'), SU: computeVisibility(state, 'SU') };
  const shots = [];
  for (const u of alive) {
    if (u.status !== 'ok') continue;
    const s = unitStats(u);
    const enemies = state.units.filter((e) => e.side !== u.side && onMap(e));
    if (u.type === 'artillery' && u.orders.fireAt && u.movedHexes === 0) {
      spendAmmo(state, u);
      if (s.salvo) { salvo(state, u, u.orders.fireAt, enemies, vis, shots, res); continue; }
      const target = enemies.find((e) => sameHex(e, u.orders.fireAt));
      if (target) shots.push({ u, target, indirect: true, observed: vis[u.side].units.has(target.id) });
      else {
        res.fires.push({ attacker: u.id, from: { col: u.col, row: u.row }, to: { ...u.orders.fireAt }, empty: true, indirect: true });
        log(state, 'barrage', `${u.name} : barrage sur une position vide.`, u.side);
      }
      continue;
    }
    const cands = enemies.filter((e) => {
      const d = hexDistance(u, e);
      if (!vis[u.side].units.has(e.id) && d > 1) return false;
      if (d === 1) return true;
      if (u.type === 'artillery') return u.movedHexes === 0 && !u.holdFire && !u.reloading && u.ammo > 0 && d >= s.minRange && d <= s.range;
      return d <= s.range && hasLOS(map, u, e);
    });
    if (!cands.length || (u.type === 'at' && u.movedHexes > 0)) continue;
    // L'antichar tire en priorité sur les blindés ; sinon, la cible la plus proche puis la plus entamée.
    const prio = (e) => (u.type === 'at' && unitStats(e).armored ? -10 : 0) + hexDistance(u, e);
    cands.sort((a, b) => prio(a) - prio(b) || a.hp / unitStats(a).maxHp - b.hp / unitStats(b).maxHp);
    const target = cands[0];
    const indirect = u.type === 'artillery' && hexDistance(u, target) > 1;
    if (indirect) spendAmmo(state, u); // l'autodéfense au contact ne consomme pas d'obus
    if (indirect && s.salvo) { salvo(state, u, target, enemies, vis, shots, res); continue; }
    shots.push({ u, target, indirect, observed: true });
  }

  if (state.calls) resolveCalls(state, shots, res, vis);

  const hpBefore = new Map(alive.map((u) => [u.id, u.hp]));
  const damageTaken = new Map();
  // Ce que chaque cible a subi : touches, barrage, coup critique, positions des tireurs en tir direct.
  const pressure = new Map();
  for (const { u, target, indirect, observed, salvo: inSalvo, focal } of shots) {
    const odds = fireOdds(map, u, target, { indirect, observed, salvo: inSalvo, focal });
    const r = rollFire(rng, odds);
    damageTaken.set(target.id, (damageTaken.get(target.id) ?? 0) + r.damage);
    const p = pressure.get(target.id) ?? { hits: 0, barrage: false, crit: false, from: [] };
    p.hits += r.hits;
    if (indirect) p.barrage = true;
    else p.from.push(u);
    if (odds.crits && r.rolls.includes(6)) p.crit = true;
    pressure.set(target.id, p);
    u.revealed = true;
    u.inCombat = true;
    target.inCombat = true;
    res.fires.push({ attacker: u.id, side: u.side, target: target.id, from: { col: u.col, row: u.row }, to: { col: target.col, row: target.row }, indirect, ...r, threshold: odds.threshold, mods: odds.mods });
    const modTxt = odds.mods.length ? ` (${odds.mods.map((m) => `${m.v > 0 ? '+' : ''}${m.v} ${m.why}`).join(', ')})` : '';
    log(state, 'fire', `${u.name} → ${target.name} : ${odds.dice}d6 [${r.rolls.join(' ')}] sur ${odds.threshold}+${modTxt} ⇒ ${r.damage} dégât${r.damage > 1 ? 's' : ''}.`, u.side);
  }
  for (const [id, dmg] of damageTaken) {
    const t = state.units.find((x) => x.id === id);
    t.hp = Math.max(0, t.hp - dmg);
  }
  const shaken = new Set();
  for (const u of alive) {
    if (u.inCombat) { u.xpGained++; u.xp++; u.inCombat = false; }
    if (!damageTaken.has(u.id) || u.hp > 0) continue;
    u.status = 'destroyed';
    res.events.push({ kind: 'destroyed', id: u.id });
    log(state, 'destroy', `${u.name} est anéantie !`, u.side);
    creditKill(state, shots, u);
    // Voir une unité voisine anéantie ébranle ses voisines.
    for (const a of alive) if (a.side === u.side && a.hp > 0 && hexDistance(a, u) === 1) shaken.add(a.id);
  }
  const standing = alive.filter((u) => u.status === 'ok' && u.hp > 0);
  for (const u of alive) {
    if (u.status !== 'ok' || u.hp <= 0 || (!damageTaken.has(u.id) && !shaken.has(u.id))) continue;
    const friends = standing.filter((a) => a !== u && a.side === u.side);
    const m = moraleCheck(map, u, hpBefore.get(u.id), rng, {
      forced: shaken.has(u.id),
      isolated: !friends.some((a) => hexDistance(a, u) <= 2),
      support: friends.some((a) => a.entrench > 0 && hexDistance(a, u) === 1),
      pincer: pincered(u, pressure.get(u.id)?.from ?? []),
    });
    if (!m) continue;
    const modTxt = m.mods.length ? `, ${m.mods.map((x) => `${x.v > 0 ? '+' : ''}${x.v} ${x.why}`).join(', ')}` : '';
    if (m.held) log(state, 'morale', `${u.name} tient bon (moral : ${m.roll} → ${m.total}${modTxt}).`, u.side);
    else {
      u.status = 'routed';
      u.entrench = 0;
      u.orders = { path: [], entrench: false, fireAt: null };
      res.events.push({ kind: 'routed', id: u.id });
      log(state, 'morale', `${u.name} cède et se replie en désordre ! (moral : ${m.roll} → ${m.total}${modTxt})`, u.side);
      creditKill(state, shots, u);
    }
  }

  // Clouage pour le tour suivant : feu nourri, barrage (sauf blindés), ou coup critique sur un blindé.
  for (const u of alive) {
    u.pinned = false;
    const p = pressure.get(u.id);
    if (!p || u.status !== 'ok') continue;
    const armored = unitStats(u).armored;
    if (armored ? p.crit : p.barrage || p.hits >= (u.entrench > 0 ? 3 : 2)) {
      u.pinned = true;
      res.events.push({ kind: 'pinned', id: u.id });
      log(state, 'morale', armored ? `${u.name} est immobilisée : coup au but sur le train de roulement.` : `${u.name} est clouée au sol par le feu.`, u.side);
    }
  }

  // Fin de tour : ordres remis à zéro (on continue de creuser si on était en train de le faire).
  for (const u of state.units) {
    u.reloading = !!u.reloadNext;
    u.reloadNext = false;
    if (!onMap(u)) continue;
    const keepDig = u.status === 'ok' && u.orders.entrench && u.movedHexes === 0;
    u.orders = { path: [], entrench: keepDig, fireAt: null };
  }
  applyTerrainDamage(state, res);
  updateObjective(state);
  updateBlocks(state);
  updateVisibility(state, state.turn + 1); // vue préparée pour le tour suivant, à sa lumière
  for (const u of state.units) { u.startPos = null; u.movedHexes = 0; }
  checkVictory(state);
  state.turn++;
  return res;
}

// ---------- Terrain destructible ----------

export const FIRE_DAMAGE = 2;
export const FIRE_TURNS = 2;
export const RUIN_AFTER = 2;

// Après le combat : les incendies en cours brûlent, se propagent puis s'éteignent ; ensuite les obus du tour
// marquent le terrain (cratères, ruines, départs de feu). Une forêt qui s'embrase ne brûle les unités qu'au tour
// suivant : elles ont le temps d'en sortir. res.terrain liste les changements pour le rendu.
function applyTerrainDamage(state, res) {
  const { map, rng } = state;
  const changes = [];
  const wet = map.weather === 'rain' || map.weather === 'snow'; // bois mouillé : pas de feu
  const ignite = new Set();
  for (const t of map.tiles.filter((x) => x.fire > 0)) {
    for (const u of state.units) {
      if (!onMap(u) || u.col !== t.col || u.row !== t.row) continue;
      u.hp = Math.max(0, u.hp - FIRE_DAMAGE);
      res.burns.push({ id: u.id, col: t.col, row: t.row, damage: FIRE_DAMAGE });
      if (u.hp > 0) log(state, 'fire', `${u.name} est prise dans l'incendie (−${FIRE_DAMAGE} PV).`, u.side);
      else {
        u.status = 'destroyed';
        res.events.push({ kind: 'destroyed', id: u.id });
        log(state, 'destroy', `${u.name} périt dans l'incendie !`, u.side);
      }
    }
    if (!wet) {
      for (const n of neighbors(map, t)) {
        const nt = tileAt(map, n.col, n.row);
        if (flammable(nt) && !nt.fire && rng.chance(1 / 3)) ignite.add(nt);
      }
    }
    if (--t.fire === 0) {
      if (t.terrain === 'isba') t.ruined = true; // isbas réduites en cendres : des cheminées et des décombres
      else t.terrain = 'plain';
      t.burnt = true;
      t.burntTurn = state.turn;
      changes.push({ col: t.col, row: t.row, kind: 'burnt' });
    }
  }
  for (const f of res.fires) {
    if (!f.indirect) continue;
    const t = tileAt(map, f.to.col, f.to.row);
    if (!t) continue;
    t.shelled = (t.shelled ?? 0) + (f.weight ?? 1);
    if (TERRAIN[t.terrain].wood && !t.ruined && !t.fire && !wet && rng.chance(f.barrage ? 0.6 : 1 / 3)) ignite.add(t);
    else if ((t.terrain === 'village' || TERRAIN[t.terrain].urban) && !t.ruined && t.shelled >= RUIN_AFTER) {
      t.ruined = true;
      changes.push({ col: t.col, row: t.row, kind: 'ruins' });
      if (t.terrain === 'village') log(state, 'terrain', `${t.name ?? 'Un pâté de maisons'} n'est plus qu'un champ de ruines.`);
      // Ville : les façades s'écroulent dans les rues voisines ; les gravats arrêtent les chars.
      if (t.terrain === 'building' || t.terrain === 'strong') {
        for (const n of neighbors(map, t)) {
          const nt = tileAt(map, n.col, n.row);
          if (nt.terrain === 'street' && !nt.bridge && !nt.rubble && rng.chance(0.4)) { nt.rubble = true; changes.push({ col: nt.col, row: nt.row, kind: 'rubble' }); }
        }
      }
    } else if ((t.terrain === 'plain' || t.terrain === 'farm') && !t.craters && !t.river) {
      t.craters = true;
      changes.push({ col: t.col, row: t.row, kind: 'craters' });
    } else if (t.terrain === 'forest' && !t.fire && !wet && rng.chance(1 / 3)) ignite.add(t);
  }
  for (const t of ignite) {
    if (!flammable(t) || t.fire > 0) continue;
    t.fire = FIRE_TURNS;
    changes.push({ col: t.col, row: t.row, kind: 'fire' });
  }
  if (ignite.size) log(state, 'terrain', [...ignite].some((t) => t.terrain === 'isba') ? 'Des isbas prennent feu.' : ignite.size > 1 ? `L'incendie gagne ${ignite.size} parcelles de forêt.` : 'Une forêt prend feu.');
  res.terrain = changes;
}

const flammable = (t) => t.terrain === 'forest' || (TERRAIN[t.terrain].wood && !t.ruined);

// Tenaille : deux tireurs en tir direct venus de directions opposées (écart d'au moins 120°).
function pincered(u, shooters) {
  const c = hexToPixel(u.col, u.row, 1);
  const dirs = shooters.map((s) => {
    const p = hexToPixel(s.col, s.row, 1);
    const dx = p.x - c.x, dy = p.y - c.y, l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  });
  return dirs.some((a, i) => dirs.slice(i + 1).some((b) => a.x * b.x + a.y * b.y <= -0.5));
}

// Salve de Katioucha : la case visée et ses voisines est et ouest ; chaque ennemi présent reçoit ⅔ des dés.
// La batterie recharge ensuite pendant un tour.
function salvo(state, u, center, enemies, vis, shots, res) {
  const cells = [center, { col: center.col - 1, row: center.row }, { col: center.col + 1, row: center.row }].filter((h) => tileAt(state.map, h.col, h.row));
  let hit = 0;
  for (const h of cells) {
    const target = enemies.find((e) => sameHex(e, h));
    if (target) { shots.push({ u, target, indirect: true, observed: vis[u.side].units.has(target.id), salvo: true }); hit++; }
    else res.fires.push({ attacker: u.id, from: { col: u.col, row: u.row }, to: { col: h.col, row: h.row }, empty: true, indirect: true });
  }
  if (!hit) log(state, 'barrage', `${u.name} : salve sur une position vide.`, u.side);
  u.reloadNext = true;
}

function spendAmmo(state, u) {
  u.ammo = Math.max(0, u.ammo - 1);
  if (u.ammo === 0) log(state, 'ammo', `${u.name} a tiré ses derniers obus : plus que l'autodéfense au contact.`, u.side);
}

function creditKill(state, shots, victim) {
  for (const s of shots) if (s.target === victim) { s.u.xp++; s.u.xpGained++; }
}

function updateObjective(state) {
  const o = state.objective;
  if (!o) return;
  const occ = unitAt(state, o);
  // Seules l'infanterie et les blindés tiennent une position ; une position disputée ne compte pas.
  if (!occ || occ.status !== 'ok' || occ.type === 'recon' || occ.type === 'artillery' || occ.type === 'at') return;
  o.contested = enemiesAdjacent(state, occ).some(active);
  if (occ.side === o.owner) { if (!o.contested) o.hold++; }
  else {
    o.owner = occ.side;
    o.hold = o.contested ? 0 : 1;
    log(state, 'objective', `${occ.name} s'empare de l'objectif !`, occ.side);
  }
}

export const HOLD_TO_WIN = 4;

export function checkVictory(state) {
  const count = (side) => state.units.filter((u) => u.side === side && active(u)).length;
  const de = count('DE'), su = count('SU');
  const end = (winner, reason) => {
    state.result = { winner, reason };
    state.phase = 'over';
    log(state, 'result', reason);
  };
  if (!de && !su) return end(null, 'Les deux camps sont hors de combat : match nul.');
  if (!de) return end('SU', 'Toutes les unités allemandes sont détruites ou en déroute.');
  if (!su) return end('DE', 'Toutes les unités soviétiques sont détruites ou en déroute.');
  if (state.kind === 'ville') {
    if (state.turn < state.maxTurns) return;
    const share = cityShare(state);
    const pct = Math.round(share * 100);
    return share >= 0.5
      ? end(state.attacker, `Fin des combats : l'attaquant tient ${pct} % de la ville.`)
      : end(state.defender, `Fin des combats : le défenseur tient encore ${100 - pct} % de la ville.`);
  }
  const o = state.objective;
  if (o && o.owner && o.hold >= HOLD_TO_WIN) return end(o.owner, `La position stratégique est tenue depuis ${o.hold} tours.`);
  if (state.turn >= state.maxTurns) {
    if (o && o.owner) return end(o.owner, 'Fin des combats : le détenteur de l\'objectif l\'emporte.');
    const r = (side) => strength(state.units.filter((u) => u.side === side)) / Math.max(0.01, state.initialStrength[side]);
    const dr = r('DE'), sr = r('SU');
    if (Math.abs(dr - sr) < 0.08) return end(null, 'Fin des combats : aucun camp n\'a pris l\'ascendant.');
    return end(dr > sr ? 'DE' : 'SU', 'Fin des combats : le camp le moins éprouvé reste maître du terrain.');
  }
}

export { neighbors };

// ---------- Bataille de rue ----------

// Déploiement en ville. Défenseur : infanterie dans les maisons et les points forts, face à l'attaquant ; antichar sur
// la grand-rue, avec une enfilade vers l'attaquant ; le reste en retrait. Attaquant : chars sur la route, infanterie
// de part et d'autre.
function autoDeployUrban(state, side) {
  const { map, rng } = state;
  const town = map.town;
  const units = state.units.filter((u) => u.side === side);
  for (const u of units) { u.col = -10; u.row = -10; }
  const facing = state.attacker === 'DE' ? -1 : 1; // le défenseur fait face au bord de l'attaquant
  const order = ['infantry', 'at', 'tank', 'recon', 'artillery'];
  units.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  units.forEach((u, k) => {
    const wantRow = town.cy + Math.round(((k % 5) - 2) * (town.hh / 2.5));
    let best = null, bestScore = -Infinity;
    for (const t of map.tiles) {
      if (!canDeployAt(state, side, t) || t.terrain === 'marsh') continue;
      let score = -Math.abs(t.row - wantRow) * 0.5 + rng.next() * 0.6;
      if (side === state.defender) {
        const forward = (t.col - town.cx) * facing; // vers l'attaquant
        if (u.type === 'infantry') score += TERRAIN[t.terrain].def * 1.2 + (isUrban(t) ? 1 : 0) + forward * 0.35;
        else if (u.type === 'at') score += (t.terrain === 'street' && Math.abs(t.row - town.cy) <= 1 ? 3 : 0) + forward * 0.2 + (isUrban(t) ? 1 : 0);
        else score += -forward * 0.3 + (isUrban(t) ? 0.5 : 0);
      } else {
        const depth = side === 'DE' ? t.col : map.W - 1 - t.col;
        if (u.type === 'tank') score += (t.road ? 3 : 0) - Math.abs(t.row - town.cy) * 0.4 + depth * 0.2;
        else score += depth * 0.4 + TERRAIN[t.terrain].def * 0.5 - (t.road ? 0.5 : 0);
      }
      if (score > bestScore) { bestScore = score; best = t; }
    }
    u.col = best.col;
    u.row = best.row;
  });
}

// Feux hors carte, ordonnés le matin du tour : barrage focalisé (l'hexagone et ses six voisins, toutes les unités qui
// s'y trouvent, amies comprises ; les maisons s'effondrent) ou tir d'appui (une case vue, comme une batterie). Un de
// chaque par tour au plus, dans la limite du stock de la bataille.
export const FIRE_CALLS = {
  barrage: { label: 'Barrage focalisé', dice: 6, shells: 2 },
  support: { label: 'Tir d\'appui', dice: 4, shells: 1 },
};

export function fireLeft(state, side, kind) {
  if (!state.fire) return 0;
  return Math.max(0, state.fire[side][kind] - state.calls[side].filter((c) => c.kind === kind).length);
}

export function callFire(state, side, kind, h) {
  if (state.kind !== 'ville' || !FIRE_CALLS[kind]) return { error: 'Pas de feux hors carte dans cette bataille.' };
  if (!tileAt(state.map, h.col, h.row)) return { error: 'Hors de la carte.' };
  state.calls[side] = state.calls[side].filter((c) => c.kind !== kind);
  if (fireLeft(state, side, kind) <= 0) return { error: kind === 'barrage' ? 'Plus de barrage disponible.' : 'Plus de tir d\'appui disponible.' };
  if (kind === 'support' && !state.visibility[side]?.hexes.has(h.row * state.map.W + h.col)) return { error: 'Le tir d\'appui vise une case que vous voyez.' };
  const c = { kind, col: h.col, row: h.row };
  state.calls[side].push(c);
  return c;
}

export function cancelFire(state, side, kind) {
  if (state.calls) state.calls[side] = state.calls[side].filter((c) => c.kind !== kind);
}

export const barrageZone = (state, h) => [h, ...neighbors(state.map, h)].filter((x) => tileAt(state.map, x.col, x.row));

// Batterie fictive qui tire les feux hors carte : depuis son bord de carte, à hauteur de la cible.
function offMapGun(state, side, h) {
  const u = { id: `feu-${side}`, name: side === 'DE' ? 'Artillerie de corps' : 'Artillerie d\'armée', side, type: 'artillery', level: 2, xp: 0, xpGained: 0, col: retreatCol(state, side), row: h.row, entrench: 0, pinned: false, movedHexes: 0, offMap: true };
  u.hp = unitStats(u).maxHp;
  return u;
}

// Phase de combat : les feux hors carte des deux camps s'ajoutent aux tirs du tour.
function resolveCalls(state, shots, res, vis) {
  for (const side of ['DE', 'SU']) {
    for (const c of state.calls[side]) {
      state.fire[side][c.kind]--;
      const gun = offMapGun(state, side, c);
      const K = FIRE_CALLS[c.kind];
      if (c.kind === 'support') {
        const target = state.units.find((e) => e.side !== side && onMap(e) && sameHex(e, c));
        if (target) shots.push({ u: gun, target, indirect: true, observed: true });
        else res.fires.push({ attacker: gun.id, side, from: { col: gun.col, row: gun.row }, to: { col: c.col, row: c.row }, empty: true, indirect: true });
        log(state, 'barrage', `${K.label} sur ${target ? target.name : 'une position vide'}.`, side);
        continue;
      }
      const zone = barrageZone(state, c);
      const hit = [];
      for (const h of zone) {
        res.fires.push({ attacker: gun.id, side, from: { col: gun.col, row: gun.row }, to: { col: h.col, row: h.row }, empty: true, indirect: true, barrage: true, weight: K.shells });
        const target = state.units.find((e) => onMap(e) && sameHex(e, h));
        if (target) { shots.push({ u: gun, target, indirect: true, observed: true, focal: true }); hit.push(target.name); }
      }
      log(state, 'barrage', `${K.label} : ${zone.length} hexagones pilonnés${hit.length ? ` (${hit.join(', ')})` : ''}.`, side);
    }
    state.calls[side] = [];
  }
  void vis;
}

// Îlots tenus : l'infanterie ou les chars d'un seul camp sur l'îlot le prennent ; disputé, il ne change pas de mains.
function updateBlocks(state) {
  for (const b of state.blocks ?? []) {
    const sides = new Set();
    for (const i of b.tiles) {
      const col = i % state.map.W, row = Math.floor(i / state.map.W);
      const u = state.units.find((x) => onMap(x) && x.status === 'ok' && x.col === col && x.row === row && (x.type === 'infantry' || x.type === 'tank'));
      if (u) sides.add(u.side);
    }
    b.contested = sides.size > 1;
    if (sides.size === 1) {
      const s = [...sides][0];
      if (s !== b.owner) log(state, 'objective', `${s === 'DE' ? 'La Wehrmacht' : 'L\'Armée rouge'} prend ${b.label}.`, s);
      b.owner = s;
    }
  }
}

// Part de la ville (îlots pondérés) que tient l'attaquant.
export function cityShare(state) {
  const total = (state.blocks ?? []).reduce((a, b) => a + b.weight, 0);
  return total ? state.blocks.filter((b) => b.owner === state.attacker).reduce((a, b) => a + b.weight, 0) / total : 0;
}
