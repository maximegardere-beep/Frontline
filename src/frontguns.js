// Artillerie du front stratégique : quelques groupes nommés, placés derrière le front, avec une portée.
// Leur puissance de feu dépend de leur posture, inverse de leur vitesse : en batterie (immobile, plein feu),
// appui mobile (mi-vitesse, 40 %), déplacement (rapide, aucun tir). Appui passif dans leur portée : attaque et
// défense des troupes amies renforcées (applyArtillery), assaillants frappés (supportFire). Barrages focalisés :
// quelques-uns par bataille (front.barrageStock), tous les groupes libres à portée y concourent.
// Un groupe dont la case tombe est perdu ; un barrage ennemi sur sa position l'use (contre-batterie).
// Distances en unités de grille (deux cases voisines sont à 1,73).

import { pixelToHex } from './hex.js';
import { LONG_RANGE } from './frontmetro.js';

export const GUN_KINDS = {
  div: { label: 'Artillerie divisionnaire', short: 'Art.', range: 18, r: 3, rate: 0.04, works: 0.12, speed: 0.6 },
  heavy: { label: 'Artillerie lourde', short: 'Art. lourde', range: 26, r: 2.6, rate: 0.05, works: 0.2, speed: 0.4 },
  mortar: { label: 'Mortiers lourds 120 mm', short: 'Mortiers', range: 12, r: 2.6, rate: 0.045, works: 0.1, speed: 0.7 },
  rocket: { label: 'Lance-roquettes (Katioucha)', short: 'Katioucha', range: 13, r: 3.5, rate: 0.07, works: 0.06, speed: 0.8 },
  nebel: { label: 'Lance-roquettes (Nebelwerfer)', short: 'Nebelwerfer', range: 12, r: 3, rate: 0.065, works: 0.06, speed: 0.7 },
  // Canons antichar (atout du défenseur) : tir tendu dans un cône face au contact, contre les seuls blindés ; pas de
  // barrage ni d'appui contre l'infanterie. at.kill : chars détruits par tick à bout portant et pleine puissance ;
  // at.shock : choc retiré à la formation visée ; back : placement derrière le contact.
  atLight: { label: 'Canons antichar légers', short: 'Antichar', range: 6, r: 0, rate: 0, works: 0, speed: 0.7, back: 3, at: { kill: 4, shock: 0.3 } },
  atMed: { label: 'Canons antichar', short: 'Antichar', range: 7.5, r: 0, rate: 0, works: 0, speed: 0.6, back: 3.5, at: { kill: 6, shock: 0.4 } },
  atHeavy: { label: 'Canons antichar lourds', short: 'Antichar lourd', range: 10, r: 0, rate: 0, works: 0, speed: 0.4, back: 4.5, at: { kill: 9, shock: 0.5 } },
};

// Métropole : distance des batteries du défenseur à la rive éloignée du fleuve (unités de grille) ; seules les pièces
// à longue portée (LONG_RANGE) y vont, mortiers et lance-roquettes restent en ville.
export const METRO_GUNS = { bank: 3 };

// Cône de tir des canons antichar (demi-angle) ; les chars lourds encaissent mieux.
export const AT_RULES = { cone: 0.87, heavy: 0.6, maxShock: 0.6 };

// fire : part de la puissance ; move : part de la vitesse du groupe.
export const GUN_POSTURES = {
  battery: { label: 'En batterie', fire: 1, move: 0 },
  mobile: { label: 'Appui mobile', fire: 0.4, move: 0.5 },
  move: { label: 'Déplacement', fire: 0, move: 1 },
};

export const GUN_RULES = {
  support: 0.008, // appui défensif : part de la densité des assaillants détruite par tick, à pleine puissance
  supportCells: 8, // cases assaillantes frappées au plus par groupe et par tick
  counter: 0.07, // usure d'un groupe par tick de barrage ennemi sur sa position
  regen: 0.15, // récupération nocturne
  minStr: 0.25, // en dessous, le groupe est hors de combat (détruit)
  flee: 0.12, // part des troupes d'une case pilonnée qui décroche vers l'arrière, par tick de barrage
  shock: 0.15, // choc infligé aux troupes ennemies d'une case pilonnée, par tick de barrage à pleine puissance (combat.js)
  spot: 5.5, // distance de repérage d'un groupe camouflé (unités de grille, ~3 cases)
  // Appui passif (applyArtillery) : bonus d'attaque des poussées et de défense des cases couvertes, à pleine
  // couverture. Couverture d'un groupe : sa puissance, pleine jusqu'à 70 % de sa portée puis décroissante ; plusieurs
  // groupes se cumulent avec des rendements décroissants (stack : 1 groupe 1, 2 groupes 1,4, 3 groupes 1,56).
  coverAtk: 0.12,
  coverDef: 0.15,
  coverFade: 0.3,
  coverStack: 0.6,
  focus: 1.2, // puissance d'un barrage focalisé (stock de barrages) par rapport à l'ancienne mission quotidienne
};

