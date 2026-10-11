// Rendu Canvas : carte topographique (pré-calculée), brouillard, ordres, unités (pions OTAN), effets de combat.

import { hexToPixel, pixelToHex, hexCorner, edgeCorners, neighborCoords, SQRT3, hexDistance, toCube, fromCube } from './hex.js';
import { tileAt, roadEdgeKey } from './terrain.js';
import { createRng } from './rng.js';
import { unitStats } from './units.js';
import { onMap, retreatCol, deployZone } from './game.js';

export const HEX = 30;

const C = {
  elev: ['#c8cf9f', '#dcd5a3', '#d0b985', '#b9996a'],
  contour: 'rgba(110, 72, 34, 0.75)',
  grid: 'rgba(80, 70, 40, 0.16)',
  forest: '#86a062',
  tree: '#3d5a2a',
  marsh: '#4f7d97',
  farmA: '#e6d27f',
  farmB: '#cbb75e',
  river: '#3f7cab',
  riverHi: '#8fbfe0',
  roadLo: '#5b351d',
  roadHi: '#e8b45a',
  house: '#6b4a32',
  roof: '#9b3b26',
  label: '#2d2414',
  halo: 'rgba(244, 236, 210, 0.85)',
  fog: 'rgba(38, 40, 26, 0.34)',
  pencil: '#b3261e',
  DE: { fill: '#9aa6ad', edge: '#2c3439', zone: 'rgba(70, 90, 110, 0.18)' },
  SU: { fill: '#b45a43', edge: '#3d150c', zone: 'rgba(150, 50, 30, 0.16)' },
};

