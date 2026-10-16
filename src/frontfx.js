// Front stratégique : effets de combat dessinés sur la carte pendant la journée. Purement visuel, rien ici ne
// touche au moteur. À chaque tick, spawn() lit les pertes et les poussées du tick (front.tickLoss, tickEdges) et
// programme sur la durée du tick :
// - une lueur sur chaque case au contact, d'autant plus vive que les pertes y sont lourdes ;
// - aux assauts, des foyers de combat rapproché : mitrailleuses qui balaient, grenades, coups de fusil ; ailleurs le
//   long du front, un feu de ligne discret (éclairs de départ, traçants courts, poussière à l'impact) ;
// - des obus là où des blindés poussent (et les antichars qui leur répondent) ;
// - les barrages du matin : salves d'explosions, fumée qui traîne, sol noirci.
// Comme les sons, seulement là où le camp observateur a des troupes ou une vue, et seulement à l'écran.

import { ARMOR_ATK } from './frontinput.js';
import { AIR, airBase } from './frontair.js';

const TRACER = ['#fff27a', '#ff7a3c']; // Wehrmacht (jaune), Armée rouge (orange)
// Obus en cloche par type de pièce (frontguns.js) : obus par tick de barrage, durée de vol (ms, + par pixel),
// hauteur de la cloche (part de la distance), rayon de l'explosion. Les mortiers tirent haut, les Katioucha tendu.
const ARC = {
  div: { n: 12, life: 900, perPx: 9, maxLife: 3200, h: 0.38, r: 6 },
  heavy: { n: 8, life: 1200, perPx: 10, maxLife: 3800, h: 0.42, r: 9 },
  mortar: { n: 14, life: 1000, perPx: 12, maxLife: 3000, h: 0.7, r: 5 },
  rocket: { n: 14, life: 700, perPx: 5, maxLife: 2000, h: 0.18, r: 6.5, rocket: true },
  nebel: { n: 12, life: 800, perPx: 6, maxLife: 2200, h: 0.24, r: 6, rocket: true },
};
const MAX_PARTS = 2400;
// Panaches de fumée : bouffées émises en continu par les foyers (incendies, combats intenses), poussées par le vent.
const PLUME = { rate: 0.008, life: 5600, max: 1000, grow: 24, drift: 0.011 }; // bouffées par ms et par foyer à plein, vie (ms), …

// Bouffée de fumée : disque flou d'une couleur.
function puffSprite(rgb) {
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(24, 24, 0, 24, 24, 24);
  grad.addColorStop(0, `rgba(${rgb}, 1)`);
  grad.addColorStop(0.5, `rgba(${rgb}, 0.55)`);
  grad.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 48, 48);
  return c;
}

function glowSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255, 196, 110, 0.9)');
  grad.addColorStop(0.35, 'rgba(255, 120, 40, 0.45)');
  grad.addColorStop(1, 'rgba(255, 80, 20, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

export class FrontFx {
  constructor(cell) {
    this.cell = cell;
    this.parts = []; // { k, t0, life, ... } en pixels monde, temps en ms (performance.now)
    this.glow = []; // [x, y, intensité, phase] × n, lueurs du dernier tick
    this.sprite = null;
    this.plumes = []; // bouffées des panaches { t0, x, y, dark }
    this.sources = {}; // foyers de l'image en cours, par nature : [x, y, force] × n
    this.wind = { x: 1, y: 0, k: 0.6 }; // direction (unitaire) et force (0 à 1) du vent du jour
    this.still = false; // mouvement réduit ou journée accélérée : pas de nouvelles bouffées
    this.lastPlume = 0;
  }

  clear() {
    this.parts.length = 0;
    this.glow = [];
    this.plumes.length = 0;
  }

  glowSprite() { return (this.sprite ??= glowSprite()); }

  // Flamme : cœur clair, bord orange, sans halo large.
  fireSprite() {
    if (this.fire) return this.fire;
    const c = (this.fire = document.createElement('canvas'));
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 232, 160, 1)');
    grad.addColorStop(0.3, 'rgba(255, 140, 44, 0.8)');
    grad.addColorStop(0.65, 'rgba(210, 64, 20, 0.2)');
    grad.addColorStop(1, 'rgba(180, 40, 10, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return c;
  }

  // Foyers d'une nature ('fire', 'battle', …) pour l'image en cours.
  plumeSources(list, kind) { this.sources[kind] = list; }

  // Panaches : émission depuis les foyers, puis bouffées qui grossissent, s'éclaircissent et dérivent sous le vent.
  drawPlumes(ctx, now) {
    this.smokeDark ??= puffSprite('62, 58, 54');
    this.smokeLight ??= puffSprite('132, 126, 116');
    const dt = Math.min(100, Math.max(0, now - (this.lastPlume || now)));
    this.lastPlume = now;
    const P = this.plumes;
    if (!this.still) {
      for (const list of Object.values(this.sources)) {
        for (let k = 0; k < list.length; k += 3) {
          let n = PLUME.rate * dt * list[k + 2];
          n = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
          for (let q = 0; q < n; q++) P.push({ t0: now - Math.random() * dt, x: list[k] + (Math.random() - 0.5) * 1.5, y: list[k + 1] + (Math.random() - 0.5) * 1.5, ph: Math.random() * 6, s: list[k + 2] });
        }
      }
      if (P.length > PLUME.max) P.splice(0, P.length - PLUME.max);
    }
    if (!P.length) return;
    const w = this.wind, v = PLUME.drift * (0.35 + w.k);
    let alive = 0;
    for (const p of P) {
      const age = now - p.t0, u = age / PLUME.life;
      if (u >= 1 || u < 0) continue;
      alive++;
      // Le vent pousse ; la bouffée monte aussi un peu (vers le haut de l'écran) et ondule.
      const wob = Math.sin(age * 0.002 + p.ph) * 3 * u;
      const x = p.x + w.x * v * age - w.y * wob, y = p.y + w.y * v * age + w.x * wob - 4 * u;
      const R = 1.8 + PLUME.grow * u * (0.6 + 0.4 * p.s) / (0.6 + w.k);
      ctx.globalAlpha = 0.42 * (1 - u) * Math.min(1, u * 10) * (0.55 + 0.45 * p.s);
      ctx.drawImage(u < 0.3 ? this.smokeDark : this.smokeLight, x - R, y - R, R * 2, R * 2);
    }
    ctx.globalAlpha = 1;
    if (P.length > 200 && alive < P.length * 0.7) this.plumes = P.filter((p) => now - p.t0 < PLUME.life);
  }

  // front : état après le tick ; viewer : camp observateur (null : tout) ; now, dur : fenêtre du tick (ms) ;
  // rect : partie visible du monde { x0, y0, x1, y1 } ; events : événements du tick (prises de villes).
  spawn(front, viewer, now, dur, rect, events = []) {
    const C = this.cell;
    const { N, nb } = front.map;
    const cx = front.centers.x, cy = front.centers.y;
    const loss = front.tickLoss;
    const seen = (i) => viewer === null || front.owner[i] === viewer || front.vision[viewer][i];
    const shown = (i) => {
      const x = cx[i] * C, y = cy[i] * C;
      return x > rect.x0 - 30 && x < rect.x1 + 30 && y > rect.y0 - 30 && y < rect.y1 + 30;
    };
    const jit = (v) => v + (Math.random() - 0.5) * 0.9;
    const at = () => now + Math.random() * dur;
    const glow = [];
    // Combats actifs : cases assaillies (et, moins, leurs assaillants) et cases qui viennent de changer de mains.
    // Ailleurs, le front calme ne fait qu'échanger quelques tirs épars.
    const hot = new Float32Array(N);
    const e = front.tickEdges ?? [];
    for (let k = 0; k < e.length; k += 3) { hot[e[k + 1]] += e[k + 2]; hot[e[k]] += e[k + 2] * 0.5; }
    for (const ev of events) if (ev.kind === 'capture') hot[ev.i] += 2;
    if (loss) {
      for (let i = 0; i < N; i++) {
        const l = loss[i], s = front.owner[i];
        if (!(l > 0) || s < 0 || !seen(i) || !shown(i)) continue;
        const h = hot[i];
        // Lueur : échelle logarithmique, réservée aux combats actifs ou aux pertes nettes ; l'assaut (0,2 à 1) flambe.
        if (h > 0 || l > 0.06) glow.push(cx[i] * C, cy[i] * C, Math.min(1, Math.log1p(l / 0.02) / Math.log1p(50)), i * 1.7);
        // Tirs reçus par la case i, venus de ses voisines ennemies.
        const foes = [];
        for (let d = 0; d < 6; d++) { const j = nb[i * 6 + d]; if (j >= 0 && front.owner[j] === 1 - s) foes.push(j); }
        if (!foes.length) continue;
        if (h > 0) {
          // Foyer d'assaut : mitrailleuses qui balaient, grenades, coups de fusil, des deux côtés.
          let n = 1 + l * 10 + Math.min(2, h * 0.15);
          n = Math.min(7, Math.floor(n) + (Math.random() < n % 1 ? 1 : 0));
          for (let k = 0; k < n; k++) {
            const j = foes[(Math.random() * foes.length) | 0];
            const back = Math.random() < 0.45; // la case assaillie riposte
            this.firefight(back ? i : j, back ? j : i, back ? s : 1 - s, at(), cx, cy);
          }
        } else if (Math.random() < Math.min(0.8, 0.2 + l * 6)) {
          // Front calme : feu de ligne, un départ de coup le long du front, parfois un traçant court.
          const j = foes[(Math.random() * foes.length) | 0];
          const mine = Math.random() < 0.5;
          this.lineShot(mine ? i : j, mine ? j : i, mine ? s : 1 - s, at(), cx, cy);
        }
      }
    }
    this.glow = glow;
    // Blindés : obus le long des poussées dont l'assaillant est surtout blindé, et antichars en face.
    for (let k = 0; k < e.length; k += 3) {
      const i = e[k], j = e[k + 1], v = e[k + 2];
      const s = front.owner[i];
      if (s < 0 || front.field[s].atk[i] < ARMOR_ATK || !(seen(i) || seen(j)) || !shown(j)) continue;
      let n = Math.min(3, v * 0.25);
      n = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
      for (let q = 0; q < n; q++) {
        const from = { x: jit(cx[i]) * C, y: jit(cy[i]) * C }, to = { x: jit(cx[j]) * C, y: jit(cy[j]) * C };
        this.shell(from, to, at(), s);
        if (Math.random() < 0.4) this.shell(to, from, at(), 1 - s);
      }
    }
    // Formations blindées : obus des chars sur la case visée, antichars en face.
    const ta = front.tickArmor ?? [];
    for (let k = 0; k < ta.length; k += 3) {
      const a = front.armor.find((x) => x.id === ta[k]), j = ta[k + 1];
      if (!a || !(seen(a.cell) || seen(j)) || !shown(j)) continue;
      let n = Math.min(4, ta[k + 2] * 0.06);
      n = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
      for (let q = 0; q < n; q++) {
        const from = { x: jit(cx[a.cell]) * C, y: jit(cy[a.cell]) * C }, to = { x: jit(cx[j]) * C, y: jit(cy[j]) * C };
        this.shell(from, to, at(), a.side);
        if (Math.random() < 0.5) this.shell(to, from, at(), 1 - a.side);
      }
    }
    // Barrages du matin (le tick qui vient de se jouer est front.tick − 1) : obus en cloche depuis la batterie,
    // explosion à l'arrivée. Une batterie ennemie qu'on ne voit pas : l'obus n'apparaît qu'en fin de course.
    if (front.tick <= front.cfg.barrageTicks) {
      for (const s of [0, 1]) {
        for (const b of front.barrages[s]) {
          const bx = b.x * C, by = b.y * C, R = b.r * C;
          if (bx < rect.x0 - R || bx > rect.x1 + R || by < rect.y0 - R || by > rect.y1 + R) continue;
          if (viewer !== null && s !== viewer && !this.barrageSeen(front, viewer, b)) continue;
          const g = (front.guns ?? []).find((x) => x.id === b.gun);
          const A = ARC[g?.kind] ?? ARC.div;
          const gunSeen = g && (viewer === null || g.side === viewer || g.seen?.[viewer]?.clock === front.clock);
          for (let q = 0; q < A.n; q++) {
            const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
            const tx = bx + Math.cos(a) * r, ty = by + Math.sin(a) * r;
            if (g) this.arc(g.x * C, g.y * C, tx, ty, at(), A, !gunSeen);
            else this.blast(tx, ty, at(), A.r + Math.random() * A.r * 0.4);
          }
        }
      }
    }
    // Départs de coups : lueurs à la position des groupes d'artillerie qui ont tiré ce tick (barrage ou appui).
    for (const g of front.guns ?? []) {
      if (g.lost || g.fired !== front.clock - 1) continue;
      if (viewer !== null && g.side !== viewer) {
        const seen = g.seen?.[viewer];
        if (!seen || seen.clock !== front.clock) continue;
      }
      const gx = g.x * C, gy = g.y * C;
      if (gx < rect.x0 - 30 || gx > rect.x1 + 30 || gy < rect.y0 - 30 || gy > rect.y1 + 30) continue;
      const mission = front.barrages[g.side].find((b) => b.gun === g.id);
      const salvo = front.tick <= front.cfg.barrageTicks && mission;
      for (let q = 0; q < (salvo ? 5 : 2); q++) this.blast(gx + (Math.random() - 0.5) * 10, gy + (Math.random() - 0.5) * 6, at(), 2.2, true);
    }
    // Aviation : les avions décollent au tick d'approche, piquent sur l'objectif, puis rentrent ; la DCA tire sur
    // leur route. On voit ses propres sorties, et celles de l'ennemi qui frappent là où l'on voit.
    const first = AIR.strikeTicks[0];
    for (const s of [0, 1]) {
      for (const m of front.air?.[s] ?? []) {
        const tc = Math.max(0, Math.min(front.map.N - 1, Math.round(m.y / 1.5) * front.map.W + Math.round(m.x / 1.732)));
        if (viewer !== null && s !== viewer && !front.vision[viewer][tc]) continue;
        if (front.tick === first && m.power > 0) {
          const o = airBase(front, s, m), life = dur * 4.4;
          for (let k = 0; k < 3; k++) {
            const off = (k - 1) * 1.4;
            this.parts.push({ k: 'plane', t0: now + k * 260, life, x0: o.x * C, y0: (o.y + off) * C, x1: (m.x + off * 0.6) * C, y1: (m.y + off * 0.4) * C, side: s, down: k >= 3 - (m.downed ?? 0), smoked: 0 });
          }
          // Flocons de DCA autour de la route, là où elle passe près des batteries.
          for (const id of m.flak ?? []) {
            const a = front.aa.find((x) => x.id === id);
            if (!a) continue;
            const vx = m.x - o.x, vy = m.y - o.y, L2 = vx * vx + vy * vy || 1;
            const t = Math.max(0, Math.min(1, ((a.x - o.x) * vx + (a.y - o.y) * vy) / L2));
            for (let q = 0; q < 14; q++) {
              const tt = Math.max(0, Math.min(1, t + (Math.random() - 0.5) * 0.25));
              this.parts.push({ k: 'flak', t0: now + tt * life * 0.45 + Math.random() * 400, life: 1500, x: (o.x + vx * tt) * C + (Math.random() - 0.5) * 20, y: (o.y + vy * tt) * C + (Math.random() - 0.5) * 16 - 10 });
            }
          }
        }
        // Bombes : au fil des ticks de frappe (chasse : une seule passe).
        if (AIR.strikeTicks.includes(front.tick - 1) && m.power > 0 && (m.kind === 'strike' || front.tick - 1 === first)) {
          const R = (m.kind === 'strike' ? AIR.strikeR : 0.8) * C;
          for (let q = 0; q < (m.kind === 'strike' ? 6 : 5); q++) {
            const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
            this.blast(m.x * C + Math.cos(a) * r, m.y * C + Math.sin(a) * r, at(), 7 + Math.random() * 3);
          }
        }
      }
    }
    // Villes qui tombent : une grosse explosion.
    for (const ev of events) {
      if (ev.kind !== 'capture' || !front.map.towns.some((t) => t.i === ev.i) || !seen(ev.i)) continue;
      this.blast(cx[ev.i] * C, cy[ev.i] * C, now + dur * 0.5, 13);
    }
    if (this.parts.length > MAX_PARTS) this.parts.splice(0, this.parts.length - MAX_PARTS);
  }

  barrageSeen(front, viewer, b) {
    const { N } = front.map;
    for (let i = 0; i < N; i++) {
      if (Math.hypot(front.centers.x[i] - b.x, front.centers.y[i] - b.y) > b.r) continue;
      if (front.owner[i] === viewer || front.vision[viewer][i]) return true;
    }
    return false;
  }

  tracer(from, to, t0, side, life, w) {
    this.parts.push({ k: 'tracer', t0, life, x0: from.x, y0: from.y, x1: to.x, y1: to.y, side, w });
  }

  // Point de la case a, près de sa frontière avec la case b (unités de grille → pixels monde), décalé le long du front.
  edgePoint(a, b, cx, cy, depth = 0.35) {
    const C = this.cell, mx = (cx[a] + cx[b]) / 2, my = (cy[a] + cy[b]) / 2;
    const nx = cx[a] - mx, ny = cy[a] - my, side = (Math.random() - 0.5) * 1.1;
    return { x: (mx + nx * depth * (0.6 + Math.random() * 0.8) - ny * side) * C, y: (my + ny * depth * (0.6 + Math.random() * 0.8) + nx * side) * C };
  }

  // Feu de ligne : éclair de départ, et un traçant court qui franchit le front (poussière à l'arrivée) une fois sur trois.
  lineShot(a, b, side, t0, cx, cy) {
    const from = this.edgePoint(a, b, cx, cy);
    this.parts.push({ k: 'muzzle', t0, life: 90, x: from.x, y: from.y, r: 0.9 });
    if (Math.random() < 0.35) {
      const to = this.edgePoint(b, a, cx, cy, 0.5);
      const ex = from.x + (to.x - from.x) * 0.8, ey = from.y + (to.y - from.y) * 0.8;
      this.tracer(from, { x: ex, y: ey }, t0, side, 110, 0.8);
      this.parts.push({ k: 'dust', t0: t0 + 110, life: 650, x: ex, y: ey, r: 1.1 });
    }
  }

  // Combat rapproché de la case a vers la case b : rafale de mitrailleuse qui balaie, grenade, ou coup de fusil.
  firefight(a, b, side, t0, cx, cy) {
    const from = this.edgePoint(a, b, cx, cy, 0.45), to = this.edgePoint(b, a, cx, cy, 0.5);
    const roll = Math.random();
    if (roll < 0.35) {
      const base = Math.atan2(to.y - from.y, to.x - from.x), L = Math.hypot(to.x - from.x, to.y - from.y) * (0.9 + Math.random() * 0.3);
      const sweep = (Math.random() < 0.5 ? 1 : -1) * 0.07, start = -sweep * 3;
      for (let q = 0; q < 6; q++) {
        const an = base + start + sweep * q;
        this.tracer(from, { x: from.x + Math.cos(an) * L, y: from.y + Math.sin(an) * L }, t0 + q * 50, side, 120, 0.8);
      }
      this.parts.push({ k: 'muzzle', t0, life: 300, x: from.x, y: from.y, r: 1.3 });
    } else if (roll < 0.55) {
      this.blast(to.x, to.y, t0 + 250, 2.4, true); // grenade
    } else {
      this.parts.push({ k: 'muzzle', t0, life: 90, x: from.x, y: from.y, r: 1 });
      this.tracer(from, to, t0, side, 140, 1);
      this.parts.push({ k: 'dust', t0: t0 + 140, life: 650, x: to.x, y: to.y, r: 1.2 });
    }
  }

  // Obus en cloche de (x0, y0) à (x1, y1) : il monte vers le haut de l'écran puis retombe, traînée derrière lui.
  // late : n'apparaît qu'en fin de course (tiré d'une batterie qu'on ne voit pas).
  arc(x0, y0, x1, y1, t0, A, late = false) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const life = Math.min(A.maxLife, A.life + d * A.perPx);
    // Cloche haute même à courte portée (batteries juste derrière le front) : sinon on ne la voit pas.
    this.parts.push({ k: 'arc', t0, life, x0, y0, x1, y1, h: Math.max(d * A.h, A.rocket ? 18 : 40), u0: late ? 0.6 : 0, rocket: !!A.rocket });
    this.blast(x1, y1, t0 + life, A.r + Math.random() * A.r * 0.4);
  }

  shell(from, to, t0, side) {
    this.parts.push({ k: 'tracer', t0, life: 110, x0: from.x, y0: from.y, x1: to.x, y1: to.y, side, w: 2.2 });
    this.parts.push({ k: 'flash', t0, life: 90, x: from.x, y: from.y, r: 3.5 });
    this.blast(to.x, to.y, t0 + 110, 3.5, true);
  }

  // Explosion : éclair, boule de feu, onde, gerbe de terre ; puis fumée qui s'élève et sol noirci.
  blast(x, y, t0, r, small = false) {
    this.parts.push({ k: 'blast', t0, life: 420, x, y, r, a: Math.random() * Math.PI });
    this.parts.push({ k: 'smoke', t0: t0 + 60, life: small ? 1600 : 3200, x, y, r, dx: (Math.random() - 0.3) * r * 0.8, dy: -r * (0.6 + Math.random() * 0.6) });
    if (!small) this.parts.push({ k: 'scorch', t0, life: 14000, x, y, r: r * (0.6 + Math.random() * 0.3) });
  }

  // Obus en cloche, au-dessus des unités (ils volent) : traînée qui s'épaissit vers la tête (fumée grise pour les
  // roquettes), halo, puis la tête.
  drawArcs(ctx, now, px) {
    ctx.save();
    ctx.lineCap = 'round';
    const SEG = 7;
    for (const p of this.parts) {
      if (p.k !== 'arc' || now < p.t0 || now > p.t0 + p.life) continue;
      const u = (now - p.t0) / p.life;
      if (u < p.u0) continue;
      const pt = (v) => ({ x: p.x0 + (p.x1 - p.x0) * v, y: p.y0 + (p.y1 - p.y0) * v - p.h * 4 * v * (1 - v) });
      const fade = Math.min(1, (u - p.u0) * 12);
      const tail = p.rocket ? 0.35 : 0.25;
      let a = pt(Math.max(p.u0, u - tail));
      for (let q = 1; q <= SEG; q++) {
        const b = pt(Math.max(p.u0, u - tail * (1 - q / SEG)));
        const k = q / SEG;
        ctx.globalAlpha = fade * k * (p.rocket ? 0.55 : 0.85);
        ctx.strokeStyle = p.rocket ? 'rgb(176, 170, 158)' : 'rgb(255, 226, 150)';
        ctx.lineWidth = (p.rocket ? 1 + 2 * k : 0.6 + 1.6 * k) * Math.max(1, px);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        a = b;
      }
      const R = Math.max(3.5, 8 * px);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = fade * 0.7;
      ctx.drawImage(this.glowSprite(), a.x - R, a.y - R, R * 2, R * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = fade;
      ctx.fillStyle = '#fff6d8';
      ctx.beginPath();
      ctx.arc(a.x, a.y, Math.max(1.3, 2.2 * px), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Avions vus de dessus : approche en altitude, piqué sur l'objectif, retour vers leur bord de carte ; ombre portée
  // d'autant plus loin qu'ils volent haut. Abattu : il part en vrille dans la fumée et s'écrase. Flocons de DCA.
  drawPlanes(ctx, now, px) {
    const k = Math.max(1, px * 0.9) * 1.25;
    for (const p of this.parts) {
      if (p.k !== 'flak' || now < p.t0 || now > p.t0 + p.life) continue;
      const u = (now - p.t0) / p.life;
      ctx.globalAlpha = 0.85 * (1 - u);
      ctx.fillStyle = '#1e1c1a';
      ctx.beginPath();
      ctx.arc(p.x, p.y, (1.6 + 3.4 * Math.sqrt(u)) * k * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const p of this.parts) {
      if (p.k !== 'plane' || now < p.t0 || now > p.t0 + p.life) continue;
      const u = (now - p.t0) / p.life;
      const dx = p.x1 - p.x0, dy = p.y1 - p.y0, L = Math.hypot(dx, dy) || 1;
      let x, y, alt, ang;
      if (u < 0.5) {
        const v = u / 0.5;
        x = p.x0 + dx * v; y = p.y0 + dy * v; alt = 1 - 0.75 * v ** 3; ang = Math.atan2(dy, dx);
      } else {
        // Dégagement : virage vers le nord puis retour.
        const v = (u - 0.5) / 0.5, bx = p.x1 + (dx / L) * 140, by = p.y1 - 60, ex = p.x0, ey = p.y1 - 160;
        x = (1 - v) ** 2 * p.x1 + 2 * (1 - v) * v * bx + v * v * ex;
        y = (1 - v) ** 2 * p.y1 + 2 * (1 - v) * v * by + v * v * ey;
        const tx = 2 * (1 - v) * (bx - p.x1) + 2 * v * (ex - bx), ty = 2 * (1 - v) * (by - p.y1) + 2 * v * (ey - by);
        alt = 0.25 + 0.75 * v; ang = Math.atan2(ty, tx);
      }
      if (p.down) {
        // Touché aux deux cinquièmes de l'approche : vrille, fumée, chute.
        const hit = 0.38;
        if (u > hit) {
          const v = Math.min(1, (u - hit) / 0.12);
          const hx = p.x0 + dx * (hit / 0.5), hy = p.y0 + dy * (hit / 0.5);
          x = hx + (dx / L) * 40 * v; y = hy + (dy / L) * 40 * v + 18 * v * v;
          alt = (1 - 0.75 * (hit / 0.5) ** 3) * (1 - v); ang = Math.atan2(dy, dx) + v * 7;
          if (Math.random() < 0.5) this.parts.push({ k: 'smoke', t0: now, life: 2200, x, y: y - alt * 14 * k, r: 2, dx: 3, dy: -6 });
          if (v >= 1) {
            if (!p.crashed) { p.crashed = true; this.blast(x, y, now, 7); }
            continue;
          }
        }
      }
      const lift = alt * 14 * k;
      this.planeSprite(ctx, x + alt * 10 * k, y + alt * 7 * k, ang, p.side, k, 0.22, true);
      this.planeSprite(ctx, x, y - lift, ang, p.side, k, 1, false);
    }
  }

  planeSprite(ctx, x, y, ang, side, k, alpha, shadow) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.scale(k, k);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = shadow ? '#141008' : side ? '#6c7a4a' : '#7c8590';
    ctx.strokeStyle = '#22261c';
    ctx.lineWidth = 0.5;
    const poly = (pts) => { ctx.beginPath(); pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath(); ctx.fill(); if (!shadow) ctx.stroke(); };
    poly([[7, 0], [-6, -0.9], [-6, 0.9]]);
    poly([[2, -8], [3.6, -8], [3.6, 8], [2, 8]]);
    poly([[-5, -3], [-4, -3], [-4, 3], [-5, 3]]);
    if (!shadow) {
      ctx.fillStyle = side ? '#c0392b' : '#1d1b17';
      ctx.fillRect(2.2, -6.5, 1.1, 1.6);
      ctx.fillRect(2.2, 4.9, 1.1, 1.6);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // Sol noirci : sous les masses de troupes.
  drawGround(ctx, now) {
    ctx.fillStyle = 'rgb(46, 34, 22)';
    for (const p of this.parts) {
      if (p.k !== 'scorch' || now < p.t0) continue;
      const u = (now - p.t0) / p.life;
      if (u >= 1) continue;
      ctx.globalAlpha = 0.42 * (1 - u) * Math.min(1, (now - p.t0) / 200);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Lueurs des combats : entre les masses et le trait du front.
  drawGlow(ctx, now) {
    if (!this.glow.length) return;
    this.sprite ??= glowSprite();
    const g = this.glow, C = this.cell;
    ctx.save();
    for (let k = 0; k < g.length; k += 4) {
      const a = g[k + 2], flick = 0.75 + 0.25 * Math.sin(now * 0.011 + g[k + 3]) * Math.sin(now * 0.017 + g[k + 3] * 2.3);
      const s = C * (1.2 + 2 * a);
      ctx.globalAlpha = Math.min(1, (0.06 + 0.7 * a * a) * flick);
      ctx.drawImage(this.sprite, g[k] - s, g[k + 1] - s, s * 2, s * 2);
    }
    ctx.restore();
  }

  // Tirs, explosions, fumée : au-dessus du trait du front. px : taille d'un pixel écran en unités monde.
  drawOver(ctx, now, px) {
    const parts = this.parts;
    let live = 0;
    // Poussière des impacts, puis fumée (dessous), puis le feu.
    ctx.fillStyle = 'rgb(226, 214, 182)';
    for (const p of parts) {
      if (p.k !== 'dust' || now < p.t0 || now > p.t0 + p.life) continue;
      const u = (now - p.t0) / p.life;
      ctx.globalAlpha = 0.6 * (1 - u);
      ctx.beginPath();
      ctx.arc(p.x, p.y - u * 1.5, Math.max(p.r, 1.2 * px) * (1 + 1.6 * u), 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of parts) {
      if (p.k !== 'smoke' || now < p.t0 || now > p.t0 + p.life) continue;
      const u = (now - p.t0) / p.life;
      ctx.globalAlpha = 0.5 * (1 - u) * Math.min(1, u * 8);
      ctx.fillStyle = 'rgb(84, 78, 70)';
      ctx.beginPath();
      ctx.arc(p.x + p.dx * u, p.y + p.dy * u, p.r * (0.7 + 1.6 * Math.sqrt(u)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.lineCap = 'round';
    // Tirs traçants : un liseré sombre sous le trait de couleur, lisible sur toutes les teintes.
    for (const side of [0, 1]) {
      for (const w of [0.8, 1, 2.2]) {
        ctx.beginPath();
        let any = false;
        for (const p of parts) {
          if (p.k !== 'tracer' || p.side !== side || p.w !== w || now < p.t0 || now > p.t0 + p.life) continue;
          const u = (now - p.t0) / p.life, a = Math.max(0, u - 0.45);
          ctx.moveTo(p.x0 + (p.x1 - p.x0) * a, p.y0 + (p.y1 - p.y0) * a);
          ctx.lineTo(p.x0 + (p.x1 - p.x0) * u, p.y0 + (p.y1 - p.y0) * u);
          any = true;
        }
        if (!any) continue;
        const lw = Math.max(w, (w + 0.6) * px);
        ctx.strokeStyle = 'rgba(30, 20, 10, 0.55)';
        ctx.lineWidth = lw + 1.6 * px;
        ctx.stroke();
        ctx.strokeStyle = TRACER[side];
        ctx.lineWidth = lw;
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      if (now < p.t0 || now > p.t0 + p.life) continue;
      const u = (now - p.t0) / p.life;
      if (p.k === 'muzzle') {
        // Départ de coup : éclair minuscule, qui crépite (mitrailleuse : plusieurs éclats).
        if (((now - p.t0) / 45 | 0) % 2) continue;
        ctx.globalAlpha = 1 - u * 0.5;
        ctx.fillStyle = '#fff4c8';
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(p.r, 1.1 * px), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.k === 'flash') {
        ctx.globalAlpha = 1 - u;
        ctx.fillStyle = '#fff1c2';
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(p.r, 3 * px), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.k === 'blast') {
        const r = Math.max(p.r, 4 * px);
        // Éclair blanc, puis boule orange qui se resserre.
        if (u < 0.22) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#fffbe6';
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * (0.7 + u * 2), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = Math.max(0, 1 - u * 1.4);
        ctx.fillStyle = '#ff8a2a';
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * (1.1 - 0.6 * u), 0, Math.PI * 2);
        ctx.fill();
        // Onde de choc.
        ctx.globalAlpha = 0.6 * (1 - u);
        ctx.strokeStyle = '#ffd59a';
        ctx.lineWidth = Math.max(0.8, 1.2 * px);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * (0.8 + 1.6 * u), 0, Math.PI * 2);
        ctx.stroke();
      }
      live++;
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    // Gerbes de terre (assombrissent : hors du mode « lighter »).
    ctx.strokeStyle = 'rgba(52, 38, 24, 0.85)';
    ctx.lineWidth = Math.max(0.9, 1.3 * px);
    ctx.beginPath();
    for (const p of parts) {
      if (p.k !== 'blast' || p.r < 5 || now < p.t0 || now > p.t0 + p.life * 0.7) continue;
      const u = (now - p.t0) / (p.life * 0.7), r = Math.max(p.r, 4 * px);
      for (let q = 0; q < 5; q++) {
        const a = p.a + (q / 5) * Math.PI * 2, r0 = r * (0.7 + 0.8 * u), r1 = r * (1 + 1.1 * u);
        ctx.moveTo(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0);
        ctx.lineTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1);
      }
    }
    ctx.stroke();
    // Ménage : particules terminées.
    if (parts.length > 200 || !live) this.parts = parts.filter((p) => now < p.t0 + p.life);
  }

  busy(now) { return this.glow.length > 0 || this.plumes.length > 0 || this.parts.some((p) => now < p.t0 + p.life); }
}