// Groupes engagés dans un barrage (un seul pour les barrages d'avant le stock).
export const missionGuns = (b) => b.guns ?? [b.gun];
export const onMission = (front, g) => front.barrages[g.side].some((b) => missionGuns(b).includes(g.id));

const ORDINAL = (n) => `${n}${n === 1 ? 'er' : 'e'}`;

// Nom suivant, pour éviter deux unités du même nom : « 1er rég. … » → « 2e rég. … », « Pz.Jg.Abt. 40 » → « … 41 ».
export function nextName(name) {
  const m = name.match(/^(\d+)(?:er|e) (.*)$/);
  if (m) return `${Number(m[1]) + 1}e ${m[2]}`;
  return /\d/.test(name) ? name.replace(/\d+/, (n) => String(Number(n) + 1)) : `${name} II`;
}

function gunCell(front, g) {
  const h = pixelToHex(g.x, g.y, 1);
  const { W, H } = front.map;
  return h.col < 0 || h.row < 0 || h.col >= W || h.row >= H ? -1 : h.row * W + h.col;
}
export { gunCell };

export const gunPower = (g) => (g.lost ? 0 : GUN_POSTURES[g.posture].fire * g.str);

// Groupes de départ : répartis du nord au sud, à mi-portée derrière le front.
export function createGuns(front, kinds) {
  const { W, H, N } = front.map;
  const cx = front.centers.x, cy = front.centers.y;
  const guns = [];
  let id = 1;
  for (const s of [0, 1]) {
    const list = kinds[s];
    // Cases de contact, par ligne : où est le front.
    const frontX = new Float32Array(H).fill(NaN);
    for (let i = 0; i < N; i++) {
      if (front.owner[i] !== s) continue;
      for (let d = 0; d < 6; d++) {
        const j = front.map.nb[i * 6 + d];
        if (j >= 0 && front.owner[j] === 1 - s) {
          const r = Math.floor(i / W);
          frontX[r] = Number.isNaN(frontX[r]) ? cx[i] : s === 0 ? Math.max(frontX[r], cx[i]) : Math.min(frontX[r], cx[i]);
          break;
        }
      }
    }
    // Métropole : l'artillerie du défenseur tire de l'autre rive du fleuve, hors d'atteinte de l'assaut (rive la plus
    // éloignée de l'ennemi, par ligne).
    const farBank = new Float32Array(H).fill(NaN);
    if (front.map.districts && s !== front.attacker) {
      for (let i = 0; i < N; i++) {
        if (!front.map.river[i]) continue;
        const r = Math.floor(i / W);
        farBank[r] = Number.isNaN(farBank[r]) ? cx[i] : s === 0 ? Math.min(farBank[r], cx[i]) : Math.max(farBank[r], cx[i]);
      }
    }
    list.forEach((kind, k) => {
      const K = GUN_KINDS[kind];
      let row = Math.round(((k + 0.5) / list.length) * H);
      while (Number.isNaN(frontX[row]) && row < H - 1) row++;
      const want = { x: frontX[row] - (s === 0 ? 1 : -1) * (K.back ?? Math.max(7, K.range * 0.5)), y: cy[row * W] };
      if (!K.at && K.range >= LONG_RANGE && !Number.isNaN(farBank[row])) want.x = farBank[row] - (s === 0 ? 1 : -1) * METRO_GUNS.bank;
      // Case amie la plus proche du point voulu, hors montagne.
      let best = -1, bd = Infinity;
      for (let i = 0; i < N; i++) {
        if (front.owner[i] !== s || front.map.flow[i] <= 0) continue;
        const d = Math.hypot(cx[i] - want.x, cy[i] - want.y);
        if (d < bd) { bd = d; best = i; }
      }
      const n = list.slice(0, k + 1).filter((x) => x === kind || (K.at && GUN_KINDS[x].at && kind !== 'atHeavy' && x !== 'atHeavy')).length;
      const name = K.at
        ? (s === 0 ? (kind === 'atHeavy' ? `Flak-Abt. ${21 + k * 9} (8,8 cm)` : `Pz.Jg.Abt. ${40 + k * 13}`) : kind === 'atHeavy' ? `${ORDINAL(n)} rég. antichar lourd` : `${ORDINAL(n)} rég. antichar`)
        : s === 0
          ? (kind === 'heavy' ? `Art.Abt. ${600 + k * 7}` : kind === 'nebel' ? `Werfer-Rgt. ${51 + k}` : `Art.Rgt. ${100 + k * 33}`)
          : (kind === 'rocket' ? `${ORDINAL(n)} rég. de mortiers de la Garde` : kind === 'mortar' ? `${ORDINAL(n)} rég. de mortiers` : `${ORDINAL(n)} rég. d'artillerie`);
      let unique = name;
      while (guns.some((g) => g.name === unique) || front.guns?.some((g) => g.name === unique)) unique = nextName(unique);
      guns.push({ id: id++, side: s, kind, name: unique, x: cx[best], y: cy[best], str: 1, posture: 'battery', dest: null, lost: false, fired: -99, seen: [null, null], face: s === 0 ? 0 : Math.PI });
    });
  }
  return guns;
}