function hexPath(ctx, cx, cy, s) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const p = hexCorner(cx, cy, s, i);
    i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
  }
  ctx.closePath();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = null;
    this.layer = null;
  }

  setMap(map) {
    this.map = map;
    this.width = Math.ceil((map.W + 0.5) * HEX * SQRT3);
    this.height = Math.ceil((map.H - 1) * 1.5 * HEX + 2 * HEX);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.aspectRatio = `${this.width} / ${this.height}`;
    this.buildTerrain();
  }

  center(h) { return hexToPixel(h.col, h.row, HEX); }

  hexAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * this.width;
    const y = ((clientY - r.top) / r.height) * this.height;
    const h = pixelToHex(x, y, HEX);
    return tileAt(this.map, h.col, h.row) ? h : null;
  }

  buildTerrain() {
    const map = this.map;
    const off = document.createElement('canvas');
    off.width = this.canvas.width;
    off.height = this.canvas.height;
    const ctx = off.getContext('2d');
    ctx.scale(this.dpr, this.dpr);
    ctx.fillStyle = C.elev[1];
    ctx.fillRect(0, 0, this.width, this.height);

    // Teintes hypsométriques + ombrage (lumière venant du nord-ouest).
    for (const t of map.tiles) {
      const { x, y } = this.center(t);
      hexPath(ctx, x, y, HEX + 0.6);
      ctx.fillStyle = C.elev[t.elev];
      ctx.fill();
      const nw = neighborCoords(t.col, t.row)[2], se = neighborCoords(t.col, t.row)[5];
      const a = tileAt(map, nw.col, nw.row)?.elev ?? t.elev, b = tileAt(map, se.col, se.row)?.elev ?? t.elev;
      const slope = b - a;
      if (slope) {
        ctx.fillStyle = slope > 0 ? `rgba(255,250,225,${0.1 * Math.min(2, slope)})` : `rgba(60,40,10,${0.08 * Math.min(2, -slope)})`;
        ctx.fill();
      }
    }

    // Couverture du sol.
    for (const t of map.tiles) {
      const { x, y } = this.center(t);
      const r = createRng(t.row * 1000 + t.col + 7);
      if (t.terrain === 'farm') {
        ctx.save();
        hexPath(ctx, x, y, HEX - 2);
        ctx.clip();
        ctx.translate(x, y);
        ctx.rotate(r.next() * Math.PI);
        for (let i = -4; i < 4; i++) {
          ctx.fillStyle = i % 2 ? C.farmA : C.farmB;
          ctx.globalAlpha = 0.75;
          ctx.fillRect(-HEX, i * 8, HEX * 2, 8);
        }
        ctx.restore();
      } else if (t.terrain === 'forest') {
        hexPath(ctx, x, y, HEX + 0.5);
        ctx.fillStyle = C.forest;
        ctx.globalAlpha = 0.8;
        ctx.fill();
        ctx.globalAlpha = 1;
        for (let i = 0; i < 9; i++) {
          const a = r.next() * Math.PI * 2, d = Math.sqrt(r.next()) * HEX * 0.72;
          const tx = x + Math.cos(a) * d, ty = y + Math.sin(a) * d;
          ctx.beginPath();
          ctx.arc(tx, ty, 3.2 + r.next() * 2.2, 0, Math.PI * 2);
          ctx.fillStyle = C.tree;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(tx - 1, ty - 1, 1.3, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(200,220,150,0.45)';
          ctx.fill();
        }
      } else if (t.terrain === 'marsh') {
        ctx.strokeStyle = C.marsh;
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 7; i++) {
          const mx = x + (r.next() - 0.5) * HEX * 1.2, my = y + (r.next() - 0.5) * HEX * 1.1;
          ctx.beginPath();
          ctx.moveTo(mx - 5, my);
          ctx.lineTo(mx + 5, my);
          ctx.moveTo(mx - 2, my - 1);
          ctx.lineTo(mx - 3, my - 5);
          ctx.moveTo(mx + 1, my - 1);
          ctx.lineTo(mx + 2, my - 5);
          ctx.stroke();
        }
      }
    }

    // Courbes de niveau : arêtes entre hexagones d'altitudes différentes.
    ctx.lineCap = 'round';
    for (const t of map.tiles) {
      const { x, y } = this.center(t);
      neighborCoords(t.col, t.row).forEach((n, d) => {
        const nt = tileAt(map, n.col, n.row);
        if (!nt || nt.elev >= t.elev) return;
        const [i, j] = edgeCorners(d);
        const p = hexCorner(x, y, HEX, i), q = hexCorner(x, y, HEX, j);
        ctx.strokeStyle = C.contour;
        ctx.lineWidth = t.elev - nt.elev > 1 ? 2.4 : 1.4;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      });
    }

    // Rivières : courbe lissée passant par les centres.
    for (const path of map.rivers) {
      const pts = path.map((h) => this.center(h));
      const first = pts[0], last = pts[pts.length - 1];
      pts.unshift({ x: first.x, y: first.y < this.height / 2 ? 0 : this.height });
      pts.push({ x: last.x, y: last.y < this.height / 2 ? 0 : this.height });
      for (const [w, c] of [[9, C.river], [3, C.riverHi]]) {
        ctx.strokeStyle = c;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
      }
    }

    // Routes.
    const edges = [...map.roadEdges].map((k) => k.split('|').map(Number));
    for (const [w, c] of [[5, C.roadLo], [2.2, C.roadHi]]) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      for (const [i, j] of edges) {
        const a = this.center(map.tiles[i]), b = this.center(map.tiles[j]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    for (const t of map.tiles) {
      if (!(t.river && t.road)) continue;
      const { x, y } = this.center(t);
      ctx.fillStyle = '#3a2a1c';
      ctx.fillRect(x - 7, y - 5, 14, 10);
      ctx.fillStyle = C.roadHi;
      ctx.fillRect(x - 6, y - 2, 12, 4);
    }

    // Villages.
    for (const t of map.villages) {
      const { x, y } = this.center(t);
      const r = createRng(t.col * 31 + t.row * 977);
      for (let i = 0; i < 7; i++) {
        const hx = x + (r.next() - 0.5) * HEX * 1.15, hy = y + (r.next() - 0.5) * HEX * 0.95;
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate((r.next() - 0.5) * 0.8);
        ctx.fillStyle = C.house;
        ctx.fillRect(-4.5, -3.5, 9, 7);
        ctx.fillStyle = C.roof;
        ctx.fillRect(-4.5, -3.5, 9, 3);
        ctx.restore();
      }
    }

    // Quadrillage discret.
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (const t of map.tiles) {
      const { x, y } = this.center(t);
      hexPath(ctx, x, y, HEX);
      ctx.stroke();
    }

    // Noms des villages.
    ctx.font = '600 11px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    for (const t of map.villages) {
      const { x, y } = this.center(t);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = C.halo;
      ctx.strokeText(t.name, x, y + HEX * 0.95);
      ctx.fillStyle = C.label;
      ctx.fillText(t.name, x, y + HEX * 0.95);
    }
    this.layer = off;
  }

  draw(view) {
    const { ctx, map } = this;
    const { state, side } = view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const vis = state.visibility[side];
    const reveal = state.phase === 'over';

    // Zones de repli (bords de carte) et zone de déploiement.
    for (const s of ['DE', 'SU']) {
      const col = retreatCol(state, s);
      for (let row = 0; row < map.H; row++) {
        const { x, y } = this.center({ col, row });
        hexPath(ctx, x, y, HEX);
        ctx.fillStyle = C[s].zone;
        ctx.fill();
      }
    }
    if (state.phase === 'deploy') {
      for (const col of deployZone(state, side)) {
        for (let row = 0; row < map.H; row++) {
          const { x, y } = this.center({ col, row });
          hexPath(ctx, x - 0, y, HEX - 3);
          ctx.strokeStyle = 'rgba(179, 38, 30, 0.55)';
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // Brouillard de guerre.
    if (!reveal) {
      ctx.fillStyle = C.fog;
      for (const t of map.tiles) {
        if (vis.hexes.has(t.row * map.W + t.col)) continue;
        const { x, y } = this.center(t);
        hexPath(ctx, x, y, HEX + 0.6);
        ctx.fill();
      }
    }

    // Objectif.
    if (state.objective) {
      const { x, y } = this.center(state.objective);
      const owner = state.objective.owner;
      hexPath(ctx, x, y, HEX - 2);
      ctx.strokeStyle = owner ? C[owner].edge : C.pencil;
      ctx.lineWidth = 3;
      ctx.stroke();
      this.star(x, y - HEX * 0.62, 7, owner ? C[owner].fill : '#f2d34f');
    }

    // Hexagones accessibles, portée d'artillerie.
    if (view.reach) {
      ctx.fillStyle = 'rgba(255, 248, 220, 0.32)';
      for (const k of view.reach.keys()) {
        const h = { col: k % map.W, row: Math.floor(k / map.W) };
        const { x, y } = this.center(h);
        hexPath(ctx, x, y, HEX - 1.5);
        ctx.fill();
      }
    }
    if (view.rangeOf) {
      const u = view.rangeOf;
      const s = unitStats(u);
      ctx.fillStyle = 'rgba(179, 38, 30, 0.13)';
      for (const t of map.tiles) {
        const d = hexDistance(u, t);
        if (d < s.minRange || d > s.range) continue;
        const { x, y } = this.center(t);
        hexPath(ctx, x, y, HEX - 1.5);
        ctx.fill();
      }
    }
    if (view.hover) {
      const { x, y } = this.center(view.hover);
      hexPath(ctx, x, y, HEX - 1);
      ctx.strokeStyle = 'rgba(40, 30, 10, 0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Ordres du joueur, au crayon rouge.
    if (!view.anim) {
      for (const u of state.units) {
        if (u.side !== side || !onMap(u)) continue;
        this.drawOrders(u, u.id === view.selectedId);
      }
    }

    // Dernières positions connues de l'ennemi (fantômes) avec le mouvement observé.
    if (!reveal) {
      for (const [id, m] of Object.entries(state.memory[side])) {
        if (vis.units.has(id) || (view.animVisible && view.animVisible.has(id))) continue;
        this.drawGhost(m, state.turn - m.turn);
      }
    }

    // Unités.
    for (const u of state.units) {
      const snap = view.anim?.pos[u.id];
      if (view.anim ? !snap : !onMap(u)) continue;
      if (u.side !== side && !reveal) {
        const seen = view.anim ? view.animVisible.has(u.id) : vis.units.has(u.id);
        if (!seen) continue;
      }
      const p = snap ? { x: snap.x, y: snap.y } : this.center(u);
      const status = snap ? snap.status : u.status;
      const hp = view.anim?.hp?.[u.id] ?? u.hp;
      this.drawCounter(u, p.x, p.y, { selected: u.id === view.selectedId, status, hp });
    }

    if (view.fx) this.drawEffects(view.fx);
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

  drawOrders(u, selected) {
    const { ctx } = this;
    const o = u.orders;
    ctx.save();
    ctx.globalAlpha = selected ? 1 : 0.75;
    if (o.path.length) {
      const pts = [this.center(u), ...o.path.map((h) => this.center(h))];
      ctx.strokeStyle = C.pencil;
      ctx.lineWidth = selected ? 3 : 2.2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
      const a = pts[pts.length - 2], b = pts[pts.length - 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.fillStyle = C.pencil;
      ctx.beginPath();
      ctx.moveTo(b.x + Math.cos(ang) * 4, b.y + Math.sin(ang) * 4);
      ctx.lineTo(b.x + Math.cos(ang + 2.6) * 11, b.y + Math.sin(ang + 2.6) * 11);
      ctx.lineTo(b.x + Math.cos(ang - 2.6) * 11, b.y + Math.sin(ang - 2.6) * 11);
      ctx.fill();
    }
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
      ctx.beginPath();
      ctx.arc(b.x, b.y, HEX * 0.55, 0, Math.PI * 2);
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
      const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(ang) * w * 0.5, y + Math.sin(ang) * h * 0.5);
      ctx.lineTo(ex, ey);
      ctx.lineTo(ex - Math.cos(ang - 0.5) * 8, ey - Math.sin(ang - 0.5) * 8);
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(ang + 0.5) * 8, ey - Math.sin(ang + 0.5) * 8);
      ctx.stroke();
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
    }
  }

  drawCounter(u, x, y, { selected, status, hp }) {
    const { ctx } = this;
    const s = unitStats(u);
    const w = HEX * 1.3, h = HEX * 0.95;
    const col = C[u.side];
    ctx.save();
    if (status === 'routed') {
      ctx.translate(x, y);
      ctx.rotate(-0.25);
      ctx.translate(-x, -y);
      ctx.globalAlpha = 0.8;
    }
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
      ctx.shadowColor = '#ffe680';
      ctx.shadowBlur = 14;
    }
    ctx.fillStyle = 'rgba(30,20,10,0.35)';
    ctx.fillRect(x - w / 2 + 2, y - h / 2 + 3, w, h);
    ctx.fillStyle = col.fill;
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = selected ? '#fff2a8' : col.edge;
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = '#f3ecd6';
    ctx.fillRect(x - w * 0.3, y - h * 0.36, w * 0.6, h * 0.5);
    this.symbol(u.type, x, y - h * 0.11, w * 0.6, h * 0.5, '#1d1a12');
    // Chevrons d'expérience.
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
    // Barre de PV.
    const ratio = Math.max(0, hp / s.maxHp);
    ctx.fillStyle = 'rgba(20,15,5,0.55)';
    ctx.fillRect(x - w * 0.42, y + h * 0.24, w * 0.84, 4);
    ctx.fillStyle = ratio > 0.6 ? '#7fbf4d' : ratio > 0.3 ? '#e2b33c' : '#d4462f';
    ctx.fillRect(x - w * 0.42, y + h * 0.24, w * 0.84 * ratio, 4);
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

  drawEffects(fx) {
    const { ctx } = this;
    for (const f of fx) {
      const a = this.center(f.from), b = this.center(f.to);
      const t = f.t;
      if (t <= 0) continue;
      if (t < 0.45) {
        const k = t / 0.45;
        ctx.strokeStyle = f.indirect ? 'rgba(255, 200, 90, 0.9)' : 'rgba(255, 240, 160, 0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (f.indirect) {
          const mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - 60;
          const px = (1 - k) ** 2 * a.x + 2 * (1 - k) * k * mx + k * k * b.x;
          const py = (1 - k) ** 2 * a.y + 2 * (1 - k) * k * my + k * k * b.y;
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#ffd36a';
          ctx.fill();
        } else {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
          ctx.stroke();
        }
      } else {
        const k = (t - 0.45) / 0.55;
        const hits = f.empty ? 2 : Math.max(1, f.hits ?? 0);
        for (let i = 0; i < Math.min(5, hits); i++) {
          const ox = Math.cos(i * 2.4) * 9 * (i ? 1 : 0), oy = Math.sin(i * 2.4) * 7 * (i ? 1 : 0);
          ctx.beginPath();
          ctx.arc(b.x + ox, b.y + oy, 5 + k * 14, 0, Math.PI * 2);
          ctx.fillStyle = f.damage || f.empty ? `rgba(255, 140, 40, ${0.75 * (1 - k)})` : `rgba(230, 230, 210, ${0.6 * (1 - k)})`;
          ctx.fill();
        }
        if (!f.empty) {
          ctx.font = '700 15px "IBM Plex Mono", monospace';
          ctx.textAlign = 'center';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(20,15,5,0.85)';
          const txt = f.damage ? `−${f.damage}` : 'raté';
          ctx.strokeText(txt, b.x, b.y - 18 - k * 14);
          ctx.fillStyle = f.damage ? '#ffcf5a' : '#e8e2cc';
          ctx.fillText(txt, b.x, b.y - 18 - k * 14);
        }
      }
    }
  }
}
