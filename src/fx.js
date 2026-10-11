// Effets de combat : tirs, obus, explosions, fumée ; puis traces durables (cratères, brûlures, ornières, épaves).
// Tout est calculé à l'avance à partir d'une graine : une image ne dépend que du temps écoulé.

import { createRng } from './rng.js';

const G = 700; // gravité des débris, en hauteur simulée (px/s²)
const WIND = { x: 16, y: -7 }; // dérive de la fumée (px/s)

const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (k) => Math.max(0, Math.min(1, k));

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
}

function makeBlast(rng, x, y, t0, size, { kill = false } = {}) {
  const debris = Array.from({ length: Math.round(size * (kill ? 1.1 : 0.7)) }, () => ({
    ang: rng.next() * Math.PI * 2,
    sp: 20 + rng.next() * size * 4,
    vz: 90 + rng.next() * size * 13,
    sz: 1 + rng.next() * (kill ? 2.6 : 1.8),
  }));
  const smoke = Array.from({ length: kill ? 7 : 4 }, () => ({
    dx: (rng.next() - 0.5) * size * 1.6,
    dy: (rng.next() - 0.5) * size * 1.2,
    r: size * (0.5 + rng.next() * 0.45),
    delay: 0.06 + rng.next() * 0.25,
    life: (kill ? 1.8 : 1.1) + rng.next() * 0.5,
  }));
  return { k: 'blast', x, y, t0, size, life: kill ? 2.4 : 1.7, debris, smoke, kill };
}

// fires : [{ a, b (centres en px), type, indirect, hidden, dice, hits, damage, empty, kill }]
export function buildCombatFx(fires, seed) {
  const rng = createRng(seed);
  const items = [];
  const jit = (p, r) => ({ x: p.x + (rng.next() - 0.5) * 2 * r, y: p.y + (rng.next() - 0.5) * 2 * r });
  fires.forEach((f, i) => {
    const t0 = (i % 7) * 0.17 + rng.next() * 0.12;
    const { a, b } = f;
    const dx = a.x - b.x, dy = a.y - b.y, len = Math.hypot(dx, dy) || 1;
    // Tireur invisible : on ne voit que l'arrivée du feu, depuis sa direction.
    const src = f.hidden ? { x: b.x + (dx / len) * 34, y: b.y + (dy / len) * 34 } : a;
    let impact = t0;
    let lastImpact = t0;

    if (f.type === 'artillery' && f.indirect) {
      const n = f.empty ? 3 : Math.max(2, Math.min(4, Math.ceil(f.dice / 2)));
      for (let j = 0; j < n; j++) {
        const tt = t0 + j * 0.15 + rng.next() * 0.05;
        if (!f.hidden) {
          items.push({ k: 'flash', ...jit(a, 4), t0: tt, life: 0.14, r: 15 });
          items.push({ k: 'puff', ...jit(a, 5), t0: tt + 0.03, life: 1.1, r: 7, color: [200, 195, 180] });
        }
        const from = f.hidden ? { x: b.x + (dx / len) * 90, y: b.y - 150 } : a;
        const to = jit(b, f.empty ? 22 : 14);
        const flight = f.hidden ? 0.35 : 0.5 + Math.min(0.25, len / 900);
        items.push({ k: 'shell', ax: from.x, ay: from.y, bx: to.x, by: to.y, t0: tt, life: flight, arc: f.hidden ? 0 : 50 + len * 0.18 });
        const hit = j < Math.max(1, f.hits);
        items.push(makeBlast(rng, to.x, to.y, tt + flight, hit && !f.empty ? 20 : 16));
        if (j === 0) impact = tt + flight;
        lastImpact = tt + flight;
      }
    } else if (f.type === 'tank' || f.type === 'artillery') {
      const n = f.dice > 5 ? 2 : 1;
      for (let j = 0; j < n; j++) {
        const tt = t0 + j * 0.32;
        if (!f.hidden) {
          items.push({ k: 'flash', ...a, t0: tt, life: 0.12, r: 16 });
          items.push({ k: 'puff', ...jit(a, 3), t0: tt + 0.02, life: 0.9, r: 8, color: [215, 210, 195] });
        }
        const hit = j < f.hits;
        const to = jit(b, hit ? 7 : 18);
        items.push({ k: 'tracer', ax: src.x, ay: src.y, bx: to.x, by: to.y, t0: tt, life: 0.12, heavy: true });
        if (hit) items.push(makeBlast(rng, to.x, to.y, tt + 0.12, 13));
        else items.push({ k: 'dust', ...to, t0: tt + 0.12, life: 1, r: 12 });
        if (j === 0) impact = tt + 0.12;
        lastImpact = tt + 0.12;
      }
    } else {
      // Armes légères : rafales de traçantes, poussière et étincelles à l'arrivée.
      const n = Math.max(3, Math.min(7, f.dice + 1));
      for (let j = 0; j < n; j++) {
        const tt = t0 + j * 0.075 + rng.next() * 0.04;
        if (!f.hidden) items.push({ k: 'flash', ...jit(a, 6), t0: tt, life: 0.07, r: 7 });
        const to = jit(b, 10);
        items.push({ k: 'tracer', ax: src.x, ay: src.y, bx: to.x, by: to.y, t0: tt, life: 0.16 });
        items.push({ k: 'spark', ...to, t0: tt + 0.16, life: 0.4, hit: j < f.hits });
        lastImpact = tt + 0.16;
      }
      impact = t0 + 0.16;
    }

    if (f.kill) {
      const tk = lastImpact + 0.15;
      items.push(makeBlast(rng, b.x, b.y, tk, 30, { kill: true }));
      items.push({ k: 'fire', ...b, t0: tk + 0.1, life: 1.6 });
    }
    if (!f.empty) items.push({ k: 'text', ...b, t0: impact, life: 1.1, txt: f.damage ? `−${f.damage}` : 'raté', hit: f.damage > 0 });
  });
  const duration = items.reduce((m, it) => Math.max(m, it.t0 + it.life), 0);
  return { items, duration };
}

