// Rendu du front stratégique. La micro-grille reste la vérité du jeu ; le rendu en tire des champs continus :
// - terrain (une fois par bataille) : relief lissé, teintes et ombrage, courbes de niveau, forêts, marais,
//   montagnes hachurées, villes ;
// - masses de troupes (à chaque tick, interpolées entre deux ticks) : chaque camp est une masse colorée, plus
//   opaque où il est dense ; des contours de densité font apparaître les concentrations qui fusionnent
//   (métaballes) ; le front est la ligne de partage, épaisse et sombre ;
// - brouillard : l'ennemi est dessiné d'après ce que le joueur en sait (densité estimée), estompé hors de vue ;
// - combats (frontfx.js) : lueurs au contact, tirs traçants, obus, barrages ;
// - ordres à l'encre jaune, poches, villes.

import { Renderer, splineTo, blobPath, contourSegments, strokeSegments, ELEV_STOPS, PALETTE } from './render.js';
import { hexToPixel, pixelToHex, SQRT3 } from './hex.js';
import { createRng } from './rng.js';
import { makeNoise } from './mapgen.js';
import { FRONT_KINDS } from './terrain.js';
import { FRONT_WEATHER, POCKET_MODES, VECTOR_TYPES, pocketName } from './front.js';
import { MIN_POCKET, ARMOR_ATK } from './frontinput.js';
import { FrontFx } from './frontfx.js';
import { GUN_KINDS, visibleGuns, gunPower } from './frontguns.js';
import { visibleArmor } from './frontarmor.js';
import { railPoint } from './frontsupply.js';
import { SPRITE_PAL, piece, tank, howitzer, towed, mortar, rocket, pit, dust } from './frontsprites.js';

export const CELL = 9; // rayon d'une case de la micro-grille, en pixels monde

const K = Object.fromEntries(FRONT_KINDS.map((k, i) => [k, i]));
const SIDE_RGB = [[52, 84, 138], [178, 42, 30]]; // Wehrmacht, Armée rouge
const SIDE_LINE = ['#26303d', '#4a1610'];
const ORDER_INK = '#ffd23f'; // ordres du joueur
const ORDER_HALO = 'rgba(24, 20, 10, 0.8)';
const SPRITE_K = 1.7; // échelle des pièces vues de dessus (lisibles sans zoomer)
const FIRE = { decay: 0.965, gain: 5, min: 0.08 }; // incendies : déclin par tick, attisement par point de destruction
// Cratères par tick de barrage à pleine puissance, et leur rayon (pixels monde ; une case fait 9 de rayon).
const SCAR = { div: { n: 6, r: 1.1 }, heavy: { n: 5, r: 1.6 }, mortar: { n: 7, r: 0.9 }, rocket: { n: 9, r: 0.9 } };


// Poids de lissage d'un point de la carte : la case sous le point et ses voisines (noyau gaussien).
function kernel(map, x, y, sigma, out) {
  const h = pixelToHex(x, y, CELL);
  const col = Math.max(0, Math.min(map.W - 1, h.col)), row = Math.max(0, Math.min(map.H - 1, h.row));
  const c = row * map.W + col;
  const k = 1 / (sigma * sigma);
  let n = 0, sum = 0;
  for (let d = -1; d < 6; d++) {
    const i = d < 0 ? c : map.nb[c * 6 + d];
    if (i < 0) continue;
    const p = hexToPixel(i % map.W, Math.floor(i / map.W), CELL);
    const w = Math.exp(-((x - p.x) ** 2 + (y - p.y) ** 2) * k);
    out.idx[n] = i;
    out.w[n] = w;
    sum += w;
    n++;
  }
  for (let m = 0; m < n; m++) out.w[m] /= sum;
  return n;
}

// Échantillonneur à pas fixe : voisins et poids précalculés, pour lisser vite des valeurs par case à chaque tick.
function makeSampler(map, worldW, worldH, step, sigma) {
  const w = Math.ceil(worldW / step) + 1, h = Math.ceil(worldH / step) + 1;
  const idx = new Int32Array(w * h * 7).fill(-1), wt = new Float32Array(w * h * 7);
  const tmp = { idx: new Int32Array(7), w: new Float32Array(7) };
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const n = kernel(map, i * step, j * step, sigma, tmp);
      const o = (j * w + i) * 7;
      for (let m = 0; m < n; m++) { idx[o + m] = tmp.idx[m]; wt[o + m] = tmp.w[m]; }
    }
  }
  return {
    w, h, step,
    // Lisse un tableau par case (ou une fonction i → valeur) en un champ { w, h, step, data }.
    field(values) {
      const data = new Float32Array(w * h);
      const get = typeof values === 'function' ? values : (i) => values[i];
      for (let s = 0; s < w * h; s++) {
        let v = 0;
        for (let m = 0; m < 7; m++) { const i = idx[s * 7 + m]; if (i < 0) break; v += wt[s * 7 + m] * get(i); }
        data[s] = v;
      }
      return { w, h, step, data };
    },
  };
}

const mixTo = (a, b, t) => a + (b - a) * t;