// Ordre de déplacement (ou de mise en batterie, dest = null).
export function setGunOrder(front, s, id, { posture, dest } = {}) {
  if (front.phase !== 'plan') return { error: 'Les ordres se donnent le matin.' };
  const g = front.guns.find((x) => x.id === id && x.side === s && !x.lost);
  if (!g) return { error: 'Groupe d\'artillerie introuvable.' };
  if (dest !== undefined) {
    if (dest) {
      const h = pixelToHex(dest.x, dest.y, 1);
      const i = h.row * front.map.W + h.col;
      if (h.col < 0 || h.row < 0 || h.col >= front.map.W || h.row >= front.map.H || front.owner[i] !== s) return { error: 'L\'artillerie se déplace dans vos lignes.' };
    }
    g.dest = dest ? { x: dest.x, y: dest.y } : null;
    if (!g.dest) g.posture = 'battery';
    else if (!posture) {
      // Posture par défaut : mobile si l'on arrive dans la journée à mi-vitesse, sinon déplacement.
      const reach = GUN_KINDS[g.kind].speed * GUN_POSTURES.mobile.move * front.cfg.ticks;
      g.posture = Math.hypot(g.dest.x - g.x, g.dest.y - g.y) <= reach ? 'mobile' : 'move';
    }
  }
  if (posture) {
    if (!GUN_POSTURES[posture]) return { error: 'Posture inconnue.' };
    g.posture = posture;
    if (posture === 'battery') g.dest = null;
  }
  // Un groupe qui ne tire plus perd sa mission du jour.
  if (gunPower(g) <= 0) {
    for (const b of front.barrages[s]) if (b.guns) b.guns = b.guns.filter((id) => id !== g.id);
    front.barrages[s] = front.barrages[s].filter((b) => (b.guns ? b.guns.length > 0 : b.gun !== g.id));
    for (const b of front.barrages[s]) if (b.guns && !b.guns.includes(b.gun)) b.gun = b.guns[0];
  }
  return g;
}

// Groupe qui tirera un barrage sur at : à portée, capable de tirer, sans mission ; le plus puissant d'abord.
export function gunFor(front, s, at) {
  let best = null;
  for (const g of front.guns) {
    if (g.side !== s || GUN_KINDS[g.kind].at || gunPower(g) <= 0 || onMission(front, g)) continue;
    if (Math.hypot(g.x - at.x, g.y - at.y) > GUN_KINDS[g.kind].range) continue;
    if (!best || gunPower(g) * GUN_KINDS[g.kind].rate > gunPower(best) * GUN_KINDS[best.kind].rate) best = g;
  }
  return best;
}