// Secousse de la carte : brève, seulement pour les grosses explosions.
export function fxShake(fx, T) {
  let amp = 0;
  for (const it of fx.items) {
    if (it.k !== 'blast' || it.size < 16) continue;
    const l = T - it.t0;
    if (l >= 0 && l < 0.3) amp += (it.size / 20) * 1.8 * (1 - l / 0.3);
  }
  amp = Math.min(amp, 5);
  return { x: Math.sin(T * 93) * amp, y: Math.cos(T * 71) * amp };
}

function drawSmokePuff(ctx, x, y, r, alpha, dark = 0.5) {
  const c = Math.round(lerp(150, 55, dark));
  ctx.fillStyle = `rgba(${c}, ${c - 4}, ${c - 12}, ${alpha})`;
  circle(ctx, x, y, r);
  ctx.fill();
  ctx.fillStyle = `rgba(${c + 50}, ${c + 46}, ${c + 36}, ${alpha * 0.45})`;
  circle(ctx, x - r * 0.22, y - r * 0.28, r * 0.62);
  ctx.fill();
}

function drawBlastSmoke(ctx, it, l) {
  for (const p of it.smoke) {
    const lt = l - p.delay;
    if (lt < 0 || lt > p.life) continue;
    const k = lt / p.life;
    const r = p.r * (0.6 + 1.5 * Math.sqrt(k));
    const a = 0.55 * (1 - k) * Math.min(1, lt * 6);
    drawSmokePuff(ctx, it.x + p.dx * (0.4 + k) + WIND.x * lt, it.y + p.dy * (0.4 + k) + WIND.y * lt - lt * 8, r, a, it.kill ? 0.85 : 0.55);
  }
}

