// Rendu de la métropole (biome metropole, metrogen.js), appelé par frontrender.js :
// - calque de terrain : teinte de chaque quartier, avenues larges bordées d'arbres, voie ferrée et faisceau de la gare,
//   parcs, jardins des isbas ; les îlots, orientés selon la trame de leur quartier (grille du centre, longues halles des
//   usines, entrepôts des quais, isbas éparses), sont redessinés à chaque image selon la ruine de leur case ;
// - front : en ville, il suit les bords des cases (tracé en escalier, le long des rues) ;
// - noms de quartiers à la couleur de leur camp, repères (maisons-forteresses, gare, église, cheminées), bacs de nuit
//   le matin, lueur des incendies au crépuscule.

import { hexToPixel, pixelToHex, SQRT3 } from './hex.js';
import { createRng } from './rng.js';

// tint : teinte du quartier sous ses îlots ; ground : la même, opaque (sol d'un îlot effondré) ; fill, edge : îlots ;
// bw × bh : îlot, sx × sy : trame (pixels monde).
export const CITY_STYLE = {
  centre: { tint: 'rgba(200, 190, 166, 0.6)', ground: '#bfb59e', fill: '#a49b88', edge: '#5f5848', bw: 5.4, bh: 4.8, sx: 7.2, sy: 6.8, tilt: 0.1 },
  usine: { tint: 'rgba(150, 150, 146, 0.6)', ground: '#a2a19a', fill: '#5c6067', edge: '#2e3135', bw: 11, bh: 5, sx: 13.5, sy: 7.8, tilt: 0.1, along: true },
  ouvrier: { tint: 'rgba(198, 184, 142, 0.5)', ground: '#bcae86', fill: '#8a6a48', edge: null, bw: 3, bh: 2.6, sx: 5.4, sy: 5, tilt: 0.35, isba: true },
  gare: { tint: 'rgba(172, 160, 134, 0.6)', ground: '#ada288', fill: '#7d6f5c', edge: '#463c30', bw: 8, bh: 3.4, sx: 12, sy: 9, tilt: 0.05 },
  hauteur: { tint: 'rgba(182, 174, 128, 0.45)', ground: '#b3ac86', fill: '#9a9370', edge: '#5c5a3c', bw: 4, bh: 3.4, sx: 8.5, sy: 8.5, tilt: 0.3 },
  parc: { tint: 'rgba(122, 150, 96, 0.6)', fill: null },
  quai: { tint: 'rgba(168, 172, 166, 0.6)', ground: '#a9aca4', fill: '#7a8c96', edge: '#3c4a52', bw: 7.5, bh: 4.4, sx: 9.5, sy: 7, tilt: 0.05, along: true },
};
const LABEL_INK = ['#24406e', '#8a2617', '#3a3326']; // Wehrmacht, Armée rouge, disputé
const NIGHT_GLOW = { radius: 3.2, alpha: 0.26, min: 0.15 };

const centerOf = (W, i, cell) => hexToPixel(i % W, Math.floor(i / W), cell);

// Coins d'un îlot tourné (centre x, y ; demi-côtés ; angle).
function quad(path, x, y, hw, hh, c, s) {
  path.moveTo(x - hw * c + hh * s, y - hw * s - hh * c);
  path.lineTo(x + hw * c + hh * s, y + hw * s - hh * c);
  path.lineTo(x + hw * c - hh * s, y + hw * s + hh * c);
  path.lineTo(x - hw * c - hh * s, y - hw * s + hh * c);
  path.closePath();
}

