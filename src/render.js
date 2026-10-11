// Rendu Canvas. La grille hexagonale reste la vérité du jeu ; le rendu en tire un terrain continu :
// relief lissé (champ gaussien sur les altitudes des hexagones), courbes de niveau, forêts organiques,
// routes et rivières courbes, brouillard et zones à bords doux, mouvements le long de splines.

import { hexToPixel, pixelToHex, hexCorner, neighborCoords, SQRT3, hexDistance, toCube, fromCube } from './hex.js';
import { tileAt } from './terrain.js';
import { createRng } from './rng.js';
import { makeNoise } from './mapgen.js';
import { lightAt } from './conditions.js';
import { unitStats, UNIT_TYPES, VARIANTS } from './units.js';
import { onMap, retreatCol, deployZone } from './game.js';
import { drawFx, fxShake, stampScars, stampTracks, drawWreck } from './fx.js';

export const HEX = 30;

const ELEV_STOPS = [[187, 199, 150], [219, 213, 163], [209, 182, 127], [166, 133, 90]];
// Neige : relief blanchi, forêts sombres, eau et marais pris par la glace.
const WINTER_STOPS = [[212, 220, 224], [234, 236, 236], [221, 221, 215], [196, 194, 186]];

const C = {
  desk: '#1b1f16',
  paper: '#e5dbbd',
  contour: 'rgba(112, 72, 34, 0.85)',
  contourMinor: 'rgba(112, 72, 34, 0.32)',
  grid: 'rgba(60, 50, 25, ',
  canopy: '#7e9a58',
  canopyShadow: 'rgba(40, 55, 25, 0.45)',
  tree: '#3e5a2b',
  marsh: 'rgba(96, 140, 140, 0.33)',
  reed: '#4f7d88',
  farmA: '#e8d47f',
  farmB: '#cdb95f',
  hedge: 'rgba(70, 90, 40, 0.55)',
  river: '#4a80ab',
  riverBank: 'rgba(70, 100, 110, 0.45)',
  riverHi: '#9cc6e4',
  roadLo: '#6b4426',
  roadHi: '#e7bb68',
  house: '#6b4a32',
  roof: '#9b3b26',
  label: '#2d2414',
  halo: 'rgba(244, 236, 210, 0.85)',
  pencil: '#b3261e',
  DE: { fill: '#9aa6ad', edge: '#2c3439', zone: [70, 90, 110] },
  SU: { fill: '#b45a43', edge: '#3d150c', zone: [150, 50, 30] },
};

// ---------- Outils géométriques ----------

// Chemin lissé (Catmull-Rom converti en Bézier) passant par tous les points.
function splineTo(ctx, pts, move = true) {
  if (!pts.length) return;
  if (move) ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    ctx.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
  }
}

// Point sur la même spline, u ∈ [0, n-1].
export function splineAt(pts, u) {
  const n = pts.length;
  if (n === 1) return pts[0];
  const i = Math.max(0, Math.min(n - 2, Math.floor(u)));
  const t = Math.max(0, Math.min(1, u - i));
  const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
  const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
  const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
  const m = 1 - t;
  return {
    x: m * m * m * p1.x + 3 * m * m * t * c1.x + 3 * m * t * t * c2.x + t * t * t * p2.x,
    y: m * m * m * p1.y + 3 * m * m * t * c1.y + 3 * m * t * t * c2.y + t * t * t * p2.y,
  };
}

function circlePath(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function hexPath(ctx, cx, cy, s) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const p = hexCorner(cx, cy, s, i);
    i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
  }
  ctx.closePath();
}

// Contour fermé irrégulier (parcelles, marais).
function blobPath(ctx, cx, cy, r, rng, points = 9) {
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rr = r * (0.82 + rng.next() * 0.3);
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  ctx.beginPath();
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = mid(pts[points - 1], pts[0]);
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i < points; i++) {
    const m = mid(pts[i], pts[(i + 1) % points]);
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
  }
  ctx.closePath();
}

function paletteFor(map) {
  if (map.weather === 'snow') {
    return {
      stops: WINTER_STOPS,
      C: { ...C, canopy: '#6c7d68', canopyShadow: 'rgba(40, 52, 45, 0.4)', tree: '#33453a', farmA: '#f0f2f0', farmB: '#dfe4e3',
        hedge: 'rgba(80, 90, 80, 0.5)', marsh: 'rgba(205, 225, 236, 0.75)', reed: '#7f8e92', river: '#c4dbe8', riverHi: '#f5fbff',
        riverBank: 'rgba(120, 150, 168, 0.55)', roadHi: '#d8ccb4', roof: '#8a5a4a' },
    };
  }
  // Pluie : sol détrempé, plus sombre et plus vert.
  if (map.weather === 'rain') return { stops: ELEV_STOPS.map((s) => [s[0] * 0.86, s[1] * 0.9, s[2] * 0.84]), C: { ...C, farmA: '#c9b86e', farmB: '#ad9d52', roadHi: '#c9a35d' } };
  return { stops: ELEV_STOPS, C };
}

// ---------- Champs continus ----------

// Échantillonne un champ continu : chaque point mélange les valeurs des hexagones voisins (noyau gaussien).
function sampleField(map, worldW, worldH, step, sigma, valueOf, extra = null) {
  const w = Math.ceil(worldW / step) + 1, h = Math.ceil(worldH / step) + 1;
  const data = new Float32Array(w * h);
  const vals = map.tiles.map(valueOf);
  const centers = map.tiles.map((t) => hexToPixel(t.col, t.row, HEX));
  const k = 1 / (sigma * sigma);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = i * step, y = j * step;
      const hc = pixelToHex(x, y, HEX);
      hc.col = Math.max(0, Math.min(map.W - 1, hc.col));
      hc.row = Math.max(0, Math.min(map.H - 1, hc.row));
      let sw = 0, sv = 0;
      for (const c of [hc, ...neighborCoords(hc.col, hc.row)]) {
        if (c.col < 0 || c.row < 0 || c.col >= map.W || c.row >= map.H) continue;
        const idx = c.row * map.W + c.col;
        const dx = x - centers[idx].x, dy = y - centers[idx].y;
        const wt = Math.exp(-(dx * dx + dy * dy) * k);
        sw += wt;
        sv += wt * vals[idx];
      }
      data[j * w + i] = (sw > 0 ? sv / sw : 0) + (extra ? extra(x, y) : 0);
    }
  }
  return { w, h, step, data };
}

