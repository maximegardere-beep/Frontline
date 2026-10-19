// Rendu du front stratégique. La micro-grille reste la vérité du jeu ; le rendu en tire des champs continus :
// - terrain (une fois par bataille) : relief lissé, teintes et ombrage, courbes de niveau, forêts, marais,
//   montagnes hachurées, villes ;
// - masses de troupes (à chaque tick, interpolées entre deux ticks) : chaque camp est une masse colorée, plus
//   opaque où il est dense ; des contours de densité font apparaître les concentrations qui fusionnent
//   (métaballes) ; le front est la ligne de partage, épaisse et sombre ;
// - brouillard : l'ennemi est dessiné d'après ce que le joueur en sait (densité estimée), estompé hors de vue ;
// - combats (frontfx.js) : lueurs au contact, tirs traçants, obus, barrages ;
// - ordres à l'encre jaune, poches, villes.

import { Renderer, splineTo, splineAt, blobPath, contourSegments, strokeSegments, ELEV_STOPS, PALETTE } from './render.js';
import { hexToPixel, pixelToHex, SQRT3 } from './hex.js';
import { ALERT } from './frontalert.js';
import { bfsDistance } from './path.js';
import { createRng } from './rng.js';
import { makeNoise } from './mapgen.js';
import { FRONT_KINDS } from './terrain.js';
import { FRONT_WEATHER, VECTOR_TYPES, cellAtPoint, vectorMomentum } from './front.js';
import { MIN_POCKET, ARMOR_ATK } from './frontinput.js';
import { FrontFx } from './frontfx.js';
import { GUN_KINDS, AT_RULES, visibleGuns, gunPower, missionGuns } from './frontguns.js';
import { visibleSupport, SUPPORT, SUPPORT_LEVELS } from './frontbattalion.js';
import { SPECIAL } from './frontspecial.js';
import { visibleArmor, armorRoute } from './frontarmor.js';
import { AIR, airBase, visibleAA } from './frontair.js';
import { railPoint } from './frontsupply.js';
import { visibleHQ, hqState, HQ } from './fronthq.js';
import { buildCity, drawCity, cityFrontEdges, inCity, drawDistricts, drawLandmarks, drawFerries, drawCityGlow } from './frontcity.js';
import { SPRITE_PAL, WRECK_PAL, piece, tank, wreck, howitzer, towed, mortar, rocket, nebelwerfer, pit, dust } from './frontsprites.js';

export const CELL = 9; // rayon d'une case de la micro-grille, en pixels monde

const K = Object.fromEntries(FRONT_KINDS.map((k, i) => [k, i]));
const SIDE_RGB = [[52, 84, 138], [178, 42, 30]]; // Wehrmacht, Armée rouge
const SIDE_LINE = ['#26303d', '#4a1610'];
// Points des troupes : [ombre, couleur] par camp.
const DOT_RGB = [['#1e2f4a', '#3a5a8e'], ['#5a170c', '#b0371f']];
// Densité → points : par unité de densité (au plus max par case de contact), profondeur de la bande (pixels monde)
// à faible et forte densité, échelle de densité, rayon ; à l'arrière, densité d'une case et d'un amas retenus.
const DOTS = { per: 0.45, max: 14, depth0: 4, depth: 22, scale: 14, r: 1.1, rearCell: 6, group: 30 };
const ORDER_INK = '#ffd23f'; // ordres du joueur
const ORDER_HALO = 'rgba(24, 20, 10, 0.8)';
// Élan d'une attaque en cours (vectorMomentum) : couleur et forme de la marque posée à la tête de l'avance.
const ORDER_EMPTY = 'rgba(246, 238, 214, 0.78)'; // intérieur d'une flèche creuse : ce qui reste à prendre
const MOMENTUM_INK = { start: ORDER_INK, wait: '#b9b29c', advance: '#4fc94a', breakthrough: '#b4ff3c', stall: '#ff8a1f', repulsed: '#ef3b2c' };
const SPRITE_K = 1.7; // échelle des pièces vues de dessus (lisibles sans zoomer)
// Chars : plus petits que les pièces d'artillerie (une formation ne doit pas couvrir le secteur qu'elle attaque) ;
// échelle monde, et plancher à l'écran quand on dézoome.
const TANK_K = 0.95, TANK_SCREEN = 0.8;
const tankScale = (s) => TANK_K * Math.max(1, TANK_SCREEN / s);
// Coin de chars : jusqu'à trois (deux en vue d'ensemble), serrés.
const TANK_FORM = [[0, 0], [-8, -7], [-8, 7]];
const FIRE = { decay: 0.965, gain: 5, min: 0.08 }; // incendies : déclin par tick, attisement par point de destruction
// Fumée des combats : chaleur par unité de densité perdue, déclin par tick, apport d'un cratère ; seuil d'un foyer,
// chaleur d'un foyer à plein, espacement (unités de grille), nombre au plus, débit relatif à un incendie.
const SMOKE = { loss: 1.5, decay: 0.9, barrage: 0.25, min: 0.6, full: 3, space: 3.5, max: 28, rate: 0.8 };
const NIGHT_INK = 'rgba(150, 186, 236, 0.95)'; // regroupements de l'état-major, la nuit
// Colonnes sur les routes : vitesse (pixels monde par ms), camions par colonne, écart entre deux camions.
const CONVOY = { speed: 0.012, trucks: 4, gap: 6 };
// Ce que soulèvent les véhicules selon le temps (frontfx.js, KICK) ; couleur de la poussière des camions.
const KICK_OF = { clear: 'dust', fog: 'damp', rain: 'mud', snow: 'snow' };
const CONVOY_DUST = { clear: 'rgb(214, 198, 156)', fog: 'rgb(186, 176, 150)', rain: 'rgb(96, 76, 52)', snow: 'rgb(246, 248, 250)' };
// Ombres de nuages : par temps clair, quelques cumulus espacés ; pluie et neige, ciel bas (voile, ombres serrées,
// trouées de soleil) ; pas sous le brouillard. size : largeur d'une ombre (part de la carte) ; cross : nombre de ticks
// pour traverser la carte par vent moyen.
const CLOUDS = { clear: { n: 5, a: 0.3, size: 0.3 }, rain: { n: 10, a: 0.32, size: 0.3, veil: 0.12, sun: 2 }, snow: { n: 9, a: 0.28, size: 0.32, veil: 0.08, sun: 2 }, cross: 30 };
// Poches : teinte et pouls du contour ; drapeaux blancs quand il reste moins de flags de l'effectif encerclé au départ.
const POCKET_FX = { tint: [[52, 84, 138], [176, 44, 30]], a: 0.34, flags: 0.35 };

// Drapeau blanc planté dans une poche qui se rend ; il flotte pendant la journée (live). k : échelle (px monde).
function whiteFlag(g, x, y, now, k, live) {
  const t = live ? now / 1000 : 0;
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.strokeStyle = '#3a2e1c';
  g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -16); g.stroke();
  g.fillStyle = '#fbf8ee';
  g.strokeStyle = 'rgba(40, 30, 20, 0.6)';
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(0, -16);
  for (let i = 0; i <= 6; i++) g.lineTo(i * 1.8, -16 + Math.sin(t * 6 + i + x) * 1.2);
  for (let i = 6; i >= 0; i--) g.lineTo(i * 1.8, -10 + Math.sin(t * 6 + i + x) * 1.2);
  g.closePath(); g.fill(); g.stroke();
  g.restore();
}

