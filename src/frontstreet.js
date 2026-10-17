// Batailles de rue dans le front stratégique : au lancement de la journée, une ville que vise une poussée (la sienne
// ou celle de l'ennemi) peut se jouer en tactique (urbangen.js, game.js, kind 'ville'). Ce module repère ces villes,
// traduit le secteur en bataille (terrain, troupes, chars, antichars, ouvrages, feux) et réinjecte le résultat dans le
// front : îlots tenus → cases de la ville, pertes → densités, chars perdus, barrages dépensés. La ville est ensuite
// figée pour la journée (front.frozen).

import { FRONT_SIDES } from './front.js';
import { GUN_KINDS, artilleryCover } from './frontguns.js';
import { generateUrbanMap } from './urbangen.js';
import { makeUnit, unitStats } from './units.js';
import { createRng } from './rng.js';
import { onMap, cityShare } from './game.js';

export const STREET = {
  men: 150, // hommes par section d'infanterie
  minUnits: 3, // sections au plus petit
  maxUnits: 12, // et au plus ; au-delà, chaque section représente plus d'hommes (rapport de force gardé)
  near: 2.6, // les cases du défenseur dans ce rayon autour des cases de la ville défendent la ville
  reach: 7, // les cases de l'attaquant dans ce rayon autour du centre de la ville l'attaquent…
  engaged: 0.6, // … pour cette part de leurs troupes
  pass: 2.6, // une poussée passe par la ville si son tracé en approche à ce point
  ahead: 12, // et si la ville est à cette distance au plus de son départ (elle sera disputée aujourd'hui)
  minMen: 600, // assaut assez fort pour valoir une bataille
  tanksPerUnit: 20, // chars par compagnie tactique
  maxTanks: 4,
  maxAT: 2,
  coverFire: 0.2, // couverture d'artillerie minimale pour des feux hors carte
};

const side = (s) => FRONT_SIDES[s];
// Rayon de défense autour du centre d'une ville : plus large pour une grande ville, et en métropole tout le quartier.
const defReach = (front, t) => STREET.near + (t.district != null ? districtRadius(front, t) : t.city ? 2 : 0);
function districtRadius(front, t) {
  const d = front.map.districts[t.district];
  return Math.min(4, Math.max(...d.cells.map((i) => Math.hypot(cx(front, i) - cx(front, t.i), cy(front, i) - cy(front, t.i)))));
}
const cx = (front, i) => front.centers.x[i];
const cy = (front, i) => front.centers.y[i];

// Cases de la ville t : les cases bâties dont c'est la ville la plus proche, à deux cases au plus de son centre ; en
// métropole, tout le quartier (t.district).
export function townCellsOf(front, t) {
  if (t.district != null) return front.map.districts[t.district].cells.slice();
  const out = [];
  for (const i of front.townCells) {
    const d = Math.hypot(cx(front, i) - cx(front, t.i), cy(front, i) - cy(front, t.i));
    if (d > (t.city ? 4.2 : 2.2)) continue;
    const nearest = front.map.towns.reduce((b, o) => (Math.hypot(cx(front, i) - cx(front, o.i), cy(front, i) - cy(front, o.i)) < Math.hypot(cx(front, i) - cx(front, b.i), cy(front, i) - cy(front, b.i)) ? o : b));
    if (nearest === t) out.push(i);
  }
  return out.length ? out : [t.i];
}

function segDist(a, b, x, y) {
  const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / L2));
  return Math.hypot(a.x + vx * t - x, a.y + vy * t - y);
}

// Hommes d'un camp autour d'un point (unités de densité × cfg.men), et les cases qui les portent.
function menAround(front, s, x, y, r, share = 1) {
  const cells = [];
  let men = 0;
  for (let i = 0; i < front.map.N; i++) {
    if (front.owner[i] !== s || Math.abs(cx(front, i) - x) > r) continue;
    if (Math.hypot(cx(front, i) - x, cy(front, i) - y) > r) continue;
    cells.push(i);
    men += front.dens[i] * share * front.cfg.men;
  }
  return { men, cells };
}