// Un tick de déplacement : vers la destination, sans quitter ses lignes ; puis perte des groupes débordés.
export function moveGuns(front, events) {
  for (const g of front.guns) {
    if (g.lost) continue;
    if (g.dest) {
      const step = GUN_KINDS[g.kind].speed * GUN_POSTURES[g.posture].move;
      const dx = g.dest.x - g.x, dy = g.dest.y - g.y, d = Math.hypot(dx, dy);
      if (step > 0) {
        const k = d <= step ? 1 : step / d;
        const nx = g.x + dx * k, ny = g.y + dy * k;
        const i = gunCell(front, { x: nx, y: ny });
        if (i >= 0 && front.owner[i] === g.side) { g.x = nx; g.y = ny; }
        if (d <= step) g.dest = null;
      }
    }
    const i = gunCell(front, g);
    if (i >= 0 && front.owner[i] === 1 - g.side) {
      g.lost = true;
      events.push({ kind: 'gunLost', side: g.side, id: g.id, i });
    }
  }
}

// Appui défensif : chaque groupe sans mission (ou après le barrage du matin) frappe les cases ennemies qui
// poussent sur les siennes, à portée, au prorata de sa puissance.
export function supportFire(front, edges) {
  if (!edges?.length) return;
  const cx = front.centers.x, cy = front.centers.y;
  for (const g of front.guns) {
    const p = gunPower(g);
    if (p <= 0 || GUN_KINDS[g.kind].at) continue;
    const busy = front.tick < front.cfg.barrageTicks && onMission(front, g);
    if (busy) continue;
    const R = GUN_KINDS[g.kind].range;
    const hits = new Map();
    for (let k = 0; k < edges.length; k += 3) {
      const i = edges[k], j = edges[k + 1];
      if (front.owner[i] !== 1 - g.side || front.owner[j] !== g.side) continue;
      if (Math.hypot(cx[i] - g.x, cy[i] - g.y) > R) continue;
      hits.set(i, (hits.get(i) ?? 0) + edges[k + 2]);
    }
    if (!hits.size) continue;
    const targets = [...hits].sort((a, b) => b[1] - a[1]).slice(0, GUN_RULES.supportCells);
    for (const [i] of targets) {
      // Les blindés (puissance de choc élevée) encaissent mieux le tir indirect que l'infanterie à découvert.
      const F = front.field[1 - g.side];
      const armored = Math.max(0, Math.min(1, (F.atk[i] - 1.2) / 0.6));
      const l = front.dens[i] * GUN_RULES.support * p * (GUN_KINDS[g.kind].rate / 0.04) * (1 - 0.7 * armored);
      front.dens[i] -= l;
      front.stats.losses[1 - g.side] += l;
    }
    g.fired = front.clock;
  }
}

// Couverture d'artillerie du camp s, case par case (0 : aucune ; 1 : un groupe en batterie à bonne portée ; jusqu'à
// 1/coverStack avec plusieurs groupes). weather : efficacité des feux du jour (brouillard : sans observation).
export function artilleryCover(front, s, weather = 1) {
  const { N } = front.map, cx = front.centers.x, cy = front.centers.y;
  const miss = new Float32Array(N).fill(1);
  let any = false;
  for (const g of front.guns ?? []) {
    if (g.side !== s || GUN_KINDS[g.kind].at) continue;
    const p = gunPower(g) * weather;
    if (p <= 0) continue;
    any = true;
    const R = GUN_KINDS[g.kind].range, fade = GUN_RULES.coverFade * R;
    for (let i = 0; i < N; i++) {
      if (Math.abs(cx[i] - g.x) >= R) continue;
      const d = Math.hypot(cx[i] - g.x, cy[i] - g.y);
      if (d >= R) continue;
      miss[i] *= 1 - GUN_RULES.coverStack * p * Math.min(1, (R - d) / fade);
    }
  }
  if (!any) return null;
  for (let i = 0; i < N; i++) miss[i] = (1 - miss[i]) / GUN_RULES.coverStack;
  return miss;
}

// Dans rebuildFields : appui passif. Les poussées parties d'une case couverte frappent plus fort, les cases
// couvertes se défendent mieux.
export function applyArtillery(front, s, F, weather = 1) {
  if (front.cfg.artyCover === false) return;
  const cov = artilleryCover(front, s, weather);
  if (!cov) return;
  for (let i = 0; i < front.map.N; i++) {
    const c = cov[i];
    if (!c || front.owner[i] !== s) continue;
    F.atk[i] *= 1 + GUN_RULES.coverAtk * c;
    F.fort[i] *= 1 + GUN_RULES.coverDef * c;
  }
}