function drawBlast(ctx, it, l) {
  const s = it.size;
  if (l < 0.08) {
    ctx.fillStyle = `rgba(255, 252, 225, ${0.9 * (1 - l / 0.08)})`;
    circle(ctx, it.x, it.y, s * 1.4);
    ctx.fill();
  }
  if (l < 0.7) {
    const k = l / 0.7;
    const r = s * (0.55 + 0.75 * Math.sqrt(k));
    const a = 1 - k * k;
    const g = ctx.createRadialGradient(it.x, it.y - k * 4, 0, it.x, it.y - k * 4, r);
    g.addColorStop(0, `rgba(255, 255, 215, ${a})`);
    g.addColorStop(0.3, `rgba(255, 205, 85, ${a})`);
    g.addColorStop(0.7, `rgba(225, 85, 25, ${a * 0.8})`);
    g.addColorStop(1, 'rgba(110, 35, 10, 0)');
    ctx.fillStyle = g;
    circle(ctx, it.x, it.y - k * 4, r);
    ctx.fill();
  }
  if (l < 0.4) {
    const k = l / 0.4;
    ctx.strokeStyle = `rgba(255, 238, 200, ${(1 - k) * 0.55})`;
    ctx.lineWidth = 1 + 2.5 * (1 - k);
    circle(ctx, it.x, it.y, s * (0.6 + 2.3 * k));
    ctx.stroke();
  }
  ctx.fillStyle = '#2e2418';
  for (const d of it.debris) {
    const z = d.vz * l - 0.5 * G * l * l;
    if (z < 0) continue;
    const x = it.x + Math.cos(d.ang) * d.sp * l, y = it.y + Math.sin(d.ang) * d.sp * l * 0.7;
    ctx.fillRect(x - d.sz / 2, y - z - d.sz / 2, d.sz, d.sz);
  }
}

function drawFire(ctx, it, l, T) {
  const k = l / it.life;
  const fade = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
  for (let i = 0; i < 5; i++) {
    const ph = T * 9 + i * 1.7;
    const fx = it.x + Math.sin(i * 2.1) * 6, fy = it.y + Math.cos(i * 1.3) * 4;
    const r = (4 + Math.sin(ph) * 1.6) * fade;
    ctx.fillStyle = `rgba(255, ${140 + i * 18}, 40, ${0.75 * fade})`;
    circle(ctx, fx, fy - 3 - Math.abs(Math.sin(ph * 0.7)) * 3, r);
    ctx.fill();
  }
}

function pointOnShell(it, k) {
  return { x: lerp(it.ax, it.bx, k), y: lerp(it.ay, it.by, k) - it.arc * 4 * k * (1 - k) };
}

