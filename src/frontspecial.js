// Atouts ponctuels du front stratégique :
// - salve de lance-roquettes (attaquant) : une zone large écrasée au lever du jour, une ou deux fois par bataille ;
// - parachutistes (attaquant) : un largage au lever du jour derrière les lignes ennemies ; les cases prises forment un
//   îlot coupé de ses arrières qui fond comme une poche tant qu'on ne l'a pas rejoint (pont, PC ennemi, carrefour) ;
// - point d'appui (défenseur) : une ville ★ fortifiée (défense multipliée, ouvrages posés d'avance, garnison).
// Positions en unités de grille.

import { pixelToHex } from './hex.js';
import { barrageWorks } from './frontworks.js';
import { GUN_RULES } from './frontguns.js';

export const SPECIAL = {
  salvo: { rate: 0.13, works: 0.08, shock: 2.2, ticks: 3, reach: 30 }, // pertes et choc par tick, sur ticks ticks
  drop: { reach: 26, r: 1.9, kill: 0.35 }, // largage à reach au plus de nos lignes ; rayon de l'îlot ; ennemis tués
  strong: { r: 2.6 }, // rayon d'un point d'appui autour de sa ville
};

let nextId = 500000;

function cellAt(front, p) {
  const h = pixelToHex(p.x, p.y, 1), { W, H } = front.map;
  return h.col < 0 || h.row < 0 || h.col >= W || h.row >= H ? -1 : h.row * W + h.col;
}

// Distance d'un point à la plus proche case du camp s.
function distToOwn(front, s, p) {
  let d = Infinity;
  for (let i = 0; i < front.map.N; i++) if (front.owner[i] === s) d = Math.min(d, Math.hypot(front.centers.x[i] - p.x, front.centers.y[i] - p.y));
  return d;
}

// À la création (et au 7e jour) : moyens tirés. specs[s] : { salvos: { n, r }, paras: [densités], strong: [{ mul, level, garrison }] }.
export function initSpecial(front) {
  front.rockets ??= [{ left: 0, r: 3 }, { left: 0, r: 3 }];
  front.salvos ??= [[], []];
  front.paras ??= [[], []];
  front.drops ??= [[], []];
  front.strong ??= [[], []];
}

export function addSpecial(front, specs) {
  initSpecial(front);
  for (const s of [0, 1]) {
    const sp = specs[s];
    if (!sp) continue;
    if (sp.salvos?.n) { front.rockets[s].left += sp.salvos.n; front.rockets[s].r = Math.max(front.rockets[s].r, sp.salvos.r); }
    for (const dens of sp.paras ?? []) front.paras[s].push({ id: nextId++, dens, used: null });
    for (const st of sp.strong ?? []) placeStrongpoint(front, s, st);
  }
}

// ---------- Salve de lance-roquettes ----------

export function addSalvo(front, s, at) {
  if (front.phase !== 'plan') return { error: 'Les ordres se donnent le matin.' };
  initSpecial(front);
  if (front.rockets[s].left - front.salvos[s].length <= 0) return { error: 'Plus de salve de lance-roquettes.' };
  if (distToOwn(front, s, at) > SPECIAL.salvo.reach) return { error: 'Trop loin de vos lignes pour les lance-roquettes.' };
  const o = { id: nextId++, side: s, x: at.x, y: at.y, r: front.rockets[s].r };
  front.salvos[s].push(o);
  return o;
}

// Ticks du matin : la salve écrase les troupes ennemies de la zone (pertes, choc, fuite) et abîme les ouvrages.
// k : efficacité des feux par ce temps (le brouillard prive d'observation).
export function salvoTick(front, events, k = 1) {
  if (!front.salvos || front.tick >= SPECIAL.salvo.ticks) return;
  const S = SPECIAL.salvo;
  for (const s of [0, 1]) {
    for (const o of front.salvos[s]) {
      if (front.tick === 0) {
        front.rockets[s].left--;
        o.fired = front.clock;
        front.log.push({ day: front.day, tick: 0, kind: 'salvo', side: s, text: `Salve de ${s === 0 ? 'Nebelwerfer' : 'Katioucha'} au lever du jour${front.rockets[s].left > 0 ? ` (encore ${front.rockets[s].left})` : ''}.` });
      }
      for (let i = 0; i < front.map.N; i++) {
        if (front.owner[i] < 0 || Math.hypot(front.centers.x[i] - o.x, front.centers.y[i] - o.y) > o.r) continue;
        const blown = barrageWorks(front, i, k * (S.works / 0.12), false);
        if (blown) events.push({ ...blown, side: s });
        if (front.owner[i] !== 1 - s) continue;
        const l = front.dens[i] * S.rate * k;
        front.dens[i] -= l;
        front.stats.losses[1 - s] += l;
        front.shock[i] = Math.min(1, front.shock[i] + GUN_RULES.shock * S.shock * k);
      }
    }
  }
  if (front.tick === 0 && front.salvos.some((l) => l.length)) events.push({ kind: 'salvo' });
}

// ---------- Parachutistes ----------

