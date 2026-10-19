// Front stratégique : effets de combat dessinés sur la carte pendant la journée. Purement visuel, rien ici ne
// touche au moteur. À chaque tick, spawn() lit les pertes et les poussées du tick (front.tickLoss, tickEdges) et
// programme sur la durée du tick :
// - une lueur sur chaque case au contact, d'autant plus vive que les pertes y sont lourdes ;
// - aux assauts, des foyers de combat rapproché : mitrailleuses qui balaient, grenades, coups de fusil ; ailleurs le
//   long du front, un feu de ligne discret (éclairs de départ, traçants courts, poussière à l'impact) ;
// - des obus là où des blindés poussent (et les antichars qui leur répondent) ;
// - les barrages du matin : salves d'explosions, fumée qui traîne, sol noirci ; chaque calibre a sa signature (SIG) :
//   coup sec du mortier, geyser de terre et rideau de poussière de l'artillerie lourde, chapelet des lance-roquettes ;
// - l'aviation (raid) : Stuka et Pe-2 en piqué sur les batteries, He 111 en V qui lâchent un chapelet de bombes,
//   Il-2 qui mitraillent en rase-mottes ; la DCA qui a tiré les suit de ses traçants et de ses éclatements.
// Comme les sons, seulement là où le camp observateur a des troupes ou une vue, et seulement à l'écran.

import { ARMOR_ATK } from './frontinput.js';
import { AIR, airBase } from './frontair.js';
import { missionGuns, onMission, gunPower, GUN_KINDS } from './frontguns.js';
import { planeShape } from './frontsprites.js';