// Courbes de niveau par « marching squares » : segments [x1, y1, x2, y2] en coordonnées monde.
function contourSegments(f, level) {
  const { w, h, step, data } = f;
  const out = [];
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = data[j * w + i], b = data[j * w + i + 1], c = data[(j + 1) * w + i + 1], d = data[(j + 1) * w + i];
      const code = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const T = () => [i + (level - a) / (b - a), j];
      const R = () => [i + 1, j + (level - b) / (c - b)];
      const B = () => [i + (level - d) / (c - d), j + 1];
      const L = () => [i, j + (level - a) / (d - a)];
      const segs = {
        1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[T, R]], 5: [[T, R], [L, B]], 6: [[T, B]], 7: [[L, T]],
        8: [[L, T]], 9: [[T, B]], 10: [[L, T], [B, R]], 11: [[T, R]], 12: [[L, R]], 13: [[B, R]], 14: [[L, B]],
      }[code];
      for (const [p, q] of segs) {
        const P = p(), Q = q();
        out.push(P[0] * step, P[1] * step, Q[0] * step, Q[1] * step);
      }
    }
  }
  return out;
}

function strokeSegments(ctx, segs) {
  ctx.beginPath();
  for (let i = 0; i < segs.length; i += 4) {
    ctx.moveTo(segs[i], segs[i + 1]);
    ctx.lineTo(segs[i + 2], segs[i + 3]);
  }
  ctx.stroke();
}

// Masque doux (brouillard, zones) : canvas basse résolution + contour lissé à mi-hauteur.
function softMask(map, worldW, worldH, keys, rgb, maxAlpha, { invert = false, step = 6 } = {}) {
  const f = sampleField(map, worldW, worldH, step, HEX * 0.55, (t) => (keys.has(t.row * map.W + t.col) !== invert ? 1 : 0));
  const cv = document.createElement('canvas');
  cv.width = f.w;
  cv.height = f.h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(f.w, f.h);
  for (let i = 0; i < f.data.length; i++) {
    const v = f.data[i];
    const s = v <= 0.15 ? 0 : v >= 0.85 ? 1 : ((v - 0.15) / 0.7) ** 2 * (3 - 2 * ((v - 0.15) / 0.7));
    img.data[i * 4] = rgb[0];
    img.data[i * 4 + 1] = rgb[1];
    img.data[i * 4 + 2] = rgb[2];
    img.data[i * 4 + 3] = Math.round(s * maxAlpha * 255);
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: cv, f, outline: contourSegments(f, 0.5) };
}