// Image des effets au temps T (secondes depuis le début du combat).
export function drawFx(ctx, fx, T) {
  ctx.save();
  ctx.lineCap = 'round';
  // 1. Fumées sous le reste.
  for (const it of fx.items) {
    const l = T - it.t0;
    if (l < 0 || l > it.life) continue;
    if (it.k === 'blast') drawBlastSmoke(ctx, it, l);
    else if (it.k === 'puff' || it.k === 'dust') {
      const k = l / it.life;
      const [r, g, b] = it.color ?? [165, 140, 100];
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(it.k === 'dust' ? 0.6 : 0.5) * (1 - k)})`;
      circle(ctx, it.x + WIND.x * l, it.y + WIND.y * l - (it.k === 'dust' ? 6 * k : 0), it.r * (0.5 + 1.2 * Math.sqrt(k)));
      ctx.fill();
    } else if (it.k === 'fire') {
      // Colonne de fumée noire au-dessus d'un véhicule en feu.
      for (let i = 0; i < 6; i++) {
        const ph = (l * 0.6 + i / 6) % 1;
        drawSmokePuff(ctx, it.x + WIND.x * ph * 2.2, it.y - ph * 40, 5 + ph * 12, 0.5 * (1 - ph) * Math.min(1, l * 3), 0.9);
      }
    }
  }
  // 2. Projectiles, flammes, explosions.
  for (const it of fx.items) {
    const l = T - it.t0;
    if (l < 0 || l > it.life) continue;
    const k = l / it.life;
    if (it.k === 'blast') drawBlast(ctx, it, l);
    else if (it.k === 'fire') drawFire(ctx, it, l, T);
    else if (it.k === 'flash') {
      const r = it.r * (1 - k * 0.4);
      const g = ctx.createRadialGradient(it.x, it.y, 0, it.x, it.y, r);
      g.addColorStop(0, `rgba(255, 255, 230, ${1 - k})`);
      g.addColorStop(0.5, `rgba(255, 200, 80, ${0.85 * (1 - k)})`);
      g.addColorStop(1, 'rgba(255, 140, 40, 0)');
      ctx.fillStyle = g;
      circle(ctx, it.x, it.y, r);
      ctx.fill();
    } else if (it.k === 'tracer') {
      const hx = lerp(it.ax, it.bx, k), hy = lerp(it.ay, it.by, k);
      const tk = Math.max(0, k - (it.heavy ? 0.5 : 0.3));
      const tx = lerp(it.ax, it.bx, tk), ty = lerp(it.ay, it.by, tk);
      ctx.strokeStyle = it.heavy ? 'rgba(255, 200, 110, 0.45)' : 'rgba(255, 160, 50, 0.45)';
      ctx.lineWidth = it.heavy ? 7 : 4.5;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.strokeStyle = it.heavy ? '#fffbe8' : 'rgba(255, 232, 140, 0.95)';
      ctx.lineWidth = it.heavy ? 2.8 : 1.9;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
    } else if (it.k === 'shell') {
      const p = pointOnShell(it, k), q = pointOnShell(it, Math.max(0, k - 0.1));
      ctx.fillStyle = 'rgba(30, 25, 15, 0.22)';
      circle(ctx, lerp(it.ax, it.bx, k), lerp(it.ay, it.by, k), 2.2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(240, 235, 220, 0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.fillStyle = '#ffd36a';
      circle(ctx, p.x, p.y, 2.6);
      ctx.fill();
    } else if (it.k === 'spark') {
      ctx.fillStyle = `rgba(160, 135, 95, ${0.55 * (1 - k)})`;
      circle(ctx, it.x, it.y - 4 * k, 2 + 6 * k);
      ctx.fill();
      if (it.hit && k < 0.5) {
        ctx.strokeStyle = `rgba(255, 190, 70, ${1 - k * 2})`;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const ang = i * 1.57 + it.x;
          ctx.moveTo(it.x, it.y);
          ctx.lineTo(it.x + Math.cos(ang) * (3 + 6 * k), it.y + Math.sin(ang) * (3 + 6 * k));
        }
        ctx.stroke();
      }
    }
  }
  // 3. Bilan des tirs.
  ctx.font = '700 15px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  for (const it of fx.items) {
    if (it.k !== 'text') continue;
    const l = T - it.t0;
    if (l < 0 || l > it.life) continue;
    const k = l / it.life;
    ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
    const y = it.y - 20 - k * 16;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(20, 15, 5, 0.85)';
    ctx.strokeText(it.txt, it.x, y);
    ctx.fillStyle = it.hit ? '#ffcf5a' : '#e8e2cc';
    ctx.fillText(it.txt, it.x, y);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ---------- Traces durables, peintes une fois pour toutes sur la couche de terrain ----------

export function stampScars(ctx, fx, seed) {
  const rng = createRng(seed);
  for (const it of fx.items) {
    if (it.k === 'blast') {
      const s = it.size;
      const g = ctx.createRadialGradient(it.x, it.y, 0, it.x, it.y, s * 1.2);
      g.addColorStop(0, `rgba(38, 28, 18, ${it.kill ? 0.5 : 0.4})`);
      g.addColorStop(0.55, 'rgba(60, 45, 28, 0.16)');
      g.addColorStop(1, 'rgba(60, 45, 28, 0)');
      ctx.fillStyle = g;
      circle(ctx, it.x, it.y, s * 1.2);
      ctx.fill();
      if (it.kill) continue; // l'épave recouvre le point d'impact
      const r = s * 0.32;
      ctx.fillStyle = 'rgba(206, 186, 140, 0.55)'; // terre rejetée
      for (let i = 0; i < 7; i++) {
        const ang = rng.next() * Math.PI * 2, d = r * (1.3 + rng.next() * 0.9);
        circle(ctx, it.x + Math.cos(ang) * d, it.y + Math.sin(ang) * d, 0.8 + rng.next() * 1.2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(62, 45, 28, 0.7)';
      circle(ctx, it.x, it.y, r);
      ctx.fill();
      ctx.strokeStyle = 'rgba(214, 196, 150, 0.6)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(it.x, it.y, r * 1.12, Math.PI * 0.9, Math.PI * 1.9);
      ctx.stroke();
    } else if (it.k === 'spark' && it.hit) {
      ctx.fillStyle = 'rgba(70, 55, 35, 0.18)';
      circle(ctx, it.x, it.y, 2);
      ctx.fill();
    }
  }
}

// Ornières de chenilles le long d'un trajet (points en px).
export function stampTracks(ctx, pts) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(78, 60, 36, 0.24)';
  ctx.lineWidth = 2.2;
  ctx.setLineDash([1.6, 1.2]);
  ctx.lineCap = 'butt';
  for (const off of [-3.4, 3.4]) {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const x = p.x - (dy / len) * off, y = p.y + (dx / len) * off;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
  ctx.restore();
}

// Épave d'une unité détruite ; fume pendant deux tours, brûle pendant le premier.
export function drawWreck(ctx, w, time, age) {
  const r = createRng(w.seed);
  ctx.save();
  ctx.translate(w.x, w.y);
  ctx.save();
  ctx.rotate(w.rot);
  ctx.strokeStyle = '#15120e';
  ctx.lineWidth = 1;
  const tint = w.side === 'DE' ? '#4b5257' : '#5a3a2e';
  if (w.type === 'tank' || w.type === 'recon') {
    const L = w.type === 'tank' ? 24 : 16, H = w.type === 'tank' ? 15 : 10;
    ctx.fillStyle = '#1e1a15';
    ctx.fillRect(-L / 2, -H / 2 - 1.5, L, 3.5);
    ctx.fillRect(-L / 2, H / 2 - 2, L, 3.5);
    ctx.fillStyle = tint;
    ctx.fillRect(-L / 2 + 1.5, -H / 2 + 1.5, L - 3, H - 3);
    ctx.fillStyle = 'rgba(25, 20, 15, 0.55)';
    ctx.fillRect(-L / 2 + 1.5, -H / 2 + 1.5, (L - 3) * 0.6, H - 3);
    ctx.strokeRect(-L / 2, -H / 2, L, H);
    if (w.type === 'tank') {
      const tx = 2 + (r.next() - 0.5) * 6, ta = (r.next() - 0.5) * 2.4;
      ctx.fillStyle = '#2c2721';
      circle(ctx, tx, 0, 5.5);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#2c2721';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(tx, 0);
      ctx.lineTo(tx + Math.cos(ta) * 15, Math.sin(ta) * 15);
      ctx.stroke();
    }
  } else if (w.type === 'artillery') {
    ctx.fillStyle = '#1e1a15';
    for (const y of [-6, 6]) { ctx.fillRect(-4, y - 1.5, 8, 3); }
    ctx.strokeStyle = '#2c2721';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-3, 0); ctx.lineTo(14, -3);
    ctx.moveTo(-3, -4); ctx.lineTo(-13, -1);
    ctx.moveTo(-3, 4); ctx.lineTo(-11, 7);
    ctx.stroke();
  } else {
    // Infanterie : matériel abandonné, trous d'obus et caisses éparpillées.
    for (let i = 0; i < 7; i++) {
      ctx.save();
      ctx.translate((r.next() - 0.5) * 26, (r.next() - 0.5) * 18);
      ctx.rotate(r.next() * Math.PI);
      ctx.fillStyle = i % 3 ? '#3a3226' : tint;
      ctx.fillRect(-2.5, -1.5, 5, 3);
      ctx.restore();
    }
  }
  ctx.restore();
  if (age <= 1) {
    const big = w.type === 'tank' || w.type === 'recon' || w.type === 'artillery';
    if (age === 0 && big) drawFire(ctx, { x: 0, y: 0, life: 1 }, 0.2, time);
    for (let i = 0; i < 6; i++) {
      const ph = (time * 0.22 + i / 6) % 1;
      drawSmokePuff(ctx, WIND.x * ph * 2.4, -ph * 44, 4 + ph * 12, (age === 0 ? 0.45 : 0.25) * (1 - ph) * Math.min(1, ph * 8), big ? 0.85 : 0.6);
    }
  }
  ctx.restore();
}