// Ombre de nuage : amas de disques flous sombres, tirés d'une graine.
function cloudSprite(seed) {
  const c = document.createElement('canvas');
  c.width = 420; c.height = 260;
  const g = c.getContext('2d'), rng = createRng(`cloud:${seed}`);
  for (let i = 0; i < 14; i++) {
    const x = 420 * (0.2 + 0.6 * rng.next()), y = 260 * (0.25 + 0.5 * rng.next()), r = 260 * (0.18 + 0.22 * rng.next());
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${seed < 0 ? '255, 236, 190' : '22, 30, 44'}, 0.55)`);
    gr.addColorStop(0.6, `rgba(${seed < 0 ? '255, 236, 190' : '22, 30, 44'}, 0.35)`);
    gr.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 420, 260);
  }
  return c;
}
// Cratères par tick de barrage à pleine puissance, et leur rayon (pixels monde ; une case fait 9 de rayon).
const SCAR = { div: { n: 6, r: 1.1 }, heavy: { n: 5, r: 1.6 }, mortar: { n: 7, r: 0.9 }, rocket: { n: 9, r: 0.9 }, nebel: { n: 8, r: 0.9 } };
// Usure du terrain par les combats (pertes cumulées par case sur la bataille, plus chaque cratère de barrage) :
// au-delà de trample, la steppe se piétine et brunit ; chaque unité au-delà de crater0 ajoute des trous d'obus
// (per, au plus max par case) ; vers moon, la case devient un champ lunaire gris, criblé de cratères qui se recoupent.
// Mesure (4 batailles IA contre IA) : sur ~700 cases touchées, la moitié dépasse 2,5, un cinquième 12, 5 % 40.
const WEAR = { crater: 0.6, trample: 1.5, full: 25, crater0: 5, per: 0.55, max: 42, moon: 35 };
// Champs qui brûlent (été, temps sec) : chaleur des combats qui allume la steppe, probabilité par tick, déclin du feu,
// propagation sous le vent (sur gen cases au plus depuis le foyer), seuil sous lequel il s'éteint.
const FIELD_FIRE = { heat: 3, chance: 0.04, decay: 0.88, spread: 0.12, gen: 2, min: 0.12 };
// Épaves : chars perdus par carcasse, au plus par bataille ; ticks pendant lesquels elles fument.
const WRECK = { per: 20, max: 90, smoke: 30, spread: 4 };


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
    this.heat = new Float32Array(front.map.N); // intensité récente des combats par case (foyers de fumée)
    this.wear = new Float32Array(front.map.N); // usure cumulée du terrain (WEAR)
    this.wearCraters = new Uint8Array(front.map.N); // cratères d'usure déjà peints par case
    this.wearDirty = true; // teinte de la terre labourée à repeindre (wearImage)
    this.wearAny = false;
    this.fieldFire = new Float32Array(front.map.N); // steppe en feu (0 à 1)
    this.burnt = new Uint8Array(front.map.N); // chaume brûlé (ne repart pas) : 1 + distance au foyer
    this.tanksSeen = new Map(); // chars de chaque formation au tick précédent, et reliquat de pertes (épaves)
    this.smoke = []; // foyers de fumée visibles : [x, y, force] × n
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

  // Segments de contour (x1, y1, x2, y2 en pixels monde) privés de ceux dont le milieu tombe sur une case d'eau sans
  // propriétaire.
  dryFront(segs) {
    const { map } = this;
    if (!map.river) return segs;
    const out = [];
    for (let k = 0; k < segs.length; k += 4) {
      const h = pixelToHex((segs[k] + segs[k + 2]) / 2, (segs[k + 1] + segs[k + 3]) / 2, CELL);
      const i = h.col >= 0 && h.row >= 0 && h.col < map.W && h.row < map.H ? h.row * map.W + h.col : -1;
      if (i >= 0 && map.river[i] && this.front.owner[i] < 0) continue;
      out.push(segs[k], segs[k + 1], segs[k + 2], segs[k + 3]);
    }
    return out;
  }

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
      } else if (k === K.town && !(map.district?.[c] >= 0)) {
        // Maisons : dessinées à chaque image selon l'état de la ville (drawHouses). th : ordre d'effondrement.
        for (let t = 0; t < 4; t++) {
          const hx = p.x + (r.next() - 0.5) * CELL * 1.3, hy = p.y + (r.next() - 0.5) * CELL * 1.2;
          const q = createRng(c * 31 + t);
          this.houses.push({ c, x: hx, y: hy, th: q.next(), fire: q.next(), ph: q.next() * 10, shape: [0, 1, 2, 3, 4, 5].map(() => 0.6 + q.next() * 0.7) });
        }
      }
    }
    if (map.districts) buildCity(this, ctx, CELL); // métropole : quartiers, îlots, avenues, voie ferrée (frontcity.js)
    ctx.textAlign = 'center';
    for (const t of map.towns) {
      if (t.district != null) continue; // métropole : noms des quartiers dessinés au-dessus (drawDistricts)
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
    // Ponts de bateaux : tablier de planches gris-vert posé sur une file de barques, de rive à rive.
    for (let i = 0; i < N; i++) {
      if (!map.pontoon?.[i]) continue;
      const p = this.center(i);
      const j = map.nb[i * 6 + map.pontoonDir[i]];
      const q = j >= 0 ? this.center(j) : { x: p.x + 1, y: p.y };
      const ang = Math.atan2(q.y - p.y, q.x - p.x);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ang);
      const L = CELL * 1.9;
      ctx.fillStyle = 'rgb(58, 62, 52)';
      for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.ellipse(k * L * 0.2, 0, L * 0.08, 4.2, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = 'rgb(122, 128, 104)';
      ctx.fillRect(-L / 2, -1.8, L, 3.6);
      ctx.strokeStyle = 'rgb(54, 58, 46)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let x = -L / 2 + 1.5; x < L / 2; x += 2.2) { ctx.moveTo(x, -1.8); ctx.lineTo(x, 1.8); }
      ctx.stroke();
      ctx.restore();
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
    // Ruisseaux : filet d'eau étroit et sinueux, berges en traits fins ; ils se jettent dans la rivière.
    for (const [w, color] of [[0.62, 'rgba(46, 74, 92, 0.6)'], [0.36, 'rgb(112, 156, 178)']]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = CELL * w;
      for (const st of map.streams ?? []) {
        if (!st.line?.length) continue;
        const pts = st.line.map((_, k) => {
          let x = 0, y = 0, n = 0;
          for (let q = Math.max(0, k - 1); q <= Math.min(st.line.length - 1, k + 1); q++) { const p = pt(st.line[q]); x += p.x; y += p.y; n++; }
          return { x: x / n, y: y / n };
        });
        // Les bouts gardent leur place : la source et la confluence.
        pts[0] = pt(st.line[0]);
        pts[pts.length - 1] = pt(st.line[st.line.length - 1]);
        ctx.beginPath();
        splineTo(ctx, pts);
        ctx.stroke();
      }
    }
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
    this.lastViewer = viewer;
    this.updateFires();
    this.queueCraters();
    this.smokeSources(viewer);
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
    if (this.map.districts) this.cityEdges = cityFrontEdges(this, v, CELL); // front en escalier, en ville
    this.dots = this.troopDots(viewer);
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
      // Teinte légère du camp (les troupes elles-mêmes sont des points le long du front, drawDots) ; hors de vue,
      // l'ennemi est estompé.
      const k = 1 - Math.exp(-d / 5), dark = 1;
      let alpha = (0.15 + 0.05 * k) * Math.min(1, open * 1.3);
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
    this.lastViewer = view.viewer ?? null;
    const worn = this.wearImage();
    if (this.wearAny) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(worn, 0, 0, this.sampler.w * this.sampler.step, this.sampler.h * this.sampler.step);
    }
    this.fx.drawGround(ctx, now);
    this.drawHouses(view.viewer ?? null, false);

    if (!this.cur) this.snapshot(view.viewer ?? null);
    const fields = this.frontImage(Math.max(0, Math.min(1, view.t ?? 1)));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.massCanvas, 0, 0, this.sampler.w * this.sampler.step, this.sampler.h * this.sampler.step);

    ctx.globalAlpha = 1;
    this.drawScars();
    this.drawWrecks(now);
    this.drawHouses(view.viewer ?? null, true);
    this.drawDots(now);
    this.drawWorks(view.viewer ?? null);
    this.drawRails(view.viewer ?? null);
    const spears = f.phase === 'resolve' ? [...this.spearheads(view.viewer ?? null), ...this.armorTrails(view.viewer ?? null)] : [];
    this.drawSpearMass(spears);
    this.fx.drawGlow(ctx, now);
    this.drawFires(view.viewer ?? null, now);
    this.drawFieldFires(view.viewer ?? null, now);

    // Ligne de front : partage des deux camps, épaisse et sombre. Elle s'interrompt sur l'eau infranchissable : là, c'est
    // la rivière qui sépare les camps.
    let line = this.dryFront(contourSegments(fields.o, 0.5));
    if (this.cityEdges) {
      // Métropole : en ville, le front suit les bords des cases (les rues) au lieu de la courbe lissée.
      const out = [];
      for (let k = 0; k < line.length; k += 4) if (!inCity(this, (line[k] + line[k + 2]) / 2, (line[k + 1] + line[k + 3]) / 2, CELL)) out.push(line[k], line[k + 1], line[k + 2], line[k + 3]);
      line = out.concat(this.cityEdges);
    }
    ctx.strokeStyle = 'rgba(250, 240, 210, 0.55)';
    ctx.lineWidth = 4.5;
    strokeSegments(ctx, line);
    ctx.strokeStyle = '#1d1a12';
    ctx.lineWidth = 2.4;
    strokeSegments(ctx, line);
    this.fx.drawOver(ctx, now, 1 / cam.s);
    const w = f.wind ?? { dir: 0, force: 0.4 };
    this.fx.wind = { x: Math.cos(w.dir), y: Math.sin(w.dir), k: w.force };
    this.fx.plumeSources(this.smoke, 'battle');
    this.fx.drawPlumes(ctx, now);
    this.drawSpearTips(spears.filter((sp) => !sp.formation));
    if (f.phase === 'resolve' && !this.fx.still) this.drawConvoys(view.viewer ?? null, now);
    this.drawArmor(view);
    this.drawDaylight(Math.max(0, Math.min(1, view.t ?? 1)));
    this.drawClouds(Math.max(0, Math.min(1, view.t ?? 1)));

    this.drawTowns(view.viewer ?? null);
    if (this.map.districts) {
      drawLandmarks(this, view.viewer ?? null, CELL);
      drawFerries(this, view.viewer ?? null, now, CELL);
      drawDistricts(this, view.viewer ?? null, now, CELL);
    }
    this.drawStrongpoints(view.viewer ?? null);
    this.drawObjectiveMarks();
    this.drawPockets(view.viewer ?? null, now);
    this.drawGuns(view);
    if (f.phase === 'plan') this.drawNightMoves(view.viewer ?? null);
    this.drawAA(view);
    this.drawSupport(view);
    this.drawHQ(view);
    if (f.phase === 'plan') this.drawAirPlans(view.viewer ?? null);
    this.fx.drawArcs(ctx, now, 1 / cam.s);
    this.fx.drawPlanes(ctx, now, 1 / cam.s);
    this.orderClock = { now, t: Math.max(0, Math.min(1, view.t ?? 1)) };
    if (view.orders) this.drawFrontOrders(view.orders, view.viewer);
    if (view.preview) this.drawFrontOrders(view.preview, view.viewer, 0.55);
    if (view.alerts?.length) this.drawAlerts(view.alerts, view.viewer ?? 0, now);
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

  // ---------- Troupes : points le long du front ----------

  // Points de chaque camp, pour le camp observateur : une bande serrée contre la ligne de front, d'autant plus
  // profonde et fournie que le secteur est dense ; à l'arrière, seulement les amas (garnisons, réserves) de plus
  // de 300 hommes, avec leur effectif. Positions tirées d'un générateur par case : stables d'un tick à l'autre.
  troopDots(viewer) {
    const f = this.front, { N, nb, W } = this.map;
    const mem = viewer === null ? null : f.memory[viewer];
    const ownerOf = (i) => (viewer === null || f.owner[i] === viewer ? f.owner[i] : mem.owner[i]);
    const densOf = (i, o) => (viewer === null || o === viewer ? f.dens[i] : mem.est[i]);
    const visOf = (i, o) => viewer === null || o === viewer || f.vision[viewer][i];
    const hot = new Uint8Array(N);
    const e = f.tickEdges ?? [];
    if (f.phase === 'resolve') for (let k = 0; k < e.length; k += 3) hot[e[k]] = 1;
    const dots = [[], []], groups = [];
    const contactSeeds = [];
    // 1. Bande au contact : depuis chaque case de contact, des points tirés entre la frontière et l'intérieur.
    for (let i = 0; i < N; i++) {
      const o = ownerOf(i);
      if (o < 0) continue;
      const foes = [];
      for (let d = 0; d < 6; d++) { const j = nb[i * 6 + d]; if (j >= 0 && ownerOf(j) === 1 - o) foes.push(j); }
      if (!foes.length) continue;
      contactSeeds.push(i);
      // Densité du secteur : la case et ses voisines du même camp.
      let sum = densOf(i, o), n = 1;
      for (let d = 0; d < 6; d++) { const j = nb[i * 6 + d]; if (j >= 0 && ownerOf(j) === o) { sum += densOf(j, o); n++; } }
      const S = sum / n, k = 1 - Math.exp(-S / DOTS.scale);
      const count = Math.min(DOTS.max, Math.round(S * DOTS.per));
      if (!count) continue;
      const r = createRng(i * 7919 + 13);
      const c = this.center(i);
      // Normale : de la frontière (milieu avec les cases ennemies) vers l'intérieur de la case.
      let mx = 0, my = 0;
      for (const j of foes) { const q = this.center(j); mx += (c.x + q.x) / 2; my += (c.y + q.y) / 2; }
      mx /= foes.length; my /= foes.length;
      let nx = c.x - mx, ny = c.y - my;
      const L = Math.hypot(nx, ny) || 1;
      nx /= L; ny /= L;
      const depth = DOTS.depth0 + DOTS.depth * k;
      const seen = visOf(i, o);
      for (let q = 0; q < count; q++) {
        const d = 1.2 + depth * Math.pow(r.next(), 1.8), lat = (r.next() - 0.5) * CELL * 1.7;
        dots[o].push(mx + nx * d - ny * lat, my + ny * d + nx * lat, hot[i] && d < 6 ? -nx : 0, hot[i] && d < 6 ? -ny : 0, r.next() * 6.3, seen ? 1 : 0.55);
      }
    }
    // 2. Arrière : amas de plus de 300 hommes, loin du contact.
    const dist = bfsDistance(nb, N, contactSeeds, (i) => ownerOf(i) >= 0, 6);
    const rear = [];
    for (let i = 0; i < N; i++) { const o = ownerOf(i); if (o >= 0 && dist[i] > 4 && densOf(i, o) > DOTS.rearCell) rear.push(i); }
    rear.sort((a, b) => densOf(b, ownerOf(b)) - densOf(a, ownerOf(a)));
    const taken = new Uint8Array(N);
    let tries = 0;
    for (const i of rear) {
      if (taken[i]) continue;
      if (++tries > 40) break;
      const o = ownerOf(i);
      if (!visOf(i, o) && o !== viewer && viewer !== null) continue;
      const around = bfsDistance(nb, N, [i], (j) => ownerOf(j) === o, 2);
      let agg = 0, cx = 0, cy = 0;
      for (let j = 0; j < N; j++) {
        if (around[j] > 2 || taken[j]) continue;
        const d = densOf(j, o);
        agg += d; const p = this.center(j); cx += p.x * d; cy += p.y * d;
        taken[j] = 1;
      }
      if (agg < DOTS.group) continue;
      cx /= agg; cy /= agg;
      const r = createRng(i * 104729 + 7), R = 3 + Math.sqrt(agg) * 0.9, n = Math.min(60, Math.round(agg * 0.35));
      for (let q = 0; q < n; q++) { const a = r.next() * 6.3, d = Math.sqrt(r.next()) * R; dots[o].push(cx + Math.cos(a) * d * 1.15, cy + Math.sin(a) * d * 0.9, 0, 0, r.next() * 6.3, 1); }
      groups.push({ x: cx, y: cy + R + 7, side: o, men: Math.round((agg * f.cfg.men) / 50) * 50 });
    }
    // Chaque point reste de son côté du trait du front (champ de partage lissé, celui qui dessine la ligne).
    const S = this.sampler, own = this.cur?.owner;
    if (own) {
      for (const o of [0, 1]) {
        const a = dots[o], out = [];
        for (let k = 0; k < a.length; k += 6) {
          const gx = Math.max(0, Math.min(S.w - 1, Math.round(a[k] / S.step))), gy = Math.max(0, Math.min(S.h - 1, Math.round(a[k + 1] / S.step)));
          const v = own[gy * S.w + gx];
          if (o === 0 ? v < 0.55 : v > 0.45) continue;
          for (let q = 0; q < 6; q++) out.push(a[k + q]);
        }
        dots[o] = out;
      }
    }
    void W;
    return { dots, groups };
  }

  drawDots(now) {
    const D = this.dots;
    if (!D) return;
    const { ctx, cam } = this;
    const px = 1 / cam.s, r = Math.max(DOTS.r, 1.05 * px);
    for (const s of [0, 1]) {
      const a = D.dots[s];
      for (const pass of [0, 1]) {
        for (const alpha of [1, 0.55]) {
          ctx.beginPath();
          for (let k = 0; k < a.length; k += 6) {
            if (a[k + 5] !== alpha) continue;
            // Les points d'une case qui attaque avancent par bonds vers l'ennemi, puis reviennent (boucle).
            const hop = a[k + 2] || a[k + 3] ? ((now * 0.0025 + a[k + 4]) % 4) : 0;
            const x = a[k] + a[k + 2] * hop + (pass ? 0 : 0.35 * r), y = a[k + 1] + a[k + 3] * hop + (pass ? 0 : 0.35 * r);
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, Math.PI * 2);
          }
          ctx.globalAlpha = alpha;
          ctx.fillStyle = DOT_RGB[s][pass];
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    // Effectifs des amas de l'arrière.
    if (cam.s > 0.7) for (const g of D.groups) this.tag(`≈ ${g.men.toLocaleString('fr-FR')} h`, g.x, g.y, g.side === 0 ? '#c9d6ec' : '#f0c4b8', px);
  }

  // ---------- Cratères ----------

  // Impacts des barrages du tick qui vient de se jouer : terre labourée et cratères, pour toute la bataille.
  // Une fois par tick de l'horloge (snapshot peut être appelé plusieurs fois pour un même tick).
  queueCraters() {
    const f = this.front;
    if (this.scarClock === f.clock || f.phase === 'plan' && f.tick === 0) return;
    this.scarClock = f.clock;
    // Chaleur des combats : pertes du tick, qui retombent en quelques heures.
    const loss = f.tickLoss;
    for (let i = 0; i < this.map.N; i++) {
      this.heat[i] = this.heat[i] * SMOKE.decay + (loss?.[i] ?? 0) * SMOKE.loss;
      this.wear[i] += loss?.[i] ?? 0;
    }
    this.updateFieldFires();
    this.spawnWrecks();
    if (f.tick <= f.cfg.barrageTicks) this.barrageCraters();
    this.queueWear();
  }

  barrageCraters() {
    const f = this.front;
    const rng = createRng(`craters:${f.seed}:${f.clock}`);
    for (const s of [0, 1]) {
      for (const b of f.barrages[s]) for (const id of missionGuns(b)) {
        const g = f.guns?.find((x) => x.id === id);
        if (!g || g.fired !== f.clock - 1) continue;
        const C = SCAR[g.kind] ?? SCAR.div;
        const n = Math.round(C.n * gunPower(g) * FRONT_WEATHER[f.weather].barrage);
        for (let q = 0; q < n; q++) {
          const a = rng.next() * Math.PI * 2, r = Math.sqrt(rng.next()) * b.r * CELL;
          const x = b.x * CELL + Math.cos(a) * r, y = b.y * CELL + Math.sin(a) * r;
          const h = pixelToHex(x, y, CELL), i = h.row * this.map.W + h.col;
          if (h.col < 0 || h.row < 0 || h.col >= this.map.W || h.row >= this.map.H || this.map.river?.[i] || this.map.kind[i] === K.mountain) continue;
          this.scarQueue.push({ x, y, r: C.r * (0.7 + 0.6 * rng.next()), a: rng.next() * 6.3, k: rng.next() });
          this.heat[i] += SMOKE.barrage;
          this.wear[i] += WEAR.crater;
        }
      }
    }
  }

  // Usure : chaque case reçoit des trous d'obus à mesure que ses pertes cumulées montent (positions tirées d'un
  // générateur par case : une case pilonnée se remplit, elle ne se redessine pas). Au-delà de WEAR.moon, cratères
  // gris de champ lunaire.
  queueWear() {
    const { N, kind } = this.map;
    for (let i = 0; i < N; i++) {
      const w = this.wear[i];
      if (w < WEAR.crater0 || kind[i] === K.mountain || this.map.river?.[i]) continue;
      const want = Math.min(WEAR.max, Math.floor((w - WEAR.crater0) * WEAR.per) + 1);
      if (want <= this.wearCraters[i]) continue;
      const c = this.center(i), moon = w > WEAR.moon * 0.6;
      const rng = createRng(i * 2654435761 + this.wearCraters[i]);
      for (let q = this.wearCraters[i]; q < want; q++) {
        const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * CELL * 1.05;
        const big = rng.next() < (moon ? 0.35 : 0.15);
        this.scarQueue.push({ x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d * 0.95, r: (big ? 1.6 : 0.9) * (0.75 + 0.5 * rng.next()), a: rng.next() * 6.3, k: rng.next(), moon });
      }
      this.wearCraters[i] = want;
    }
    this.wearDirty = true;
  }

  // Teinte de la terre labourée, lissée (pas de cases visibles) : brune où l'on s'est battu, gris cendre vers le
  // champ lunaire, noire là où la steppe a brûlé. Peinte sous les masses de troupes.
  wearImage() {
    const S = this.sampler;
    if (!this.wearCanvas) {
      this.wearCanvas = document.createElement('canvas');
      this.wearCanvas.width = S.w;
      this.wearCanvas.height = S.h;
    }
    if (!this.wearDirty) return this.wearCanvas;
    this.wearDirty = false;
    const { N } = this.map;
    const churn = new Float32Array(N), moon = new Float32Array(N), burn = new Float32Array(N);
    let any = false;
    for (let i = 0; i < N; i++) {
      const w = this.wear[i];
      if (w > WEAR.trample) { churn[i] = Math.min(1, Math.log1p(w - WEAR.trample) / Math.log1p(WEAR.full)); any = true; }
      if (w > WEAR.moon * 0.5) moon[i] = Math.min(1, (w - WEAR.moon * 0.5) / WEAR.moon);
      if (this.burnt[i]) { burn[i] = 1 - this.fieldFire[i] * 0.5; any = true; }
    }
    const fc = S.field(churn).data, fm = S.field(moon).data, fb = S.field(burn).data;
    const g = this.wearCanvas.getContext('2d'), img = g.createImageData(S.w, S.h), px = img.data;
    for (let s = 0; s < S.w * S.h; s++) {
      const c = fc[s], m = fm[s], b = fb[s];
      if (c < 0.02 && b < 0.02) continue;
      // Terre retournée (brun) → champ lunaire (gris cendre) ; chaume brûlé par-dessus (noir brunâtre).
      let r = mixTo(112, 160, m), gg = mixTo(92, 154, m), bl = mixTo(66, 142, m);
      let a = 0.5 * c + 0.45 * m;
      if (b > 0.02) { const k = Math.min(1, b * 1.2); r = mixTo(r, 62, k); gg = mixTo(gg, 52, k); bl = mixTo(bl, 38, k); a = Math.max(a, 0.42 * k); }
      px[s * 4] = r; px[s * 4 + 1] = gg; px[s * 4 + 2] = bl; px[s * 4 + 3] = Math.round(Math.min(0.85, a) * 255);
    }
    g.putImageData(img, 0, 0);
    this.wearAny = any;
    return this.wearCanvas;
  }

  // Steppe en feu : en été et par temps sec, un combat violent allume les blés ; le feu court sous le vent sur les
  // cases de steppe voisines, fume, puis laisse un chaume noir pour le reste de la bataille.
  updateFieldFires() {
    const f = this.front, { N, nb, kind } = this.map;
    const dry = f.season <= 1 && (f.weather === 'clear');
    const rng = createRng(`fields:${f.seed}:${f.clock}`);
    const w = f.wind ?? { dir: 0, force: 0.4 };
    const wx = Math.cos(w.dir), wy = Math.sin(w.dir);
    const lit = [];
    for (let i = 0; i < N; i++) {
      const fire = this.fieldFire[i];
      if (fire > 0) {
        this.fieldFire[i] = fire * (dry ? FIELD_FIRE.decay : FIELD_FIRE.decay * 0.7);
        if (this.fieldFire[i] < FIELD_FIRE.min) this.fieldFire[i] = 0;
        if (dry && fire > 0.5) lit.push(i);
        continue;
      }
      if (!dry || this.burnt[i] || kind[i] !== K.plain || this.map.river?.[i]) continue;
      if (this.heat[i] > FIELD_FIRE.heat && rng.next() < FIELD_FIRE.chance) { this.fieldFire[i] = 1; this.burnt[i] = 1; }
    }
    // Propagation : vers les voisines sous le vent, d'autant plus que le vent est fort.
    for (const i of lit) {
      if (this.burnt[i] > FIELD_FIRE.gen) continue;
      const c = this.center(i);
      for (let d = 0; d < 6; d++) {
        const j = nb[i * 6 + d];
        if (j < 0 || this.burnt[j] || kind[j] !== K.plain || this.map.river?.[j]) continue;
        const q = this.center(j), L = Math.hypot(q.x - c.x, q.y - c.y) || 1;
        const along = ((q.x - c.x) * wx + (q.y - c.y) * wy) / L;
        if (along > 0.3 && rng.next() < FIELD_FIRE.spread * (0.5 + w.force) * along) { this.fieldFire[j] = 0.9; this.burnt[j] = this.burnt[i] + 1; }
      }
    }
  }

  // Flammes et fumée des champs qui brûlent, là où le camp observateur voit.
  drawFieldFires(viewer, now) {
    const f = this.front, { ctx } = this, { N } = this.map;
    const sources = [];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < N; i++) {
      const heat = this.fieldFire[i];
      if (heat <= 0) continue;
      if (viewer !== null && f.owner[i] !== viewer && !f.vision[viewer][i]) continue;
      const c = this.center(i);
      // Front de flammes : quelques langues vacillantes réparties sur la case.
      for (let q = 0; q < 3; q++) {
        const ph = i * 1.7 + q * 2.3;
        const x = c.x + Math.cos(ph) * 4.5, y = c.y + Math.sin(ph * 1.3) * 4;
        const fl = 0.55 + 0.45 * Math.sin(now * 0.019 + ph) * Math.sin(now * 0.011 + ph * 2);
        const R = 2.4 + 3.2 * heat;
        ctx.globalAlpha = Math.min(1, 0.25 + 0.55 * heat) * fl;
        ctx.drawImage(this.fx.fireSprite(), x - R, y - R, R * 2, R * 2);
      }
      if (heat > 0.3 && (i % 2 === 0)) sources.push(c.x, c.y, 0.5 * heat);
    }
    ctx.restore();
    this.fx.plumeSources(sources, 'field');
  }

  // ---------- Épaves ----------

  // Une carcasse par WRECK.per chars perdus d'une formation (et toutes les siennes quand elle est anéantie), là où
  // elle se trouve, vue par le camp du joueur ou à lui ; elle reste jusqu'à la fin de la bataille.
  spawnWrecks() {
    const f = this.front;
    if (!f.armor) return;
    const viewer = this.lastViewer ?? null;
    const rng = createRng(`wrecks:${f.seed}:${f.clock}`);
    for (const a of f.armor) {
      const prev = this.tanksSeen.get(a.id);
      const tanks = a.lost ? 0 : a.tanks;
      this.tanksSeen.set(a.id, { tanks, rest: prev?.rest ?? 0 });
      if (!prev || tanks >= prev.tanks) continue;
      const st = this.tanksSeen.get(a.id);
      st.rest = prev.rest + (prev.tanks - tanks);
      const i = cellAtPoint(f, a);
      const seen = viewer === null || a.side === viewer || (i >= 0 && f.vision[viewer][i]);
      while (st.rest >= WRECK.per || (a.lost && st.rest > WRECK.per * 0.3)) {
        st.rest = Math.max(0, st.rest - WRECK.per);
        if (!seen || this.wrecks.length >= WRECK.max) continue;
        const c = this.toWorld({ x: a.x + (rng.next() - 0.5) * WRECK.spread, y: a.y + (rng.next() - 0.5) * WRECK.spread });
        this.wrecks.push({ x: c.x, y: c.y, ang: (a.dir ?? 0) + (rng.next() - 0.5) * 1.6, side: a.side, born: f.clock, turret: (rng.next() - 0.5) * 2.4 });
      }
    }
  }

  // Carcasses : tache de sol brûlé, char noirci (tourelle de travers), fumée les premières heures.
  drawWrecks(now) {
    if (!this.wrecks.length) return;
    const { ctx, cam } = this, f = this.front;
    const k = tankScale(cam.s) * 0.95;
    const smoke = [];
    for (const w of this.wrecks) {
      ctx.fillStyle = 'rgba(30, 24, 18, 0.35)';
      ctx.beginPath();
      ctx.ellipse(w.x, w.y, 7 * k, 5 * k, w.ang, 0, Math.PI * 2);
      ctx.fill();
      piece(ctx, w.x, w.y, w.ang, k, (G, P, sh) => wreck(G, P, sh, w.turret), WRECK_PAL[w.side]);
      const age = f.clock - w.born;
      if (age < WRECK.smoke) smoke.push(w.x, w.y, 0.35 * (1 - age / WRECK.smoke));
    }
    void now;
    this.fx.plumeSources(smoke, 'wreck');
  }

  // ---------- Lumière ----------

  // Lumière du jour sur la carte : rasante et dorée à l'aube, puis neutre ; chaude au soir, bleuie à la tombée.
  // Heure : de 6 h à 20 h au fil des ticks de la journée ; le matin des ordres est l'aube.
  // Ombres de nuages qui glissent sous le vent : leur position suit l'horloge du front (immobiles le matin des ordres,
  // elles avancent pendant la journée et reprennent d'un jour à l'autre).
  drawClouds(t) {
    const f = this.front, C = CLOUDS[f.weather];
    if (!C || f.phase === 'over') return;
    this.cloudSprites ??= [1, 2, 3, 4, 5].map((k) => cloudSprite(k));
    this.sunSprite ??= cloudSprite(-1);
    const { ctx } = this, W = this.worldW, H = this.worldH;
    const time = f.phase === 'plan' ? f.clock : f.clock - 1 + t;
    const wind = f.wind ?? { dir: 0, force: 0.4 }, cw = W * C.size, ch = cw * 0.62;
    const v = ((W + cw) / CLOUDS.cross) * (0.5 + wind.force), vx = Math.cos(wind.dir) * v, vy = Math.sin(wind.dir) * v;
    const wrap = (a, n) => ((a % n) + n) % n;
    ctx.save();
    if (C.veil) { ctx.fillStyle = `rgba(30, 38, 52, ${C.veil})`; ctx.fillRect(0, 0, W, H); }
    for (let k = 0; k < C.n; k++) {
      const s = 0.8 + ((k * 7) % 5) * 0.12;
      const x = wrap(wrap(k * 0.618, 1) * (W + cw) + vx * time, W + cw) - cw, y = wrap(wrap(k * 0.371 + 0.13, 1) * (H + ch) + vy * time, H + ch) - ch;
      ctx.globalAlpha = C.a;
      ctx.drawImage(this.cloudSprites[k % 5], x, y, cw * s, ch * s);
    }
    if (C.sun) {
      ctx.globalCompositeOperation = 'soft-light';
      for (let k = 0; k < C.sun; k++) {
        const x = wrap(wrap(k * 0.5 + 0.2, 1) * (W + cw) + vx * time * 0.9, W + cw) - cw, y = wrap((k * 0.45 + 0.25) * (H + ch) + vy * time * 0.9, H + ch) - ch;
        ctx.globalAlpha = 0.9;
        ctx.drawImage(this.sunSprite, x, y, cw, ch);
      }
    }
    ctx.restore();
  }

  drawDaylight(t) {
    const f = this.front;
    if (f.phase === 'over') return;
    const frac = f.phase === 'plan' ? 0 : Math.min(1, Math.max(0, (f.tick - 1 + t) / f.cfg.ticks));
    const h = 6 + frac * 14;
    const { ctx } = this;
    const layer = (rgb, a) => {
      if (a <= 0.005) return;
      ctx.fillStyle = `rgba(${rgb}, ${a})`;
      ctx.fillRect(0, 0, this.worldW, this.worldH);
    };
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    if (h < 8.5) layer('255, 178, 120', 0.3 * (8.5 - h) / 2.5);
    if (h > 16.5) layer('255, 160, 104', Math.min(0.3, 0.3 * (h - 16.5) / 2.5));
    if (h > 18.5) layer('92, 104, 160', 0.28 * Math.min(1, (h - 18.5) / 1.5));
    ctx.restore();
    drawCityGlow(this, this.lastViewer ?? null, Math.min(1, Math.max(0, (h - 16.5) / 3)), CELL); // métropole : la ville qui brûle
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
      // Champ lunaire : bourrelets gris cendre, entonnoirs plus froids.
      ctx.fillStyle = c.moon ? 'rgba(206, 200, 186, 0.6)' : 'rgba(238, 226, 190, 0.55)';
      ctx.beginPath(); ctx.arc(c.x - 0.35, c.y - 0.35, c.r * 1.35, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c.moon ? 'rgba(96, 90, 80, 0.85)' : 'rgba(92, 70, 44, 0.8)';
      ctx.beginPath(); ctx.arc(c.x + 0.2, c.y + 0.2, c.r * 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c.moon ? 'rgba(44, 42, 38, 0.85)' : 'rgba(40, 30, 20, 0.8)';
      ctx.beginPath(); ctx.arc(c.x + 0.1, c.y + 0.15, c.r * 0.8, 0, Math.PI * 2); ctx.fill();
    }
    this.scarQueue.length = 0;
  }

  // Foyers de fumée des combats : les cases les plus chaudes, vues par le camp observateur, espacées d'au moins deux
  // cases (sinon un secteur en feu devient un mur de fumée).
  smokeSources(viewer) {
    const f = this.front, { N } = this.map;
    const hot = [];
    for (let i = 0; i < N; i++) {
      if (this.heat[i] < SMOKE.min) continue;
      if (viewer !== null && f.owner[i] !== viewer && !f.vision[viewer]?.[i]) continue;
      hot.push(i);
    }
    hot.sort((a, b) => this.heat[b] - this.heat[a]);
    const out = [], taken = [];
    for (const i of hot) {
      const x = f.centers.x[i], y = f.centers.y[i];
      if (taken.some((t) => (t.x - x) ** 2 + (t.y - y) ** 2 < SMOKE.space ** 2)) continue;
      taken.push({ x, y });
      const p = this.center(i);
      out.push(p.x, p.y, Math.min(1, this.heat[i] / SMOKE.full) * SMOKE.rate);
      if (taken.length >= SMOKE.max) break;
    }
    this.smoke = out;
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
    drawCity(this, viewer, damaged); // métropole : îlots des quartiers (frontcity.js)
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
    for (const h of this.blocks ? this.houses.concat(this.blocks) : this.houses) {
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

  // Le plus gros incendie de ville que voit le camp viewer : { x, y (unités de grille), heat 0..1 }, ou null (son).
  hottestFire(viewer) {
    const f = this.front;
    let best = -1;
    for (let c = 0; c < f.map.N; c++) {
      if (this.fire[c] >= FIRE.min * 2 && (best < 0 || this.fire[c] > this.fire[best]) && (f.owner[c] === viewer || f.vision[viewer][c])) best = c;
    }
    return best < 0 ? null : { x: f.centers.x[best], y: f.centers.y[best], heat: this.fire[best] };
  }

  drawTowns(viewer) {
    const { ctx } = this;
    const f = this.front;
    for (const t of this.map.towns) {
      if (t.district != null) continue; // métropole : le quartier porte son nom (drawDistricts)
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

  // Poches : intérieur teinté, contour qui pulse pendant la journée, fumée qui s'y concentre ; quand l'encerclé ne
  // tient plus qu'à une fraction de son effectif de départ, des drapeaux blancs.
  drawPockets(viewer, now) {
    const { ctx } = this;
    const f = this.front;
    const live = f.phase === 'resolve' && !this.fx.still;
    this.pocketStart ??= new Map();
    const smoke = [];
    for (const { p, segs } of this.cur.pockets) {
      const s = p.side;
      if (!this.pocketStart.has(p.id)) this.pocketStart.set(p.id, p.troops);
      const pulse = live ? 0.5 + 0.5 * Math.sin(now * 0.004 + p.id) : 0.5;
      ctx.drawImage(this.pocketMask(p), 0, 0, this.worldW, this.worldH);
      ctx.strokeStyle = `rgba(239, 59, 44, ${0.25 + 0.4 * pulse})`;
      ctx.lineWidth = 4 + 7 * pulse;
      strokeSegments(ctx, segs);
      if (live) for (let k = 0; k < Math.min(4, p.cells.length); k++) { const c = this.center(p.cells[(k * 7919) % p.cells.length]); smoke.push(c.x, c.y, 0.45); }
      if (p.troops < this.pocketStart.get(p.id) * POCKET_FX.flags) {
        for (let k = 0; k < Math.min(4, p.cells.length); k++) { const c = this.center(p.cells[(k * 104729 + 3) % p.cells.length]); whiteFlag(ctx, c.x, c.y, now, 1 / Math.max(0.8, this.cam.s), live); }
      }
      {
        ctx.strokeStyle = s === 0 ? '#26303d' : '#4a1610';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([5, 4]);
        strokeSegments(ctx, segs);
        ctx.setLineDash([]);
        const own = viewer === null || viewer === s;
        // Étiquette brève : effectif (ou « encerclés » chez l'ennemi) et un signe pour le comportement choisi.
        const men = own ? `${(Math.round((p.troops * f.cfg.men) / 100) * 100).toLocaleString('fr-FR')} h` : 'encerclés';
        const label = `${p.mode === 'festung' ? '■ ' : p.mode === 'breakout' ? '➚ ' : ''}${men}`;
        const c = this.toWorld({ x: p.cx, y: p.cy });
        const fs = 11 / Math.max(0.8, this.cam.s);
        ctx.font = `700 ${fs}px "IBM Plex Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.lineWidth = fs * 0.3;
        ctx.strokeStyle = 'rgba(244, 236, 210, 0.9)';
        ctx.strokeText(label, c.x, c.y);
        ctx.fillStyle = '#1d1a12';
        ctx.fillText(label, c.x, c.y);
      }
    }
    this.fx.plumeSources(smoke, 'pocket');
  }

  // Intérieur d'une poche, teinté au camp encerclé : cases peintes sur un petit calque, adouci à l'agrandissement.
  // Refait seulement quand la poche change.
  pocketMask(p) {
    const key = `${p.id}:${p.cells.length}:${this.front.clock}`;
    this.pocketMasks ??= new Map();
    let m = this.pocketMasks.get(p.id);
    if (m?.key === key) return m.c;
    const sc = 0.2, c = document.createElement('canvas');
    c.width = Math.ceil(this.worldW * sc); c.height = Math.ceil(this.worldH * sc);
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    const [r, gg, b] = POCKET_FX.tint[p.side];
    g.fillStyle = `rgb(${r}, ${gg}, ${b})`;
    for (const i of p.cells) { const q = this.center(i); g.beginPath(); g.arc(q.x * sc, q.y * sc, CELL * 0.95 * sc, 0, Math.PI * 2); g.fill(); }
    const out = document.createElement('canvas');
    out.width = c.width; out.height = c.height;
    const o = out.getContext('2d');
    o.globalAlpha = POCKET_FX.a;
    o.filter = 'blur(1.5px)';
    o.drawImage(c, 0, 0);
    this.pocketMasks.set(p.id, { key, c: out });
    if (this.pocketMasks.size > 24) this.pocketMasks.delete(this.pocketMasks.keys().next().value);
    return out;
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
    const k = tankScale(cam.s);
    const px = 1 / cam.s;
    const planning = f.phase === 'plan';
    const now = view.now ?? performance.now(), dt = Math.max(0, now - (this.lastArmorDraw ?? now));
    this.lastArmorDraw = now;
    this.fx.drawKicks(ctx, now);
    for (const { a, x, y, dir, tanks, known } of visibleArmor(f, viewer)) {
      const c = this.toWorld({ x, y });
      const own = viewer === null || a.side === viewer;
      const sel = view.armor === a.id;
      let ang = dir;
      if (own && a.target) ang = Math.atan2(a.target.y - y, a.target.x - x);
      if (own && planning && a.target) {
        // Trajet aimanté : la marche dans nos lignes suit le chemin le plus rapide (la route, surlignée), puis l'assaut
        // file droit vers l'objectif.
        const t = this.toWorld(a.target);
        const { pts, road } = this.armorPath(a);
        ctx.strokeStyle = 'rgba(255, 210, 63, 0.35)';
        ctx.lineWidth = 12 * px;
        for (const [p, q] of road) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
        const path = () => { ctx.beginPath(); splineTo(ctx, pts); };
        ctx.strokeStyle = ORDER_HALO;
        ctx.lineWidth = 6 * px;
        path(); ctx.stroke();
        ctx.strokeStyle = ORDER_INK;
        ctx.lineWidth = 3.4 * px;
        path(); ctx.stroke();
        const last = pts[pts.length - 2] ?? c;
        ang = Math.atan2(t.y - last.y, t.x - last.x);
        const s = 14 * px;
        ctx.beginPath();
        ctx.moveTo(t.x + Math.cos(ang) * 4 * px, t.y + Math.sin(ang) * 4 * px);
        ctx.lineTo(t.x + Math.cos(ang + 2.6) * s, t.y + Math.sin(ang + 2.6) * s);
        ctx.lineTo(t.x + Math.cos(ang - 2.6) * s, t.y + Math.sin(ang - 2.6) * s);
        ctx.closePath();
        ctx.fillStyle = ORDER_INK;
        ctx.fill();
      }
      const n = Math.max(1, Math.min(cam.s < 1.1 ? 2 : 3, Math.round(tanks / 50)));
      const form = TANK_FORM.slice(0, n);
      const pts = form.map(([fx, fy]) => [c.x + (fx * Math.cos(ang) - fy * Math.sin(ang)) * k + Math.cos(ang) * 4 * k, c.y + (fx * Math.sin(ang) + fy * Math.cos(ang)) * k + Math.sin(ang) * 4 * k]);
      ctx.globalAlpha = known ? 1 : 0.5;
      if (sel) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, 20 * k, 0, Math.PI * 2);
        ctx.strokeStyle = ORDER_INK;
        ctx.lineWidth = 2 * px;
        ctx.stroke();
      }
      const moving = f.phase === 'resolve' && (a.attacking || a.trail.length);
      if (moving && this.fx.still) for (const [x2, y2] of pts) dust(ctx, x2, y2, ang, k);
      else if (moving) for (const [x2, y2] of pts) this.fx.kick(x2, y2, ang, k, dt, KICK_OF[f.weather] ?? 'dust');
      for (const [x2, y2] of pts) piece(ctx, x2, y2, ang, k, (G, P, sh) => tank(G, P, sh, a.side === 1), SPRITE_PAL[a.side]);
      if (sel || cam.s > 1.2 || f.phase === 'resolve') {
        ctx.font = `700 ${10 * px}px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const ly = c.y + 22 * k;
        ctx.lineWidth = 3 * px;
        ctx.strokeStyle = 'rgba(250, 240, 210, 0.85)';
        ctx.strokeText(a.name, c.x, ly);
        ctx.fillStyle = SIDE_LINE[a.side];
        ctx.fillText(a.name, c.x, ly);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Colonnes de ravitaillement sur les routes tenues pendant la journée : camions qui soulèvent la poussière, sur nos
  // routes à l'abri du front (ou celles de l'ennemi qu'on voit). Ambiance seulement.
  drawConvoys(viewer, now) {
    const f = this.front, { nb } = this.map;
    if (!this.roadLines) {
      this.roadLines = (this.map.roads ?? []).filter((r) => r.length > 6).map((cells) => {
        const pts = cells.map((i) => this.center(i));
        let L = 0;
        const d = pts.map((p, k) => (k ? (L += Math.hypot(p.x - pts[k - 1].x, p.y - pts[k - 1].y)) : 0));
        return { cells, pts, d, L };
      });
    }
    const { ctx, cam } = this;
    const k = Math.max(1, 1 / cam.s);
    const quiet = (i, s) => {
      if (f.owner[i] !== s) return false;
      for (let q = 0; q < 6; q++) { const j = nb[i * 6 + q]; if (j >= 0 && f.owner[j] === 1 - s) return false; }
      return viewer === null || s === viewer || f.vision[viewer][i];
    };
    for (const [ri, r] of this.roadLines.entries()) {
      // Une colonne pour 160 pixels de route, alternativement dans un sens et dans l'autre.
      const n = Math.max(1, Math.floor(r.L / 160));
      for (let c = 0; c < n; c++) {
        const dir = (c + ri) % 2 ? 1 : -1;
        const head = (((now * CONVOY.speed * dir + (c / n) * r.L + ri * 37) % r.L) + r.L) % r.L;
        for (let v = 0; v < CONVOY.trucks; v++) {
          const at = head - dir * v * CONVOY.gap * k;
          if (at < 0 || at > r.L) continue;
          let m = 1;
          while (m < r.d.length - 1 && r.d[m] < at) m++;
          const a = r.pts[m - 1], b = r.pts[m], u = (at - r.d[m - 1]) / Math.max(1e-6, r.d[m] - r.d[m - 1]);
          const cell = u < 0.5 ? r.cells[m - 1] : r.cells[m];
          const side = f.owner[cell];
          if (side < 0 || !quiet(cell, side)) continue;
          const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u, ang = Math.atan2(b.y - a.y, b.x - a.x) + (dir < 0 ? Math.PI : 0);
          // Poussière derrière le camion.
          ctx.fillStyle = CONVOY_DUST[f.weather] ?? CONVOY_DUST.clear;
          for (let q = 1; q <= 3; q++) {
            ctx.globalAlpha = 0.28 / q;
            ctx.beginPath();
            ctx.arc(x - Math.cos(ang) * q * 3 * k, y - Math.sin(ang) * q * 3 * k, (1.2 + q * 0.9) * k, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(ang);
          ctx.fillStyle = 'rgba(30, 24, 16, 0.3)';
          ctx.fillRect(-2.2 * k + 0.5, -1.2 * k + 0.5, 4.4 * k, 2.4 * k);
          ctx.fillStyle = SPRITE_PAL[side].body;
          ctx.fillRect(-2.2 * k, -1.2 * k, 4.4 * k, 2.4 * k);
          ctx.fillStyle = SPRITE_PAL[side].dark;
          ctx.fillRect(1.1 * k, -1.2 * k, 1.1 * k, 2.4 * k);
          ctx.restore();
        }
      }
    }
  }

  // DCA : batterie vue de dessus (affût rond, deux tubes). Le matin, son rayon d'action. Chez l'ennemi : seulement
  // celles qu'on a repérées, en pointillé rouge, estompées si l'information date.
  drawAA(view) {
    const f = this.front;
    if (!f.aa) return;
    const viewer = view.viewer ?? null;
    const { ctx, cam } = this;
    const px = 1 / cam.s, k = SPRITE_K * Math.max(1, px);
    const planning = f.phase === 'plan';
    for (const { a, x, y, known, age } of visibleAA(f, viewer)) {
      const c = this.toWorld({ x, y });
      const own = viewer === null || a.side === viewer;
      const sel = view.aa === a.id;
      ctx.save();
      ctx.globalAlpha = own ? 1 : known ? 0.9 : Math.max(0.35, 1 - (age ?? 0) / f.cfg.ticks);
      if (planning || sel) {
        const R = AIR.aaRange * CELL;
        ctx.beginPath();
        ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
        if (own) { ctx.fillStyle = 'rgba(52, 84, 138, 0.08)'; ctx.fill(); ctx.strokeStyle = sel ? ORDER_INK : 'rgba(38, 48, 61, 0.7)'; ctx.lineWidth = (sel ? 2 : 1.2) * px; ctx.stroke(); }
        else { ctx.setLineDash([3 * px, 4 * px]); ctx.strokeStyle = 'rgba(193, 54, 36, 0.85)'; ctx.lineWidth = 1.4 * px; ctx.stroke(); ctx.setLineDash([]); }
      }
      const P = SPRITE_PAL[a.side];
      ctx.translate(c.x, c.y);
      ctx.fillStyle = 'rgba(30, 24, 16, 0.3)'; ctx.beginPath(); ctx.arc(0.8 * k, 0.8 * k, 3.4 * k, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = P.body; ctx.strokeStyle = P.dark; ctx.lineWidth = 0.6 * k;
      ctx.beginPath(); ctx.arc(0, 0, 3.2 * k, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.rotate(-0.7 + (a.id % 3) * 0.5);
      ctx.lineWidth = 0.9 * k;
      for (const o of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, o * 0.9 * k); ctx.lineTo(6 * k, o * 0.9 * k); ctx.stroke(); }
      ctx.restore();
      if (sel || cam.s > 1.4) {
        ctx.font = `700 ${9 * px}px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3 * px;
        ctx.strokeStyle = 'rgba(250, 240, 210, 0.85)';
        ctx.strokeText(a.name, c.x, c.y + 9 * k);
        ctx.fillStyle = SIDE_LINE[a.side];
        ctx.fillText(a.name, c.x, c.y + 9 * k);
      }
    }
  }

  // Points d'appui : la ville fortifiée cerclée d'un trait épais crénelé (les siens, et ceux de l'ennemi en vue).
  drawStrongpoints(viewer) {
    const f = this.front;
    const { ctx, cam } = this;
    const px = 1 / cam.s;
    for (const s of [0, 1]) {
      for (const p of f.strong?.[s] ?? []) {
        if (viewer !== null && s !== viewer && !f.vision[viewer]?.[p.i]) continue;
        if (f.owner[p.i] !== s) continue;
        const c = this.center(p.i);
        const R = SPECIAL.strong.r * CELL * 0.8;
        ctx.save();
        ctx.strokeStyle = SIDE_LINE[s];
        ctx.lineWidth = 2.4 * px;
        ctx.setLineDash([6 * px, 3 * px]);
        ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(c.x + Math.cos(a) * R, c.y + Math.sin(a) * R);
          ctx.lineTo(c.x + Math.cos(a) * (R + 4 * px), c.y + Math.sin(a) * (R + 4 * px));
          ctx.stroke();
        }
        if (cam.s > 0.9) {
          ctx.font = `700 ${9 * px}px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 3 * px;
          ctx.strokeStyle = 'rgba(250, 240, 210, 0.85)';
          ctx.strokeText('Point d\'appui', c.x, c.y - R - 7 * px);
          ctx.fillStyle = SIDE_LINE[s];
          ctx.fillText('Point d\'appui', c.x, c.y - R - 7 * px);
        }
        ctx.restore();
      }
    }
  }

  // Bataillons de soutien : pelle et pioche croisées sur un fanion ; le matin, la zone qu'ils retranchent (les siens),
  // et leur déplacement prévu.
  drawSupport(view) {
    const f = this.front;
    if (!f.support?.length) return;
    const viewer = view.viewer ?? null;
    const { ctx, cam } = this;
    const px = 1 / cam.s, k = SPRITE_K * Math.max(1, px);
    const planning = f.phase === 'plan';
    for (const { b, x, y, known, own } of visibleSupport(f, viewer)) {
      const c = this.toWorld({ x, y });
      const sel = own && view.support === b.id;
      ctx.save();
      if (own && (planning || sel)) {
        ctx.fillStyle = sel ? 'rgba(255, 210, 63, 0.22)' : 'rgba(92, 74, 40, 0.13)';
        for (const i of b.cells) { const p = this.center(i); ctx.beginPath(); ctx.arc(p.x, p.y, CELL * 0.62, 0, Math.PI * 2); ctx.fill(); }
        if (b.dest) {
          const d = this.toWorld(b.dest);
          ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y);
          ctx.setLineDash([4 * px, 4 * px]); ctx.strokeStyle = ORDER_INK; ctx.lineWidth = 2 * px; ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(d.x, d.y, 4 * k, 0, Math.PI * 2); ctx.stroke();
        }
        if (b.kind === 'sapper') {
          ctx.beginPath(); ctx.arc(c.x, c.y, b.r * CELL, 0, Math.PI * 2);
          ctx.setLineDash([3 * px, 3 * px]); ctx.strokeStyle = sel ? ORDER_INK : 'rgba(92, 74, 40, 0.6)'; ctx.lineWidth = 1.4 * px; ctx.stroke(); ctx.setLineDash([]);
        }
        if (sel) {
          ctx.beginPath(); ctx.arc(c.x, c.y, SUPPORT.move * CELL, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(38, 48, 61, 0.35)'; ctx.lineWidth = 1 * px; ctx.stroke();
        }
      }
      ctx.globalAlpha = own || known ? 1 : 0.55;
      const P = SPRITE_PAL[b.side];
      ctx.translate(c.x, c.y);
      ctx.fillStyle = 'rgba(30, 24, 16, 0.3)'; ctx.fillRect(-4.2 * k, -3.2 * k, 9.4 * k, 7.4 * k);
      ctx.fillStyle = P.body; ctx.strokeStyle = P.dark; ctx.lineWidth = 0.7 * k;
      ctx.fillRect(-5 * k, -4 * k, 9.4 * k, 7.4 * k); ctx.strokeRect(-5 * k, -4 * k, 9.4 * k, 7.4 * k);
      ctx.lineWidth = 1 * k; ctx.lineCap = 'round';
      if (b.kind === 'sapper') {
        // Génie d'assaut : charge explosive (losange) et mèche.
        ctx.beginPath(); ctx.moveTo(-0.3 * k, -3 * k); ctx.lineTo(2.5 * k, -0.3 * k); ctx.lineTo(-0.3 * k, 2.4 * k); ctx.lineTo(-3.1 * k, -0.3 * k); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(2.5 * k, -0.3 * k); ctx.lineTo(4 * k, -3 * k); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(-3 * k, 2 * k); ctx.lineTo(2.4 * k, -2.4 * k); ctx.moveTo(-3 * k, -2.4 * k); ctx.lineTo(2.4 * k, 2 * k); ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.restore();
      if (sel || cam.s > 1.3 || (own && planning)) {
        ctx.font = `600 ${9 * px}px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3 * px;
        ctx.strokeStyle = 'rgba(250, 240, 210, 0.85)';
        const label = own ? (b.kind === 'sapper' ? 'Génie d\'assaut' : `Génie · ${SUPPORT_LEVELS[b.level]}`) : 'Génie ennemi';
        ctx.strokeText(label, c.x, c.y - 9 * k);
        ctx.fillStyle = SIDE_LINE[b.side];
        ctx.fillText(label, c.x, c.y - 9 * k);
      }
    }
  }

  // Postes de commandement : tente à antenne et fanion ; le matin, le rayon de coordination du sien et son
  // déplacement prévu ; capturé, une croix.
  drawHQ(view) {
    const f = this.front;
    if (!f.hq) return;
    const viewer = view.viewer ?? null;
    const { ctx, cam } = this;
    const px = 1 / cam.s, k = SPRITE_K * Math.max(1, px);
    const planning = f.phase === 'plan';
    for (const { h, x, y, known, own } of visibleHQ(f, viewer)) {
      const c = this.toWorld({ x, y });
      const st = hqState(h);
      const sel = own && view.hq;
      ctx.save();
      ctx.globalAlpha = own || known ? 1 : 0.55;
      if (own && (planning || sel) && st !== 'captured') {
        ctx.beginPath();
        ctx.arc(c.x, c.y, h.radius * CELL, 0, Math.PI * 2);
        ctx.setLineDash([5 * px, 5 * px]);
        ctx.strokeStyle = sel ? ORDER_INK : 'rgba(38, 48, 61, 0.55)';
        ctx.lineWidth = (sel ? 2 : 1.2) * px;
        ctx.stroke();
        ctx.setLineDash([]);
        if (sel) {
          ctx.beginPath();
          ctx.arc(c.x, c.y, HQ.hop * CELL, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(38, 48, 61, 0.35)';
          ctx.lineWidth = 1 * px;
          ctx.stroke();
        }
      }
      if (own && h.dest) {
        const d = this.toWorld(h.dest);
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(d.x, d.y);
        ctx.setLineDash([4 * px, 4 * px]);
        ctx.strokeStyle = ORDER_INK;
        ctx.lineWidth = 2 * px;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(d.x, d.y, 5 * k, 0, Math.PI * 2);
        ctx.stroke();
      }
      const P = SPRITE_PAL[h.side];
      ctx.translate(c.x, c.y);
      ctx.fillStyle = 'rgba(30, 24, 16, 0.3)';
      ctx.beginPath(); ctx.ellipse(0.8 * k, 1.2 * k, 5.2 * k, 2.4 * k, 0, 0, Math.PI * 2); ctx.fill();
      // Tente.
      ctx.fillStyle = P.body; ctx.strokeStyle = P.dark; ctx.lineWidth = 0.7 * k;
      ctx.beginPath(); ctx.moveTo(-5 * k, 1.5 * k); ctx.lineTo(0, -3.5 * k); ctx.lineTo(5 * k, 1.5 * k); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -3.5 * k); ctx.lineTo(0, 1.5 * k); ctx.stroke();
      // Antenne et fanion (gris quand le PC est désorganisé).
      ctx.strokeStyle = P.dark; ctx.lineWidth = 0.6 * k;
      ctx.beginPath(); ctx.moveTo(3 * k, -1 * k); ctx.lineTo(3 * k, -9 * k); ctx.stroke();
      ctx.fillStyle = st === 'ok' ? SIDE_LINE[h.side] : 'rgba(120, 116, 104, 0.9)';
      ctx.beginPath(); ctx.moveTo(3 * k, -9 * k); ctx.lineTo(7 * k, -7.8 * k); ctx.lineTo(3 * k, -6.6 * k); ctx.closePath(); ctx.fill();
      if (st === 'captured') {
        ctx.strokeStyle = 'rgba(193, 54, 36, 0.95)'; ctx.lineWidth = 1.4 * k;
        ctx.beginPath(); ctx.moveTo(-5 * k, -5 * k); ctx.lineTo(5 * k, 3 * k); ctx.moveTo(5 * k, -5 * k); ctx.lineTo(-5 * k, 3 * k); ctx.stroke();
      }
      ctx.restore();
      if (sel || cam.s > 1.2 || (own && planning)) {
        ctx.font = `700 ${9 * px}px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3 * px;
        ctx.strokeStyle = 'rgba(250, 240, 210, 0.85)';
        const label = own ? `PC · liaison ${Math.round(h.link * 100)} %` : 'PC ennemi';
        ctx.strokeText(label, c.x, c.y + 8 * k);
        ctx.fillStyle = SIDE_LINE[h.side];
        ctx.fillText(label, c.x, c.y + 8 * k);
      }
    }
  }

  // Missions aériennes du matin : route de vol en pointillé depuis notre bord de carte, objectif cerclé.
  drawAirPlans(viewer) {
    const f = this.front;
    const { ctx, cam } = this;
    const px = 1 / cam.s;
    for (const s of viewer === null ? [0, 1] : [viewer]) {
      for (const m of f.air?.[s] ?? []) {
        const o = this.toWorld(airBase(f, s, m)), t = this.toWorld(m);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.setLineDash([6 * px, 5 * px]);
        ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(t.x, t.y);
        ctx.strokeStyle = ORDER_HALO; ctx.lineWidth = 4 * px; ctx.stroke();
        ctx.strokeStyle = ORDER_INK; ctx.lineWidth = 1.8 * px; ctx.stroke();
        ctx.setLineDash([5 * px, 4 * px]);
        const R = (m.kind === 'strike' ? AIR.strikeR : 1) * CELL;
        ctx.beginPath(); ctx.arc(t.x, t.y, R, 0, Math.PI * 2);
        ctx.strokeStyle = ORDER_HALO; ctx.lineWidth = 4 * px; ctx.stroke();
        ctx.strokeStyle = ORDER_INK; ctx.lineWidth = 2 * px; ctx.stroke();
        ctx.setLineDash([]);
        const ang = Math.atan2(t.y - o.y, t.x - o.x), g = 7 * px;
        ctx.translate(t.x - Math.cos(ang) * (R + 8 * px), t.y - Math.sin(ang) * (R + 8 * px));
        ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(-g * 0.7, -g * 0.8); ctx.lineTo(-g * 0.25, 0); ctx.lineTo(-g * 0.7, g * 0.8); ctx.closePath();
        ctx.fillStyle = ORDER_INK; ctx.strokeStyle = ORDER_HALO; ctx.lineWidth = 1.2 * px; ctx.stroke(); ctx.fill();
        ctx.restore();
      }
    }
  }

  // Regroupements de l'état-major cette nuit (frontnight.js), le matin. Flèche le long du chemin de marche, épaisse
  // par la route, pointillée à travers champs ; « −N h » au départ, « +N h » à l'arrivée. Seulement les siens.
  drawNightMoves(viewer) {
    const f = this.front;
    if (!f.nightMoves?.length) return;
    const { ctx, cam } = this;
    const px = 1 / cam.s;
    for (const t of f.nightMoves) {
      if (viewer !== null && t.side !== viewer) continue;
      const pts = t.path.map((i) => this.center(i));
      if (pts.length < 2) continue;
      const w = (t.road ? 5 : 2.2) * px;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (!t.road) ctx.setLineDash([5 * px, 4 * px]);
      ctx.beginPath(); splineTo(ctx, pts);
      ctx.strokeStyle = 'rgba(14, 18, 30, 0.8)'; ctx.lineWidth = w + 3 * px; ctx.stroke();
      ctx.beginPath(); splineTo(ctx, pts);
      ctx.strokeStyle = NIGHT_INK; ctx.lineWidth = w; ctx.stroke();
      ctx.setLineDash([]);
      const a = pts[pts.length - 1], b = pts[Math.max(0, pts.length - 3)], ang = Math.atan2(a.y - b.y, a.x - b.x), L = (t.road ? 13 : 9) * px;
      ctx.beginPath();
      ctx.moveTo(a.x + Math.cos(ang) * 3 * px, a.y + Math.sin(ang) * 3 * px);
      ctx.lineTo(a.x + Math.cos(ang + 2.5) * L, a.y + Math.sin(ang + 2.5) * L);
      ctx.lineTo(a.x + Math.cos(ang - 2.5) * L, a.y + Math.sin(ang - 2.5) * L);
      ctx.closePath();
      ctx.fillStyle = NIGHT_INK; ctx.strokeStyle = 'rgba(14, 18, 30, 0.8)'; ctx.lineWidth = 1.2 * px; ctx.stroke(); ctx.fill();
      const n = Math.round(t.amount * f.cfg.men / 10) * 10;
      this.tag(`+${n.toLocaleString('fr-FR')} h · état-major`, a.x, a.y - 12 * px, '#a8d68f', px);
      const o = pts[0];
      this.tag(`−${n.toLocaleString('fr-FR')} h`, o.x, o.y + 14 * px, '#e8a08c', px);
      ctx.restore();
    }
  }

  // Étiquette sur fond sombre, taille constante à l'écran.
  tag(text, x, y, color, px) {
    const { ctx } = this;
    ctx.font = `700 ${10 * px}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 10 * px;
    ctx.fillStyle = 'rgba(29, 33, 24, 0.88)';
    ctx.fillRect(x - w / 2, y - 8 * px, w, 16 * px);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y + 0.5 * px);
  }

  // Trajet d'une formation vers son objectif (armorRoute), en pixels monde, et ses tronçons de route ; mis en cache.
  armorPath(a) {
    const key = `${a.cell}:${a.target.x}:${a.target.y}:${this.front.clock}`;
    if (this.pathCache?.[a.id]?.key === key) return this.pathCache[a.id];
    const cells = armorRoute(this.front, a);
    const pts = cells.map((i) => this.center(i));
    pts.push(this.toWorld(a.target));
    const road = [];
    for (let k = 1; k < cells.length; k++) if (this.map.road?.[cells[k - 1]] && this.map.road?.[cells[k]]) road.push([pts[k - 1], pts[k]]);
    (this.pathCache ??= {})[a.id] = { key, pts, road };
    return this.pathCache[a.id];
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
    const k = tankScale(cam.s);
    for (const sp of spears) {
      const h = this.toWorld(sp.head);
      const ang = Math.atan2(sp.uy, sp.ux);
      let mass = 0;
      for (const i of sp.cells) mass += this.front.dens[i];
      const n = Math.max(1, Math.min(cam.s < 1.1 ? 2 : 3, Math.round(mass / 80)));
      const form = TANK_FORM.slice(0, n);
      const pts = form.map(([fx, fy]) => [h.x + (fx * Math.cos(ang) - fy * Math.sin(ang)) * k, h.y + (fx * Math.sin(ang) + fy * Math.cos(ang)) * k]);
      for (const [x, y] of pts) dust(ctx, x, y, ang, k);
      for (const [x, y] of pts) piece(ctx, x, y, ang, k, (G, P, sh) => tank(G, P, sh, sp.side === 1), SPRITE_PAL[sp.side]);
      ctx.font = `700 ${10 / cam.s}px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const ly = h.y + (Math.sin(ang) > 0.3 ? -1 : 1) * 22 * k;
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
      if (own && K.at && !planning) {
        // Canon antichar : son cône de tir reste visible pendant la journée, à peine.
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.arc(c.x, c.y, K.range * CELL, g.face - AT_RULES.cone, g.face + AT_RULES.cone);
        ctx.closePath();
        ctx.fillStyle = 'rgba(29, 26, 18, 0.06)';
        ctx.fill();
      }
      if (own && planning) {
        ctx.beginPath();
        if (K.at) {
          ctx.moveTo(c.x, c.y);
          ctx.arc(c.x, c.y, K.range * CELL, g.face - AT_RULES.cone, g.face + AT_RULES.cone);
          ctx.closePath();
          ctx.fillStyle = 'rgba(29, 26, 18, 0.08)';
          ctx.fill();
        } else {
          // Appui passif : halo laiton sur la portée, plein jusqu'à 70 % puis s'estompant, selon la puissance du groupe.
          const R = K.range * CELL, p = gunPower(g);
          ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
          if (p > 0 && f.cfg.artyCover !== false) {
            const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R);
            grad.addColorStop(0, `rgba(176, 128, 26, ${0.1 * p})`);
            grad.addColorStop(0.7, `rgba(176, 128, 26, ${0.24 * p})`);
            grad.addColorStop(1, `rgba(176, 128, 26, ${0.04 * p})`);
            ctx.fillStyle = grad;
            ctx.fill();
          }
        }
        ctx.setLineDash(sel ? [] : [3 * px, 5 * px]);
        ctx.lineWidth = (sel ? 2 : K.at ? 1 : 1.5) * px;
        ctx.strokeStyle = sel ? ORDER_INK : K.at ? 'rgba(29, 26, 18, 0.35)' : 'rgba(120, 84, 14, 0.8)';
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
          if (!missionGuns(b).includes(g.id)) continue;
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
    const at = !!GUN_KINDS[g.kind].at;
    const face = at ? g.face ?? (g.side === 0 ? 0 : Math.PI) : g.side === 0 ? 0 : Math.PI;
    const moveAng = g.dest ? Math.atan2((g.dest.y - g.y), (g.dest.x - g.x)) : face;
    let n = g.kind === 'mortar' ? 4 : at ? 2 : 3;
    n = Math.max(1, Math.ceil(n * g.str - 0.05));
    if (cam.s < 1.1) n = Math.min(n, 2);
    const gap = (g.kind === 'mortar' || g.kind === 'nebel' ? 6 : g.kind === 'rocket' ? 7.5 : at ? 7 : 8.5) * k;
    const sprite = at ? (G, Pl, sh) => howitzer(G, Pl, sh, g.kind === 'atHeavy' ? 0.95 : 0.7) : g.kind === 'mortar' ? mortar : g.kind === 'rocket' ? rocket : g.kind === 'nebel' ? nebelwerfer : (G, Pl, sh) => howitzer(G, Pl, sh, g.kind === 'heavy' ? 1.3 : 1);
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
        if (g.kind !== 'rocket') pit(ctx, x, y, face, (g.kind === 'mortar' || g.kind === 'nebel' ? 3.4 : g.kind === 'heavy' ? 6 : at ? 3.6 : 5) * k);
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

  // Alerte « SOS » (frontalert.js) : au-dessus d'un secteur qui craque, un officier au combiné, à côté de son poste
  // radio, appelle à l'aide ; une bulle fait défiler · · · — — — · · · (le signe émis s'allume) ; au sol, un cercle
  // rouge pulse. Taille à peu près constante à l'écran ; l'alerte s'estompe quand le secteur se calme.
  drawAlerts(alerts, side, now) {
    const { ctx, cam } = this;
    const f = this.front;
    const k = Math.max(0.9, Math.min(3.2, 1.3 / cam.s));
    const uniform = side === 0 ? '#5d6650' : '#7d6c42', capColor = side === 0 ? '#3f4636' : '#5c4f2e';
    const MORSE = '...---...';
    for (const a of alerts) {
      const fade = Math.max(0, Math.min(1, 1 - (f.clock - a.last) / (ALERT.hold + 1)));
      if (fade <= 0) continue;
      const c = this.toWorld(a);
      const pulse = (now / 700 + (a.key % 7) * 0.13) % 1;
      ctx.save();
      ctx.globalAlpha = fade;
      // Au sol : deux ondes rouges.
      for (const ph of [pulse, (pulse + 0.5) % 1]) {
        ctx.strokeStyle = `rgba(196, 38, 26, ${0.85 * (1 - ph)})`;
        ctx.lineWidth = 2.2 * k * (1 - ph) + 0.5;
        ctx.beginPath();
        ctx.arc(c.x, c.y, (5 + 14 * ph) * k, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Mât et médaillon.
      const bx = c.x, by = c.y - 30 * k;
      ctx.strokeStyle = 'rgba(29, 26, 18, 0.8)';
      ctx.lineWidth = 1.2 * k;
      ctx.beginPath(); ctx.moveTo(c.x, c.y - 3 * k); ctx.lineTo(bx, by + 14 * k); ctx.stroke();
      ctx.fillStyle = 'rgba(244, 236, 210, 0.96)';
      ctx.strokeStyle = '#a8261a';
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.arc(bx, by, 14 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Poste radio et antenne qui oscille.
      ctx.fillStyle = '#3d4331';
      ctx.fillRect(bx + 2.5 * k, by + 1.5 * k, 8 * k, 7.5 * k);
      ctx.fillStyle = '#c9b77a';
      ctx.beginPath(); ctx.arc(bx + 5 * k, by + 4.5 * k, 1.2 * k, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d24a2a';
      ctx.beginPath(); ctx.arc(bx + 8.3 * k, by + 3.5 * k, 0.8 * k, 0, Math.PI * 2); ctx.fill();
      const sway = Math.sin(now / 160) * 1.5 * k;
      ctx.strokeStyle = '#2b2b22';
      ctx.lineWidth = 0.8 * k;
      ctx.beginPath(); ctx.moveTo(bx + 9 * k, by + 1.5 * k); ctx.quadraticCurveTo(bx + 10 * k, by - 5 * k, bx + 11 * k + sway, by - 11 * k); ctx.stroke();
      // Officier : buste, tête, casquette, bras levé tenant le combiné à l'oreille.
      ctx.fillStyle = uniform;
      ctx.beginPath();
      ctx.moveTo(bx - 8.5 * k, by + 11 * k); ctx.lineTo(bx - 7.5 * k, by - 0.5 * k); ctx.lineTo(bx + 0.5 * k, by - 0.5 * k); ctx.lineTo(bx + 1.5 * k, by + 11 * k);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e0b88e';
      ctx.beginPath(); ctx.arc(bx - 3.5 * k, by - 4 * k, 3.3 * k, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = capColor;
      ctx.beginPath(); ctx.arc(bx - 3.5 * k, by - 5.2 * k, 3.5 * k, Math.PI, 0); ctx.fill();
      ctx.fillRect(bx - 7.6 * k, by - 5.6 * k, 6.5 * k, 1.1 * k); // visière
      ctx.strokeStyle = uniform;
      ctx.lineWidth = 2.6 * k;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bx - 0.5 * k, by + 1 * k); ctx.lineTo(bx + 1.2 * k, by - 3.5 * k); ctx.stroke();
      ctx.strokeStyle = '#141410';
      ctx.lineWidth = 1.7 * k;
      ctx.beginPath(); ctx.moveTo(bx - 0.3 * k, by - 7 * k); ctx.lineTo(bx + 1.8 * k, by - 1.5 * k); ctx.stroke();
      ctx.lineWidth = 0.5 * k;
      ctx.beginPath(); ctx.moveTo(bx + 1.8 * k, by - 1.5 * k); ctx.bezierCurveTo(bx + 4 * k, by + 1 * k, bx + 1 * k, by + 4 * k, bx + 3 * k, by + 5 * k); ctx.stroke();
      // Bulle : le message en morse, signe par signe.
      const sym = (ch) => (ch === '.' ? 2.1 : 4.6) * k, gap = 1.5 * k, letter = 3 * k;
      let w = 0;
      for (let q = 0; q < MORSE.length; q++) w += sym(MORSE[q]) + (q % 3 === 2 ? letter : gap);
      const tw = 15 * k, pad = 3 * k, h = 10 * k;
      const x0 = bx + 9 * k, y0 = by - 24 * k, W = pad * 2 + w + tw;
      ctx.fillStyle = 'rgba(244, 236, 210, 0.96)';
      ctx.strokeStyle = '#1d1a12';
      ctx.lineWidth = 1 * k;
      ctx.beginPath();
      ctx.moveTo(x0 + 2 * k, y0 + h); ctx.lineTo(bx + 2 * k, by - 11 * k); ctx.lineTo(x0 + 7 * k, y0 + h); // queue vers l'officier
      ctx.lineTo(x0 + W, y0 + h); ctx.lineTo(x0 + W, y0); ctx.lineTo(x0, y0); ctx.lineTo(x0, y0 + h);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      const lit = Math.floor(now / 140) % (MORSE.length + 4);
      let x = x0 + pad;
      for (let q = 0; q < MORSE.length; q++) {
        ctx.fillStyle = q < lit ? '#c0261a' : 'rgba(60, 44, 30, 0.3)';
        const sw = sym(MORSE[q]);
        if (MORSE[q] === '.') { ctx.beginPath(); ctx.arc(x + sw / 2, y0 + h / 2, sw / 2, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(x, y0 + h / 2 - 1.05 * k, sw, 2.1 * k);
        x += sw + (q % 3 === 2 ? letter : gap);
      }
      ctx.fillStyle = '#a8261a';
      ctx.font = `700 ${7.5 * k}px "IBM Plex Mono", monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('SOS', x - 1 * k, y0 + h / 2 + 0.4 * k);
      ctx.restore();
    }
  }

  // orders : { vectors, lines, barrages, pontoons } d'un camp (ou un seul élément d'aperçu).
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
    for (const o of orders.salvos ?? []) {
      // Salve de lance-roquettes : double cercle et traits de fusées convergents.
      const c = this.toWorld(o);
      const r = o.r * CELL;
      ctx.lineWidth = 2.4 + extra;
      ctx.setLineDash(halo ? [] : [7, 3]);
      for (const k of [1, 0.6]) { ctx.beginPath(); ctx.arc(c.x, c.y, r * k, 0, Math.PI * 2); ctx.stroke(); }
      ctx.setLineDash([]);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(c.x + Math.cos(a) * r * 1.15, c.y + Math.sin(a) * r * 1.15);
        ctx.lineTo(c.x + Math.cos(a) * r * 0.75, c.y + Math.sin(a) * r * 0.75);
        ctx.stroke();
      }
    }
    for (const o of orders.drops ?? []) {
      // Largage : parachute (voilure et suspentes) au-dessus du point.
      const c = this.toWorld(o);
      ctx.lineWidth = 2 + extra;
      ctx.beginPath(); ctx.arc(c.x, c.y - 9, 10, Math.PI, 0); ctx.closePath(); ctx.stroke();
      ctx.beginPath();
      for (const dx of [-10, 0, 10]) { ctx.moveTo(c.x + dx, c.y - 9); ctx.lineTo(c.x, c.y + 6); }
      ctx.stroke();
      ctx.beginPath(); ctx.arc(c.x, c.y + 7, 2.5, 0, Math.PI * 2); fill();
      ctx.beginPath(); ctx.arc(c.x, c.y, SPECIAL.drop.r * CELL, 0, Math.PI * 2);
      ctx.setLineDash(halo ? [] : [3, 4]); ctx.lineWidth = 1.4 + extra; ctx.stroke(); ctx.setLineDash([]);
    }
    for (const o of orders.pontoons ?? []) {
      // Pont de bateaux commandé : trait pointillé de rive à rive, barré de petites barques.
      const a = this.center(o.bank), b = this.center(o.cells[o.cells.length - 1]);
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
      const e = { x: b.x + ux * CELL * 0.9, y: b.y + uy * CELL * 0.9 };
      ctx.lineWidth = 2.4 + extra;
      ctx.setLineDash(halo ? [] : [4, 3]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(e.x, e.y); ctx.stroke();
      ctx.setLineDash([]);
      for (const c of o.cells) {
        const p = this.center(c);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 5, 2.4, Math.atan2(uy, ux) + Math.PI / 2, 0, Math.PI * 2);
        fill();
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
      // Attaque en cours : la flèche, creuse, se remplit d'encre à mesure que le front avance le long de son axe.
      const m = this.front.phase === 'resolve' && !retreat ? vectorMomentum(this.front, v) : null;
      const width = (armor ? 5 : 3) + extra;
      // Flèche légèrement courbe, comme tracée à main levée.
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const bend = Math.min(18, L * 0.08);
      const pts = [a, { x: mx - ((b.y - a.y) / L) * bend, y: my + ((b.x - a.x) / L) * bend }, b];
      // Avancement affiché : interpolé entre les deux derniers ticks, comme la masse des troupes.
      const tr = v.track ?? [];
      const p = m ? tr[Math.max(0, tr.length - 2)] + (m.p - tr[Math.max(0, tr.length - 2)]) * this.orderClock.t : 1;
      const body = (u0, u1) => {
        ctx.beginPath();
        if (u0 === 0 && u1 === 1) { splineTo(ctx, pts); return; }
        const n = Math.max(2, Math.ceil((u1 - u0) * 24));
        for (let k = 0; k <= n; k++) { const q = splineAt(pts, 2 * (u0 + ((u1 - u0) * k) / n)); if (k) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }
      };
      const line = (u0, u1, dash) => {
        ctx.lineWidth = width;
        ctx.setLineDash(dash && !halo ? [8, 5] : []);
        body(u0, u1);
        ctx.stroke();
        ctx.setLineDash([]);
        if (armor && !halo) {
          // Double trait des blindés.
          ctx.strokeStyle = ORDER_HALO;
          ctx.lineWidth = 1.4;
          body(u0, u1);
          ctx.stroke();
          ctx.strokeStyle = ink;
        }
      };
      const dash = retreat || !!v.pocket;
      if (m && !halo) {
        ctx.strokeStyle = ORDER_EMPTY;
        line(p, 1, dash);
        ctx.strokeStyle = ink;
        if (p > 0.005) line(0, p, dash);
      } else line(0, 1, dash);
      const ang = Math.atan2(b.y - pts[1].y, b.x - pts[1].x);
      const size = armor ? 16 : 12;
      const empty = m && m.state !== 'done' && !halo;
      if (empty) ctx.fillStyle = ORDER_EMPTY;
      ctx.beginPath();
      ctx.moveTo(b.x + Math.cos(ang) * 4, b.y + Math.sin(ang) * 4);
      ctx.lineTo(b.x + Math.cos(ang + 2.6) * size, b.y + Math.sin(ang + 2.6) * size);
      ctx.lineTo(b.x + Math.cos(ang - 2.6) * size, b.y + Math.sin(ang - 2.6) * size);
      ctx.closePath();
      fill();
      ctx.fillStyle = ink;
      if (m && m.state !== 'done') this.paintMomentum(pts, p, m, armor, ink, halo);
    }
  }

  // Tête d'une attaque en cours : marque à la couleur de son élan (forme redondante avec la couleur), et projection en
  // pointillés jusqu'où elle arrivera ce soir à ce rythme.
  paintMomentum(pts, p, m, armor, ink, halo) {
    const { ctx } = this;
    const base = ctx.globalAlpha;
    const at = (u) => splineAt(pts, 2 * Math.max(0, Math.min(1, u)));
    const dir = (u) => { const q0 = at(u - 0.02), q1 = at(u + 0.02); return Math.atan2(q1.y - q0.y, q1.x - q0.x); };
    // Projection : trait fin pointillé de la tête à la position attendue au soir, chevron ouvert au bout.
    if (m.proj > p + 0.03) {
      const end = m.proj < 0.97; // au bout de l'axe, la pointe de la flèche suffit
      ctx.strokeStyle = halo ? ink : ORDER_INK;
      ctx.lineWidth = halo ? 3.6 : 1.6;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      const n = Math.max(2, Math.ceil((m.proj - p) * 24));
      for (let k = 0; k <= n; k++) { const q = at(p + ((m.proj - p) * k) / n); if (k) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }
      ctx.stroke();
      ctx.setLineDash([]);
      if (end) {
        const e = at(m.proj), a = dir(m.proj), r = armor ? 8 : 6.5;
        ctx.lineWidth = halo ? 4 : 1.8;
        ctx.beginPath();
        ctx.moveTo(e.x + Math.cos(a + 2.4) * r, e.y + Math.sin(a + 2.4) * r);
        ctx.lineTo(e.x, e.y);
        ctx.lineTo(e.x + Math.cos(a - 2.4) * r, e.y + Math.sin(a - 2.4) * r);
        ctx.stroke();
      }
    }
    const c = at(p), a = dir(p), ux = Math.cos(a), uy = Math.sin(a);
    const r = armor ? 9 : 7.5;
    ctx.strokeStyle = halo ? ink : MOMENTUM_INK[m.state];
    ctx.fillStyle = ctx.strokeStyle;
    if (m.state === 'breakthrough' && !halo) ctx.globalAlpha = base * (0.65 + 0.35 * Math.sin(this.orderClock.now / 140));
    const chevron = (back, k = 1) => {
      // Pointe pleine dans le sens de l'axe (ou à rebours, quand l'attaque recule).
      const s = back ? -1 : 1, x = c.x + ux * s * r * (k - 1) * 0.9, y = c.y + uy * s * r * (k - 1) * 0.9;
      ctx.beginPath();
      ctx.moveTo(x + ux * s * r, y + uy * s * r);
      ctx.lineTo(x + Math.cos(a + 2.5) * s * r, y + Math.sin(a + 2.5) * s * r);
      ctx.lineTo(x - ux * s * r * 0.35, y - uy * s * r * 0.35);
      ctx.lineTo(x + Math.cos(a - 2.5) * s * r, y + Math.sin(a - 2.5) * s * r);
      ctx.closePath();
      if (halo) { ctx.lineWidth = 2.6; ctx.stroke(); }
      ctx.fill();
    };
    if (m.state === 'stall') {
      // Piétinement : barre en travers de l'axe.
      ctx.lineCap = 'butt';
      ctx.lineWidth = halo ? 7 : 4;
      ctx.beginPath();
      ctx.moveTo(c.x - uy * r, c.y + ux * r);
      ctx.lineTo(c.x + uy * r, c.y - ux * r);
      ctx.stroke();
      ctx.lineCap = 'round';
    } else if (m.state === 'wait') {
      // Ordre retenu par le PC : cercle creux (l'attaque partira à midi).
      ctx.lineWidth = halo ? 4.4 : 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    } else if (m.state === 'repulsed') chevron(true);
    else if (m.state === 'breakthrough') { chevron(false, 1); chevron(false, 2); }
    else chevron(false);
    ctx.globalAlpha = base;
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
  }
}

export { blobPath };