export class FrontRenderer extends Renderer {
  setMap(front) {
    this.worksLayer = null;
    this.worksKey = null;
    this.front = front;
    this.map = front.map;
    this.worldW = Math.ceil((this.map.W + 0.5) * CELL * SQRT3);
    this.worldH = Math.ceil((this.map.H - 1) * 1.5 * CELL + 2 * CELL);
    this.cache = {};
    this.wrecks = [];
    this.houses = [];
    this.fire = new Float32Array(front.map.N); // incendies des villes (visuel) : 0 à 1, attisés par la destruction
    this.ruinSeen = Float32Array.from(front.ruin ?? new Float32Array(front.map.N));
    this.scars = null; // calque des cratères (paintScars), peint au fil des barrages
    this.scarQueue = [];
    this.scarClock = -1;
    this.fx = new FrontFx(CELL);
    this.sampler = makeSampler(this.map, this.worldW, this.worldH, 4, CELL * 1.25);
    // Montagnes : chaque case reçoit la case praticable la plus proche, dont elle prend le camp dans le rendu
    // (sinon la ligne de partage contourne chaque massif).
    const { N, nb } = this.map;
    this.nearOpen = new Int32Array(N).fill(-1);
    const queue = [];
    for (let i = 0; i < N; i++) if (front.owner[i] >= 0) { this.nearOpen[i] = i; queue.push(i); }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      for (let d = 0; d < 6; d++) {
        const j = nb[i * 6 + d];
        if (j >= 0 && this.nearOpen[j] < 0) { this.nearOpen[j] = this.nearOpen[i]; queue.push(j); }
      }
    }
    this.prev = null;
    this.cur = null;
    this.buildTerrain();
    this.resize();
  }

  // Centre d'une case (indice) en pixels monde ; les points d'ordres sont en unités de grille (× CELL).
  center(i) { return typeof i === 'number' ? hexToPixel(i % this.map.W, Math.floor(i / this.map.W), CELL) : hexToPixel(i.col, i.row, CELL); }
  toWorld(p) { return { x: p.x * CELL, y: p.y * CELL }; }
  toGrid(p) { return { x: p.x / CELL, y: p.y / CELL }; }

  // Point de la carte sous le doigt, en unités de grille (celles des ordres), et la case correspondante.
  pointAt(clientX, clientY) {
    const l = this.local(clientX, clientY);
    const x = this.cam.x + l.x / this.cam.s, y = this.cam.y + l.y / this.cam.s;
    const h = pixelToHex(x, y, CELL);
    const inside = h.col >= 0 && h.row >= 0 && h.col < this.map.W && h.row < this.map.H;
    return { x: x / CELL, y: y / CELL, i: inside ? h.row * this.map.W + h.col : -1 };
  }

  // Partie du monde visible à l'écran (pixels monde).
  viewRect() {
    const c = this.cam;
    return { x0: c.x, y0: c.y, x1: c.x + this.vw / c.s, y1: c.y + this.vh / c.s };
  }

  initialView(side) {
    // Grand écran : toute la carte. Téléphone (portrait ou paysage) : la carte couvre l'écran, sans bandes vides.
    if (this.vw >= 760 && this.vh >= 480) return this.fitAll();
    this.cam.s = Math.max(this.fitScale(), this.vw / this.worldW, Math.min(1.1, this.vh / this.worldH));
    const ownX = side === 'SU' ? this.worldW * 0.62 : this.worldW * 0.38;
    this.cam.x = ownX - this.vw / this.cam.s / 2;
    this.cam.y = (this.worldH - this.vh / this.cam.s) / 2;
    this.clampCam();
  }

  // ---------- Terrain ----------

  buildTerrain() {
    const map = this.map;
    const { worldW, worldH } = this;
    const scale = Math.min(2.5, Math.sqrt(9e6 / (worldW * worldH)));
    this.layerScale = scale;
    const off = document.createElement('canvas');
    off.width = Math.ceil(worldW * scale);
    off.height = Math.ceil(worldH * scale);
    const ctx = off.getContext('2d');
    ctx.scale(scale, scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const rng = createRng(`frontrender:${map.seed}`);
    const detail = makeNoise(rng);

    // 1. Champs lissés : altitude (montagne comptée haute), part de forêt, marais, montagne.
    const step = 2;
    const w = Math.ceil(worldW / step) + 1, h = Math.ceil(worldH / step) + 1;
    const elev = new Float32Array(w * h), forest = new Float32Array(w * h), marsh = new Float32Array(w * h), rock = new Float32Array(w * h);
    const tmp = { idx: new Int32Array(7), w: new Float32Array(7) };
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const x = i * step, y = j * step;
        const n = kernel(map, x, y, CELL * 1.1, tmp);
        let e = 0, f = 0, m = 0, r = 0;
        for (let q = 0; q < n; q++) {
          const c = tmp.idx[q], wt = tmp.w[q], k = map.kind[c];
          e += wt * (k === K.mountain ? Math.max(4, map.relief[c] + 1) : map.relief[c]);
          if (k === K.forest) f += wt;
          else if (k === K.marsh) m += wt;
          else if (k === K.mountain) r += wt;
        }
        const s = j * w + i;
        elev[s] = e + (detail(x / 60, y / 60, 3) - 0.5) * 0.45;
        forest[s] = f; marsh[s] = m; rock[s] = r;
      }
    }
    // 2. Couleurs : teintes d'altitude, forêts, marais, roche ; ombrage nord-ouest.
    const hc = document.createElement('canvas');
    hc.width = w;
    hc.height = h;
    const hctx = hc.getContext('2d');
    const img = hctx.createImageData(w, h);
    const mix = (a, b, t) => a + (b - a) * t;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const s = j * w + i;
        const v = Math.max(0, Math.min(2.999, elev[s]));
        const k = Math.floor(v), f = v - k;
        const A = ELEV_STOPS[k], B = ELEV_STOPS[k + 1];
        let r = mix(A[0], B[0], f), g = mix(A[1], B[1], f), b = mix(A[2], B[2], f);
        const fo = Math.min(1, forest[s] * 1.3) * 0.7, ma = Math.min(1, marsh[s] * 1.3) * 0.55, ro = Math.min(1, rock[s] * 1.4) * 0.8;
        r = mix(r, 112, fo); g = mix(g, 140, fo); b = mix(b, 80, fo);
        r = mix(r, 138, ma); g = mix(g, 170, ma); b = mix(b, 160, ma);
        r = mix(r, 128, ro); g = mix(g, 116, ro); b = mix(b, 100, ro);
        const gx = elev[j * w + Math.min(w - 1, i + 1)] - elev[j * w + Math.max(0, i - 1)];
        const gy = elev[Math.min(h - 1, j + 1) * w + i] - elev[Math.max(0, j - 1) * w + i];
        const shade = 1 + Math.max(-0.3, Math.min(0.3, (gx + gy) * 1.6));
        img.data[s * 4] = Math.min(255, r * shade);
        img.data[s * 4 + 1] = Math.min(255, g * shade);
        img.data[s * 4 + 2] = Math.min(255, b * shade);
        img.data[s * 4 + 3] = 255;
      }
    }
    hctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(hc, 0, 0, w * step, h * step);

    // 3. Courbes de niveau.
    const ef = { w, h, step, data: elev };
    ctx.strokeStyle = 'rgba(112, 72, 34, 0.28)';
    ctx.lineWidth = 0.6;
    for (const lv of [0.5, 1, 1.5, 2, 2.5, 3, 3.5]) strokeSegments(ctx, contourSegments(ef, lv));
    ctx.strokeStyle = 'rgba(112, 72, 34, 0.7)';
    ctx.lineWidth = 1;
    for (const lv of [1.5, 2.5]) strokeSegments(ctx, contourSegments(ef, lv));

    // 4. Eau et routes : rivières (ruban bleu cerné), gués (pierres claires), routes (trait pâle cerné), ponts.
    this.drawWater(ctx);

    // 5. Végétation, marais, montagnes, villes.
    for (let c = 0; c < map.N; c++) {
      const p = this.center(c), k = map.kind[c];
      if (map.river?.[c]) continue;
      const r = createRng(c * 7 + 3);
      if (k === K.forest) {
        for (let t = 0; t < 3; t++) {
          ctx.beginPath();
          ctx.arc(p.x + (r.next() - 0.5) * CELL * 1.4, p.y + (r.next() - 0.5) * CELL * 1.4, 1.4 + r.next() * 1.4, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(52, 78, 36, 0.7)';
          ctx.fill();
        }
      } else if (k === K.marsh) {
        ctx.strokeStyle = 'rgba(70, 110, 120, 0.6)';
        ctx.lineWidth = 0.7;
        const mx = p.x + (r.next() - 0.5) * CELL, my = p.y + (r.next() - 0.5) * CELL;
        ctx.beginPath();
        ctx.moveTo(mx - 3, my); ctx.lineTo(mx + 3, my);
        ctx.moveTo(mx - 1, my); ctx.lineTo(mx - 2, my - 3);
        ctx.moveTo(mx + 1, my); ctx.lineTo(mx + 1.5, my - 3.5);
        ctx.stroke();
      } else if (k === K.mountain) {
        // Hachures : traits sombres orientés vers la pente.
        ctx.strokeStyle = 'rgba(60, 46, 34, 0.55)';
        ctx.lineWidth = 0.8;
        for (let t = 0; t < 3; t++) {
          const mx = p.x + (r.next() - 0.5) * CELL * 1.3, my = p.y + (r.next() - 0.5) * CELL * 1.3;
          ctx.beginPath();
          ctx.moveTo(mx, my - 3);
          ctx.lineTo(mx + 1.5, my + 2);
          ctx.stroke();
        }
      } else if (k === K.town) {
        // Maisons : dessinées à chaque image selon l'état de la ville (drawHouses). th : ordre d'effondrement.
        for (let t = 0; t < 4; t++) {
          const hx = p.x + (r.next() - 0.5) * CELL * 1.3, hy = p.y + (r.next() - 0.5) * CELL * 1.2;
          const q = createRng(c * 31 + t);
          this.houses.push({ c, x: hx, y: hy, th: q.next(), fire: q.next(), ph: q.next() * 10, shape: [0, 1, 2, 3, 4, 5].map(() => 0.6 + q.next() * 0.7) });
        }
      }
    }
    ctx.textAlign = 'center';
    for (const t of map.towns) {
      const p = this.center(t.i);
      ctx.font = `600 ${t.city ? 13 : 11}px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif`;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = PALETTE.halo;
      ctx.strokeText(t.name, p.x, p.y + CELL * 2.6);
      ctx.fillStyle = PALETTE.label;
      ctx.fillText(t.name, p.x, p.y + CELL * 2.6);
    }
    this.layer = off;
  }

  // Ouvrages (frontworks.js), sur un calque mis en cache et refait quand ils changent : tranchées en zigzag avec leur
  // parapet côté ennemi, barbelés en petites croix devant, hérissons antichar plus loin ; ruines grises et cratères ;
  // ponts détruits. Ceux de l'ennemi n'apparaissent qu'une fois observés.
  drawWorks(viewer) {
    const f = this.front;
    if (!f.wire) return;
    const key = `${f.worksVersion}:${viewer}:${f.clock}`;
    if (this.worksKey !== key) {
      // Refait au plus une fois par tick (clé : version des ouvrages, camp, horloge).
      if (this.worksKey?.split(':')[0] !== String(f.worksVersion) || this.worksKey?.split(':')[1] !== String(viewer)) this.paintWorks(viewer);
      this.worksKey = key;
    }
    this.ctx.drawImage(this.worksLayer, 0, 0, this.worldW, this.worldH);
  }

  // Têtes de ligne (dépôts) : pointillé brun et caisses, derrière ses propres lignes. Au-delà d'environ 5 cases en
  // avant, la poussée faiblit (frontsupply.js).
  drawRails(viewer) {
    const f = this.front;
    if (!f.rail) return;
    const { ctx, cam } = this;
    const px = 1 / cam.s;
    for (const s of viewer === null ? [0, 1] : [viewer]) {
      const pts = [];
      for (let r = 0; r < f.map.H; r += 2) { const p = railPoint(f, s, r); if (p.x > 0 && p.x < f.rightX) pts.push(this.toWorld(p)); }
      if (pts.length < 2) continue;
      ctx.strokeStyle = 'rgba(96, 70, 40, 0.55)';
      ctx.lineWidth = 1.6 * px;
      ctx.setLineDash([2 * px, 5 * px]);
      ctx.beginPath();
      splineTo(ctx, pts);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let k = 2; k < pts.length; k += 6) {
        const p = pts[k], w = 5 * Math.max(1, px);
        ctx.fillStyle = 'rgba(140, 104, 60, 0.9)';
        ctx.strokeStyle = 'rgba(60, 42, 24, 0.9)';
        ctx.lineWidth = 0.8 * px;
        ctx.fillRect(p.x - w / 2, p.y - w / 2, w, w);
        ctx.strokeRect(p.x - w / 2, p.y - w / 2, w, w);
        ctx.beginPath(); ctx.moveTo(p.x - w / 2, p.y - w / 2); ctx.lineTo(p.x + w / 2, p.y + w / 2); ctx.stroke();
      }
    }
  }

  paintWorks(viewer) {
    const f = this.front, map = this.map;
    const scale = Math.min(2, this.layerScale ?? 1);
    if (!this.worksLayer) {
      this.worksLayer = document.createElement('canvas');
      this.worksLayer.width = Math.ceil(this.worldW * scale);
      this.worksLayer.height = Math.ceil(this.worldH * scale);
    }
    const ctx = this.worksLayer.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.worksLayer.width, this.worksLayer.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const mem = viewer === null ? null : f.memory[viewer];
    const known = (i) => !mem || f.owner[i] === viewer || mem.seen[i] >= 0;
    const { N, nb } = map;
    const zig = (a, b, amp) => {
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      ctx.moveTo(a.x, a.y);
      for (let k = 1; k < 4; k++) { const t = k / 4, o = (k % 2 ? 1 : -1) * amp; ctx.lineTo(a.x + dx * t + nx * o, a.y + dy * t + ny * o); }
      ctx.lineTo(b.x, b.y);
    };
    for (let i = 0; i < N; i++) {
      const t = f.entrench[i], wr = f.wreck[i];
      if (!f.trenchLine[i] || (t < 0.08 && !(wr & 1)) || !known(i)) continue;
      const p = this.center(i);
      const ex = f.trenchSide[i] === 1 ? -1 : 1;
      const live = t >= 0.08;
      const links = [];
      // Liaisons vers les voisines de tranchée (sauf est-ouest : une tranchée court le long du front).
      for (const d of [1, 2]) { const j = nb[i * 6 + d]; if (j >= 0 && f.trenchLine[j] && (f.entrench[j] >= 0.08 || f.wreck[j] & 1) && known(j)) links.push(this.center(j)); }
      const path = () => {
        ctx.beginPath();
        if (links.length) for (const q of links) zig(p, q, 1.5);
        else zig({ x: p.x, y: p.y - CELL * 0.6 }, { x: p.x, y: p.y + CELL * 0.6 }, 1.5);
      };
      if (live) {
        ctx.save();
        ctx.translate(ex * 1.3, 0);
        path();
        ctx.strokeStyle = `rgba(226, 208, 168, ${0.35 + 0.4 * t})`;
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.restore();
        path();
        ctx.strokeStyle = `rgba(58, 44, 30, ${0.3 + 0.55 * t})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        // Ruine : tranchée effondrée, en pointillé gris, et un cratère.
        ctx.setLineDash([1.5, 2.5]);
        path();
        ctx.strokeStyle = 'rgba(96, 90, 80, 0.6)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.setLineDash([]);
        const r = createRng(i * 13 + 5);
        ctx.beginPath();
        ctx.arc(p.x + (r.next() - 0.5) * 6, p.y + (r.next() - 0.5) * 6, 1.6 + r.next() * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(60, 52, 44, 0.45)';
        ctx.fill();
      }
    }
    for (let i = 0; i < N; i++) {
      const w = f.wire[i], a = f.at[i], wr = f.wreck[i];
      if ((w < 0.1 && a < 0.1 && !(wr & 6)) || !known(i)) continue;
      const p = this.center(i);
      const ex = f.trenchSide[i] === 1 ? -1 : f.trenchSide[i] === 0 ? 1 : (f.owner[i] === 1 ? -1 : 1);
      const r = createRng(i * 7 + 1);
      if (w >= 0.1 && f.trenchLine[i]) {
        // Barbelés : petites croix en ligne, devant la tranchée.
        ctx.strokeStyle = `rgba(36, 34, 30, ${0.35 + 0.5 * w})`;
        ctx.lineWidth = 0.55;
        ctx.beginPath();
        for (let k = -1; k <= 1; k++) {
          const x = p.x + ex * 5, y = p.y + k * 4.2;
          ctx.moveTo(x - 1.3, y - 1.3); ctx.lineTo(x + 1.3, y + 1.3);
          ctx.moveTo(x + 1.3, y - 1.3); ctx.lineTo(x - 1.3, y + 1.3);
        }
        ctx.moveTo(p.x + ex * 5, p.y - 5.5); ctx.lineTo(p.x + ex * 5, p.y + 5.5);
        ctx.stroke();
      } else if (wr & 2 && f.trenchLine[i]) {
        ctx.strokeStyle = 'rgba(90, 86, 78, 0.55)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let k = 0; k < 3; k++) { const x = p.x + ex * 5 + (r.next() - 0.5) * 5, y = p.y + (r.next() - 0.5) * 9, an = r.next() * Math.PI; ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(an) * 2, y + Math.sin(an) * 2); }
        ctx.stroke();
      }
      if (a >= 0.1 || wr & 4) {
        // Hérissons tchèques : trois poutrelles croisées ; renversés et gris s'ils sont détruits.
        const ok = a >= 0.1;
        ctx.strokeStyle = ok ? `rgba(44, 42, 40, ${0.4 + 0.5 * a})` : 'rgba(110, 104, 96, 0.5)';
        ctx.lineWidth = ok ? 0.8 : 0.6;
        ctx.beginPath();
        for (let k = -1; k <= 1; k += 2) {
          const x = p.x + ex * 9, y = p.y + k * 3.5, s = ok ? 1.8 : 1.4, rot = ok ? 0 : r.next() * 2;
          for (let q = 0; q < 3; q++) { const an = rot + (q * Math.PI) / 3; ctx.moveTo(x - Math.cos(an) * s, y - Math.sin(an) * s); ctx.lineTo(x + Math.cos(an) * s, y + Math.sin(an) * s); }
        }
        ctx.stroke();
      }
    }
    // Ponts détruits : tablier rompu, débris dans l'eau.
    for (let i = 0; i < N; i++) {
      if (map.bridge[i] !== 2) continue;
      const p = this.center(i);
      ctx.fillStyle = 'rgb(104, 148, 170)';
      ctx.beginPath(); ctx.arc(p.x, p.y, CELL * 0.75, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgb(110, 84, 56)';
      ctx.fillRect(p.x - CELL * 0.9, p.y - 2.4, CELL * 0.45, 4.8);
      ctx.fillRect(p.x + CELL * 0.45, p.y - 2.4, CELL * 0.45, 4.8);
      ctx.fillStyle = 'rgba(40, 32, 24, 0.7)';
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(p.x + (k - 1.5) * 2, p.y + (k % 2 ? 1.5 : -1.2), 0.9, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  drawWater(ctx) {
    const map = this.map;
    if (!map.river) return;
    const { N, nb } = map;
    // Rivières : ruban lissé le long du tracé (berge sombre, puis eau), un peu plus large que les cases d'eau du jeu.
    const pt = ([row, col]) => ({ x: CELL * SQRT3 * (col + 0.5 * (Math.round(row) & 1)) + (CELL * SQRT3) / 2, y: CELL * 1.5 * row + CELL });
    for (const [w, color] of [[1.5, 'rgba(46, 74, 92, 0.75)'], [1.15, 'rgb(104, 148, 170)']]) {
      ctx.strokeStyle = color;
      for (const r of map.rivers ?? []) {
        if (!r.line?.length) continue;
        // Moyenne glissante : le tracé suit les cases sans leurs crans.
        const pts = r.line.map((_, k) => {
          let x = 0, y = 0, n = 0;
          for (let q = Math.max(0, k - 2); q <= Math.min(r.line.length - 1, k + 2); q++) { const p = pt(r.line[q]); x += p.x; y += p.y; n++; }
          return { x: x / n, y: y / n };
        });
        // Prolonge jusqu'aux bords de la carte.
        const first = pts[0], last = pts[pts.length - 1], second = pts[1] ?? first, prev = pts[pts.length - 2] ?? last;
        pts.unshift({ x: first.x * 2 - second.x, y: first.y * 2 - second.y });
        pts.push({ x: last.x * 2 - prev.x, y: last.y * 2 - prev.y });
        ctx.lineWidth = CELL * w * (r.big ? 2.1 : 1);
        ctx.beginPath();
        splineTo(ctx, pts);
        ctx.stroke();
      }
    }
    // Gués : pierres claires en travers.
    for (let i = 0; i < N; i++) {
      if (map.river[i] !== 2) continue;
      const p = this.center(i);
      ctx.fillStyle = 'rgba(226, 214, 180, 0.9)';
      for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.arc(p.x + k * 2.6, p.y + (k % 2) * 1.2, 1.3, 0, Math.PI * 2); ctx.fill(); }
    }
    // Routes : spline par les centres des cases, cernée.
    for (const pass of [['rgba(86, 66, 40, 0.55)', 3.4], ['rgb(222, 206, 160)', 2]]) {
      ctx.strokeStyle = pass[0];
      ctx.lineWidth = pass[1];
      for (const path of map.roads ?? []) {
        ctx.beginPath();
        splineTo(ctx, path.map((i) => this.center(i)));
        ctx.stroke();
      }
    }
    // Ponts : tablier brun en travers de la rivière, dans l'axe de la route.
    for (const path of map.roads ?? []) {
      for (let k = 0; k < path.length; k++) {
        const i = path[k];
        if (map.bridge[i] !== 1) continue;
        const a = this.center(path[Math.max(0, k - 1)]), b = this.center(path[Math.min(path.length - 1, k + 1)]), p = this.center(i);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(ang);
        const L = CELL * (map.bigRiver[i] ? 2.2 : 1.6);
        ctx.fillStyle = 'rgba(40, 30, 20, 0.5)';
        ctx.fillRect(-L / 2 + 0.8, -2.6 + 0.8, L, 5.2);
        ctx.fillStyle = 'rgb(140, 104, 64)';
        ctx.fillRect(-L / 2, -2.6, L, 5.2);
        ctx.strokeStyle = 'rgb(70, 50, 30)';
        ctx.lineWidth = 0.7;
        ctx.strokeRect(-L / 2, -2.6, L, 5.2);
        ctx.restore();
      }
    }
  }

  // ---------- Masses de troupes ----------

  // Ce que le camp viewer sait de la situation (null : vue omnisciente).
  viewOf(viewer) {
    const f = this.front, { N } = this.map;
    const owner = new Float32Array(N), dA = new Float32Array(N), dB = new Float32Array(N), open = new Float32Array(N), vis = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const known = viewer === null || f.owner[i] === viewer ? f.owner[i] : f.memory[viewer].owner[i];
      if (known < 0) {
        // Montagne : le camp de la case praticable la plus proche, sans troupes ni teinte.
        const j = this.nearOpen[i];
        const kj = j < 0 ? -1 : viewer === null || f.owner[j] === viewer ? f.owner[j] : f.memory[viewer].owner[j];
        owner[i] = kj === 0 ? 1 : 0;
        continue;
      }
      open[i] = 1;
      owner[i] = known === 0 ? 1 : 0;
      const d = viewer === null || known === viewer ? f.dens[i] : f.memory[viewer].est[i];
      if (known === 0) dA[i] = d; else dB[i] = d;
      vis[i] = viewer === null || f.vision[viewer][i] ? 1 : 0;
    }
    return { owner, dA, dB, open, vis };
  }

  // Instantané lissé, à appeler après chaque tick ; le rendu interpole entre les deux derniers.
  snapshot(viewer) {
    this.updateFires();
    this.queueCraters();
    const v = this.viewOf(viewer);
    const S = this.sampler;
    const open = S.field(v.open).data;
    const own = S.field(v.owner).data;
    this.prev = this.cur ?? null;
    const dA = S.field(v.dA).data, dB = S.field(v.dB).data;
    // Courbes de concentration et contours de poches : une fois par tick (discrets, ils n'ont pas besoin d'être
    // interpolés) ; seule la ligne de front est recalculée à chaque image.
    const F = (data) => ({ w: S.w, h: S.h, step: S.step, data });
    const conc = [[F(dA), 0], [F(dB), 1]].map(([fl, side]) => ({ side, levels: [[8, 0.35, 0.8], [18, 0.6, 1.2]].map(([lv, a, wd]) => ({ a, wd, segs: contourSegments(fl, lv) })) }));
    const pockets = [];
    const f = this.front;
    for (const s of [0, 1]) {
      for (const p of f.pockets[s]) {
        if (p.troops < MIN_POCKET) continue;
        if (viewer !== null && s !== viewer && !p.cells.some((i) => f.vision[viewer][i])) continue;
        const set = new Uint8Array(this.map.N);
        for (const i of p.cells) set[i] = 1;
        pockets.push({ p, segs: contourSegments(S.field(set), 0.45) });
      }
    }
    this.cur = { owner: own, open, dA, dB, vis: S.field(v.vis).data, viewer, conc, pockets };
    if (!this.prev) this.prev = this.cur;
  }

  frontImage(t) {
    const S = this.sampler, a = this.prev, b = this.cur;
    const n = S.w * S.h;
    if (!this.massCanvas) {
      this.massCanvas = document.createElement('canvas');
      this.massCanvas.width = S.w;
      this.massCanvas.height = S.h;
      this.massImg = this.massCanvas.getContext('2d').createImageData(S.w, S.h);
    }
    const px = this.massImg.data;
    const o = new Float32Array(n), dA = new Float32Array(n), dB = new Float32Array(n);
    for (let s = 0; s < n; s++) {
      o[s] = mixTo(a.owner[s], b.owner[s], t);
      dA[s] = mixTo(a.dA[s], b.dA[s], t);
      dB[s] = mixTo(a.dB[s], b.dB[s], t);
      const open = mixTo(a.open[s], b.open[s], t);
      const vis = mixTo(a.vis[s], b.vis[s], t);
      const de = o[s] >= 0.5;
      const d = de ? dA[s] / Math.max(0.05, o[s]) : dB[s] / Math.max(0.05, 1 - o[s]);
      const rgb = SIDE_RGB[de ? 0 : 1];
      const enemy = b.viewer !== null && (de ? 0 : 1) !== b.viewer;
      // Opacité et teinte : la masse s'épaissit et fonce avec la densité (arrières pâles, front et concentrations
      // sombres) ; hors de vue, l'ennemi n'est qu'une estimation estompée.
      const k = 1 - Math.exp(-d / 5), dark = 1 - 0.32 * k;
      let alpha = (0.2 + 0.66 * k) * Math.min(1, open * 1.3);
      if (enemy) alpha *= 0.6 + 0.4 * vis;
      px[s * 4] = rgb[0] * dark;
      px[s * 4 + 1] = rgb[1] * dark;
      px[s * 4 + 2] = rgb[2] * dark;
      px[s * 4 + 3] = Math.round(alpha * 255);
    }
    this.massCanvas.getContext('2d').putImageData(this.massImg, 0, 0);
    return { o: { w: S.w, h: S.h, step: S.step, data: o }, dA: { w: S.w, h: S.h, step: S.step, data: dA }, dB: { w: S.w, h: S.h, step: S.step, data: dB } };
  }

  // ---------- Image ----------

  // view : { viewer (0, 1 ou null), t (0 → 1 entre deux ticks), orders (ordres du camp viewer), origin, preview, now }
  draw(view = {}) {
    const { ctx, cam } = this;
    const f = this.front;
    const d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = PALETTE.desk;
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.setTransform(d * cam.s, 0, 0, d * cam.s, -cam.x * cam.s * d, -cam.y * cam.s * d);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(4, 6, this.worldW, this.worldH);
    ctx.drawImage(this.layer, 0, 0, this.worldW, this.worldH);

    // Neige du jour : voile blanc sur le terrain.
    if (FRONT_WEATHER[f.weather]?.frozen) {
      ctx.fillStyle = 'rgba(240, 244, 246, 0.42)';
      ctx.fillRect(0, 0, this.worldW, this.worldH);
    }

    const now = view.now ?? performance.now();
    this.fx.drawGround(ctx, now);
    this.drawHouses(view.viewer ?? null, false);

    if (!this.cur) this.snapshot(view.viewer ?? null);
    const fields = this.frontImage(Math.max(0, Math.min(1, view.t ?? 1)));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.massCanvas, 0, 0, this.sampler.w * this.sampler.step, this.sampler.h * this.sampler.step);

    // Concentrations : contours de densité de chaque camp (les masses voisines fusionnent).
    for (const { side, levels } of this.cur.conc) {
      ctx.strokeStyle = SIDE_LINE[side];
      for (const { a, wd, segs } of levels) {
        ctx.globalAlpha = a;
        ctx.lineWidth = wd;
        strokeSegments(ctx, segs);
      }
    }
    ctx.globalAlpha = 1;
    this.drawScars();
    this.drawHouses(view.viewer ?? null, true);
    this.drawWorks(view.viewer ?? null);
    this.drawRails(view.viewer ?? null);
    const spears = f.phase === 'resolve' ? [...this.spearheads(view.viewer ?? null), ...this.armorTrails(view.viewer ?? null)] : [];
    this.drawSpearMass(spears);
    this.fx.drawGlow(ctx, now);
    this.drawFires(view.viewer ?? null, now);

    // Ligne de front : partage des deux camps, épaisse et sombre.
    const line = contourSegments(fields.o, 0.5);
    ctx.strokeStyle = 'rgba(250, 240, 210, 0.55)';
    ctx.lineWidth = 4.5;
    strokeSegments(ctx, line);
    ctx.strokeStyle = '#1d1a12';
    ctx.lineWidth = 2.4;
    strokeSegments(ctx, line);
    this.fx.drawOver(ctx, now, 1 / cam.s);
    this.fx.drawPlumes(ctx, now);
    this.drawSpearTips(spears.filter((sp) => !sp.formation));
    this.drawArmor(view);

    this.drawTowns(view.viewer ?? null);
    this.drawObjectiveMarks();
    this.drawPockets(view.viewer ?? null);
    this.drawGuns(view);
    if (view.orders) this.drawFrontOrders(view.orders, view.viewer);
    if (view.preview) this.drawFrontOrders(view.preview, view.viewer, 0.55);
    if (view.origin != null && view.origin >= 0) {
      const p = this.center(view.origin);
      ctx.beginPath();
      ctx.arc(p.x, p.y, CELL * 1.6, 0, Math.PI * 2);
      ctx.strokeStyle = ORDER_INK;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Zone d'estimation touchée par le joueur.
    if (view.probe) {
      const c = this.toWorld(view.probe);
      ctx.beginPath();
      ctx.arc(c.x, c.y, view.probe.r * CELL, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(250, 240, 210, 0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(250, 240, 210, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ---------- Cratères ----------

  // Impacts des barrages du tick qui vient de se jouer : terre labourée et cratères, pour toute la bataille.
  // Une fois par tick de l'horloge (snapshot peut être appelé plusieurs fois pour un même tick).
  queueCraters() {
    const f = this.front;
    if (this.scarClock === f.clock || f.phase === 'plan' && f.tick === 0) return;
    this.scarClock = f.clock;
    if (f.tick > f.cfg.barrageTicks) return;
    const rng = createRng(`craters:${f.seed}:${f.clock}`);
    for (const s of [0, 1]) {
      for (const b of f.barrages[s]) {
        const g = f.guns?.find((x) => x.id === b.gun);
        if (!g || g.fired !== f.clock - 1) continue;
        const C = SCAR[g.kind] ?? SCAR.div;
        const n = Math.round(C.n * gunPower(g) * FRONT_WEATHER[f.weather].barrage);
        for (let q = 0; q < n; q++) {
          const a = rng.next() * Math.PI * 2, r = Math.sqrt(rng.next()) * b.r * CELL;
          const x = b.x * CELL + Math.cos(a) * r, y = b.y * CELL + Math.sin(a) * r;
          const h = pixelToHex(x, y, CELL), i = h.row * this.map.W + h.col;
          if (h.col < 0 || h.row < 0 || h.col >= this.map.W || h.row >= this.map.H || this.map.river?.[i] || this.map.kind[i] === K.mountain) continue;
          this.scarQueue.push({ x, y, r: C.r * (0.7 + 0.6 * rng.next()), a: rng.next() * 6.3, k: rng.next() });
        }
      }
    }
  }

  // Calque des cratères, au-dessus des masses (lisible dans les deux camps) : chaque impact ajoute une tache brune très légère (elles s'accumulent en
  // terre labourée là où l'on pilonne souvent), un pointillé de terre retournée, puis le cratère lui-même : bourrelet
  // clair éclairé du nord-ouest, entonnoir sombre, projections.
  drawScars() {
    if (this.scarQueue.length) this.paintScars();
    if (this.scars) this.ctx.drawImage(this.scars, 0, 0, this.worldW, this.worldH);
  }

  paintScars() {
    const scale = Math.min(1.6, this.layerScale ?? 1);
    if (!this.scars) {
      this.scars = document.createElement('canvas');
      this.scars.width = Math.ceil(this.worldW * scale);
      this.scars.height = Math.ceil(this.worldH * scale);
      this.churn = document.createElement('canvas');
      this.churn.width = this.churn.height = 32;
      const g = this.churn.getContext('2d'), grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(92, 68, 42, 1)');
      grad.addColorStop(1, 'rgba(92, 68, 42, 0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
    }
    const ctx = this.scars.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    for (const c of this.scarQueue) {
      ctx.globalAlpha = 0.09;
      const R = CELL * 1.1;
      ctx.drawImage(this.churn, c.x - R, c.y - R, R * 2, R * 2);
      ctx.globalAlpha = 1;
      for (let q = 0; q < 4; q++) {
        const a = c.a + q * 1.7, d = 2 + ((c.k * 7 + q * 3.1) % 1) * 5;
        ctx.fillStyle = q % 2 ? 'rgba(236, 222, 186, 0.5)' : 'rgba(52, 38, 24, 0.55)';
        ctx.fillRect(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, 0.7, 0.7);
      }
      ctx.fillStyle = 'rgba(70, 52, 32, 0.45)';
      for (let q = 0; q < 5; q++) { const a = c.a + q * 1.26, d = c.r * (1.7 + (q % 3) * 0.4); ctx.fillRect(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, 0.6, 0.6); }
      ctx.fillStyle = 'rgba(238, 226, 190, 0.55)';
      ctx.beginPath(); ctx.arc(c.x - 0.35, c.y - 0.35, c.r * 1.35, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(92, 70, 44, 0.8)';
      ctx.beginPath(); ctx.arc(c.x + 0.2, c.y + 0.2, c.r * 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(40, 30, 20, 0.8)';
      ctx.beginPath(); ctx.arc(c.x + 0.1, c.y + 0.15, c.r * 0.8, 0, Math.PI * 2); ctx.fill();
    }
    this.scarQueue.length = 0;
  }

  // ---------- Villes sous le feu ----------

  // Incendies : chaque hausse de la destruction d'une case de ville l'attise ; ils s'éteignent en un jour environ.
  updateFires() {
    const f = this.front;
    if (!f.ruin) return;
    for (const c of f.townCells ?? []) {
      const d = f.ruin[c] - this.ruinSeen[c];
      this.ruinSeen[c] = f.ruin[c];
      this.fire[c] = Math.min(1, this.fire[c] * FIRE.decay + Math.max(0, d) * FIRE.gain);
    }
  }

  // Part effondrée d'une maison (0 intacte, 1 gravats) selon la destruction de sa case.
  houseRuin(h) {
    const r = this.front.ruin?.[h.c] ?? 0;
    return Math.max(0, Math.min(1, (r - h.th * 0.75) / 0.3));
  }

  // Maisons : toit puis murs qui cèdent, gravats gris et sol noirci. Les intactes sous les masses, comme le terrain
  // (damaged false) ; les abîmées par-dessus, pour que les ruines se lisent dans les deux camps (damaged true).
  drawHouses(viewer, damaged) {
    const { ctx } = this;
    const f = this.front, mem = viewer === null ? null : f.memory[viewer];
    for (const h of this.houses) {
      // Chez l'ennemi : l'état connu, celui d'une case déjà observée ; sinon la ville d'avant-guerre.
      const known = !mem || f.owner[h.c] === viewer || mem.seen[h.c] >= 0;
      const u = known ? this.houseRuin(h) : 0;
      if (u > 0 !== damaged) continue;
      if (u <= 0) {
        ctx.fillStyle = PALETTE.house;
        ctx.fillRect(h.x - 2.2, h.y - 1.8, 4.4, 3.6);
        ctx.fillStyle = PALETTE.roof;
        ctx.fillRect(h.x - 2.2, h.y - 1.8, 4.4, 1.5);
        continue;
      }
      ctx.fillStyle = `rgba(40, 30, 20, ${0.16 + 0.2 * u})`;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 2.6 + 1.2 * u, 0, Math.PI * 2);
      ctx.fill();
      if (u < 1) {
        // Éventrée : murs assombris, toit qui disparaît par un bout, trou noir à la place.
        ctx.fillStyle = 'rgb(88, 66, 50)';
        ctx.fillRect(h.x - 2.2, h.y - 1.8, 4.4, 3.6);
        ctx.fillStyle = 'rgb(122, 56, 38)';
        ctx.fillRect(h.x - 2.2, h.y - 1.8, 4.4 * (1 - u), 1.5);
        ctx.fillStyle = 'rgba(26, 20, 14, 0.75)';
        ctx.fillRect(h.x + 2.2 - 4.4 * u, h.y - 1.2, 4.4 * u * 0.9, 2.6);
      } else {
        // Gravats : tas gris irrégulier, quelques blocs.
        ctx.fillStyle = 'rgb(146, 140, 128)';
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = k * 1.047, d = 2.2 * h.shape[k];
          if (k) ctx.lineTo(h.x + Math.cos(a) * d * 1.2, h.y + Math.sin(a) * d);
          else ctx.moveTo(h.x + Math.cos(a) * d * 1.2, h.y + Math.sin(a) * d);
        }
        ctx.fill();
        ctx.fillStyle = 'rgb(94, 90, 82)';
        for (let k = 0; k < 3; k++) ctx.fillRect(h.x + (h.shape[k] - 0.95) * 5, h.y + (h.shape[k + 3] - 0.95) * 4, 1, 1);
      }
    }
  }

  // Flammes des maisons qui brûlent (lueur vacillante) ; leur fumée part en panache (frontfx.js).
  drawFires(viewer, now) {
    const f = this.front;
    if (!f.ruin) return;
    const { ctx } = this;
    const seen = (c) => viewer === null || f.owner[c] === viewer || f.vision[viewer][c];
    const sources = [], lit = new Set();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const h of this.houses) {
      const heat = this.fire[h.c];
      if (heat < FIRE.min || h.fire > heat * 1.4 || !seen(h.c)) continue;
      const u = this.houseRuin(h);
      if (u <= 0.05) continue;
      const fl = 0.55 + 0.45 * Math.sin(now * 0.021 + h.ph) * Math.sin(now * 0.013 + h.ph * 2.1);
      const R = 2.2 + 2.6 * heat;
      ctx.globalAlpha = Math.min(1, 0.35 + 0.6 * heat) * fl;
      ctx.drawImage(this.fx.fireSprite(), h.x - R, h.y - R, R * 2, R * 2);
      ctx.fillStyle = '#ffdc8a';
      ctx.beginPath();
      ctx.arc(h.x + Math.sin(now * 0.03 + h.ph) * 0.5, h.y - 0.4, 0.7 + 0.6 * heat, 0, Math.PI * 2);
      ctx.fill();
      // Un panache par case en feu, au-dessus de sa première maison qui brûle.
      if (!lit.has(h.c)) { lit.add(h.c); sources.push(h.x, h.y, heat); }
    }
    ctx.restore();
    this.fx.plumeSources(sources, 'fire');
  }

  drawTowns(viewer) {
    const { ctx } = this;
    const f = this.front;
    for (const t of this.map.towns) {
      const p = this.center(t.i);
      const owner = viewer === null || f.owner[t.i] === viewer ? f.owner[t.i] : f.memory[viewer].owner[t.i];
      const r = t.city ? 6 : 4.5;
      ctx.beginPath();
      ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
      ctx.fillStyle = owner === 0 ? '#5a6b82' : owner === 1 ? '#a8402e' : '#999';
      ctx.fill();
      ctx.strokeStyle = '#1d1a12';
      ctx.lineWidth = 1.3;
      ctx.stroke();
      // Villes de l'objectif : étoile.
      if (f.defTowns?.includes(t.i)) this.star(p.x, p.y - r - 6, 5, '#f2d34f');
    }
  }

  drawPockets(viewer) {
    const { ctx } = this;
    const f = this.front;
    for (const { p, segs } of this.cur.pockets) {
      const s = p.side;
      {
        ctx.strokeStyle = s === 0 ? '#26303d' : '#4a1610';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([5, 4]);
        strokeSegments(ctx, segs);
        ctx.setLineDash([]);
        const own = viewer === null || viewer === s;
        const men = own ? `${(Math.round((p.troops * f.cfg.men) / 100) * 100).toLocaleString('fr-FR')} h` : 'encerclés';
        const label = `Poche ${pocketName(f, p)} · ${men}${p.mode !== 'hold' ? ` · ${POCKET_MODES[p.mode]}` : ''}`;
        const c = this.toWorld({ x: p.cx, y: p.cy });
        ctx.font = '700 10px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(244, 236, 210, 0.9)';
        ctx.strokeText(label, c.x, c.y);
        ctx.fillStyle = '#1d1a12';
        ctx.fillText(label, c.x, c.y);
      }
    }
  }

  // Cotes des objectifs secondaires : petit triangle et nom, à la couleur du camp qui doit les tenir ou les prendre.
  drawObjectiveMarks() {
    const { ctx, cam } = this;
    const px = 1 / cam.s;
    for (const o of this.front.objectives ?? []) {
      if (o.kind !== 'holdCell') continue;
      const c = this.center(o.i);
      const r = 6 * Math.max(1, px);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - r);
      ctx.lineTo(c.x + r * 0.9, c.y + r * 0.6);
      ctx.lineTo(c.x - r * 0.9, c.y + r * 0.6);
      ctx.closePath();
      ctx.fillStyle = 'rgba(250, 240, 210, 0.92)';
      ctx.strokeStyle = SIDE_LINE[o.side];
      ctx.lineWidth = 1.6 * px;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c.x, c.y + r * 0.1, r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = SIDE_LINE[o.side];
      ctx.fill();
      ctx.font = `600 ${10 * Math.max(1, px)}px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3 * Math.max(1, px);
      ctx.strokeStyle = 'rgba(250, 240, 210, 0.85)';
      ctx.strokeText(o.name ?? 'Cote', c.x, c.y + r + 2 * px);
      ctx.fillStyle = SIDE_LINE[o.side];
      ctx.fillText(o.name ?? 'Cote', c.x, c.y + r + 2 * px);
    }
  }

  // Fers de lance blindés de la journée : pour chaque vecteur blindé, les cases que ses chars entraînent (puissance de
  // choc des blindés) et sa tête, la plus avancée le long de l'axe. L'ennemi n'apparaît que là où on le voit.
  spearheads(viewer) {
    const f = this.front;
    const { N } = this.map;
    const cx = f.centers.x, cy = f.centers.y;
    const out = [];
    for (const s of [0, 1]) {
      let n = 0;
      for (const v of f.orders[s]) {
        if (v.type !== 'armor') continue;
        n++;
        const F = f.field[s], T = VECTOR_TYPES.armor;
        const L = Math.hypot(v.to.x - v.from.x, v.to.y - v.from.y) || 1;
        const ux = (v.to.x - v.from.x) / L, uy = (v.to.y - v.from.y) / L;
        const cells = [];
        let best = [];
        for (let i = 0; i < N; i++) {
          if (f.owner[i] !== s || F.atk[i] < ARMOR_ATK || F.w[i] < 0.3 || f.dens[i] < 1) continue;
          if (viewer !== null && s !== viewer && !f.vision[viewer][i]) continue;
          // Seules les cases que ce vecteur entraîne lui-même : son couloir (jusqu'à son extrémité) et sa zone de ramassage.
          const rx = cx[i] - v.from.x, ry = cy[i] - v.from.y;
          const t = rx * ux + ry * uy, perp = Math.abs(rx * -uy + ry * ux);
          if (t > L + 1 || (t >= 0 ? perp > T.sigma * 1.1 : Math.hypot(rx, ry) > T.catch)) continue;
          cells.push(i);
          best.push([t, i]);
        }
        if (!cells.length) continue;
        // Tête : moyenne des trois cases les plus avancées (plus stable qu'une case seule).
        best = best.sort((a, b) => b[0] - a[0]).slice(0, 3);
        const hx = best.reduce((a, [, i]) => a + cx[i], 0) / best.length, hy = best.reduce((a, [, i]) => a + cy[i], 0) / best.length;
        out.push({ side: s, cells, head: { x: hx, y: hy }, ux, uy, from: v.from, name: s === 0 ? `Pz.Gr. ${n}` : `${n}${n === 1 ? 'er' : 'e'} C. blindé` });
      }
    }
    return out;
  }

  // Sillage des formations blindées pendant la journée : les cases prises ou traversées, hachurées.
  armorTrails(viewer) {
    const f = this.front;
    const out = [];
    for (const { a } of visibleArmor(f, viewer)) {
      const cells = a.trail.filter((i) => f.owner[i] === a.side && (viewer === null || a.side === viewer || f.vision[viewer][i]));
      if (cells.length) out.push({ side: a.side, cells, formation: true });
    }
    return out;
  }

  // Formations blindées : coin de chars vus de dessus (un char pour ~35), orientés selon leur marche (ou vers leur
  // objectif le matin), avec poussière quand elles bougent. Le matin, flèche jaune vers l'objectif des siennes.
  drawArmor(view) {
    const f = this.front;
    if (!f.armor) return;
    const { ctx, cam } = this;
    const viewer = view.viewer ?? null;
    const k = SPRITE_K * Math.max(1, 1 / cam.s);
    const px = 1 / cam.s;
    const planning = f.phase === 'plan';
    for (const { a, x, y, dir, tanks, known } of visibleArmor(f, viewer)) {
      const c = this.toWorld({ x, y });
      const own = viewer === null || a.side === viewer;
      const sel = view.armor === a.id;
      let ang = dir;
      if (own && a.target) ang = Math.atan2(a.target.y - y, a.target.x - x);
      if (own && planning && a.target) {
        const t = this.toWorld(a.target);
        ctx.strokeStyle = ORDER_HALO;
        ctx.lineWidth = 6 * px;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(t.x, t.y); ctx.stroke();
        ctx.strokeStyle = ORDER_INK;
        ctx.lineWidth = 3.4 * px;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(t.x, t.y); ctx.stroke();
        const s = 14 * px;
        ctx.beginPath();
        ctx.moveTo(t.x + Math.cos(ang) * 4 * px, t.y + Math.sin(ang) * 4 * px);
        ctx.lineTo(t.x + Math.cos(ang + 2.6) * s, t.y + Math.sin(ang + 2.6) * s);
        ctx.lineTo(t.x + Math.cos(ang - 2.6) * s, t.y + Math.sin(ang - 2.6) * s);
        ctx.closePath();
        ctx.fillStyle = ORDER_INK;
        ctx.fill();
      }
      let n = Math.max(1, Math.min(5, Math.round(tanks / 35)));
      if (cam.s < 1.1) n = Math.min(n, 3);
      const form = [[0, 0], [-10, -9], [-10, 9], [-20, -18], [-20, 18]].slice(0, n);
      const pts = form.map(([fx, fy]) => [c.x + (fx * Math.cos(ang) - fy * Math.sin(ang)) * k + Math.cos(ang) * 8 * k, c.y + (fx * Math.sin(ang) + fy * Math.cos(ang)) * k + Math.sin(ang) * 8 * k]);
      ctx.globalAlpha = known ? 1 : 0.5;
      if (sel) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, 26 * k, 0, Math.PI * 2);
        ctx.strokeStyle = ORDER_INK;
        ctx.lineWidth = 2 * px;
        ctx.stroke();
      }
      const moving = f.phase === 'resolve' && (a.attacking || a.trail.length);
      if (moving) for (const [x2, y2] of pts) dust(ctx, x2, y2, ang, k);
      for (const [x2, y2] of pts) piece(ctx, x2, y2, ang, k, (G, P, sh) => tank(G, P, sh, a.side === 1), SPRITE_PAL[a.side]);
      if (sel || cam.s > 1.2 || f.phase === 'resolve') {
        ctx.font = `700 ${10 * px}px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const ly = c.y + 30 * k;
        ctx.lineWidth = 3 * px;
        ctx.strokeStyle = 'rgba(250, 240, 210, 0.85)';
        ctx.strokeText(a.name, c.x, ly);
        ctx.fillStyle = SIDE_LINE[a.side];
        ctx.fillText(a.name, c.x, ly);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Masse blindée : hachures serrées, de la couleur sombre du camp, sur les cases entraînées par les chars.
  drawSpearMass(spears) {
    if (!spears.length) return;
    const { ctx } = this;
    for (const sp of spears) {
      if (!this.hatch?.[sp.side]) {
        const c = document.createElement('canvas');
        c.width = c.height = 8;
        const g = c.getContext('2d');
        g.strokeStyle = SIDE_LINE[sp.side];
        g.lineWidth = 2.2;
        g.beginPath();
        g.moveTo(-2, 10); g.lineTo(10, -2);
        g.moveTo(-2, 2); g.lineTo(2, -2);
        g.moveTo(6, 10); g.lineTo(10, 6);
        g.stroke();
        this.hatch ??= [];
        this.hatch[sp.side] = ctx.createPattern(c, 'repeat');
      }
      ctx.save();
      ctx.beginPath();
      for (const i of sp.cells) {
        const p = this.toWorld({ x: this.front.centers.x[i], y: this.front.centers.y[i] });
        ctx.moveTo(p.x + CELL * 0.95, p.y);
        ctx.arc(p.x, p.y, CELL * 0.95, 0, Math.PI * 2);
      }
      ctx.clip();
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = this.hatch[sp.side];
      ctx.fillRect(0, 0, this.worldW, this.worldH);
      ctx.restore();
    }
  }

  // Tête de percée : un coin de chars vus de dessus, orienté selon l'axe, qui avance avec la percée et soulève de la
  // poussière ; le nom du groupe en dessous. Le nombre de chars suit les troupes que la percée entraîne.
  drawSpearTips(spears) {
    const { ctx, cam } = this;
    const k = SPRITE_K * Math.max(1, 1 / cam.s);
    for (const sp of spears) {
      const h = this.toWorld(sp.head);
      const ang = Math.atan2(sp.uy, sp.ux);
      let mass = 0;
      for (const i of sp.cells) mass += this.front.dens[i];
      let n = Math.max(2, Math.min(5, Math.round(mass / 60)));
      if (cam.s < 1.1) n = Math.min(n, 3);
      const form = [[0, 0], [-10, -9], [-10, 9], [-20, -18], [-20, 18]].slice(0, n);
      const pts = form.map(([fx, fy]) => [h.x + (fx * Math.cos(ang) - fy * Math.sin(ang)) * k, h.y + (fx * Math.sin(ang) + fy * Math.cos(ang)) * k]);
      for (const [x, y] of pts) dust(ctx, x, y, ang, k);
      for (const [x, y] of pts) piece(ctx, x, y, ang, k, (G, P, sh) => tank(G, P, sh, sp.side === 1), SPRITE_PAL[sp.side]);
      ctx.font = `700 ${10 / cam.s}px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const ly = h.y + (Math.sin(ang) > 0.3 ? -1 : 1) * 30 * k;
      ctx.lineWidth = 3 / cam.s;
      ctx.strokeStyle = 'rgba(250, 240, 210, 0.85)';
      ctx.strokeText(sp.name, h.x - Math.cos(ang) * 10 * k, ly);
      ctx.fillStyle = SIDE_LINE[sp.side];
      ctx.fillText(sp.name, h.x - Math.cos(ang) * 10 * k, ly);
    }
  }

  // Groupes d'artillerie : pièces vues de dessus (drawBattery). Le matin, cercle de portée des siens (marqué pour le groupe
  // sélectionné), trait vers sa destination et vers sa mission. L'ennemi repéré apparaît à sa dernière position vue.
  drawGuns(view) {
    const f = this.front;
    if (!f.guns) return;
    const { ctx, cam } = this;
    const viewer = view.viewer ?? null;
    const px = 1 / cam.s;
    const planning = f.phase === 'plan';
    for (const { g, x, y, known } of visibleGuns(f, viewer)) {
      const c = this.toWorld({ x, y });
      const own = viewer === null || g.side === viewer;
      const sel = view.gun === g.id;
      const K = GUN_KINDS[g.kind];
      if (own && planning) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, K.range * CELL, 0, Math.PI * 2);
        ctx.setLineDash(sel ? [] : [3 * px, 5 * px]);
        ctx.lineWidth = (sel ? 2 : 1) * px;
        ctx.strokeStyle = sel ? ORDER_INK : 'rgba(29, 26, 18, 0.35)';
        ctx.stroke();
        ctx.setLineDash([]);
        if (g.dest) {
          const d = this.toWorld(g.dest);
          ctx.strokeStyle = ORDER_INK;
          ctx.lineWidth = 2 * px;
          ctx.setLineDash([6 * px, 4 * px]);
          ctx.beginPath();
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(d.x, d.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(d.x, d.y, 4 * px, 0, Math.PI * 2);
          ctx.fillStyle = ORDER_INK;
          ctx.fill();
        }
        for (const b of f.barrages[g.side]) {
          if (b.gun !== g.id) continue;
          const t = this.toWorld(b);
          ctx.strokeStyle = 'rgba(255, 210, 63, 0.6)';
          ctx.lineWidth = 1.2 * px;
          ctx.beginPath();
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = known ? 1 : 0.5;
      this.drawBattery(g, c, sel);
      // Nom : au zoom rapproché, ou pour le groupe sélectionné.
      if (sel || cam.s > 1.3) {
        ctx.font = `600 ${10 * px}px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3 * px;
        ctx.strokeStyle = 'rgba(250, 240, 210, 0.85)';
        const ly = c.y + 21 * SPRITE_K * Math.max(1, 1 / cam.s);
        ctx.strokeText(g.name, c.x, ly);
        ctx.fillStyle = SIDE_LINE[g.side];
        ctx.fillText(g.name, c.x, ly);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Un groupe d'artillerie vu de dessus (frontsprites.js). Sa posture se lit : en batterie, pièces ouvertes dans leurs
  // épaulements, face à l'ennemi ; appui mobile, une pièce en position et les autres attelées ; déplacement, colonne
  // de camions qui remorquent les pièces. Le nombre de pièces suit la force du groupe. Taille minimale à l'écran ; au
  // zoom éloigné, deux pièces seulement.
  drawBattery(g, c, sel) {
    const { ctx, cam } = this;
    const P = SPRITE_PAL[g.side];
    const k = SPRITE_K * Math.max(1, 1 / cam.s);
    const face = g.side === 0 ? 0 : Math.PI;
    const moveAng = g.dest ? Math.atan2((g.dest.y - g.y), (g.dest.x - g.x)) : face;
    let n = g.kind === 'mortar' ? 4 : 3;
    n = Math.max(1, Math.ceil(n * g.str - 0.05));
    if (cam.s < 1.1) n = Math.min(n, 2);
    const gap = (g.kind === 'mortar' ? 6 : g.kind === 'rocket' ? 7.5 : 8.5) * k;
    const sprite = g.kind === 'mortar' ? mortar : g.kind === 'rocket' ? rocket : (G, Pl, sh) => howitzer(G, Pl, sh, g.kind === 'heavy' ? 1.3 : 1);
    if (sel) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, (n * gap) / 2 + 8 * k, 0, Math.PI * 2);
      ctx.strokeStyle = ORDER_INK;
      ctx.lineWidth = 2 / cam.s;
      ctx.stroke();
    }
    for (let q = 0; q < n; q++) {
      const emplaced = g.posture === 'battery' || (g.posture === 'mobile' && q === 0);
      if (emplaced) {
        // Ligne de pièces de front, perpendiculaire à la direction de tir.
        const off = (q - (n - 1) / 2) * gap;
        const x = c.x - Math.sin(face) * off, y = c.y + Math.cos(face) * off;
        if (g.kind !== 'rocket') pit(ctx, x, y, face, (g.kind === 'mortar' ? 3.4 : g.kind === 'heavy' ? 6 : 5) * k);
        piece(ctx, x, y, face, k, sprite, P);
      } else {
        // Colonne attelée, dans la direction de marche.
        const back = (q - (g.posture === 'mobile' ? 1 : 0)) * 17 * k;
        const x = c.x - Math.cos(moveAng) * back, y = c.y - Math.sin(moveAng) * back;
        dust(ctx, x, y, moveAng, k);
        piece(ctx, x, y, moveAng, k, g.kind === 'rocket' ? rocket : towed, P);
      }
    }
  }

  // orders : { vectors, lines, barrages } d'un camp (ou un seul élément d'aperçu).
  // Encre jaune cernée de sombre : lisible sur la masse bleue comme sur la rouge, distincte du trait de front.
  drawFrontOrders(orders, viewer, alpha = 1) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    this.paintOrders(orders, ORDER_HALO, 2.4);
    this.paintOrders(orders, ORDER_INK, 0);
    ctx.restore();
  }

  // Un passage du dessin des ordres : halo (extra > 0, traits élargis) ou encre.
  paintOrders(orders, ink, extra) {
    const { ctx } = this;
    const halo = extra > 0;
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    const fill = () => { if (halo) { ctx.lineWidth = extra; ctx.stroke(); } ctx.fill(); };
    for (const b of orders.barrages ?? []) {
      const c = this.toWorld(b);
      const r = b.r * CELL;
      ctx.lineWidth = 2 + extra;
      ctx.setLineDash(halo ? [] : [4, 3]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3, rr = r * (0.35 + 0.15 * (k % 3));
        const x = c.x + Math.cos(a) * rr, y = c.y + Math.sin(a) * rr;
        ctx.beginPath();
        ctx.moveTo(x - 2.5, y - 2.5); ctx.lineTo(x + 2.5, y + 2.5);
        ctx.moveTo(x + 2.5, y - 2.5); ctx.lineTo(x - 2.5, y + 2.5);
        ctx.stroke();
      }
    }
    for (const l of orders.lines ?? []) {
      // Ligne de défense : trait avec dents tournées vers l'ennemi.
      const a = this.toWorld(l.a), b = this.toWorld(l.b);
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
      let nx = -uy, ny = ux;
      if ((l.side === 0 && nx < 0) || (l.side === 1 && nx > 0)) { nx = -nx; ny = -ny; }
      ctx.lineWidth = 2.6 + extra;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      for (let s = 6; s < L - 3; s += 10) {
        const x = a.x + ux * s, y = a.y + uy * s;
        ctx.beginPath();
        ctx.moveTo(x - ux * 3, y - uy * 3);
        ctx.lineTo(x + nx * 5, y + ny * 5);
        ctx.lineTo(x + ux * 3, y + uy * 3);
        ctx.closePath();
        fill();
      }
    }
    for (const v of orders.vectors ?? []) {
      const a = this.toWorld(v.from), b = this.toWorld(v.to);
      const armor = v.type === 'armor', retreat = v.type === 'retreat';
      if (v.type === 'fix') {
        // Fixation : trait droit, hachures en travers et barre en T au bout (on presse, on ne perce pas).
        const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
        ctx.lineWidth = 2.6 + extra;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        for (let t = 8; t < L - 4; t += 9) { const x = a.x + ux * t, y = a.y + uy * t; ctx.moveTo(x - uy * 4, y + ux * 4); ctx.lineTo(x + uy * 4, y - ux * 4); }
        ctx.moveTo(b.x - uy * 11, b.y + ux * 11); ctx.lineTo(b.x + uy * 11, b.y - ux * 11);
        ctx.stroke();
        continue;
      }
      ctx.lineWidth = (armor ? 5 : 3) + extra;
      ctx.setLineDash((retreat || v.pocket) && !halo ? [8, 5] : []);
      // Flèche légèrement courbe, comme tracée à main levée.
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const bend = Math.min(18, L * 0.08);
      const pts = [a, { x: mx - ((b.y - a.y) / L) * bend, y: my + ((b.x - a.x) / L) * bend }, b];
      ctx.beginPath();
      splineTo(ctx, pts);
      ctx.stroke();
      ctx.setLineDash([]);
      if (armor && !halo) {
        // Double trait des blindés.
        ctx.strokeStyle = ORDER_HALO;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        splineTo(ctx, pts);
        ctx.stroke();
        ctx.strokeStyle = ink;
      }
      const ang = Math.atan2(b.y - pts[1].y, b.x - pts[1].x);
      const size = armor ? 16 : 12;
      ctx.beginPath();
      ctx.moveTo(b.x + Math.cos(ang) * 4, b.y + Math.sin(ang) * 4);
      ctx.lineTo(b.x + Math.cos(ang + 2.6) * size, b.y + Math.sin(ang + 2.6) * size);
      ctx.lineTo(b.x + Math.cos(ang - 2.6) * size, b.y + Math.sin(ang - 2.6) * size);
      ctx.closePath();
      fill();
    }
  }
}

export { blobPath };