// Orientation d'un canon antichar : vers la case ennemie la plus proche (à défaut, vers le camp ennemi).
function atFacing(front, g) {
  const cx = front.centers.x, cy = front.centers.y, R = GUN_KINDS[g.kind].range * 2;
  let bd = Infinity, face = g.side === 0 ? 0 : Math.PI;
  for (let i = 0; i < front.map.N; i++) {
    if (front.owner[i] !== 1 - g.side || Math.abs(cx[i] - g.x) > R) continue;
    const d = Math.hypot(cx[i] - g.x, cy[i] - g.y);
    if (d < bd) { bd = d; face = Math.atan2(cy[i] - g.y, cx[i] - g.x); }
  }
  return face;
}

// Une formation est-elle dans le cône d'un canon antichar ? Renvoie la proximité (0 à 1) ou 0.
export function inCone(g, x, y) {
  const K = GUN_KINDS[g.kind];
  const dx = x - g.x, dy = y - g.y, d = Math.hypot(dx, dy);
  if (d > K.range) return 0;
  let a = Math.abs(Math.atan2(dy, dx) - g.face);
  if (a > Math.PI) a = 2 * Math.PI - a;
  return a > AT_RULES.cone && d > 1 ? 0 : 1 - (0.5 * d) / K.range;
}

// Chaque tick : les canons antichar tirent sur les formations ennemies dans leur cône. Pertes en chars, et choc
// retiré au tick suivant (armorPressure). En tirant, ils se dévoilent.
export function atFire(front) {
  for (const a of front.armor ?? []) a.underAT = 0;
  for (const g of front.guns) {
    const K = GUN_KINDS[g.kind];
    if (!K.at || g.lost) continue;
    g.face = atFacing(front, g);
    const p = gunPower(g);
    if (p <= 0) continue;
    for (const a of front.armor ?? []) {
      if (a.side === g.side || a.lost) continue;
      const k = inCone(g, a.x, a.y) * p;
      if (k <= 0) continue;
      const kill = Math.min(a.tanks, K.at.kill * k * (a.heavy ? AT_RULES.heavy : 1));
      a.tanks -= kill;
      front.stats.atKills = front.stats.atKills ?? [0, 0];
      front.stats.atKills[g.side] += kill;
      a.underAT = Math.min(AT_RULES.maxShock, a.underAT + K.at.shock * k);
      a.fought = true;
      g.fired = front.clock;
    }
  }
}

// Nuit : les groupes en route qui n'ont pas de destination se remettent en batterie ; l'usure se répare un peu.
export function gunsNight(front) {
  for (const g of front.guns) {
    if (g.lost) continue;
    if (!g.dest) g.posture = 'battery';
    g.str = Math.min(1, g.str + GUN_RULES.regen);
  }
}

// Ce que le camp s sait des groupes ennemis : camouflés, ils ne sont repérés qu'à courte distance de ses troupes
// (SPOT, moins que la reconnaissance ordinaire) ou quand ils tirent. Position mise à jour à chaque tick.
export function updateGunSightings(front) {
  const cx = front.centers.x, cy = front.centers.y;
  for (const g of front.guns) {
    const s = 1 - g.side;
    if (g.lost) { g.seen[s] = null; continue; }
    let spotted = g.fired >= front.clock - 1;
    for (let i = 0; i < front.map.N && !spotted; i++) {
      if (front.owner[i] !== s || front.dens[i] <= 0.5) continue;
      if (Math.abs(cx[i] - g.x) <= GUN_RULES.spot && Math.hypot(cx[i] - g.x, cy[i] - g.y) <= GUN_RULES.spot) spotted = true;
    }
    if (spotted) g.seen[s] = { x: g.x, y: g.y, clock: front.clock };
  }
}

// Groupes visibles pour viewer (null : tous) : les siens, et les ennemis repérés depuis moins d'un jour.
export function visibleGuns(front, viewer) {
  const out = [];
  for (const g of front.guns) {
    if (g.lost) continue;
    if (viewer === null || g.side === viewer) { out.push({ g, x: g.x, y: g.y, known: true }); continue; }
    const seen = g.seen[viewer];
    if (seen && front.clock - seen.clock <= front.cfg.ticks) out.push({ g, x: seen.x, y: seen.y, known: front.clock - seen.clock <= 1 });
  }
  return out;
}