const TRACER = ['#fff27a', '#ff7a3c']; // Wehrmacht (jaune), Armée rouge (orange)
// Obus en cloche par type de pièce (frontguns.js) : obus par tick de barrage, durée de vol (ms, + par pixel),
// hauteur de la cloche (part de la distance), rayon de l'explosion. Les mortiers tirent haut, les Katioucha tendu.
// sig : signature de l'impact (blast) ; ripple : salve de roquettes partie d'un seul coup, en chapelet.
const ARC = {
  div: { n: 12, life: 900, perPx: 9, maxLife: 3200, h: 0.38, r: 6 },
  heavy: { n: 8, life: 1200, perPx: 10, maxLife: 3800, h: 0.42, r: 9, sig: 'heavy' },
  mortar: { n: 14, life: 1000, perPx: 12, maxLife: 3000, h: 0.7, r: 5, sig: 'mortar' },
  rocket: { n: 16, life: 700, perPx: 5, maxLife: 2000, h: 0.18, r: 6.5, rocket: true, sig: 'rocket', ripple: 55 },
  nebel: { n: 12, life: 800, perPx: 6, maxLife: 2200, h: 0.24, r: 6, rocket: true, sig: 'rocket', ripple: 90 },
  // Appui passif : un obus isolé, petite gerbe sans panache ni sol noirci.
  passive: { n: 1, life: 800, perPx: 7, maxLife: 2400, h: 0.32, r: 3.2, small: true },
};
// Signatures d'impact par calibre (blast) : durée de l'éclair et de la boule de feu (ms), part de la boule de feu,
// gerbe de terre (geyser, vie en ms : jets vers le haut et mottes qui retombent), rideau de poussière qui dérive sous
// le vent (curtain : bouffées, dustA : opacité, dust : vie en ms), fumée (vie ; puffs : nombre de bouffées), sol
// noirci (part du rayon). Bombes : en piqué (bomb) et en chapelet (stick). Sans signature : l'obus générique.
const SIG = {
  mortar: { life: 260, fire: 0, smoke: 1100, scorch: 0.45 },
  heavy: { life: 360, fire: 0.55, geyser: 1700, curtain: 4, dustA: 0.3, dust: 9000, smoke: 2600, scorch: 1 },
  bomb: { life: 460, fire: 0.9, geyser: 1900, curtain: 5, dustA: 0.3, dust: 10000, smoke: 3600, scorch: 1.1 },
  rocket: { life: 240, fire: 0.6, smoke: 2000, puffs: 3, scorch: 0.55 },
  stick: { life: 380, fire: 0.8, geyser: 1400, curtain: 2, dustA: 0.2, dust: 8000, smoke: 2600, scorch: 0.9 }, // bombe de chapelet
};
// Obus isolé d'appui passif, avec la signature de sa pièce (mortiers, artillerie lourde).
const PASSIVE_ARC = { mortar: { ...ARC.passive, sig: 'mortar' }, heavy: { ...ARC.passive, r: 4, sig: 'heavy' } };
const PASSIVE = { max: 3, odds: 0.45 }; // obus d'appui passif par tick dans la vue, au plus ; chance par groupe
const MAX_PARTS = 2400;
// Ce que soulèvent les blindés en marche, selon le temps : poussière ocre (sec), gerbes de boue (pluie), neige
// poudreuse (neige), poussière rabattue (brouillard). rate : bouffées par ms et par char ; life (ms) ; grow : px par
// seconde ; drift : part du vent ; fall : gravité (boue) ; a : opacité.
const KICK = {
  dust: { rgb: '196, 170, 122', rate: 0.03, life: 3200, r: 3, grow: 6, drift: 1, fall: 0, a: 0.36 },
  damp: { rgb: '170, 156, 124', rate: 0.016, life: 1800, r: 2.5, grow: 5, drift: 0.6, fall: 0, a: 0.3 },
  mud: { rgb: '74, 56, 36', rate: 0.035, life: 650, r: 1.2, grow: 1.5, drift: 0.2, fall: 60, a: 0.8, throw: 26 },
  snow: { rgb: '246, 248, 250', rate: 0.028, life: 2000, r: 2.6, grow: 5, drift: 0.9, fall: 0, a: 0.55 },
};
const MAX_KICKS = 900;
const WRECK_SMOKE = 7000; // un avion écrasé fume encore quelques secondes (ms)
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
    this.kicks = []; // poussière, boue ou neige soulevée par les blindés { t0, x, y, vx, vy, kind }
    this.crashes = []; // avions écrasés qui fument { x, y, t0 }
  }

  clear() {
    this.parts.length = 0;
    this.glow = [];
    this.plumes.length = 0;
    this.kicks.length = 0;
    this.crashes.length = 0;
  }

  // Un char en marche à (x, y), cap ang : il soulève derrière lui de quoi faire un panache (dt : ms depuis l'image
  // précédente ; k : échelle des chars).
  kick(x, y, ang, k, dt, kind) {
    const K = KICK[kind] ?? KICK.dust;
    let n = K.rate * Math.min(80, dt);
    n = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    const bx = x - Math.cos(ang) * 8 * k, by = y - Math.sin(ang) * 8 * k, now = performance.now();
    for (let q = 0; q < n; q++) {
      const side = (Math.random() - 0.5) * 2;
      const t = K.throw ?? 4;
      this.kicks.push({ t0: now, x: bx + side * 2 * k, y: by + (Math.random() - 0.5) * 2 * k, vx: -Math.cos(ang) * t * (0.5 + Math.random()) - Math.sin(ang) * side * t * 0.5, vy: -Math.sin(ang) * t * (0.5 + Math.random()) + Math.cos(ang) * side * t * 0.5 - (K.throw ? t : 0), kind, k });
    }
    if (this.kicks.length > MAX_KICKS) this.kicks.splice(0, this.kicks.length - MAX_KICKS);
  }

  // Panaches des blindés : ils s'élargissent et filent sous le vent ; la boue retombe aussitôt.
  drawKicks(ctx, now) {
    if (!this.kicks.length) return;
    this.kickSprites ??= Object.fromEntries(Object.entries(KICK).map(([k, K]) => [k, puffSprite(K.rgb)]));
    const w = this.wind, v = 0.006 * (0.4 + w.k);
    let alive = 0;
    for (const p of this.kicks) {
      const K = KICK[p.kind], age = now - p.t0, u = age / K.life;
      if (u >= 1 || u < 0) continue;
      alive++;
      const s = age / 1000;
      const x = p.x + p.vx * s + w.x * v * K.drift * age, y = p.y + p.vy * s + 0.5 * K.fall * s * s + w.y * v * K.drift * age;
      const R = (K.r + K.grow * s) * p.k;
      ctx.globalAlpha = K.a * (1 - u) * Math.min(1, u * 6);
      ctx.drawImage(this.kickSprites[p.kind], x - R, y - R, R * 2, R * 2);
    }
    ctx.globalAlpha = 1;
    if (this.kicks.length > 100 && alive < this.kicks.length * 0.7) this.kicks = this.kicks.filter((p) => now - p.t0 < KICK[p.kind].life);
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
        // Salves de lance-roquettes (frontspecial.js) : pendant leurs premiers ticks, sans batterie visible.
        const salvos = front.tick <= 3 ? (front.salvos?.[s] ?? []).map((o) => ({ ...o, kind: s === 0 ? 'nebel' : 'rocket' })) : [];
        for (const b of [...front.barrages[s], ...salvos, ...salvos]) {
          const bx = b.x * C, by = b.y * C, R = b.r * C;
          if (bx < rect.x0 - R || bx > rect.x1 + R || by < rect.y0 - R || by > rect.y1 + R) continue;
          if (viewer !== null && s !== viewer && !this.barrageSeen(front, viewer, b)) continue;
          // Barrage focalisé : chaque groupe engagé tire sa part, depuis sa position.
          const guns = missionGuns(b).map((id) => (front.guns ?? []).find((x) => x.id === id)).filter(Boolean);
          for (const g of guns.length ? guns : [null]) {
            const A = ARC[g?.kind ?? b.kind] ?? ARC.div;
            const gunSeen = g && (viewer === null || g.side === viewer || g.seen?.[viewer]?.clock === front.clock);
            // Lance-roquettes : toute la salve part d'un coup, roquette après roquette ; elle s'étale en ellipse
            // allongée dans l'axe du tir (la dispersion en portée l'emporte sur la dérive).
            const ang = g ? Math.atan2(by - g.y * C, bx - g.x * C) : s === 0 ? 0 : Math.PI;
            const t1 = now + Math.random() * dur * 0.55;
            for (let q = 0; q < A.n; q++) {
              let tx, ty, t;
              if (A.ripple) {
                const along = (Math.random() * 2 - 1) * R, across = (Math.random() * 2 - 1) * R * 0.38;
                tx = bx + Math.cos(ang) * along - Math.sin(ang) * across;
                ty = by + Math.sin(ang) * along + Math.cos(ang) * across;
                t = t1 + q * A.ripple + Math.random() * A.ripple * 0.6;
              } else {
                const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
                tx = bx + Math.cos(a) * r; ty = by + Math.sin(a) * r; t = at();
              }
              if (g) this.arc(g.x * C, g.y * C, tx, ty, t, A, !gunSeen);
              else this.blast(tx, ty, t, A.r + Math.random() * A.r * 0.4, false, A.sig);
            }
          }
        }
      }
    }
    // Appui passif : quelques obus épars sur les cases ennemies au contact, à portée des groupes, des deux camps.
    // PASSIVE.max par tick au plus dans la vue ; l'obus d'une batterie qu'on ne voit pas n'apparaît qu'en fin de course.
    if (front.phase === 'resolve' || front.tick > 0) {
      let budget = PASSIVE.max;
      const guns = (front.guns ?? []).filter((g) => !g.lost && !GUN_KINDS[g.kind].at && gunPower(g) > 0 && !(front.tick <= front.cfg.barrageTicks && onMission(front, g)));
      for (let q = guns.length - 1; q > 0; q--) { const r = (Math.random() * (q + 1)) | 0; [guns[q], guns[r]] = [guns[r], guns[q]]; }
      for (const g of guns) {
        if (budget <= 0 || !e.length || Math.random() > PASSIVE.odds) continue;
        const R = GUN_KINDS[g.kind].range;
        for (let tries = 0; tries < 6; tries++) {
          const k = ((Math.random() * e.length) / 3 | 0) * 3;
          const t = front.owner[e[k]] === 1 - g.side ? e[k] : front.owner[e[k + 1]] === 1 - g.side ? e[k + 1] : -1;
          if (t < 0 || Math.hypot(cx[t] - g.x, cy[t] - g.y) > R || !seen(t) || !shown(t)) continue;
          const gunSeen = viewer === null || g.side === viewer || g.seen?.[viewer]?.clock === front.clock;
          this.arc(g.x * C, g.y * C, jit(cx[t]) * C, jit(cy[t]) * C, at(), PASSIVE_ARC[g.kind] ?? ARC.passive, !gunSeen);
          budget--;
          break;
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
      const mission = front.barrages[g.side].find((b) => missionGuns(b).includes(g.id));
      const salvo = front.tick <= front.cfg.barrageTicks && mission;
      for (let q = 0; q < (salvo ? 5 : 2); q++) this.blast(gx + (Math.random() - 0.5) * 10, gy + (Math.random() - 0.5) * 6, at(), 2.2, true);
    }
    // Aviation : les avions décollent au tick d'approche, piquent sur l'objectif, puis rentrent ; la DCA tire sur
    // leur route. On voit ses propres sorties, et celles de l'ennemi qui frappent là où l'on voit.
    const first = AIR.strikeTicks[0];
    // Au matin, l'escadrille passe haut au-dessus de la vue : traînées de condensation, ombre lointaine au sol.
    if (front.tick === 1 && [0, 1].some((s) => (viewer === null || s === viewer) && front.air?.[s]?.length)) {
      const s = viewer ?? [0, 1].find((x) => front.air?.[x]?.length);
      const W = rect.x1 - rect.x0, H = rect.y1 - rect.y0, dir = s === 0 ? 1 : -1;
      const x0 = dir > 0 ? rect.x0 - W * 0.15 : rect.x1 + W * 0.15, y0 = rect.y0 + H * (0.65 + Math.random() * 0.25);
      for (let k = 0; k < 3; k++) {
        this.parts.push({ k: 'high', t0: now + k * 180, life: dur * 5, x0: x0 - dir * k * 26, y0: y0 + (k - 1) * 22, x1: x0 + dir * W * 1.3 - dir * k * 26, y1: y0 - H * 0.75 + (k - 1) * 22, side: s });
      }
    }
    for (const s of [0, 1]) {
      for (const m of front.air?.[s] ?? []) {
        const tc = Math.max(0, Math.min(front.map.N - 1, Math.round(m.y / 1.5) * front.map.W + Math.round(m.x / 1.732)));
        if (viewer !== null && s !== viewer && !front.vision[viewer][tc]) continue;
        if (front.tick === first && m.power > 0) this.raid(front, s, m, now, dur);
      }
    }
    // Villes qui tombent : une grosse explosion.
    for (const ev of events) {
      if (ev.kind !== 'capture' || !front.map.towns.some((t) => t.i === ev.i) || !seen(ev.i)) continue;
      this.blast(cx[ev.i] * C, cy[ev.i] * C, now + dur * 0.5, 13);
    }
    if (this.parts.length > MAX_PARTS) this.parts.splice(0, this.parts.length - MAX_PARTS);
  }

  // Raid d'une mission, programmé en entier au tick d'approche (vie d'un avion : 4,4 ticks, sur l'objectif à mi-vie,
  // comme les moteurs du raid dans audio.js). Selon la mission et le camp :
  // - chasse : bombardiers en piqué (Ju 87 Stuka, Pe-2) en file, qui basculent l'un après l'autre sur la batterie,
  //   larguent au bas du piqué et ressourcent ;
  // - appui allemand : He 111 en V, en palier ; chacun lâche un chapelet de bombes qui marche sur la zone le long
  //   de sa route (tapis) ;
  // - appui soviétique : Il-2 en échelon, en rase-mottes ; rafales de canons (lignes de poussière le long de la
  //   route), roquettes, petites bombes.
  // L'appui (trois ticks de frappe) revient en deuxième vague, un tick plus tard, à côté. La DCA ennemie qui a tiré
  // sur la route (m.flak) suit les avions de ses traçants (drawPlanes).
  raid(front, s, m, now, dur) {
    const C = this.cell, o = airBase(front, s, m), life = dur * 4.4;
    const mode = m.kind === 'hunt' ? 'dive' : s === 0 ? 'level' : 'strafe';
    const type = { dive: s === 0 ? 'stuka' : 'pe2', level: 'he111', strafe: 'il2' }[mode];
    const tx = m.x * C, ty = m.y * C;
    const dx = tx - o.x * C, dy = ty - o.y * C, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const v = L / (life * 0.5); // vitesse au sol (px par ms) à l'approche, en palier
    const aa = (m.flak ?? []).map((id) => front.aa.find((a) => a.id === id)).filter(Boolean).map((a) => ({ x: a.x * C, y: a.y * C, side: a.side }));
    const waves = m.kind === 'strike' ? 2 : 1;
    for (let w = 0; w < waves; w++) {
      for (let k = 0; k < 3; k++) {
        // Place dans la formation : en arrière (back, px) et sur le côté (side, px) du chef de file.
        const back = mode === 'dive' ? 0 : mode === 'level' ? (k ? 1.7 : 0) * C : k * 1.3 * C;
        const side = (mode === 'dive' ? (k - 1) * 0.5 : mode === 'level' ? [0, -2, 2][k] : k * 1.3 - 1.3) * C + w * 1.6 * C;
        const t0 = now + w * dur * 1.1 + (mode === 'dive' ? k * life * 0.06 : back / v);
        const ox = -uy * side, oy = ux * side;
        const p = { k: 'plane', t0, life, x0: o.x * C + ox, y0: o.y * C + oy, x1: tx + ox, y1: ty + oy, side: s, type, mode, aa, down: w === 0 && k >= 3 - (m.downed ?? 0), peel: k % 2 ? 1 : -1, ph: Math.random() * 6 };
        this.parts.push(p);
        if (p.down) continue;
        const at = (d) => t0 + life * 0.5 + d / v; // instant où l'avion passe à d px au-delà de l'objectif
        if (mode === 'dive') {
          // Largage au bas du piqué (fin de la deuxième moitié du piqué), bombe lourde sur la batterie.
          const F = Math.min(450, life * 0.03), miss = (m.missed ? 1.4 : 0.35) * C;
          const ix = tx + (Math.random() - 0.5) * miss, iy = ty + (Math.random() - 0.5) * miss;
          this.parts.push({ k: 'bomb', t0: t0 + life * 0.5 - F, life: F, x0: p.x1 - ux * 4, y0: p.y1 - uy * 4, x1: ix, y1: iy, alt: 0.15 });
          this.blast(ix, iy, t0 + life * 0.5, 9 + Math.random() * 2, false, 'bomb');
          if (type === 'pe2') this.blast(ix + ux * 6, iy + uy * 6, t0 + life * 0.5 + 90, 6.5, false, 'stick');
        } else if (mode === 'level') {
          // Chapelet : six bombes à intervalle régulier, centré sur l'objectif ; chacune tombe en suivant l'avion.
          const S = AIR.strikeR * C * 2, F = Math.min(800, life * 0.06);
          for (let q = 0; q < 6; q++) {
            const d = -S / 2 + (S * q) / 5 + (Math.random() - 0.5) * 2.5;
            const ix = p.x1 + ux * d + (Math.random() - 0.5) * 2.5, iy = p.y1 + uy * d + (Math.random() - 0.5) * 2.5;
            this.parts.push({ k: 'bomb', t0: at(d) - F, life: F, x0: ix - ux * v * F * 0.25, y0: iy - uy * v * F * 0.25, x1: ix, y1: iy, alt: 0.9 });
            this.blast(ix, iy, at(d), 6 + Math.random() * 1.5, false, 'stick');
          }
        } else {
          // Rafales de canons : deux lignes de poussière qui courent devant l'avion ; puis roquettes et petites bombes.
          const d0 = -AIR.strikeR * C * 1.3, d1 = AIR.strikeR * C * 0.3, lead = 1.6 * C;
          for (const c of [-1, 1]) {
            const cx0 = p.x1 + ux * d0 - uy * c * 1.4, cy0 = p.y1 + uy * d0 + ux * c * 1.4;
            this.parts.push({ k: 'strafe', t0: at(d0 - lead), life: (d1 - d0) / v + 700, walk: (d1 - d0) / v, x0: cx0, y0: cy0, x1: cx0 + ux * (d1 - d0), y1: cy0 + uy * (d1 - d0), lead, side: s, n: 14 });
          }
          for (let q = 0; q < 2; q++) {
            const d = d1 * 0.4 + q * 5 + Math.random() * 4, sd = (Math.random() - 0.5) * 8;
            this.blast(p.x1 + ux * d - uy * sd, p.y1 + uy * d + ux * sd, at(d - lead), 5 + Math.random(), false, 'rocket');
          }
          for (let q = 0; q < 4; q++) {
            const d = d1 + q * 4 + Math.random() * 3, sd = (Math.random() - 0.5) * 10;
            this.blast(p.x1 + ux * d - uy * sd, p.y1 + uy * d + ux * sd, at(d) + 400, 3.6, true);
          }
        }
      }
    }
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
    this.blast(x1, y1, t0 + life, A.r + Math.random() * A.r * 0.4, !!A.small, A.sig);
  }

  shell(from, to, t0, side) {
    this.parts.push({ k: 'tracer', t0, life: 110, x0: from.x, y0: from.y, x1: to.x, y1: to.y, side, w: 2.2 });
    this.parts.push({ k: 'flash', t0, life: 90, x: from.x, y: from.y, r: 3.5 });
    this.blast(to.x, to.y, t0 + 110, 3.5, true);
  }

  // Explosion : éclair, boule de feu, onde, gerbe de terre ; puis fumée qui s'élève et sol noirci. sig : signature du
  // calibre (SIG) — mortier : coup sec, petite bouffée grise, presque pas de feu ; obus lourd et bombe : éclair bref,
  // geyser de terre vertical puis rideau de poussière brune qui dérive ; roquette : éclair vif, courtes bouffées.
  blast(x, y, t0, r, small = false, sig = null) {
    const S = SIG[sig];
    if (!S) {
      this.parts.push({ k: 'blast', t0, life: 420, x, y, r, a: Math.random() * Math.PI });
      this.parts.push({ k: 'smoke', t0: t0 + 60, life: small ? 1600 : 3200, x, y, r, dx: (Math.random() - 0.3) * r * 0.8, dy: -r * (0.6 + Math.random() * 0.6) });
      if (!small) this.parts.push({ k: 'scorch', t0, life: 14000, x, y, r: r * (0.6 + Math.random() * 0.3) });
      return;
    }
    const w = this.wind;
    this.parts.push({ k: 'blast', t0, life: S.life, x, y, r, a: Math.random() * Math.PI, sig, fire: S.fire });
    if (S.geyser) {
      // Mottes : vitesse latérale et verticale (px/s), tirées une fois pour toutes.
      const clods = [];
      for (let q = 0; q < (small ? 7 : 14); q++) {
        const a = Math.random() * Math.PI * 2, v = (0.4 + Math.random()) * r * 1.6;
        clods.push(Math.cos(a) * v, Math.sin(a) * v * 0.5, -(3.2 + Math.random() * 3.4) * r, 0.5 + Math.random() * 0.8);
      }
      // Jets : angle (depuis la verticale), longueur et épaisseur (parts du rayon) ; l'éventail s'ouvre vers le haut.
      const jets = [];
      for (let q = 0; q < (small ? 4 : 6); q++) jets.push((Math.random() - 0.5) * 1.4, 1.3 + Math.random() * 1.5, 0.2 + Math.random() * 0.16);
      this.parts.push({ k: 'geyser', t0, life: S.geyser * (small ? 0.75 : 1), x, y, r, clods, jets });
      for (let q = 0; q < (small ? 1 : S.curtain); q++) {
        const off = (q / Math.max(1, S.curtain - 1) - 0.5) * r * 2.2;
        this.parts.push({ k: 'curtain', t0: t0 + 180 + q * 70, life: S.dust * (0.75 + Math.random() * 0.4), x: x - w.y * off, y: y + w.x * off - r * 0.6, r: r * (0.9 + Math.random() * 0.5), v: S.dustA * (0.4 + Math.random() * 0.6) });
      }
    }
    if (sig === 'mortar') this.parts.push({ k: 'specks', t0, life: 340, x, y, r, a: Math.random() * Math.PI });
    for (let q = 0; q < (S.puffs ?? 1); q++) {
      const ox = (Math.random() - 0.5) * r * 0.9, oy = (Math.random() - 0.5) * r * 0.6;
      this.parts.push({ k: 'smoke', t0: t0 + 40 + q * 60, life: S.smoke * (small ? 0.6 : 1) * (0.8 + Math.random() * 0.4), x: x + ox, y: y + oy, r: r * (sig === 'mortar' ? 0.75 : S.puffs ? 0.7 : 0.9), dx: w.x * r * 0.8 + (Math.random() - 0.5) * r * 0.5, dy: -r * (0.4 + Math.random() * 0.5), grey: sig === 'mortar' });
    }
    if (!small) this.parts.push({ k: 'scorch', t0, life: 14000, x, y, r: r * S.scorch * (0.6 + Math.random() * 0.3) });
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

  // Trajectoire d'un avion (part p) à l'instant u de sa vie (0 à 1) : position au sol, altitude (0 à 1), cap,
  // raccourci du fuselage (fore : en piqué, vu d'en haut, l'avion se présente de face) et bascule (roll : les ailes
  // s'amincissent). Sur l'objectif à mi-vie ; puis dégagement en virage vers le nord et retour.
  flight(p, u) {
    const dx = p.x1 - p.x0, dy = p.y1 - p.y0, L = Math.hypot(dx, dy) || 1, ux = dx / L;
    const line = (v) => [p.x0 + dx * v, p.y0 + dy * v]; // v : part de la route (1 : objectif)
    let x, y, alt, ang = Math.atan2(dy, dx), fore = 1, roll = 0, uE, altE;
    if (p.mode === 'dive') {
      // Croisière jusqu'au point de bascule, piqué raide (peu de chemin au sol, l'avion rejoint son ombre).
      const vP = 1 - Math.min(L * 0.3, this.cell * 3.2) / L;
      uE = 0.5; altE = 0.12;
      if (u < 0.36) { [x, y] = line((vP * u) / 0.36); alt = 0.85; }
      else if (u < 0.5) {
        const w = (u - 0.36) / 0.14, e = w * w * (3 - 2 * w);
        [x, y] = line(vP + (1 - vP) * e);
        alt = 0.85 - 0.73 * e;
        fore = 1 - 0.55 * Math.sin(Math.PI * Math.min(1, w * 1.2));
        roll = w < 0.35 ? Math.sin((w / 0.35) * Math.PI) * 1.1 : 0;
        ang += p.peel * 0.3 * Math.sin(Math.min(1, w * 2.5) * Math.PI);
      }
    } else {
      // Palier (He 111) ou rase-mottes (Il-2, qui descend sur la zone) ; tout droit un peu au-delà de l'objectif.
      const low = p.mode === 'strafe';
      uE = 0.58; altE = low ? 0.16 : 0.9;
      if (u < uE) {
        [x, y] = line(u / 0.5);
        const e = Math.max(0, Math.min(1, (u - 0.28) / 0.18));
        alt = low ? 0.55 - 0.39 * e * e * (3 - 2 * e) : 0.9;
      }
    }
    if (u >= uE) {
      const v = (u - uE) / (1 - uE), [sx, sy] = p.mode === 'dive' ? line(1) : line(uE / 0.5);
      const bx = sx + ux * 140, by = sy - 60, ex = p.x0, ey = sy - 160;
      x = (1 - v) ** 2 * sx + 2 * (1 - v) * v * bx + v * v * ex;
      y = (1 - v) ** 2 * sy + 2 * (1 - v) * v * by + v * v * ey;
      ang = Math.atan2(2 * (1 - v) * (by - sy) + 2 * v * (ey - by), 2 * (1 - v) * (bx - sx) + 2 * v * (ex - bx));
      alt = altE + (0.9 - altE) * Math.min(1, v * 1.6);
      // Ressource : l'avion se cabre, vu d'en haut il raccourcit encore un instant.
      if (p.mode === 'dive' && v < 0.12) fore = 1 - 0.4 * (1 - v / 0.12);
    }
    return { x, y, alt, ang, fore, roll };
  }

  // Avions vus de dessus ; ombre portée d'autant plus loin qu'ils volent haut, et silhouette un peu plus grande en
  // altitude (plus près de l'œil). Abattu : il part en vrille dans la fumée et s'écrase. DCA : gerbes de traçants
  // depuis les batteries qui ont tiré, éclatements à hauteur des avions (petits et hauts sur une formation en
  // altitude, ombre décalée au sol ; en rase-mottes, surtout des traçants).
  drawPlanes(ctx, now, px) {
    const k = Math.max(1, px * 0.9) * 1.1, C = this.cell;
    const dt = Math.min(100, Math.max(0, now - (this.lastAir || now)));
    this.lastAir = now;
    const lift = (alt) => alt * 14 * k;
    // Éclatements de DCA : éclair, flocon sombre qui s'étale ; son ombre au sol, décalée comme celle des avions.
    for (const p of this.parts) {
      if (p.k !== 'flak' || now < p.t0 || now > p.t0 + p.life) continue;
      const u = (now - p.t0) / p.life, alt = p.alt ?? 0.6, hi = alt > 0.6;
      const r = (hi ? 1.3 + 3 * Math.sqrt(u) : 2 + 4.4 * Math.sqrt(u)) * k * 0.8;
      const x = p.x, y = p.y - lift(alt) - u * 3 * k;
      ctx.globalAlpha = 0.14 * (1 - u);
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(p.x + alt * 22 * k, p.y + alt * 16 * k, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = (hi ? 0.85 : 0.7) * (1 - u);
      ctx.fillStyle = hi ? '#1e1c1a' : '#56524c';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (u < 0.1) {
        ctx.globalAlpha = 1 - u * 10;
        ctx.fillStyle = '#ffcf7a';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // Épaves : une colonne de fumée noire monte quelques secondes du point d'impact.
    this.crashes = this.crashes.filter((c) => now - c.t0 < WRECK_SMOKE);
    for (const c of this.crashes) if (Math.random() < 0.35) this.parts.push({ k: 'smoke', t0: now, life: 3400, x: c.x + (Math.random() - 0.5) * 3, y: c.y, r: 3.2 * k * 0.8, dx: this.wind.x * 14, dy: -22 });
    // Escadrille en altitude : deux traînées blanches par avion, qui s'élargissent et s'effacent derrière lui.
    for (const p of this.parts) {
      if (p.k !== 'high' || now < p.t0 || now > p.t0 + p.life) continue;
      const u = (now - p.t0) / p.life, dx = p.x1 - p.x0, dy = p.y1 - p.y0, L = Math.hypot(dx, dy) || 1, ang = Math.atan2(dy, dx);
      const x = p.x0 + dx * u, y = p.y0 + dy * u, fade = Math.min(1, (1 - u) * 5);
      ctx.fillStyle = 'rgb(252, 252, 248)';
      for (const side of [-1, 1]) {
        for (let q = 0; q < 26; q++) {
          const b = q / 26, back = 6 * k + b * Math.min(L * u, 220 * k);
          ctx.globalAlpha = 0.3 * (1 - b) * fade;
          ctx.beginPath();
          ctx.arc(x - (dx / L) * back - (dy / L) * side * 2.4 * k, y - (dy / L) * back + (dx / L) * side * 2.4 * k, (0.7 + b * 3.6) * k, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const type = p.side === 0 ? 'he111' : 'pe2';
      this.planeSprite(ctx, x + 34 * k, y + 26 * k, ang, p.side, k * 0.6, 0.12 * fade, true, type);
      this.planeSprite(ctx, x, y, ang, p.side, k * 0.6, 0.9 * fade, false, type);
    }
    ctx.globalAlpha = 1;
    // Mitraillage : la poussière jaillit en ligne devant l'Il-2, chaque obus de canon arrive sur un traçant court.
    for (const p of this.parts) {
      if (p.k !== 'strafe' || now < p.t0 || now > p.t0 + p.life) continue;
      const dx = p.x1 - p.x0, dy = p.y1 - p.y0, L = Math.hypot(dx, dy) || 1;
      for (let q = 0; q < p.n; q++) {
        const b = q / (p.n - 1), age = now - (p.t0 + p.walk * b);
        if (age < 0 || age > 700) continue;
        const x = p.x0 + dx * b + Math.sin(q * 7.3) * 1.2, y = p.y0 + dy * b + Math.cos(q * 5.1) * 1.2, u = age / 700;
        ctx.globalAlpha = 0.75 * (1 - u);
        ctx.fillStyle = 'rgb(198, 172, 126)';
        ctx.beginPath();
        ctx.arc(x, y - u * 2, Math.max(1.3, 1.2 * px) * (1 + 2.2 * u) * (q % 3 ? 1 : 1.4), 0, Math.PI * 2);
        ctx.fill();
        if (age < 70) {
          const lx = x - (dx / L) * p.lead, ly = y - (dy / L) * p.lead - lift(0.2) * 0.8, a = age / 70;
          ctx.globalAlpha = 1;
          ctx.strokeStyle = TRACER[p.side];
          ctx.lineWidth = Math.max(0.8, px);
          ctx.beginPath();
          ctx.moveTo(lx + (x - lx) * a * 0.6, ly + (y - ly) * a * 0.6);
          ctx.lineTo(lx + (x - lx) * Math.min(1, a + 0.4), ly + (y - ly) * Math.min(1, a + 0.4));
          ctx.stroke();
          ctx.fillStyle = '#fff4c8';
          ctx.beginPath();
          ctx.arc(x, y, Math.max(0.9, px), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // Bombes qui tombent : point sombre qui suit l'avion et rejoint le sol.
    ctx.fillStyle = '#1a1814';
    for (const p of this.parts) {
      if (p.k !== 'bomb' || now < p.t0 || now > p.t0 + p.life) continue;
      const u = (now - p.t0) / p.life, x = p.x0 + (p.x1 - p.x0) * u, y = p.y0 + (p.y1 - p.y0) * u - lift(p.alt) * (1 - u * u);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.ellipse(x, y, 0.9 * k, 0.45 * k, Math.atan2(p.y1 - p.y0, p.x1 - p.x0), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // DCA : chaque batterie à portée tire sur l'avion le plus proche, gerbes de traçants qui visent devant lui ;
    // éclatements autour.
    const range = AIR.aaRange * C, fire = new Map();
    for (const p of this.parts) {
      if (p.k !== 'plane' || !p.aa?.length || now < p.t0 || now > p.t0 + p.life * 0.7) continue;
      const u = (now - p.t0) / p.life, f = this.flight(p, u);
      if (p.down && u > 0.38) continue;
      for (const a of p.aa) {
        const d = Math.hypot(a.x - f.x, a.y - f.y), key = a.x * 1e5 + a.y;
        if (d < range && !(fire.get(key)?.d < d)) fire.set(key, { a, p, u, alt: f.alt, d });
      }
    }
    for (const { a, p, u, alt } of fire.values()) this.sheaf(ctx, now, dt, p, a, u, alt, k, px);
    for (const p of this.parts) {
      if (p.k !== 'plane' || now < p.t0 || now > p.t0 + p.life) continue;
      const u = (now - p.t0) / p.life;
      let { x, y, alt, ang, fore, roll } = this.flight(p, u);
      if (p.down) {
        // Touché aux deux cinquièmes de l'approche : vrille, fumée, chute.
        const hit = 0.38;
        if (u > hit) {
          const v = Math.min(1, (u - hit) / 0.12), h = this.flight(p, hit);
          x = h.x + Math.cos(h.ang) * 40 * v; y = h.y + Math.sin(h.ang) * 40 * v + 18 * v * v;
          alt = h.alt * (1 - v); ang = h.ang + v * 7; fore = 1; roll = 0;
          if (Math.random() < 0.8) this.parts.push({ k: 'smoke', t0: now, life: 2600, x, y: y - lift(alt), r: 3.2, dx: 3, dy: -6, black: true });
          if (v >= 1) {
            if (!p.crashed) { p.crashed = true; this.blast(x, y, now, 11); this.crashes.push({ x, y, t0: now }); }
            continue;
          }
        }
      }
      const h = lift(alt);
      // Haut dans l'approche : une traînée courte derrière l'avion.
      if (alt > 0.7 && !p.down && p.mode !== 'strafe') {
        ctx.fillStyle = 'rgb(252, 252, 248)';
        for (let q = 0; q < 12; q++) {
          const b = q / 12;
          ctx.globalAlpha = 0.22 * (1 - b) * (alt - 0.7) / 0.3;
          ctx.beginPath();
          ctx.arc(x - Math.cos(ang) * (6 + b * 60) * k, y - h - Math.sin(ang) * (6 + b * 60) * k, (0.6 + b * 2.4) * k, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      this.planeSprite(ctx, x + alt * 22 * k, y + alt * 16 * k, ang, p.side, k * 0.8, 0.26, true, p.type, fore, roll);
      this.planeSprite(ctx, x, y - h, ang, p.side, k * (0.8 + 0.3 * alt), 1, false, p.type, fore, roll);
    }
  }

  // Gerbe de DCA légère de la batterie a vers l'avion p : quelques tubes, rafales de traçants en courbe (le pointeur
  // balaie en suivant), visant devant l'avion, qui s'éteignent en fin de course ; plus l'avion vole haut, plus ils
  // s'éteignent tôt et plus les éclatements (programmés ici, dessinés au début de drawPlanes) l'emportent.
  sheaf(ctx, now, dt, p, a, u, alt, k, px) {
    const lead = this.flight(p, Math.min(1, u + 0.025));
    const ax = lead.x, ay = lead.y - lead.alt * 14 * k;
    const hi = alt > 0.6, reach = hi ? 0.72 : 1;
    ctx.save();
    ctx.lineCap = 'round';
    for (let j = 0; j < (hi ? 2 : 3); j++) {
      // Rafales : le tube tire par à-coups.
      if (Math.sin(now * 0.005 + j * 2.1 + p.ph) < -0.35) continue;
      const gx = a.x + (j - 1.5) * 1.6, gy = a.y + (j % 2) * 1.2;
      const miss = 7 * k * Math.sin(now * 0.0023 + j * 1.7 + p.ph);
      const ex = ax + miss, ey = ay + miss * 0.6, L = Math.hypot(ex - gx, ey - gy) || 1;
      // Courbe : la gerbe s'incurve dans le sens du balayage.
      const bow = L * 0.16 * (j % 2 ? 1 : -0.6) + miss;
      const mx = (gx + ex) / 2 - ((ey - gy) / L) * bow, my = (gy + ey) / 2 + ((ex - gx) / L) * bow;
      const at = (t) => [(1 - t) ** 2 * gx + 2 * (1 - t) * t * mx + t * t * ex, (1 - t) ** 2 * gy + 2 * (1 - t) * t * my + t * t * ey];
      for (let q = 0; q < 6; q++) {
        const t = ((now / (480 + j * 70) + j * 0.31 + q / 6) % 1) * reach;
        const [x0, y0] = at(t), [x1, y1] = at(Math.min(1, t + 0.055));
        const fade = Math.min(1, (reach - t) / 0.15);
        ctx.globalAlpha = 0.5 * fade;
        ctx.strokeStyle = 'rgb(30, 20, 10)';
        ctx.lineWidth = Math.max(0.8, 1.3 * px) + 1.2 * px;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.globalAlpha = fade;
        ctx.strokeStyle = TRACER[a.side];
        ctx.lineWidth = Math.max(0.8, 1.3 * px);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      // Départ des coups.
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#fff4c8';
      ctx.beginPath(); ctx.arc(gx, gy, Math.max(0.8, px), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // Éclatements (canons de 37 à 88 mm) à hauteur de l'avion, devant et autour.
    let n = (hi ? 0.006 : 0.0018) * dt;
    n = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    const spread = (hi ? 16 : 10) * k;
    for (let q = 0; q < n; q++) {
      this.parts.push({ k: 'flak', t0: now, life: hi ? 1700 : 1100, x: lead.x + (Math.random() - 0.5) * spread * 2, y: lead.y + (Math.random() - 0.5) * spread, alt: Math.max(0.1, lead.alt + (Math.random() - 0.4) * 0.18) });
    }
  }

  planeSprite(ctx, x, y, ang, side, k, alpha, shadow, type, fore = 1, roll = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.scale(k * fore, k * Math.max(0.3, Math.cos(roll)));
    ctx.globalAlpha = alpha;
    planeShape(ctx, type, side, shadow);
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
    // Rideau de poussière des gros calibres : il s'élargit, retombe en voile et file sous le vent.
    this.curtainSprite ??= puffSprite('150, 124, 88');
    const w = this.wind, wv = 0.0035 * (0.4 + w.k);
    for (const p of parts) {
      if (p.k !== 'curtain' || now < p.t0 || now > p.t0 + p.life) continue;
      const age = now - p.t0, u = age / p.life;
      const R = p.r * (1 + 2.6 * Math.sqrt(u));
      ctx.globalAlpha = p.v * (1 - u) * Math.min(1, u * 9);
      ctx.drawImage(this.curtainSprite, p.x + w.x * wv * age - R, p.y + w.y * wv * age + p.r * 0.5 * u - R, R * 2, R * 2);
    }
    for (const p of parts) {
      if (p.k !== 'smoke' || now < p.t0 || now > p.t0 + p.life) continue;
      const u = (now - p.t0) / p.life;
      ctx.globalAlpha = (p.black ? 0.7 : 0.5) * (1 - u) * Math.min(1, u * 8);
      ctx.fillStyle = p.black ? 'rgb(30, 28, 26)' : p.grey ? 'rgb(66, 64, 60)' : 'rgb(84, 78, 70)';
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
      } else if (p.k === 'blast' && p.sig) {
        // Signatures : éclair (bref et large pour les gros calibres, sec pour le mortier), boule de feu réduite.
        const r = Math.max(p.r, 3 * px), mortar = p.sig === 'mortar';
        const fl = mortar ? 0.3 : 0.2;
        if (u < fl) {
          ctx.globalAlpha = 1 - u / fl;
          ctx.fillStyle = '#fffbe6';
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * (mortar ? 0.5 : p.sig === 'rocket' ? 0.75 : 0.9) * (0.8 + u * 2), 0, Math.PI * 2);
          ctx.fill();
        }
        if (p.fire > 0) {
          ctx.globalAlpha = Math.max(0, 1 - u * 1.3) * 0.9;
          ctx.fillStyle = '#ff8a2a';
          ctx.beginPath();
          ctx.arc(p.x, p.y - u * r * 0.4, r * p.fire * (1.1 - 0.6 * u), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 0.5 * (1 - u);
        ctx.strokeStyle = '#ffd59a';
        ctx.lineWidth = Math.max(0.6, px);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * (mortar ? 0.5 + u : 0.8 + 1.8 * u), 0, Math.PI * 2);
        ctx.stroke();
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
      if (p.k !== 'blast' || p.r < 5 || (p.sig && p.sig !== 'rocket') || now < p.t0 || now > p.t0 + p.life * 0.7) continue;
      const u = (now - p.t0) / (p.life * 0.7), r = Math.max(p.r, 4 * px);
      for (let q = 0; q < 5; q++) {
        const a = p.a + (q / 5) * Math.PI * 2, r0 = r * (0.7 + 0.8 * u), r1 = r * (1 + 1.1 * u);
        ctx.moveTo(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0);
        ctx.lineTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1);
      }
    }
    ctx.stroke();
    // Mortier : éclats de terre gris sombre, courts, tout autour.
    ctx.strokeStyle = 'rgba(58, 54, 50, 0.9)';
    ctx.lineWidth = Math.max(0.7, px);
    ctx.beginPath();
    for (const p of parts) {
      if (p.k !== 'specks' || now < p.t0 || now > p.t0 + p.life) continue;
      const u = (now - p.t0) / p.life, r = Math.max(p.r, 3 * px);
      for (let q = 0; q < 7; q++) {
        const a = p.a + (q / 7) * Math.PI * 2 + (q % 2) * 0.3, r0 = r * (0.35 + 0.9 * u), r1 = r * (0.6 + 1.1 * u) * (q % 2 ? 0.8 : 1);
        ctx.moveTo(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0 * 0.8);
        ctx.lineTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1 * 0.8);
      }
    }
    ctx.stroke();
    this.drawGeysers(ctx, now, px);
    // Ménage : particules terminées.
    if (parts.length > 200 || !live) this.parts = parts.filter((p) => now < p.t0 + p.life);
  }

  // Gerbes des gros calibres, vues de haut avec un peu de perspective : un éventail de jets de terre jaillit vers le
  // haut de l'écran, retombe et s'effondre en nuage brun au pied ; des mottes montent et retombent en cloche.
  drawGeysers(ctx, now, px) {
    this.dirtSprite ??= puffSprite('92, 70, 46');
    ctx.lineCap = 'round';
    for (const p of this.parts) {
      if (p.k !== 'geyser' || now < p.t0 || now > p.t0 + p.life) continue;
      const age = now - p.t0, u = age / p.life, r = Math.max(p.r, 4 * px), t = age / 1000;
      const rise = 1 - (1 - Math.min(1, u / 0.18)) ** 3, fall = Math.max(0, (u - 0.25) / 0.75);
      // Pied de la gerbe : nuage de terre qui s'étale.
      const R = r * (0.9 + 1.2 * Math.sqrt(u));
      ctx.globalAlpha = 0.6 * (1 - u) * Math.min(1, u * 12);
      ctx.drawImage(this.dirtSprite, p.x - R, p.y - R * 0.75 - r * 0.3, R * 2, R * 1.5);
      // Jets : ils montent, puis la terre retombe (le pied du jet remonte vers la pointe et s'efface).
      for (let q = 0; q < p.jets.length; q += 3) {
        const a = p.jets[q], L = r * p.jets[q + 1] * rise * (1 - 0.35 * fall), w = r * p.jets[q + 2];
        const sx = Math.sin(a), sy = -Math.cos(a), b0 = L * Math.min(0.9, fall * 1.1);
        ctx.globalAlpha = 0.75 * (1 - fall) ** 1.2;
        ctx.strokeStyle = 'rgb(66, 50, 34)';
        ctx.lineWidth = Math.max(0.8 * px, w * (1 - 0.4 * fall));
        ctx.beginPath();
        ctx.moveTo(p.x + sx * b0, p.y + sy * b0);
        ctx.lineTo(p.x + sx * L, p.y + sy * L);
        ctx.stroke();
        // Pointe claire : terre pulvérisée prise par la lumière.
        ctx.globalAlpha *= 0.6;
        ctx.strokeStyle = 'rgb(150, 124, 92)';
        ctx.lineWidth = Math.max(0.6 * px, w * 0.55);
        ctx.beginPath();
        ctx.moveTo(p.x + sx * L * 0.8, p.y + sy * L * 0.8);
        ctx.lineTo(p.x + sx * L, p.y + sy * L);
        ctx.stroke();
      }
      // Mottes : trajectoire balistique ; posées, elles s'effacent.
      const c = p.clods, g = 9 * r;
      ctx.fillStyle = 'rgb(44, 32, 22)';
      for (let q = 0; q < c.length; q += 4) {
        const land = (-2 * c[q + 2]) / g, tt = Math.min(t, land);
        const x = p.x + c[q] * tt, y = p.y + c[q + 1] * tt + c[q + 2] * tt + 0.5 * g * tt * tt;
        ctx.globalAlpha = t < land ? 0.95 : Math.max(0, 0.8 - (t - land) * 1.2);
        if (ctx.globalAlpha <= 0) continue;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5 * px, r * 0.1 * c[q + 3]), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  busy(now) { return this.glow.length > 0 || this.plumes.length > 0 || this.parts.some((p) => now < p.t0 + p.life); }
}