// Calque de terrain (une fois par bataille) ; remplit r.blocks (îlots) et r.chimneys.
export function buildCity(r, ctx, CELL) {
  const map = r.map, { W, N } = map;
  const at = (x, y) => { const h = pixelToHex(x, y, CELL); return h.col < 0 || h.row < 0 || h.col >= W || h.row >= map.H ? -1 : h.row * W + h.col; };
  r.blocks = [];
  r.chimneys = [];
  r.rubble = []; // gravats des avenues (case, position)
  // Teinte des quartiers : chaque case, en hexagone plein.
  for (let i = 0; i < N; i++) {
    const d = map.district[i];
    if (d < 0) continue;
    const p = centerOf(W, i, CELL);
    ctx.beginPath();
    for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; ctx.lineTo(p.x + Math.cos(a) * CELL * 1.04, p.y + Math.sin(a) * CELL * 1.04); }
    ctx.fillStyle = CITY_STYLE[map.districts[d].type].tint;
    ctx.fill();
  }
  // Voie ferrée : traverses, puis rail sombre ; faisceau de voies à la gare.
  const pts = (path) => path.map((i) => centerOf(W, i, CELL));
  for (const path of map.rails ?? []) {
    const P = pts(path);
    ctx.setLineDash([1.2, 2.6]);
    ctx.strokeStyle = 'rgba(60, 46, 34, 0.55)';
    ctx.lineWidth = 5;
    line(ctx, P);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(52, 40, 30, 0.9)';
    ctx.lineWidth = 1.6;
    line(ctx, P);
  }
  const gare = map.districts.find((d) => d.type === 'gare');
  if (gare && map.rails?.[0]) {
    const rail = map.rails[0], g = centerOf(W, gare.center, CELL);
    const gap = (n) => { const p = centerOf(W, rail[n], CELL); return Math.hypot(p.x - g.x, p.y - g.y); };
    let k = 0;
    for (let n = 1; n < rail.length; n++) if (gap(n) < gap(k)) k = n;
    const a = centerOf(W, rail[Math.max(0, k - 3)], CELL), b = centerOf(W, rail[Math.min(rail.length - 1, k + 3)], CELL);
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
    r.gareAngle = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.strokeStyle = 'rgba(52, 40, 30, 0.6)';
    ctx.lineWidth = 0.8;
    for (let q = -3; q <= 3; q++) {
      ctx.beginPath();
      ctx.moveTo(a.x + nx * q * 2.4, a.y + ny * q * 2.4);
      ctx.lineTo(b.x + nx * q * 2.4, b.y + ny * q * 2.4);
      ctx.stroke();
    }
  }
  // Avenues : ruban large et clair, cerné ; rangées d'arbres sur les radiales et le boulevard.
  // En ville seulement (dans la steppe, la route ordinaire suffit) : tronçons de cases de ville, prolongés d'une case.
  const runs = [];
  for (const path of map.avenues ?? []) {
    let run = [];
    path.forEach((i, k) => {
      const inside = map.district[i] >= 0 || map.district[path[k + 1]] >= 0 || map.district[path[k - 1]] >= 0;
      if (inside) run.push(i);
      else if (run.length) { runs.push(run); run = []; }
    });
    if (run.length > 1) runs.push(run);
  }
  for (const [w, color] of [[CELL * 1.75, 'rgba(86, 66, 40, 0.5)'], [CELL * 1.55, 'rgb(232, 222, 192)']]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    for (const run of runs) line(ctx, pts(run));
  }
  map.avenues.forEach((path, n) => {
    if (n === map.avenues.length - 1) return; // la route des quais n'a pas d'arbres
    const P = pts(path);
    ctx.fillStyle = 'rgba(78, 104, 56, 0.75)';
    for (let k = 1; k < P.length; k++) {
      const a = P[k - 1], b = P[k], L = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
      if (map.district[path[k]] < 0) continue;
      for (const t of [0.25, 0.75]) for (const sg of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(a.x + (b.x - a.x) * t + nx * sg * CELL * 0.62, a.y + (b.y - a.y) * t + ny * sg * CELL * 0.62, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const i of path) if (map.district[i] >= 0) { const p = centerOf(W, i, CELL); r.rubble.push({ c: i, x: p.x, y: p.y }); }
  });
  // Îlots, quartier par quartier : trame tournée, tirée sur l'emprise du quartier, hors avenues, voies et eau.
  for (const d of map.districts) {
    const S = CITY_STYLE[d.type];
    const rng = createRng(`city:${map.seed}:${d.id}`);
    if (!S.fill) {
      // Parc : bosquets.
      for (const i of d.cells) {
        const p = centerOf(W, i, CELL);
        for (let t = 0; t < 4; t++) {
          ctx.beginPath();
          ctx.arc(p.x + (rng.next() - 0.5) * CELL * 1.4, p.y + (rng.next() - 0.5) * CELL * 1.3, 1.3 + rng.next() * 1.1, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(58, 88, 44, 0.75)';
          ctx.fill();
        }
      }
      continue;
    }
    const ang = (S.along ? Math.PI / 2 : d.type === 'gare' ? r.gareAngle ?? 0 : 0) + (rng.next() - 0.5) * 2 * S.tilt;
    const c = Math.cos(ang), s = Math.sin(ang);
    let mx = 0, my = 0;
    for (const i of d.cells) { const p = centerOf(W, i, CELL); mx += p.x; my += p.y; }
    mx /= d.cells.length; my /= d.cells.length;
    let R = 0;
    for (const i of d.cells) { const p = centerOf(W, i, CELL); R = Math.max(R, Math.hypot(p.x - mx, p.y - my)); }
    R += CELL * 2;
    for (let u = -R; u <= R; u += S.sx) for (let v = -R; v <= R; v += S.sy) {
      const jx = S.isba ? (rng.next() - 0.5) * 1.6 : 0, jy = S.isba ? (rng.next() - 0.5) * 1.6 : 0;
      const x = mx + u * c - v * s + jx, y = my + u * s + v * c + jy;
      const i = at(x, y);
      if (i < 0 || map.district[i] !== d.id || map.avenue[i] || map.rail?.[i] || map.river[i]) continue;
      if (S.isba && rng.next() < 0.2) continue; // jardins plus vastes çà et là
      const q = createRng(`blk:${map.seed}:${i}:${Math.round(x)}:${Math.round(y)}`);
      r.blocks.push({ c: i, x, y, hw: S.bw / 2, hh: S.bh / 2, cos: c, sin: s, type: d.type, th: q.next(), fire: q.next(), ph: q.next() * 10, shape: [0, 1, 2, 3, 4, 5].map(() => 0.6 + q.next() * 0.7) });
      if (S.isba) { ctx.fillStyle = 'rgba(96, 122, 62, 0.35)'; ctx.fillRect(x - S.sx * 0.42, y - S.sy * 0.4, S.sx * 0.84, S.sy * 0.8); }
      if (d.type === 'usine' && q.next() < 0.18) r.chimneys.push({ c: i, x: x + S.bw * 0.3 * c, y: y + S.bw * 0.3 * s });
    }
  }
  // Emprise des îlots (pixels monde) : le calque des îlots intacts ne couvre qu'elle.
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const b of r.blocks) { box.x0 = Math.min(box.x0, b.x - 8); box.y0 = Math.min(box.y0, b.y - 8); box.x1 = Math.max(box.x1, b.x + 8); box.y1 = Math.max(box.y1, b.y + 8); }
  r.cityBox = box;
}

function line(ctx, P) {
  ctx.beginPath();
  P.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
}

// Îlots, à chaque image : intacts (passe damaged false, sous les masses), touchés (passe true, par-dessus). Les intacts
// sont peints une fois (par camp observateur) sur un calque couvrant l'emprise de la ville ; chaque image recouvre
// les îlots touchés (sol du quartier, puis leur état) et ne parcourt qu'eux.
export function drawCity(r, viewer, damaged) {
  const { ctx } = r, f = r.front;
  if (!r.blocks) return;
  const mem = viewer === null ? null : f.memory[viewer];
  const known = (c) => !mem || f.owner[c] === viewer || mem.seen[c] >= 0;
  const ruinOf = (b) => (known(b.c) ? r.houseRuin(b) : 0);
  if (!damaged) {
    r.cityHit = r.blocks.filter((b) => ruinOf(b) > 0);
    if (!r.cityLayer) {
      const paths = {};
      for (const b of r.blocks) quad((paths[b.type] ??= new Path2D()), b.x, b.y, b.hw, b.hh, b.cos, b.sin);
      const L = (r.cityLayer = document.createElement('canvas')), B = r.cityBox, k = r.layerScale;
      L.width = Math.ceil((B.x1 - B.x0) * k);
      L.height = Math.ceil((B.y1 - B.y0) * k);
      const lc = L.getContext('2d');
      lc.setTransform(k, 0, 0, k, -B.x0 * k, -B.y0 * k);
      for (const [type, P] of Object.entries(paths)) {
        const S = CITY_STYLE[type];
        lc.fillStyle = S.fill;
        lc.fill(P);
        if (S.edge) { lc.strokeStyle = S.edge; lc.lineWidth = 0.5; lc.stroke(P); }
      }
    }
    const B = r.cityBox;
    ctx.drawImage(r.cityLayer, B.x0, B.y0, B.x1 - B.x0, B.y1 - B.y0);
    return;
  }
  for (const b of r.cityHit ?? []) {
    const u = ruinOf(b);
    // Le sol du quartier recouvre l'îlot intact du calque.
    ctx.beginPath();
    quad(ctx, b.x, b.y, b.hw + 0.6, b.hh + 0.6, b.cos, b.sin);
    ctx.fillStyle = CITY_STYLE[b.type].ground;
    ctx.fill();
    if (u < 1) {
      // En feu, éventré : murs noircis, toit qui disparaît.
      ctx.beginPath();
      quad(ctx, b.x, b.y, b.hw, b.hh, b.cos, b.sin);
      ctx.fillStyle = b.type === 'ouvrier' ? 'rgb(58, 44, 34)' : 'rgb(74, 66, 60)';
      ctx.fill();
      if (u < 0.6) {
        ctx.beginPath();
        quad(ctx, b.x, b.y, b.hw * (1 - u), b.hh * 0.5, b.cos, b.sin);
        ctx.fillStyle = CITY_STYLE[b.type].fill;
        ctx.fill();
      }
      continue;
    }
    if (b.type === 'ouvrier') {
      // Isba brûlée : cendres et le seul poêle debout.
      ctx.fillStyle = 'rgba(44, 38, 32, 0.55)';
      ctx.fillRect(b.x - 2, b.y - 1.6, 4, 3.2);
      ctx.fillStyle = 'rgb(30, 26, 22)';
      ctx.fillRect(b.x - 0.6 + (b.th - 0.5) * 1.5, b.y - 1.4, 1.2, 2.2);
      continue;
    }
    // Gravats : tas gris irrégulier à l'emprise de l'îlot, quelques blocs, un pan de mur parfois.
    ctx.fillStyle = 'rgb(140, 134, 124)';
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = k * 1.047 + b.th, dd = b.shape[k];
      ctx.lineTo(b.x + Math.cos(a) * b.hw * dd, b.y + Math.sin(a) * b.hh * dd * 1.1);
    }
    ctx.fill();
    ctx.fillStyle = 'rgb(92, 88, 80)';
    for (let k = 0; k < 3; k++) ctx.fillRect(b.x + (b.shape[k] - 0.95) * b.hw * 1.4, b.y + (b.shape[k + 3] - 0.95) * b.hh * 1.4, 1, 1);
    if (b.th > 0.8) {
      ctx.strokeStyle = 'rgb(70, 66, 60)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(b.x - b.hw * b.cos, b.y - b.hw * b.sin);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  // Avenues en ruines : gravats en travers, la rue se ferme aux chars.
  for (const g of r.rubble) {
    const u = known(g.c) ? f.ruin[g.c] : 0;
    if (u < 0.5) continue;
    ctx.fillStyle = `rgba(132, 126, 116, ${Math.min(1, (u - 0.4) * 1.6)})`;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.ellipse(g.x + (k - 1) * 3.2, g.y + ((k * 7) % 3 - 1) * 1.6, 2.6, 1.6, 0.5 * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Front en ville : les bords de cases entre deux camps (au sens de ce que voit viewer), là où l'une des deux cases
// est en ville. v : vue de frontrender (owner : 1 Wehrmacht, 0 Armée rouge ; open : case praticable).
export function cityFrontEdges(r, v, CELL) {
  const map = r.map, { W, N, nb } = map;
  const segs = [];
  for (let i = 0; i < N; i++) {
    if (!v.open[i]) continue;
    for (let d = 0; d < 3; d++) {
      const j = nb[i * 6 + d];
      if (j < 0 || !v.open[j] || v.owner[i] === v.owner[j]) continue;
      if (map.district[i] < 0 && map.district[j] < 0) continue;
      const p = centerOf(W, i, CELL), a = (-Math.PI / 3) * d;
      for (const e of [-1, 1]) segs.push(p.x + Math.cos(a + (e * Math.PI) / 6) * CELL, p.y + Math.sin(a + (e * Math.PI) / 6) * CELL);
    }
  }
  return segs;
}

// Le segment (milieu x, y) tombe-t-il en ville (il est alors remplacé par le tracé en escalier) ?
export function inCity(r, x, y, CELL) {
  const h = pixelToHex(x, y, CELL), map = r.map;
  if (h.col < 0 || h.row < 0 || h.col >= map.W || h.row >= map.H) return false;
  return map.district[h.row * map.W + h.col] >= 0;
}

// Camp qui possède chaque quartier, au sens de ce que voit viewer (null : disputé).
export function districtOwners(r, viewer) {
  const f = r.front, mem = viewer === null ? null : f.memory[viewer];
  return r.map.districts.map((d) => {
    let a = 0, b = 0;
    for (const i of d.cells) {
      const o = viewer === null || f.owner[i] === viewer ? f.owner[i] : mem.owner[i];
      if (o === 0) a++; else if (o === 1) b++;
    }
    const need = d.cells.length * 0.6;
    return a > need ? 0 : b > need ? 1 : null;
  });
}

// Noms des quartiers, à la couleur du camp qui les possède ; un quartier qui change de mains s'éclaire un instant.
export function drawDistricts(r, viewer, now, CELL) {
  const { ctx } = r, map = r.map;
  const own = districtOwners(r, viewer);
  r.distPrev ??= own.slice();
  r.distFlash ??= own.map(() => -1e9);
  own.forEach((o, k) => { if (o !== r.distPrev[k]) { r.distFlash[k] = now; r.distPrev[k] = o; } });
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '1.2px';
  // Taille : celle du monde de près, au moins 6,5 pixels à l'écran de loin (vue d'ensemble).
  const k = Math.max(1, 6.5 / 8 / r.cam.s);
  for (const d of map.districts) {
    const p = centerOf(map.W, d.center, CELL);
    const o = own[d.id], flash = Math.max(0, 1 - (now - r.distFlash[d.id]) / 1600);
    ctx.font = `600 ${(d.type === 'centre' ? 9.5 : 8) * k}px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif`;
    const text = d.name.toUpperCase();
    ctx.lineWidth = 3 * k;
    ctx.strokeStyle = flash > 0 ? `rgba(255, 210, 63, ${0.5 + 0.5 * flash})` : 'rgba(244, 238, 220, 0.85)';
    ctx.strokeText(text, p.x, p.y);
    ctx.fillStyle = LABEL_INK[o === null ? 2 : o];
    ctx.fillText(text, p.x, p.y);
    ctx.font = `${7 * k}px "IBM Plex Sans Condensed", sans-serif`;
    ctx.lineWidth = 2.4 * k;
    const pips = '●'.repeat(d.value);
    ctx.strokeText(pips, p.x, p.y + 8 * k);
    ctx.fillText(pips, p.x, p.y + 8 * k);
  }
  ctx.restore();
}

// Repères : maisons-forteresses, gare, église de la vieille ville, cheminées des usines (elles restent debout).
export function drawLandmarks(r, viewer, CELL) {
  const { ctx } = r, f = r.front, map = r.map;
  const mem = viewer === null ? null : f.memory[viewer];
  const ruinOf = (c) => (!mem || f.owner[c] === viewer || mem.seen[c] >= 0 ? f.ruin[c] : 0);
  for (const ch of r.chimneys ?? []) {
    ctx.fillStyle = 'rgb(40, 40, 42)';
    ctx.beginPath();
    ctx.arc(ch.x, ch.y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const icon = (kind, c) => {
    const p = centerOf(map.W, c, CELL), broken = ruinOf(c) > 0.7;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = broken ? 'rgb(150, 144, 134)' : 'rgb(236, 228, 204)';
    ctx.strokeStyle = 'rgb(43, 39, 34)';
    ctx.lineWidth = 1;
    if (broken) ctx.setLineDash([1.5, 1.2]);
    ctx.beginPath();
    if (kind === 'silo') {
      ctx.rect(-6, -4, 12, 8);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      for (let x = -3; x <= 3; x += 3) { ctx.moveTo(x, -4); ctx.lineTo(x, 4); }
      ctx.stroke();
    } else if (kind === 'store') {
      ctx.rect(-5.5, -3.5, 11, 7);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-5.5, -1.2); ctx.lineTo(5.5, -1.2); ctx.stroke();
    } else if (kind === 'corner') {
      ctx.rect(-3.8, -3.8, 7.6, 7.6);
      ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
    } else if (kind === 'water') {
      ctx.moveTo(0, 4.5); ctx.lineTo(0, 0.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -1.5, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (kind === 'station') {
      ctx.rect(-7, -2.5, 14, 6);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-7, -2.5); ctx.lineTo(0, -6.5); ctx.lineTo(7, -2.5); ctx.stroke();
    } else if (kind === 'church') {
      ctx.rect(-3.5, -1, 7, 5);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -1, 3.2, Math.PI, 0); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -4.2); ctx.lineTo(0, -7); ctx.moveTo(-1.3, -6); ctx.lineTo(1.3, -6); ctx.stroke();
    }
    ctx.restore();
  };
  const KIND = { 'Silo à grain': 'silo', 'Grand magasin': 'store', 'Maison d\'angle': 'corner', 'Château d\'eau': 'water' };
  for (const s of map.strongholds ?? []) icon(KIND[s.name] ?? 'corner', s.i);
  for (const d of map.districts) {
    if (d.type === 'gare') icon('station', d.center);
    if (d.type === 'centre') icon('church', d.center);
  }
  // Noms des maisons-forteresses, de près seulement.
  if (r.cam.s > 1.3) {
    ctx.save();
    ctx.font = 'italic 6.5px "IBM Plex Sans Condensed", sans-serif';
    ctx.textAlign = 'center';
    for (const s of map.strongholds ?? []) {
      const p = centerOf(map.W, s.i, CELL);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = 'rgba(244, 238, 220, 0.85)';
      ctx.strokeText(s.name, p.x, p.y + 10);
      ctx.fillStyle = '#2b2722';
      ctx.fillText(s.name, p.x, p.y + 10);
    }
    ctx.restore();
  }
}

// Bacs de nuit, montrés le matin : de la rive gauche à un accostage tenu de chaque quai (et usine) du défenseur ;
// une barque glisse sur chaque trajet.
export function drawFerries(r, viewer, now, CELL) {
  const { ctx } = r, f = r.front, map = r.map;
  if (f.phase !== 'plan' || !map.landing) return;
  const def = 1 - f.attacker, mem = viewer === null ? null : f.memory[viewer];
  const ownerOf = (i) => (viewer === null || f.owner[i] === viewer ? f.owner[i] : mem.owner[i]);
  const dirX = def === 1 ? 1 : -1;
  ctx.save();
  for (const d of map.districts) {
    if (d.type !== 'quai' && d.type !== 'usine') continue;
    const c0 = centerOf(map.W, d.center, CELL);
    let best = -1, bd = Infinity;
    for (const i of d.cells) {
      if (!map.landing[i] || ownerOf(i) !== def) continue;
      const p = centerOf(map.W, i, CELL), dd = Math.hypot(p.x - c0.x, p.y - c0.y);
      if (dd < bd) { bd = dd; best = i; }
    }
    if (best < 0) continue;
    const a = centerOf(map.W, best, CELL), b = { x: a.x + dirX * CELL * SQRT3 * 3.2, y: a.y + CELL * 0.6 };
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = 'rgba(244, 238, 220, 0.85)';
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(a.x, a.y); ctx.stroke();
    ctx.setLineDash([]);
    const t = (now / 5000 + d.id * 0.37) % 1;
    ctx.fillStyle = 'rgb(44, 36, 28)';
    ctx.beginPath();
    ctx.ellipse(b.x + (a.x - b.x) * t, b.y + (a.y - b.y) * t, 2.2, 1.1, Math.atan2(a.y - b.y, a.x - b.x), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Crépuscule : la ville qui brûle éclaire le ciel par en dessous (lueur orangée autour des incendies, sur l'eau aussi).
export function drawCityGlow(r, viewer, dark, CELL) {
  if (dark <= 0 || !r.map.districts) return;
  const { ctx } = r, f = r.front, map = r.map;
  const seen = (c) => viewer === null || f.owner[c] === viewer || f.vision[viewer][c];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const R = CELL * NIGHT_GLOW.radius;
  for (let c = 0; c < map.N; c++) {
    const heat = r.fire[c];
    if (heat < NIGHT_GLOW.min || map.district[c] < 0 || !seen(c)) continue;
    const p = centerOf(map.W, c, CELL);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
    g.addColorStop(0, `rgba(255, 120, 40, ${NIGHT_GLOW.alpha * dark * Math.min(1, heat)})`);
    g.addColorStop(1, 'rgba(255, 120, 40, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(p.x - R, p.y - R, R * 2, R * 2);
  }
  ctx.restore();
}