// ---------- Renderer ----------

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = null;
    this.layer = null;
    this.cam = { x: 0, y: 0, s: 1 };
    this.vw = 1;
    this.vh = 1;
    this.gridAlpha = 0.12;
    this.cache = {};
  }

  setMap(map) {
    this.map = map;
    this.worldW = Math.ceil((map.W + 0.5) * HEX * SQRT3);
    this.worldH = Math.ceil((map.H - 1) * 1.5 * HEX + 2 * HEX);
    this.cache = {};
    this.wrecks = [];
    this.buildTerrain();
    this.buildGrid();
    this.resize();
  }

  // ---------- Caméra ----------

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.vw = Math.max(1, r.width);
    this.vh = Math.max(1, r.height);
    this.canvas.width = Math.round(this.vw * this.dpr);
    this.canvas.height = Math.round(this.vh * this.dpr);
    this.canvas.style.width = `${this.vw}px`;
    this.canvas.style.height = `${this.vh}px`;
    this.clampCam();
  }

  fitScale() { return Math.min(this.vw / this.worldW, this.vh / this.worldH); }

  fitAll() {
    this.cam.s = this.fitScale();
    this.cam.x = (this.worldW - this.vw / this.cam.s) / 2;
    this.cam.y = (this.worldH - this.vh / this.cam.s) / 2;
    this.clampCam();
  }

  // Vue initiale : sur petit écran, on zoome assez pour que les hexagones restent faciles à toucher.
  initialView(side) {
    if (this.vw >= 760) return this.fitAll();
    this.cam.s = Math.max(this.fitScale(), Math.min(1, this.vh / this.worldH), 0.78);
    const ownX = side === 'DE' ? 0 : this.worldW;
    this.cam.x = ownX - this.vw / this.cam.s / 2;
    this.cam.y = (this.worldH - this.vh / this.cam.s) / 2;
    this.clampCam();
  }

  focus(h) {
    const p = this.center(h);
    const sx = (p.x - this.cam.x) * this.cam.s, sy = (p.y - this.cam.y) * this.cam.s;
    const m = 50;
    if (sx > m && sx < this.vw - m && sy > m && sy < this.vh - m) return false;
    this.cam.x = p.x - this.vw / this.cam.s / 2;
    this.cam.y = p.y - this.vh / this.cam.s / 2;
    this.clampCam();
    return true;
  }

  clampCam() {
    if (!this.worldW) return;
    const minS = this.fitScale() * 0.92, maxS = 3;
    this.cam.s = Math.max(minS, Math.min(maxS, this.cam.s));
    const vwW = this.vw / this.cam.s, vhW = this.vh / this.cam.s;
    const pad = 14;
    this.cam.x = vwW >= this.worldW ? (this.worldW - vwW) / 2 : Math.max(-pad, Math.min(this.worldW - vwW + pad, this.cam.x));
    this.cam.y = vhW >= this.worldH ? (this.worldH - vhW) / 2 : Math.max(-pad, Math.min(this.worldH - vhW + pad, this.cam.y));
  }

  pan(dx, dy) {
    this.cam.x -= dx / this.cam.s;
    this.cam.y -= dy / this.cam.s;
    this.clampCam();
  }

  zoomAt(factor, sx, sy) {
    const wx = this.cam.x + sx / this.cam.s, wy = this.cam.y + sy / this.cam.s;
    this.cam.s *= factor;
    this.clampCam();
    this.cam.x = wx - sx / this.cam.s;
    this.cam.y = wy - sy / this.cam.s;
    this.clampCam();
  }

  local(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  hexAt(clientX, clientY) {
    const l = this.local(clientX, clientY);
    const h = pixelToHex(this.cam.x + l.x / this.cam.s, this.cam.y + l.y / this.cam.s, HEX);
    return tileAt(this.map, h.col, h.row) ? h : null;
  }

  center(h) { return hexToPixel(h.col, h.row, HEX); }

  // ---------- Terrain pré-calculé ----------

  buildTerrain() {
    const map = this.map;
    const { C, stops: ELEV_STOPS } = paletteFor(map);
    const { worldW, worldH } = this;
    const rng = createRng(`render:${map.seed}`);
    const detail = makeNoise(rng);

    // Résolution de la couche : assez fine pour zoomer, sans dépasser les limites mémoire d'iOS.
    const scale = Math.min(3, Math.sqrt(9e6 / (worldW * worldH)));
    this.layerScale = scale;
    const off = document.createElement('canvas');
    off.width = Math.ceil(worldW * scale);
    off.height = Math.ceil(worldH * scale);
    const ctx = off.getContext('2d');
    ctx.scale(scale, scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. Relief continu : altitudes lissées + micro-relief, teintes hypsométriques et ombrage nord-ouest.
    const height = sampleField(map, worldW, worldH, 3, HEX * 0.62, (t) => t.elev,
      (x, y) => (detail(x / 70, y / 70, 3) - 0.5) * 0.5);
    this.height = height;
    const hc = document.createElement('canvas');
    hc.width = height.w;
    hc.height = height.h;
    const hctx = hc.getContext('2d');
    const img = hctx.createImageData(height.w, height.h);
    const { w, h, data } = height;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const idx = j * w + i;
        const v = Math.max(0, Math.min(2.999, data[idx]));
        const k = Math.floor(v), f = v - k;
        const a = ELEV_STOPS[k], b = ELEV_STOPS[k + 1];
        const gx = data[j * w + Math.min(w - 1, i + 1)] - data[j * w + Math.max(0, i - 1)];
        const gy = data[Math.min(h - 1, j + 1) * w + i] - data[Math.max(0, j - 1) * w + i];
        const shade = 1 + Math.max(-0.22, Math.min(0.22, (gx + gy) * 1.4));
        for (let c = 0; c < 3; c++) img.data[idx * 4 + c] = Math.min(255, (a[c] + (b[c] - a[c]) * f) * shade);
        img.data[idx * 4 + 3] = 255;
      }
    }
    hctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(hc, 0, 0, w * 3, h * 3);

    // 2. Marais : nappes irrégulières et roseaux.
    for (const t of map.tiles) {
      if (t.terrain !== 'marsh') continue;
      const p = this.center(t);
      const r = createRng(t.row * 1000 + t.col + 3);
      ctx.fillStyle = C.marsh;
      for (let n = 0; n < 3; n++) {
        blobPath(ctx, p.x + (r.next() - 0.5) * 18, p.y + (r.next() - 0.5) * 14, HEX * (0.45 + r.next() * 0.25), r);
        ctx.fill();
      }
      ctx.strokeStyle = C.reed;
      ctx.lineWidth = 1;
      for (let n = 0; n < 8; n++) {
        const mx = p.x + (r.next() - 0.5) * HEX * 1.3, my = p.y + (r.next() - 0.5) * HEX * 1.2;
        ctx.beginPath();
        ctx.moveTo(mx - 4, my); ctx.lineTo(mx + 4, my);
        ctx.moveTo(mx - 1.5, my); ctx.lineTo(mx - 3, my - 5);
        ctx.moveTo(mx + 1, my); ctx.lineTo(mx + 2, my - 6);
        ctx.stroke();
      }
    }

    // 3. Champs : parcelles irrégulières rayées, orientées au hasard, bordées de haies.
    for (const t of map.tiles) {
      if (t.terrain !== 'farm') continue;
      const p = this.center(t);
      const r = createRng(t.row * 1000 + t.col + 11);
      for (let n = 0; n < 2; n++) {
        const cx = p.x + (r.next() - 0.5) * 16, cy = p.y + (r.next() - 0.5) * 12;
        ctx.save();
        blobPath(ctx, cx, cy, HEX * (0.5 + r.next() * 0.2), r, 7);
        ctx.clip();
        ctx.translate(cx, cy);
        ctx.rotate(r.next() * Math.PI);
        for (let s = -6; s < 6; s++) {
          ctx.fillStyle = s % 2 ? C.farmA : C.farmB;
          ctx.globalAlpha = 0.8;
          ctx.fillRect(-HEX * 1.2, s * 5, HEX * 2.4, 5);
        }
        ctx.restore();
        ctx.strokeStyle = C.hedge;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // 4. Forêts : union de couronnes qui déborde légèrement et relie les hexagones boisés voisins.
    const forest = map.tiles.filter((t) => t.terrain === 'forest');
    const canopy = new Path2D();
    const crowns = [];
    for (const t of forest) {
      const p = this.center(t);
      const r = createRng(t.row * 1000 + t.col + 7);
      for (let n = 0; n < 7; n++) {
        const a = r.next() * Math.PI * 2, d = Math.sqrt(r.next()) * HEX * 0.42;
        const cr = 10 + r.next() * 6;
        canopy.moveTo(p.x + Math.cos(a) * d + cr, p.y + Math.sin(a) * d);
        canopy.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, cr, 0, Math.PI * 2);
      }
      for (const n of neighborCoords(t.col, t.row)) {
        if (tileAt(map, n.col, n.row)?.terrain !== 'forest') continue;
        const q = this.center(n);
        canopy.moveTo((p.x + q.x) / 2 + 15, (p.y + q.y) / 2);
        canopy.arc((p.x + q.x) / 2, (p.y + q.y) / 2, 15, 0, Math.PI * 2);
      }
      for (let n = 0; n < 16; n++) {
        const a = r.next() * Math.PI * 2, d = Math.sqrt(r.next()) * HEX * 0.72;
        crowns.push({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 2 + r.next() * 2.2 });
      }
    }
    ctx.save();
    ctx.translate(1.5, 2.5);
    ctx.fillStyle = C.canopyShadow;
    ctx.fill(canopy);
    ctx.restore();
    ctx.fillStyle = C.canopy;
    ctx.fill(canopy);
    for (const c of crowns) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fillStyle = C.tree;
      ctx.globalAlpha = 0.75;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (map.weather === 'snow') {
        ctx.beginPath();
        ctx.arc(c.x - c.r * 0.3, c.y - c.r * 0.35, c.r * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(246, 248, 250, 0.85)';
        ctx.fill();
      }
    }

    // 5. Courbes de niveau continues : maîtresses aux seuils de la grille, intermédiaires tous les quarts.
    ctx.strokeStyle = C.contourMinor;
    ctx.lineWidth = 0.7;
    for (const lv of [0.25, 0.75, 1, 1.25, 1.75, 2, 2.25, 2.75, 3]) strokeSegments(ctx, contourSegments(height, lv));
    ctx.strokeStyle = C.contour;
    ctx.lineWidth = 1.3;
    for (const lv of [0.5, 1.5, 2.5]) strokeSegments(ctx, contourSegments(height, lv));

    // 6. Rivières et ruisseaux : méandres le long du tracé de la grille ; seules les extrémités au bord sortent de la carte.
    for (const { path, stream } of map.rivers) {
      const pts = path.map((hx, i) => {
        const c = this.center(hx);
        if (i === 0 || i === path.length - 1) return c;
        const prev = this.center(path[i - 1]), next = this.center(path[i + 1]);
        const dx = next.x - prev.x, dy = next.y - prev.y, len = Math.hypot(dx, dy) || 1;
        const off = (rng.next() - 0.5) * HEX * 0.5;
        return { x: c.x - (dy / len) * off, y: c.y + (dx / len) * off };
      });
      const atEdge = (h) => h.row === 0 || h.row === map.H - 1;
      const first = pts[0], last = pts[pts.length - 1];
      if (atEdge(path[0])) pts.unshift({ x: first.x, y: first.y < worldH / 2 ? -10 : worldH + 10 });
      if (atEdge(path[path.length - 1])) pts.push({ x: last.x, y: last.y < worldH / 2 ? -10 : worldH + 10 });
      const widths = stream ? [[8, C.riverBank], [4.2, C.river], [1.3, C.riverHi]] : [[13, C.riverBank], [7.5, C.river], [2.2, C.riverHi]];
      for (const [lw, col] of widths) {
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.beginPath();
        splineTo(ctx, pts);
        ctx.stroke();
      }
      if (map.weather === 'snow') {
        ctx.strokeStyle = 'rgba(110, 140, 160, 0.55)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([3, 7]);
        ctx.beginPath();
        splineTo(ctx, pts);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Source du ruisseau : petite mare.
      if (stream && !atEdge(path[path.length - 1])) {
        ctx.fillStyle = C.riverBank;
        blobPath(ctx, last.x, last.y, 9, rng, 7);
        ctx.fill();
        ctx.fillStyle = C.river;
        blobPath(ctx, last.x, last.y, 6, rng, 7);
        ctx.fill();
      }
    }
    // Gués : haut-fond sableux en travers du courant.
    for (const t of map.tiles) {
      if (!t.ford) continue;
      const { x, y } = this.center(t);
      ctx.fillStyle = 'rgba(226, 204, 150, 0.9)';
      blobPath(ctx, x, y, 8, rng, 8);
      ctx.fill();
      ctx.fillStyle = 'rgba(120, 100, 70, 0.7)';
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(x + i * 3.5, y + (i % 2) * 2, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 7. Routes : courbes douces suivant les chemins de la grille.
    for (const [lw, col] of [[5.2, C.roadLo], [2.6, C.roadHi]]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      for (const path of map.roads) {
        ctx.beginPath();
        splineTo(ctx, path.map((hx) => this.center(hx)));
        ctx.stroke();
      }
    }
    for (const t of map.tiles) {
      if (!(t.river && t.road)) continue;
      const { x, y } = this.center(t);
      ctx.fillStyle = '#3a2a1c';
      ctx.fillRect(x - 8, y - 5, 16, 10);
      ctx.fillStyle = C.roadHi;
      ctx.fillRect(x - 7, y - 2, 14, 4);
    }

    // 8. Villages : maisons groupées et église. Bourg : îlots serrés alignés sur un même quadrillage de rues.
    const townAngle = createRng(`town:${map.seed}`).next() * 0.6 - 0.3;
    for (const t of map.villages) {
      const { x, y } = this.center(t);
      const r = createRng(t.col * 31 + t.row * 977);
      if (t.town) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(townAngle);
        for (let gx = -2; gx <= 1; gx++) {
          for (let gy = -2; gy <= 1; gy++) {
            if (t.name && (gx === -1 || gx === 0) && (gy === -1 || gy === 0)) continue; // place centrale
            if (r.next() < 0.12) continue;
            const bx = gx * 12 + 1, by = gy * 11 + 1;
            ctx.fillStyle = C.house;
            ctx.fillRect(bx, by, 10, 9);
            ctx.fillStyle = C.roof;
            ctx.fillRect(bx, by, 10, 3.5 + r.next() * 2);
          }
        }
        ctx.restore();
        if (!t.name) continue;
      } else {
        for (let i = 0; i < 9; i++) {
        const a = r.next() * Math.PI * 2, d = 5 + r.next() * HEX * 0.55;
        ctx.save();
        ctx.translate(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8);
        ctx.rotate(a + (r.next() - 0.5) * 0.5);
        ctx.fillStyle = C.house;
        ctx.fillRect(-4.5, -3.5, 9, 7);
        ctx.fillStyle = C.roof;
        ctx.fillRect(-4.5, -3.5, 9, 3);
        ctx.restore();
        }
      }
      ctx.fillStyle = C.house;
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x - 0.8, y - 9, 1.6, 6);
      ctx.fillRect(x - 3, y - 7.5, 6, 1.4);
    }

    // 9. Points cotés sur les sommets.
    ctx.font = '600 9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    const peaks = [];
    for (const t of map.tiles) {
      if (t.elev < 3 || t.terrain === 'village') continue;
      if (peaks.some((p) => hexDistance(p, t) < 4)) continue;
      peaks.push(t);
      const { x, y } = this.center(t);
      const v = data[Math.round(y / 3) * w + Math.round(x / 3)];
      const label = String(140 + Math.round(v * 38) + Math.floor(rng.next() * 9));
      ctx.fillStyle = C.label;
      ctx.beginPath();
      ctx.moveTo(x, y - 4); ctx.lineTo(x + 4, y + 3); ctx.lineTo(x - 4, y + 3);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.halo;
      ctx.strokeText(label, x + 6, y + 4);
      ctx.fillText(label, x + 6, y + 4);
    }

    // 10. Noms des villages.
    ctx.font = '600 11px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    for (const t of map.villages) {
      if (!t.name) continue;
      const { x, y } = this.center(t);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = C.halo;
      ctx.strokeText(t.name, x, y + HEX * 0.98);
      ctx.fillStyle = C.label;
      ctx.fillText(t.name, x, y + HEX * 0.98);
    }
    this.layer = off;
  }

  buildGrid() {
    const g = new Path2D();
    for (const t of this.map.tiles) {
      const { x, y } = this.center(t);
      for (let i = 0; i < 6; i++) {
        const p = hexCorner(x, y, HEX, i);
        i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y);
      }
      g.closePath();
    }
    this.gridPath = g;
  }

  // ---------- Traces de combat (peintes sur la couche de terrain, elles restent jusqu'à la fin de la bataille) ----------

  layerCtx() {
    const ctx = this.layer.getContext('2d');
    ctx.setTransform(this.layerScale, 0, 0, this.layerScale, 0, 0);
    return ctx;
  }

  stampScars(fx, seed) { stampScars(this.layerCtx(), fx, seed); }

  stampTracks(pts) { stampTracks(this.layerCtx(), pts); }

  addWreck(w) { this.wrecks.push(w); }

  // Vrai tant qu'une épave fume ou qu'une forêt brûle encore : la carte s'anime alors doucement.
  hasSmoke(turn) {
    return this.wrecks.some((w) => turn - w.turn <= 1) || this.map.tiles.some((t) => t.fire > 0 || (t.burnt && turn - t.burntTurn <= 1));
  }

  // Changements de terrain du tour, peints une fois pour toutes sur la couche : décombres, cendres.
  applyTerrain(changes = []) {
    const ctx = this.layerCtx();
    for (const ch of changes) {
      const { x, y } = this.center(ch);
      const r = createRng(`terrain:${ch.col}:${ch.row}:${ch.kind}`);
      if (ch.kind === 'ruins') {
        ctx.fillStyle = 'rgba(128, 116, 98, 0.92)';
        blobPath(ctx, x, y, HEX * 0.74, r, 9);
        ctx.fill();
        for (let i = 0; i < 22; i++) {
          const a = r.next() * Math.PI * 2, d = Math.sqrt(r.next()) * HEX * 0.62;
          ctx.save();
          ctx.translate(x + Math.cos(a) * d, y + Math.sin(a) * d);
          ctx.rotate(r.next() * Math.PI);
          ctx.fillStyle = i % 3 ? 'rgba(84, 70, 56, 0.9)' : 'rgba(120, 60, 44, 0.85)';
          ctx.fillRect(-2.5, -1.5, 3 + r.next() * 4, 2 + r.next() * 2);
          ctx.restore();
        }
        // Pans de murs encore debout, noircis.
        ctx.strokeStyle = 'rgba(40, 32, 26, 0.9)';
        ctx.lineWidth = 1.6;
        for (let i = 0; i < 4; i++) {
          const a = r.next() * Math.PI * 2, d = r.next() * HEX * 0.45;
          const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d, ang = r.next() * Math.PI;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + Math.cos(ang) * 7, py + Math.sin(ang) * 7);
          ctx.lineTo(px + Math.cos(ang) * 7 + Math.cos(ang + 1.57) * 4, py + Math.sin(ang) * 7 + Math.sin(ang + 1.57) * 4);
          ctx.stroke();
        }
      } else if (ch.kind === 'burnt') {
        ctx.fillStyle = 'rgba(46, 42, 36, 0.85)';
        blobPath(ctx, x, y, HEX * 0.82, r, 10);
        ctx.fill();
        for (let i = 0; i < 22; i++) {
          const a = r.next() * Math.PI * 2, d = Math.sqrt(r.next()) * HEX * 0.7;
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.8 + r.next() * 1.6, 0, Math.PI * 2);
          ctx.fillStyle = i % 2 ? 'rgba(150, 146, 136, 0.7)' : 'rgba(20, 16, 12, 0.9)'; // cendres et souches
          ctx.fill();
        }
      }
    }
  }

  // Flammes et fumée des forêts en feu (animées).
  drawFires(now) {
    const { ctx } = this;
    for (const t of this.map.tiles) {
      if (!(t.fire > 0)) continue;
      const { x, y } = this.center(t);
      const r = createRng(`fire:${t.col}:${t.row}`);
      const glow = ctx.createRadialGradient(x, y, 2, x, y, HEX * 1.1);
      glow.addColorStop(0, 'rgba(255, 150, 50, 0.45)');
      glow.addColorStop(1, 'rgba(255, 120, 40, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - HEX * 1.1, y - HEX * 1.1, HEX * 2.2, HEX * 2.2);
      for (let i = 0; i < 9; i++) {
        const a = r.next() * Math.PI * 2, d = Math.sqrt(r.next()) * HEX * 0.6, ph = r.next() * 10;
        const fx = x + Math.cos(a) * d, fy = y + Math.sin(a) * d;
        const h = Math.max(2.5, 7 + 3.5 * Math.sin(now * 9 + ph) + 2.5 * Math.sin(now * 23 + ph * 2));
        ctx.fillStyle = 'rgba(255, 120, 30, 0.85)';
        ctx.beginPath();
        ctx.moveTo(fx - 3.5, fy);
        ctx.quadraticCurveTo(fx - 2, fy - h * 0.6, fx, fy - h);
        ctx.quadraticCurveTo(fx + 2, fy - h * 0.6, fx + 3.5, fy);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 224, 120, 0.9)';
        ctx.beginPath();
        ctx.ellipse(fx, fy - 1.5, 1.6, h * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Colonne de fumée qui monte et dérive.
      for (let i = 0; i < 6; i++) {
        const k = ((now * 0.25 + i / 6) % 1);
        ctx.beginPath();
        ctx.arc(x + k * 14 + Math.sin(now + i) * 3, y - 6 - k * 34, 5 + k * 11, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(70, 66, 60, ${0.35 * (1 - k)})`;
        ctx.fill();
      }
    }
  }

  mask(name, keys, rgb, alpha, opts) {
    const c = this.cache[name];
    if (c && c.keys === keys) return c.m;
    const id = [...keys].sort((a, b) => a - b).join(',') + (opts?.invert ? '!' : '');
    if (c && c.id === id) { c.keys = keys; return c.m; }
    const m = softMask(this.map, this.worldW, this.worldH, keys, rgb, alpha, opts);
    this.cache[name] = { id, m, keys };
    return m;
  }

  drawMask(m, outline, lineWidth, dash = null) {
    const { ctx } = this;
    ctx.drawImage(m.canvas, 0, 0, m.f.w * m.f.step, m.f.h * m.f.step);
    if (!outline) return;
    ctx.strokeStyle = outline;
    ctx.lineWidth = lineWidth / this.cam.s;
    if (dash) ctx.setLineDash(dash.map((d) => d / this.cam.s));
    strokeSegments(ctx, m.outline);
    ctx.setLineDash([]);
  }

  // ---------- Image ----------

  draw(view) {
    const { ctx, map, cam } = this;
    const { state, side } = view;
    const d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = C.desk;
    ctx.fillRect(0, 0, this.vw, this.vh);
    const shake = view.fx && view.shake ? fxShake(view.fx.fx, view.fx.T) : { x: 0, y: 0 };
    ctx.setTransform(d * cam.s, 0, 0, d * cam.s, (-cam.x * cam.s + shake.x) * d, (-cam.y * cam.s + shake.y) * d);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(4, 6, this.worldW, this.worldH);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.layer, 0, 0, this.worldW, this.worldH);

    if (this.gridAlpha > 0) {
      ctx.strokeStyle = C.grid + this.gridAlpha + ')';
      ctx.lineWidth = 1 / cam.s;
      ctx.stroke(this.gridPath);
    }

    const vis = state.visibility[side];
    const reveal = state.phase === 'over';
    const colW = HEX * SQRT3;

    // Zones de repli : dégradés le long des bords.
    for (const s of ['DE', 'SU']) {
      const west = retreatCol(state, s) === 0;
      const g = ctx.createLinearGradient(west ? 0 : this.worldW, 0, west ? colW * 1.3 : this.worldW - colW * 1.3, 0);
      const [r, gg, b] = C[s].zone;
      g.addColorStop(0, `rgba(${r},${gg},${b},0.32)`);
      g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(west ? 0 : this.worldW - colW * 1.3, 0, colW * 1.3, this.worldH);
    }

    if (state.phase === 'deploy') {
      const keys = new Set(map.tiles.filter((t) => deployZone(state, side).includes(t.col)).map((t) => t.row * map.W + t.col));
      this.drawMask(this.mask('deploy', keys, [179, 38, 30], 0.12), 'rgba(179, 38, 30, 0.8)', 2, [6, 5]);
    }

    if (!reveal) this.drawMask(this.mask('fog', vis.hexes, [34, 37, 24], 0.42, { invert: true }), null);
    this.drawAtmosphere(state);

    if (state.objective) {
      const { x, y } = this.center(state.objective);
      const owner = state.objective.owner;
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.86, 0, Math.PI * 2);
      ctx.strokeStyle = owner ? C[owner].edge : C.pencil;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      this.star(x, y - HEX * 0.7, 8, owner ? C[owner].fill : '#f2d34f');
    }

    if (view.reach) {
      const keys = view.reachKeys ?? new Set(view.reach.keys());
      this.drawMask(this.mask('reach', keys, [255, 246, 214], 0.36), 'rgba(250, 240, 200, 0.95)', 2);
    }
    if (view.rangeOf) {
      const u = view.rangeOf;
      const s = unitStats(u);
      const keys = new Set(map.tiles.filter((t) => { const dd = hexDistance(u, t); return dd >= s.minRange && dd <= s.range; }).map((t) => t.row * map.W + t.col));
      this.drawMask(this.mask('range', keys, [179, 38, 30], 0.16), 'rgba(179, 38, 30, 0.85)', 1.5, [4, 4]);
    }
    if (view.hover) {
      const { x, y } = this.center(view.hover);
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.78, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(40, 30, 10, 0.6)';
      ctx.lineWidth = 1.5 / cam.s;
      ctx.stroke();
    }

    if (view.directives && !view.anim) this.drawDirectives(state, side, view.directives, view.assignment);

    if (!view.anim) {
      for (const u of state.units) {
        if (u.side !== side || !onMap(u)) continue;
        this.drawOrders(u, u.id === view.selectedId);
      }
    }
    if (view.preview) this.drawPreview(view.preview);

    if (!reveal) {
      for (const [id, m] of Object.entries(state.memory[side])) {
        if (vis.units.has(id) || (view.animVisible && view.animVisible.has(id))) continue;
        this.drawGhost(m, state.turn - m.turn);
      }
    }

    const now = (view.time ?? performance.now()) / 1000;
    for (const w of this.wrecks) drawWreck(ctx, w, now, state.turn - w.turn);
    this.drawFires(now);

    // Traînées des unités en mouvement.
    if (view.anim?.trails) {
      for (const [id, tr] of Object.entries(view.anim.trails)) {
        if (tr.length < 2) continue;
        const u = state.units.find((x) => x.id === id);
        if (u.side !== side && !reveal && !view.animVisible.has(id)) continue;
        ctx.strokeStyle = u.type === 'tank' ? 'rgba(90, 70, 40, 0.35)' : 'rgba(60, 50, 30, 0.25)';
        ctx.lineWidth = u.type === 'tank' ? 5 : 3;
        ctx.beginPath();
        tr.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      }
    }

    for (const u of state.units) {
      const snap = view.anim?.pos[u.id];
      if (view.anim ? !snap : !onMap(u)) continue;
      if (u.side !== side && !reveal) {
        const seen = view.anim ? view.animVisible.has(u.id) : vis.units.has(u.id);
        if (!seen) continue;
      }
      const p = snap ? { x: snap.x, y: snap.y } : this.center(u);
      this.drawCounter(u, p.x, p.y, { selected: u.id === view.selectedId, status: snap ? snap.status : u.status, hp: view.anim?.hp?.[u.id] ?? u.hp, heading: snap?.heading ?? 0, pinned: !view.anim && u.pinned, ammo: u.side === side && u.ammo != null ? u.ammo : null });
    }

    if (view.fx) drawFx(ctx, view.fx.fx, view.fx.T);
  }

  // ---------- Directives (mode commandement) ----------

  drawDirectives(state, side, directives, assignment) {
    const { ctx } = this;
    const INK = { attack: C.pencil, defend: '#21456a', retreat: '#7a5618' };
    const LABEL = { attack: 'ATTAQUE', defend: 'DÉFENSE', retreat: 'REPLI' };
    const toFoe = side === 'DE' ? 1 : -1;
    ctx.save();
    // Liens discrets entre chaque unité et la directive qui la commande.
    if (assignment) {
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 1.2;
      for (const u of state.units) {
        if (u.side !== side || !onMap(u) || !assignment.has(u.id)) continue;
        const dv = directives[assignment.get(u.id)];
        if (!dv) continue;
        const a = this.center(u), b = this.center(dv);
        ctx.strokeStyle = INK[dv.kind];
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    directives.forEach((dv, i) => {
      const { x, y } = this.center(dv);
      const ink = INK[dv.kind];
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      if (dv.kind === 'attack') {
        // Axe d'effort : large flèche venant de nos lignes (ou du groupe qui attaque).
        const grp = state.units.filter((u) => u.side === side && onMap(u) && assignment?.get(u.id) === i).map((u) => this.center(u));
        let ang = toFoe > 0 ? 0 : Math.PI;
        if (grp.length) {
          const cx = grp.reduce((s, p) => s + p.x, 0) / grp.length, cy = grp.reduce((s, p) => s + p.y, 0) / grp.length;
          if (Math.hypot(x - cx, y - cy) > HEX) ang = Math.atan2(y - cy, x - cx);
        }
        const L = HEX * 2.2, wdt = HEX * 0.34, head = HEX * 0.62;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(-L, -wdt);
        ctx.quadraticCurveTo(-L * 0.5, -wdt * 1.2, -head, -wdt);
        ctx.lineTo(-head, -wdt - HEX * 0.3);
        ctx.lineTo(0, 0);
        ctx.lineTo(-head, wdt + HEX * 0.3);
        ctx.lineTo(-head, wdt);
        ctx.quadraticCurveTo(-L * 0.5, wdt * 1.2, -L, wdt);
        ctx.closePath();
        ctx.globalAlpha = 0.28;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.restore();
      } else if (dv.kind === 'defend') {
        // Position défensive : arc dentelé tourné vers l'ennemi.
        const r = HEX * 0.95;
        const a0 = (toFoe > 0 ? 0 : Math.PI) - Math.PI * 0.55, a1 = a0 + Math.PI * 1.1;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, r, a0, a1);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let k = 0; k <= 6; k++) {
          const a = a0 + ((a1 - a0) * k) / 6;
          ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
          ctx.lineTo(x + Math.cos(a) * (r + 7), y + Math.sin(a) * (r + 7));
        }
        ctx.stroke();
        ctx.globalAlpha = 0.18;
        circlePath(ctx, x, y, r);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        // Repli : double chevron vers nos lignes, point de ralliement cerclé.
        const back = -toFoe;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 3]);
        circlePath(ctx, x, y, HEX * 0.7);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (const o of [-6, 6]) {
          ctx.moveTo(x - back * 6 + o * back, y - 9);
          ctx.lineTo(x + back * 6 + o * back, y);
          ctx.lineTo(x - back * 6 + o * back, y + 9);
        }
        ctx.stroke();
      }
      ctx.font = '700 10px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.halo;
      const ly = y - HEX * 1.15;
      ctx.strokeText(LABEL[dv.kind], x, ly);
      ctx.fillText(LABEL[dv.kind], x, ly);
    });
    ctx.restore();
  }

  // Lumière de l'heure (aube rosée, crépuscule orangé, nuit bleue) et voile du brouillard, sous les pions.
  drawAtmosphere(state) {
    const c = state.conditions;
    if (!c) return;
    const { ctx } = this;
    const tint = { dawn: 'rgba(255, 176, 140, 0.16)', dusk: 'rgba(255, 128, 60, 0.2)', night: 'rgba(14, 22, 58, 0.5)' }[lightAt(c, state.turn)];
    if (c.weather === 'fog') {
      ctx.fillStyle = 'rgba(232, 234, 228, 0.24)';
      ctx.fillRect(0, 0, this.worldW, this.worldH);
    }
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, this.worldW, this.worldH);
    }
  }

  star(x, y, r, fill) {
    const { ctx } = this;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = '#2d2414';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  arrowHead(b, ang, size) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(b.x + Math.cos(ang) * 4, b.y + Math.sin(ang) * 4);
    ctx.lineTo(b.x + Math.cos(ang + 2.6) * size, b.y + Math.sin(ang + 2.6) * size);
    ctx.lineTo(b.x + Math.cos(ang - 2.6) * size, b.y + Math.sin(ang - 2.6) * size);
    ctx.fill();
  }

  drawPathCurve(from, path, { color, width, dash }) {
    const { ctx } = this;
    const pts = [this.center(from), ...path.map((h) => this.center(h))];
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    splineTo(ctx, pts);
    ctx.stroke();
    ctx.setLineDash([]);
    const n = pts.length - 1;
    const a = splineAt(pts, Math.max(0, n - 0.15)), b = pts[n];
    this.arrowHead(b, Math.atan2(b.y - a.y, b.x - a.x), 12);
  }

  drawPreview({ unit, path }) {
    if (!path?.length) return;
    this.ctx.save();
    this.ctx.globalAlpha = 0.55;
    this.drawPathCurve(unit, path, { color: C.pencil, width: 2, dash: [3, 5] });
    this.ctx.restore();
  }

  drawOrders(u, selected) {
    const { ctx } = this;
    const o = u.orders;
    ctx.save();
    ctx.globalAlpha = selected ? 1 : 0.78;
    if (o.path.length) this.drawPathCurve(u, o.path, { color: C.pencil, width: selected ? 3 : 2.2, dash: [8, 5] });
    if (o.fireAt) {
      const a = this.center(u), b = this.center(o.fireAt);
      ctx.strokeStyle = C.pencil;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo((a.x + b.x) / 2, Math.min(a.y, b.y) - 40, b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 2.5;
      // Katioucha : la salve couvre aussi les cases est et ouest.
      const cells = unitStats(u).salvo ? [-1, 0, 1].map((dc) => this.center({ col: o.fireAt.col + dc, row: o.fireAt.row })) : [b];
      ctx.beginPath();
      for (const c of cells) {
        ctx.moveTo(c.x + HEX * 0.55, c.y);
        ctx.arc(c.x, c.y, HEX * 0.55, 0, Math.PI * 2);
      }
      ctx.moveTo(b.x - HEX * 0.8, b.y);
      ctx.lineTo(b.x + HEX * 0.8, b.y);
      ctx.moveTo(b.x, b.y - HEX * 0.8);
      ctx.lineTo(b.x, b.y + HEX * 0.8);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawGhost(m, age) {
    const { ctx } = this;
    const { x, y } = this.center(m);
    const w = HEX * 1.3, h = HEX * 0.95;
    ctx.save();
    ctx.globalAlpha = Math.max(0.35, 0.8 - age * 0.12);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = C.pencil;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    ctx.setLineDash([]);
    this.symbol(m.type, x, y - 2, w * 0.62, h * 0.52, C.pencil);
    ctx.fillStyle = C.pencil;
    ctx.font = '700 9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(age === 0 ? 'vu' : `T-${age}`, x, y + h / 2 - 2);
    if (m.vec && age <= 1) {
      const c = toCube(m.col, m.row);
      const t = fromCube(c[0] + m.vec[0], c[1] + m.vec[1], c[2] + m.vec[2]);
      const b = this.center(t);
      const ang = Math.atan2(b.y - y, b.x - x);
      const len = Math.min(Math.hypot(b.x - x, b.y - y), HEX * 2.4);
      const sx = x + Math.cos(ang) * w * 0.5, sy = y + Math.sin(ang) * h * 0.5;
      const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo((sx + ex) / 2 - Math.sin(ang) * 8, (sy + ey) / 2 + Math.cos(ang) * 8, ex, ey);
      ctx.stroke();
      this.arrowHead({ x: ex, y: ey }, ang, 9);
    }
    ctx.restore();
  }

  // Symbologie OTAN simplifiée dans un cadre.
  symbol(type, cx, cy, w, h, color) {
    const { ctx } = this;
    const l = cx - w / 2, t = cy - h / 2;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(l, t, w, h);
    ctx.beginPath();
    if (type === 'infantry') {
      ctx.moveTo(l, t); ctx.lineTo(l + w, t + h);
      ctx.moveTo(l + w, t); ctx.lineTo(l, t + h);
      ctx.stroke();
    } else if (type === 'recon') {
      ctx.moveTo(l, t + h); ctx.lineTo(l + w, t);
      ctx.stroke();
    } else if (type === 'tank') {
      const rx = w * 0.32, ry = h * 0.28;
      ctx.moveTo(cx - rx + ry, cy - ry);
      ctx.lineTo(cx + rx - ry, cy - ry);
      ctx.arc(cx + rx - ry, cy, ry, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(cx - rx + ry, cy + ry);
      ctx.arc(cx - rx + ry, cy, ry, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.stroke();
    } else if (type === 'artillery') {
      ctx.arc(cx, cy, Math.min(w, h) * 0.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'at') {
      // Symbole OTAN de l'antichar : chevron renversé d'un coin inférieur à l'autre.
      ctx.moveTo(l, t + h); ctx.lineTo(cx, t); ctx.lineTo(l + w, t + h);
      ctx.stroke();
    }
  }

  drawCounter(u, x, y, { selected, status, hp, heading, pinned, ammo = null }) {
    const { ctx } = this;
    const s = unitStats(u);
    const w = HEX * 1.3, h = HEX * 0.95;
    const col = C[u.side];
    ctx.save();
    // Légère inclinaison dans le sens de la marche : le pion « roule » au lieu de sauter.
    const tilt = status === 'routed' ? -0.25 : Math.max(-0.12, Math.min(0.12, heading * 0.12));
    if (tilt) {
      ctx.translate(x, y);
      ctx.rotate(tilt);
      ctx.translate(-x, -y);
    }
    if (status === 'routed') ctx.globalAlpha = 0.8;
    if (u.entrench > 0 && status === 'ok') {
      ctx.strokeStyle = '#5e4424';
      ctx.lineWidth = 3;
      for (let i = 0; i < u.entrench; i++) {
        ctx.beginPath();
        ctx.arc(x, y + 2, w * 0.62 + i * 4, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      }
    }
    if (selected) {
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.98, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 230, 128, 0.28)';
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(30,20,10,0.35)';
    ctx.fillRect(x - w / 2 + 2, y - h / 2 + 3, w, h);
    ctx.fillStyle = col.fill;
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    // Matériel d'élite : liseré doré et nom du matériel sous le pion.
    const variant = unitStats(u).variant;
    ctx.strokeStyle = selected ? '#fff2a8' : variant ? '#d9b44a' : col.edge;
    ctx.lineWidth = selected || variant ? 2.5 : 1.5;
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    if (variant && status !== 'destroyed') {
      ctx.font = '700 7.5px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      const label = VARIANTS[variant].short;
      const tw = ctx.measureText(label).width + 6;
      ctx.fillStyle = 'rgba(29, 26, 18, 0.88)';
      ctx.fillRect(x - tw / 2, y + h / 2 + 1, tw, 9);
      ctx.fillStyle = '#e8c766';
      ctx.fillText(label, x, y + h / 2 + 8);
    }
    ctx.fillStyle = '#f3ecd6';
    ctx.fillRect(x - w * 0.3, y - h * 0.36, w * 0.6, h * 0.5);
    this.symbol(u.type, x, y - h * 0.11, w * 0.6, h * 0.5, '#1d1a12');
    ctx.strokeStyle = '#1d1a12';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < u.level - 1; i++) {
      const cx = x + w / 2 - 6, cy = y - h / 2 + 4 + i * 4;
      ctx.beginPath();
      ctx.moveTo(cx - 3.5, cy + 2.5);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + 3.5, cy + 2.5);
      ctx.stroke();
    }
    const ratio = Math.max(0, hp / s.maxHp);
    ctx.fillStyle = 'rgba(20,15,5,0.55)';
    ctx.fillRect(x - w * 0.42, y + h * 0.24, w * 0.84, 4);
    ctx.fillStyle = ratio > 0.6 ? '#7fbf4d' : ratio > 0.3 ? '#e2b33c' : '#d4462f';
    ctx.fillRect(x - w * 0.42, y + h * 0.24, w * 0.84 * ratio, 4);
    // Clouée (masqué pendant l'animation, l'état affiché étant déjà celui de fin de tour).
    if (pinned && status === 'ok') {
      const px = x - w / 2 + 1, py = y - h / 2 + 1, r = 7.5;
      ctx.beginPath();
      ctx.moveTo(px, py - r);
      ctx.lineTo(px + r, py);
      ctx.lineTo(px, py + r);
      ctx.lineTo(px - r, py);
      ctx.closePath();
      ctx.fillStyle = '#f2c230';
      ctx.fill();
      ctx.strokeStyle = '#1d1a12';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px - r * 0.45, py);
      ctx.lineTo(px + r * 0.45, py);
      ctx.stroke();
    }
    // Obus restants (batteries du joueur) : pastilles au-dessus du pion, pleines pour les obus disponibles.
    if (ammo != null && status !== 'destroyed') {
      const n = UNIT_TYPES[u.type].ammo, pw = 4, gap = 2;
      const x0 = x - (n * pw + (n - 1) * gap) / 2, py = y - h / 2 - 7;
      ctx.lineWidth = 1;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = i < ammo ? '#e2b33c' : 'rgba(243, 236, 214, 0.55)';
        ctx.fillRect(x0 + i * (pw + gap), py, pw, 5);
        ctx.strokeStyle = '#1d1a12';
        ctx.strokeRect(x0 + i * (pw + gap), py, pw, 5);
      }
    }
    if (status === 'routed') {
      ctx.fillStyle = '#fbf6e6';
      ctx.fillRect(x + w / 2 - 2, y - h / 2 - 9, 9, 6);
      ctx.strokeStyle = '#1d1a12';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + w / 2 - 2, y - h / 2 - 9);
      ctx.lineTo(x + w / 2 - 2, y - h / 2 + 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