// Villes disputées aujourd'hui (front en phase 'plan', ordres des deux camps donnés) : une poussée d'infanterie ou de
// blindés, ou une formation blindée, vise une ville tenue par l'autre camp. La plus disputée d'abord.
export function streetCandidates(front) {
  if (front.phase !== 'plan') return [];
  const out = [];
  for (const t of front.map.towns) {
    const def = front.owner[t.i];
    if (def < 0 || front.frozen?.[t.i]) continue;
    const att = 1 - def, tx = cx(front, t.i), ty = cy(front, t.i);
    const vectors = front.orders[att].filter((v) => (v.type === 'infantry' || v.type === 'armor') && Math.hypot(v.from.x - tx, v.from.y - ty) <= STREET.ahead && segDist(v.from, v.to, tx, ty) <= STREET.pass);
    const armor = (front.armor ?? []).filter((a) => a.side === att && !a.lost && a.target && Math.hypot(a.x - tx, a.y - ty) <= STREET.ahead + 6 && segDist({ x: a.x, y: a.y }, a.target, tx, ty) <= STREET.pass);
    if (!vectors.length && !armor.length) continue;
    const attMen = menAround(front, att, tx, ty, STREET.reach, STREET.engaged).men;
    if (attMen < STREET.minMen) continue;
    const cells = townCellsOf(front, t);
    const defMen = menAround(front, def, tx, ty, defReach(front, t)).men;
    out.push({ town: t, cells, attacker: att, defender: def, attMen, defMen, armor: armor.map((a) => a.id), score: attMen + defMen + armor.reduce((n, a) => n + a.tanks * 20, 0) });
  }
  return out.sort((a, b) => b.score - a.score);
}

// Sections d'infanterie de chaque camp : environ STREET.men hommes chacune, bornées, au même rapport de force.
function sections(attMen, defMen) {
  let a = attMen / STREET.men, d = defMen / STREET.men;
  const top = Math.max(a, d);
  if (top > STREET.maxUnits) { a *= STREET.maxUnits / top; d *= STREET.maxUnits / top; }
  return [Math.max(STREET.minUnits, Math.round(a)), Math.max(2, Math.round(d))];
}

