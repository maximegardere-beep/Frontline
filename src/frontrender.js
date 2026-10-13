// Rendu du front stratégique. La micro-grille reste la vérité du jeu ; le rendu en tire des champs continus :
// - terrain (une fois par bataille) : relief lissé, teintes et ombrage, courbes de niveau, forêts, marais,
//   montagnes hachurées, villes ;
// - masses de troupes (à chaque tick, interpolées entre deux ticks) : chaque camp est une masse colorée, plus
//   opaque où il est dense ; des contours de densité font apparaître les concentrations qui fusionnent
//   (métaballes) ; le front est la ligne de partage, épaisse et sombre ;
// - brouillard : l'ennemi est dessiné d'après ce que le joueur en sait (densité estimée), estompé hors de vue ;
// - ordres au crayon rouge, poches, villes.

import { Renderer, splineTo, blobPath, contourSegments, strokeSegments, ELEV_STOPS, PALETTE } from './render.js';
import { hexToPixel, pixelToHex, SQRT3 } from './hex.js';
import { createRng } from './rng.js';
import { makeNoise } from './mapgen.js';
import { FRONT_KINDS } from './terrain.js';
import { FRONT_WEATHER, POCKET_MODES, pocketName } from './front.js';

export const CELL = 9; // rayon d'une case de la micro-grille, en pixels monde

const K = Object.fromEntries(FRONT_KINDS.map((k, i) => [k, i]));
const SIDE_RGB = [[52, 84, 138], [178, 42, 30]]; // Wehrmacht, Armée rouge
const SIDE_LINE = ['#26303d', '#4a1610'];

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

const lerp = (a, b, t) => a + (b - a) * t;

export class FrontRenderer extends Renderer {
  setMap(front) {
    this.front = front;
    this.map = front.map;
    this.worldW = Math.ceil((this.map.W + 0.5) * CELL * SQRT3);
    this.worldH = Math.ceil((this.map.H - 1) * 1.5 * CELL + 2 * CELL);
    this.cache = {};
    this.wrecks = [];
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

  initialView(side) {
    if (this.vw >= 760) return this.fitAll();
    this.cam.s = Math.max(this.fitScale(), Math.min(1.1, this.vh / this.worldH));
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

    // 4. Végétation, marais, montagnes, villes.
    for (let c = 0; c < map.N; c++) {
      const p = this.center(c), k = map.kind[c];
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
        for (let t = 0; t < 4; t++) {
          const hx = p.x + (r.next() - 0.5) * CELL * 1.3, hy = p.y + (r.next() - 0.5) * CELL * 1.2;
          ctx.fillStyle = PALETTE.house;
          ctx.fillRect(hx - 2.2, hy - 1.8, 4.4, 3.6);
          ctx.fillStyle = PALETTE.roof;
          ctx.fillRect(hx - 2.2, hy - 1.8, 4.4, 1.5);
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
      o[s] = lerp(a.owner[s], b.owner[s], t);
      dA[s] = lerp(a.dA[s], b.dA[s], t);
      dB[s] = lerp(a.dB[s], b.dB[s], t);
      const open = lerp(a.open[s], b.open[s], t);
      const vis = lerp(a.vis[s], b.vis[s], t);
      const de = o[s] >= 0.5;
      const d = de ? dA[s] / Math.max(0.05, o[s]) : dB[s] / Math.max(0.05, 1 - o[s]);
      const rgb = SIDE_RGB[de ? 0 : 1];
      const enemy = b.viewer !== null && (de ? 0 : 1) !== b.viewer;
      // Opacité : la masse s'épaissit avec la densité ; hors de vue, l'ennemi n'est qu'une estimation estompée.
      // Teinte de base du territoire, renforcée par la densité (les masses du front).
      let alpha = (0.3 + 0.45 * (1 - Math.exp(-d / 7))) * Math.min(1, open * 1.3);
      if (enemy) alpha *= 0.6 + 0.4 * vis;
      px[s * 4] = rgb[0];
      px[s * 4 + 1] = rgb[1];
      px[s * 4 + 2] = rgb[2];
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

    // Ligne de front : partage des deux camps, épaisse et sombre.
    const line = contourSegments(fields.o, 0.5);
    ctx.strokeStyle = 'rgba(250, 240, 210, 0.55)';
    ctx.lineWidth = 4.5;
    strokeSegments(ctx, line);
    ctx.strokeStyle = '#1d1a12';
    ctx.lineWidth = 2.4;
    strokeSegments(ctx, line);

    this.drawTowns(view.viewer ?? null);
    this.drawPockets(view.viewer ?? null);
    if (view.orders) this.drawFrontOrders(view.orders, view.viewer);
    if (view.preview) this.drawFrontOrders(view.preview, view.viewer, 0.55);
    if (view.origin != null && view.origin >= 0) {
      const p = this.center(view.origin);
      ctx.beginPath();
      ctx.arc(p.x, p.y, CELL * 1.6, 0, Math.PI * 2);
      ctx.strokeStyle = PALETTE.pencil;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
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

  // orders : { vectors, lines, barrages } d'un camp (ou un seul élément d'aperçu).
  drawFrontOrders(orders, viewer, alpha = 1) {
    const { ctx } = this;
    const pencil = PALETTE.pencil;
    ctx.save();
    ctx.globalAlpha = alpha;
    for (const b of orders.barrages ?? []) {
      const c = this.toWorld(b);
      const r = b.r * CELL;
      ctx.strokeStyle = pencil;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
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
      ctx.strokeStyle = pencil;
      ctx.fillStyle = pencil;
      ctx.lineWidth = 2.6;
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
        ctx.fill();
      }
    }
    for (const v of orders.vectors ?? []) {
      const a = this.toWorld(v.from), b = this.toWorld(v.to);
      const armor = v.type === 'armor', retreat = v.type === 'retreat';
      ctx.strokeStyle = pencil;
      ctx.fillStyle = pencil;
      ctx.lineWidth = armor ? 5 : 3;
      ctx.setLineDash(retreat || v.pocket ? [8, 5] : []);
      // Flèche légèrement courbe, comme tracée à main levée.
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const bend = Math.min(18, L * 0.08);
      const pts = [a, { x: mx - ((b.y - a.y) / L) * bend, y: my + ((b.x - a.x) / L) * bend }, b];
      ctx.beginPath();
      splineTo(ctx, pts);
      ctx.stroke();
      ctx.setLineDash([]);
      if (armor) {
        // Double trait des blindés.
        ctx.strokeStyle = 'rgba(250, 240, 220, 0.85)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        splineTo(ctx, pts);
        ctx.stroke();
      }
      const ang = Math.atan2(b.y - pts[1].y, b.x - pts[1].x);
      const size = armor ? 16 : 12;
      ctx.beginPath();
      ctx.moveTo(b.x + Math.cos(ang) * 4, b.y + Math.sin(ang) * 4);
      ctx.lineTo(b.x + Math.cos(ang + 2.6) * size, b.y + Math.sin(ang + 2.6) * size);
      ctx.lineTo(b.x + Math.cos(ang - 2.6) * size, b.y + Math.sin(ang - 2.6) * size);
      ctx.fill();
    }
    ctx.restore();
  }
}

export { blobPath };
