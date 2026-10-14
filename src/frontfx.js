// Front stratégique : effets de combat dessinés sur la carte pendant la journée. Purement visuel, rien ici ne
// touche au moteur. À chaque tick, spawn() lit les pertes et les poussées du tick (front.tickLoss, tickEdges) et
// programme sur la durée du tick :
// - une lueur sur chaque case au contact, d'autant plus vive que les pertes y sont lourdes ;
// - des tirs traçants d'un camp vers l'autre, en rafales de mitrailleuse une fois sur quatre ;
// - des obus là où des blindés poussent (et les antichars qui leur répondent) ;
// - les barrages du matin : salves d'explosions, fumée qui traîne, sol noirci.
// Comme les sons, seulement là où le camp observateur a des troupes ou une vue, et seulement à l'écran.

import { ARMOR_ATK } from './frontinput.js';

const TRACER = ['#fff27a', '#ff7a3c']; // Wehrmacht (jaune), Armée rouge (orange)
const MAX_PARTS = 1600;

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
  }

  clear() {
    this.parts.length = 0;
    this.glow = [];
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
        let shots;
        if (h > 0) {
          shots = 1 + l * 12 + Math.min(2, h * 0.15);
          shots = Math.min(7, Math.floor(shots) + (Math.random() < shots % 1 ? 1 : 0));
        } else shots = Math.random() < 0.04 + l * 1.5 ? 1 : 0; // front calme : un coup de temps en temps
        for (let k = 0; k < shots; k++) {
          const j = foes[(Math.random() * foes.length) | 0];
          const from = { x: jit(cx[j]) * C, y: jit(cy[j]) * C }, to = { x: jit(cx[i]) * C, y: jit(cy[i]) * C };
          const t = at(), side = 1 - s;
          if (h > 0 && Math.random() < 0.3) this.burstMG(from, to, t, side);
          else this.tracer(from, to, t, side, 160 + Math.random() * 80, 1);
          // Riposte : la case touchée tire aussi.
          if (Math.random() < (h > 0 ? 0.6 : 0.3)) this.tracer(to, { x: jit(cx[j]) * C, y: jit(cy[j]) * C }, at(), s, 160 + Math.random() * 80, 1);
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
    // Barrages du matin (le tick qui vient de se jouer est front.tick − 1).
    if (front.tick <= front.cfg.barrageTicks) {
      for (const s of [0, 1]) {
        for (const b of front.barrages[s]) {
          const bx = b.x * C, by = b.y * C, R = b.r * C;
          if (bx < rect.x0 - R || bx > rect.x1 + R || by < rect.y0 - R || by > rect.y1 + R) continue;
          if (viewer !== null && s !== viewer && !this.barrageSeen(front, viewer, b)) continue;
          for (let q = 0; q < 16; q++) {
            const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
            this.blast(bx + Math.cos(a) * r, by + Math.sin(a) * r, at(), 6 + Math.random() * 4);
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
      // Katioucha : traînées de roquettes vers la zone pilonnée.
      if (salvo && g.kind === 'rocket') {
        for (let q = 0; q < 8; q++) {
          const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * mission.r * C;
          this.tracer({ x: gx, y: gy }, { x: mission.x * C + Math.cos(a) * rr, y: mission.y * C + Math.sin(a) * rr }, at(), g.side, 700 + Math.random() * 300, 1.6);
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

  burstMG(from, to, t0, side) {
    const n = 4 + ((Math.random() * 4) | 0);
    for (let q = 0; q < n; q++) {
      const tx = to.x + (Math.random() - 0.5) * this.cell * 0.8, ty = to.y + (Math.random() - 0.5) * this.cell * 0.8;
      this.tracer(from, { x: tx, y: ty }, t0 + q * 55, side, 130, 0.8);
    }
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
    // Fumée d'abord (dessous), puis le feu.
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
      if (p.k === 'flash') {
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

  busy(now) { return this.glow.length > 0 || this.parts.some((p) => now < p.t0 + p.life); }
}