// Bataille de rue tirée d'une ville candidate : tout ce que startUrban (main.js) et createBattle (game.js) attendent,
// plus link, de quoi réinjecter le résultat (applyStreetBattle).
export function streetBattle(front, cand) {
  const { town: t, attacker: att, defender: def } = cand;
  const rng = createRng(`rue:${front.seed}:${front.day}:${t.i}`);
  const tx = cx(front, t.i), ty = cy(front, t.i);
  const A = menAround(front, att, tx, ty, STREET.reach, STREET.engaged);
  const D = menAround(front, def, tx, ty, defReach(front, t));
  const [na, nd] = sections(A.men, D.men);
  // Terrain : taille, rivière (côté du défenseur ou de l'attaquant), routes d'accès, ruines déjà là.
  const cells = cand.cells;
  const R = Math.max(1, ...cells.map((i) => Math.hypot(cx(front, i) - tx, cy(front, i) - ty)));
  let riverDx = 0, riverN = 0;
  const roads = new Set();
  for (let i = 0; i < front.map.N; i++) {
    const dx = cx(front, i) - tx, dy = cy(front, i) - ty, d = Math.hypot(dx, dy);
    if (d > R + 3.5) continue;
    if (front.map.river[i] && !front.map.bridge[i]) { riverDx += dx; riverN++; }
    if (front.map.road[i] && d > R + 0.5) roads.add(Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N');
  }
  roads.add('W'); roads.add('E'); // la grand-rue traverse toujours
  // Métropole : la trame du quartier (usines, gare, quais…) ; vieille ville et usines en grande ville.
  const type = t.district != null ? front.map.districts[t.district].type : null;
  const size = type ? (type === 'centre' || type === 'usine' ? 'city' : 'town') : t.city ? 'city' : cells.length <= 3 ? 'village' : 'town';
  const map = generateUrbanMap(`${front.seed}:${t.i}`, { size, style: type, river: riverN >= 2 ? (riverDx > 0 ? 'east' : 'west') : null, roads: [...roads], name: t.name });
  const ruin = cells.reduce((a, i) => a + (front.ruin?.[i] ?? 0), 0) / cells.length;
  if (ruin > 0.05) {
    for (const tile of map.tiles) {
      if ((tile.terrain === 'building' || tile.terrain === 'isba' || tile.terrain === 'strong') && rng.chance(ruin * 0.8)) tile.ruined = true;
      else if (tile.terrain === 'street' && !tile.bridge && rng.chance(ruin * 0.15)) tile.rubble = true;
    }
  }
  // Troupes.
  const lvl = (s) => (side(s) === 'DE' ? 2 : 1);
  const mk = (s, type, level) => makeUnit(side(s), type, level, rng);
  const armies = { DE: [], SU: [] };
  for (let k = 0; k < na; k++) armies[side(att)].push(mk(att, 'infantry', lvl(att)));
  for (let k = 0; k < nd; k++) armies[side(def)].push(mk(def, 'infantry', lvl(def)));
  if (na >= 5) armies[side(att)].push(mk(att, 'recon', lvl(att)));
  // Chars : les formations qui visent la ville (attaquant), celles qui sont dessus ou tout près (défenseur).
  const tankLink = [];
  for (const s of [att, def]) {
    let n = 0;
    for (const a of front.armor ?? []) {
      if (a.side !== s || a.lost || n >= STREET.maxTanks) continue;
      const mine = s === att ? cand.armor.includes(a.id) : Math.hypot(a.x - tx, a.y - ty) <= R + 3;
      if (!mine) continue;
      const k = Math.max(1, Math.min(STREET.maxTanks - n, Math.round(a.tanks / STREET.tanksPerUnit)));
      for (let q = 0; q < k; q++) {
        const u = mk(s, 'tank', a.heavy ? 3 : Math.max(1, lvl(s)));
        armies[side(s)].push(u);
        tankLink.push({ unit: u.id, armor: a.id, tanks: a.tanks / k });
      }
      n += k;
    }
  }
  // Antichars du défenseur à portée de la ville.
  let at = 0;
  for (const g of front.guns ?? []) {
    if (g.side !== def || g.lost || !GUN_KINDS[g.kind].at || at >= STREET.maxAT) continue;
    if (Math.hypot(g.x - tx, g.y - ty) > GUN_KINDS[g.kind].range + R) continue;
    armies[side(def)].push(mk(def, 'at', g.kind === 'atHeavy' ? 3 : 2));
    at++;
  }
  // Ouvrages : retranchement des défenseurs, selon celui des cases de la ville (point d'appui compris).
  const dig = cells.reduce((a, i) => a + (front.entrench?.[i] ?? 0), 0) / cells.length;
  const strong = (front.strong?.[def] ?? []).some((p) => p.i === t.i);
  for (const u of armies[side(def)]) u.startDig = Math.round(dig * 2) + (strong ? 1 : 0);
  // Feux hors carte : là où l'artillerie couvre la ville ; barrages pris sur le stock de la bataille.
  const fire = {};
  for (const s of [att, def]) {
    const cov = artilleryCover(front, s)?.[t.i] ?? 0;
    const ok = cov >= STREET.coverFire;
    const stock = front.barrageStock ? front.barrageStock[s] - front.barrages[s].length : 1;
    fire[side(s)] = { support: ok ? Math.round(1 + 3 * Math.min(1, cov)) : 0, barrage: ok ? Math.max(0, Math.min(2, stock)) : 0 };
  }
  const W8 = front.weather;
  const conditions = { weather: W8 === 'clear' || W8 === 'rain' || W8 === 'fog' || W8 === 'snow' ? W8 : 'clear', biome: null, month: 6, sunrise: 4, sunset: 20, startHour: 6 };
  const title = type ? `Bataille de rue : ${t.name}` : `Bataille de ${t.name}`;
  const intro = `${side(att) === 'DE' ? 'La Wehrmacht' : 'L\'Armée rouge'} attaque ${t.name} : environ ${Math.round(A.men / 100) * 100} hommes contre ${Math.round(D.men / 100) * 100}. Le résultat décide du sort de la ville.`;
  const link = {
    townI: t.i, cells, attacker: att, defender: def, day: front.day,
    men: { [att]: A.men, [def]: D.men }, from: { [att]: A.cells, [def]: D.cells },
    // Hommes que représente chaque unité à pied (sections, reconnaissance, antichar).
    perUnit: Object.fromEntries([att, def].map((s) => [s, (s === att ? A.men : D.men) / Math.max(1, armies[side(s)].filter((u) => u.type !== 'tank').length)])),
    tanks: tankLink, fire: JSON.parse(JSON.stringify(fire)),
    center: { x: tx, y: ty }, R, town: map.town,
  };
  return { seed: `${front.seed}:rue:${front.day}:${t.i}`, map, armies, attacker: side(att), fire, conditions, title, intro, maxTurns: 10, link };
}

// Résultat d'une bataille de rue réinjecté dans le front. state : bataille tactique terminée.
export function applyStreetBattle(front, link, state, events = []) {
  const { attacker: att, defender: def, cells } = link;
  const town = state.map.town;
  // Îlots → cases : chaque case de la ville prend le détenteur de l'îlot le plus proche de sa position relative.
  const kx = town.hw / Math.max(1, link.R), ky = town.hh / Math.max(1, link.R);
  const blocks = state.blocks.filter((b) => !b.bridge);
  const taken = [];
  for (const i of cells) {
    const col = town.cx + (cx(front, i) - link.center.x) * kx, row = town.cy + (cy(front, i) - link.center.y) * ky;
    const b = blocks.reduce((best, x) => (Math.hypot(x.col - col, x.row - row) < Math.hypot(best.col - col, best.row - row) ? x : best), blocks[0]);
    if (b && b.owner === side(att) && front.owner[i] === def) taken.push(i);
  }
  // Survivants et pertes, en hommes, puis en densité sur les cases qui ont fourni les troupes.
  const alive = (s) => state.units.filter((u) => u.side === side(s) && u.type !== 'tank').reduce((a, u) => a + (onMap(u) ? u.hp / unitStats(u).maxHp : 0), 0);
  const lost = {};
  for (const s of [att, def]) {
    const survivors = alive(s) * link.perUnit[s];
    lost[s] = Math.max(0, link.men[s] - survivors) / front.cfg.men; // en densité
    let pool = 0;
    for (const i of link.from[s]) if (front.owner[i] === s) pool += front.dens[i];
    const k = pool > 0 ? Math.min(0.9, lost[s] / pool) : 0;
    for (const i of link.from[s]) if (front.owner[i] === s) { const l = front.dens[i] * k; front.dens[i] -= l; front.stats.losses[s] += l; }
  }
  // Cases prises : le défenseur reflue vers ses cases voisines ; l'attaquant y entre.
  let moved = 0;
  for (const i of taken) {
    const back = [];
    for (let d = 0; d < 6; d++) { const n = front.map.nb[i * 6 + d]; if (n >= 0 && front.owner[n] === def && !taken.includes(n)) back.push(n); }
    if (back.length) for (const n of back) front.dens[n] += front.dens[i] / back.length;
    else front.stats.losses[def] += front.dens[i];
    front.dens[i] = 0;
    front.owner[i] = att;
    front.stats.captured[att]++;
    events.push({ kind: 'capture', i, side: att, street: true });
  }
  if (taken.length) {
    let pool = 0;
    for (const i of link.from[att]) if (front.owner[i] === att && !taken.includes(i)) pool += front.dens[i];
    const want = Math.min(pool * 0.5, taken.length * 25);
    const k = pool > 0 ? want / pool : 0;
    for (const i of link.from[att]) if (front.owner[i] === att && !taken.includes(i)) { const m = front.dens[i] * k; front.dens[i] -= m; moved += m; }
    for (const i of taken) front.dens[i] += moved / taken.length;
  }
  // Chars perdus, barrages dépensés.
  for (const l of link.tanks) {
    const u = state.units.find((x) => x.id === l.unit);
    const a = front.armor.find((x) => x.id === l.armor);
    if (!u || !a) continue;
    const share = onMap(u) ? 1 - u.hp / unitStats(u).maxHp : 1;
    a.tanks = Math.max(0, a.tanks - l.tanks * share);
    a.fought = true;
  }
  for (const s of [att, def]) {
    const used = link.fire[side(s)].barrage - state.fire[side(s)].barrage;
    if (front.barrageStock && used > 0) front.barrageStock[s] = Math.max(0, front.barrageStock[s] - used);
  }
  // La ville est figée pour la journée : ni prise ni reprise avant demain.
  front.frozen ??= new Uint8Array(front.map.N);
  for (const i of cells) front.frozen[i] = 1;
  const share = cityShare(state);
  const name = front.map.towns.find((t) => t.i === link.townI)?.name ?? 'la ville';
  front.log.push({ day: front.day, tick: 0, kind: 'town', side: null, text: `Bataille de rue à ${name} : ${state.result?.winner === side(att) ? (side(att) === 'DE' ? 'la Wehrmacht' : 'l\'Armée rouge') + ' l\'emporte' : (side(def) === 'DE' ? 'la Wehrmacht' : 'l\'Armée rouge') + ' tient'} (${Math.round(share * 100)} % de la ville à l'attaquant ; ${taken.length} case${taken.length > 1 ? 's' : ''} prise${taken.length > 1 ? 's' : ''}).` });
  return { taken: taken.length, cells: cells.length, share, winner: state.result?.winner ?? null, lost: { [side(att)]: Math.round(lost[att] * front.cfg.men), [side(def)]: Math.round(lost[def] * front.cfg.men) } };
}