export function addDrop(front, s, at) {
  if (front.phase !== 'plan') return { error: 'Les ordres se donnent le matin.' };
  initSpecial(front);
  const para = front.paras[s].find((p) => !p.used);
  if (!para) return { error: 'Plus de parachutistes disponibles.' };
  const i = cellAt(front, at);
  if (i < 0 || front.owner[i] !== 1 - s) return { error: 'Le largage se fait derrière les lignes ennemies.' };
  if (distToOwn(front, s, at) > SPECIAL.drop.reach) return { error: `Trop loin de vos lignes (${Math.round(SPECIAL.drop.reach / 1.73)} cases au plus).` };
  const o = { id: nextId++, side: s, x: front.centers.x[i], y: front.centers.y[i], i, para: para.id, dens: para.dens };
  para.used = o.id;
  front.drops[s].push(o);
  return o;
}

export function removeSpecial(front, s, id) {
  if (!front.salvos) return;
  front.salvos[s] = front.salvos[s].filter((o) => o.id !== id);
  const d = front.drops[s].find((o) => o.id === id);
  if (d) { front.paras[s].find((p) => p.id === d.para).used = null; front.drops[s] = front.drops[s].filter((o) => o !== d); }
}

// Au lever du jour : les parachutistes prennent les cases autour du point de largage ; une part des ennemis y meurt,
// le reste reflue vers les cases voisines. Des événements « capture » suivent (villes, PC, journal).
export function dropTick(front, events) {
  if (!front.drops || front.tick !== 0) return;
  const { nb } = front.map;
  const cx = front.centers.x, cy = front.centers.y;
  for (const s of [0, 1]) {
    for (const o of front.drops[s]) {
      const zone = [];
      for (let i = 0; i < front.map.N; i++) if (front.owner[i] === 1 - s && Math.hypot(cx[i] - o.x, cy[i] - o.y) <= SPECIAL.drop.r) zone.push(i);
      if (!zone.length) { front.paras[s].find((p) => p.id === o.para).used = null; continue; } // la zone est déjà à nous
      const inZone = new Set(zone);
      for (const i of zone) {
        const e = front.dens[i];
        const dead = e * SPECIAL.drop.kill;
        front.stats.losses[1 - s] += dead;
        const out = [];
        for (let d = 0; d < 6; d++) { const j = nb[i * 6 + d]; if (j >= 0 && front.owner[j] === 1 - s && !inZone.has(j)) out.push(j); }
        if (out.length) for (const j of out) front.dens[j] += (e - dead) / out.length;
        else front.stats.losses[1 - s] += e - dead;
        front.owner[i] = s;
        front.dens[i] = o.dens / zone.length;
        events.push({ kind: 'capture', i, side: s, drop: true });
      }
      front.paras[s] = front.paras[s].filter((p) => p.id !== o.para);
      front.log.push({ day: front.day, tick: 0, kind: 'drop', side: s, text: `Largage de parachutistes (${s === 0 ? 'Wehrmacht' : 'Armée rouge'}) : ${Math.round(o.dens * front.cfg.men).toLocaleString('fr-FR')} hommes tiennent ${zone.length} cases derrière le front.` });
    }
    front.drops[s] = [];
  }
}

// ---------- Point d'appui ----------

// Sur la ville ★ du défenseur la plus exposée qui n'en a pas encore (la plus proche de l'ennemi).
function placeStrongpoint(front, s, st) {
  const cx = front.centers.x, cy = front.centers.y;
  const taken = new Set(front.strong[s].map((p) => p.i));
  let best = -1, bd = Infinity;
  for (const t of front.map.towns) {
    if (front.owner[t.i] !== s || taken.has(t.i)) continue;
    let d = Infinity;
    for (let i = 0; i < front.map.N; i++) if (front.owner[i] === 1 - s) d = Math.min(d, Math.hypot(cx[i] - cx[t.i], cy[i] - cy[t.i]));
    const star = front.defTowns?.includes(t.i) ? 0 : 20; // les villes ★ d'abord
    if (d + star < bd) { bd = d + star; best = t.i; }
  }
  if (best < 0) return;
  const cells = [];
  for (let i = 0; i < front.map.N; i++) if (front.owner[i] === s && Math.hypot(cx[i] - cx[best], cy[i] - cy[best]) <= SPECIAL.strong.r) cells.push(i);
  for (const i of cells) {
    front.entrench[i] = Math.max(front.entrench[i], 1);
    front.trenchSide[i] = s;
    if (st.level >= 2) front.wire[i] = Math.max(front.wire[i], 1);
    if (st.level >= 3) front.at[i] = Math.max(front.at[i], 1);
  }
  front.worksVersion = (front.worksVersion ?? 0) + 1;
  if (st.garrison) front.dens[best] += st.garrison;
  const town = front.map.towns.find((t) => t.i === best);
  front.strong[s].push({ i: best, name: town?.name ?? '', mul: st.mul, level: st.level, cells });
}

// Dans rebuildFields : défense multipliée dans les cases du point d'appui encore tenues.
export function applyStrong(front, s, F) {
  for (const p of front.strong?.[s] ?? []) for (const i of p.cells) if (front.owner[i] === s) F.fort[i] *= p.mul;
}

// Au soir : ordres consommés.
export function specialNight(front) {
  if (!front.salvos) return;
  front.salvos = [[], []];
}
