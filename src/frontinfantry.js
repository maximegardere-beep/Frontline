// Fantassins du front stratégique, vus de dessus : de petits soldats dont la disposition dit la posture de chaque
// secteur (frontrender.js, troopDots, lit l'état du moteur et classe les cases de contact ; ce module place les
// hommes et les dessine) :
// - Tenir : une tranchée à créneaux parallèle au front, quelques pixels en arrière, là où le secteur ne bouge plus ;
//   un groupe de 3 à 5 hommes serrés dans le créneau, face à l'ennemi, et une ligne de soutien clairsemée derrière ;
// - Attaquer : deux vagues de tirailleurs décalées (groupes de 4), qui avancent par bonds alternés : l'une progresse
//   pendant que l'autre fait feu ;
// - Repli : une colonne en file indienne vers l'arrière, dans la poussière, et une arrière-garde de 3 qui tire ;
// - Poche : des groupes de 2 à 5 épars, sans ligne, tournés en tous sens ;
// - Arrière : les amas (garnisons, réserves) en essaim serré.
// Une seule représentation à tous les zooms : les hommes ont une taille monde (ils rapetissent quand on dézoome), avec
// un plancher à l'écran. Purement visuel : les tirages viennent d'un générateur par case, jamais de celui du moteur.

const INF_CELL = 9 * Math.sqrt(3); // largeur d'une case le long du front (CELL × √3), en pixels monde
// Couleurs des hommes : [corps, tête] par camp (Wehrmacht, Armée rouge).
export const MAN_RGB = [['#1e2f4a', '#3a5a8e'], ['#5a170c', '#b0371f']];
// Silhouette, en unités de dessin (× k pour les pixels monde au zoom 1) : ombre portée, corps (demi-axes le long de
// la visée et en travers), tête, fusil (de rifle[0] à rifle[1] devant, sur l'épaule à rifle[2] du milieu, épaisseur
// rifle[3] en pixels monde). k : échelle (un homme fait environ le tiers d'une case) ; screen : plancher de la taille
// à l'écran (part de la taille au zoom 1) ; angles : orientations pré-dessinées ; reach : demi-côté d'une vignette.
export const MAN = {
  k: 0.62, screen: 0.45, angles: 16, reach: 7.5,
  shadow: { dx: 1.6, dy: 1.6, rx: 2.6, ry: 3.4, a: 0.25 },
  body: { rx: 2.3, ry: 3.4 }, head: { r: 1.6, fwd: 0.3 }, rifle: [0, 5.2, 2, 0.6],
};
// Tranchée : recul derrière la ligne (pixels monde), créneaux (demi-amplitude, longueur d'un créneau avancé),
// demi-longueur d'un tronçon (une case de contact), épaisseurs (fond sombre, liseré clair), ticks d'immobilité avant
// d'apparaître et d'être pleine.
export const TRENCH = { back: 5, amp: 1.9, bay: 7.5, half: 8.6, dark: 6, light: 2, still: 3, full: 12 };
// Bonds de l'attaque : longueur (pixels monde), durée d'un bond (s) ; colonne de repli : espacement, vitesse (pas
// par seconde) ; coups de feu : créneau de tirage (ms) et chance par créneau.
export const BOUND = { len: 10, dur: 1.4, file: 5, speed: 0.55, slot: 110, flash: 0.03 };
export const POSTURE = { hold: 0, attack: 1, retreat: 2, pocket: 3 };

// Rôle d'un homme pour l'animation : immobile, tireur, vague 0 ou 1 de l'assaut, homme d'une colonne.
const ROLE = { still: 0, fire: 1, wave0: 2, wave1: 3, file: 4 };
// Un homme : x, y, angle, opacité, rôle, ax, ay (bond ou pas de colonne), phase, bout de colonne (1 tête, 2 queue).
export const MAN_STRIDE = 9;

// Échelle des hommes et des tranchées au zoom s : taille monde, avec un plancher à l'écran.
export const manScale = (s) => Math.max(1, MAN.screen / s);

// ---------- Placement ----------

// Hommes et tranchée d'un secteur (une case de contact). sec : { side, posture, x, y (point du front), nx, ny (vers
// l'intérieur de ses lignes), count, depth (profondeur de la bande), alpha, live (s'anime pendant la journée),
// trench (force de la tranchée, 0 : aucune) } ; out : { men: [[], []], trenches: [[], []] } ; r : générateur de la case.
export function placeSector(out, sec, r) {
  const { side, x, y, nx, ny, alpha, live } = sec;
  const men = out.men[side];
  const P = (d, lat) => [x + nx * d - ny * lat, y + ny * d + nx * lat];
  const foe = Math.atan2(-ny, -nx), back = Math.atan2(ny, nx);
  const put = ([px, py], ang, role, ax = 0, ay = 0, ph = r.next() * 10, end = 0) => men.push(px, py, ang, alpha, role, ax, ay, ph, end);
  const aim = () => foe + (r.next() - 0.5) * 0.5;
  let n = sec.count;
  if (sec.posture === POSTURE.hold) {
    const T = TRENCH;
    if (sec.trench > 0) { const [cx, cy] = P(T.back, 0); out.trenches[side].push(cx, cy, -ny, nx, -nx, -ny, sec.trench, alpha); }
    // Le groupe du créneau : serré, sur deux rangs décalés, face à l'ennemi.
    const g = Math.min(n, 3 + Math.floor(r.next() * 3));
    const at = (r.next() - 0.5) * 1.5;
    for (let q = 0; q < g; q++) put(P(T.back - T.amp * 0.7 + (q % 2) * 1.8 + (r.next() - 0.5) * 0.6, at + (q - (g - 1) / 2) * 2.9 + (r.next() - 0.5) * 0.6), aim(), live ? ROLE.fire : ROLE.still);
    // Soutien : une partie du reste, en tirailleurs isolés plus loin derrière, d'autant plus profond que c'est dense.
    n -= g;
    const support = Math.round(n * 0.6);
    for (let q = 0; q < support; q++) put(P(T.back + 7 + sec.depth * Math.pow(r.next(), 1.3), ((q + 0.5) / support - 0.5) * INF_CELL * 0.95 + (r.next() - 0.5) * 3), aim(), ROLE.still);
  } else if (sec.posture === POSTURE.attack) {
    // Groupes de 4 en deux vagues décalées (en profondeur et sur le côté) ; d'autres vagues suivent derrière.
    const groups = Math.max(1, Math.round(n / 4)), ph = r.next() * BOUND.dur * 2;
    for (let k = 0; k < groups && n > 0; k++) {
      const wave = k % 2, row = Math.floor(k / 2);
      const d0 = BOUND.len + 1 + wave * 6 + row * 9, c = (wave ? 0.18 : -0.18) * INF_CELL + (r.next() - 0.5) * 2;
      for (let q = 0; q < 4 && n > 0; q++, n--) {
        const role = !live ? ROLE.still : wave ? ROLE.wave1 : ROLE.wave0;
        put(P(d0 + (r.next() - 0.5) * 2.4, c + (q - 1.5) * 3.8 + (r.next() - 0.5) * 1.2), aim(), role, -nx, -ny, ph + r.next() * 0.15);
      }
    }
  } else if (sec.posture === POSTURE.retreat) {
    // Arrière-garde au contact, qui tire ; le reste en file indienne vers l'arrière.
    const g = Math.min(n, 3);
    for (let q = 0; q < g; q++) put(P(2.5 + r.next() * 1.5, (q - (g - 1) / 2) * 4.5), aim(), live ? ROLE.fire : ROLE.still);
    const m = Math.min(n - g, 7), lat = (r.next() - 0.5) * 6, ph = r.next();
    for (let q = 0; q < m; q++) {
      put(P(9 + q * BOUND.file, lat + (r.next() - 0.5) * 0.8), back + (r.next() - 0.5) * 0.2, live ? ROLE.file : ROLE.still, nx * BOUND.file, ny * BOUND.file, ph, m > 1 && q === 0 ? 1 : m > 1 && q === m - 1 ? 2 : 0);
    }
  } else {
    // Poche : petits groupes épars, sans ligne, tournés en tous sens.
    while (n > 0) {
      const g = Math.min(n, 2 + Math.floor(r.next() * 4));
      const d = 3 + r.next() * (sec.depth + 6), c = (r.next() - 0.5) * INF_CELL * 0.95;
      for (let q = 0; q < g; q++) put(P(d + (r.next() - 0.5) * 5, c + (r.next() - 0.5) * 5), r.next() * 6.3, ROLE.still);
      n -= g;
    }
  }
}

// Amas de l'arrière : n hommes en essaim serré (spirale de Vogel) dans un rayon R autour de (cx, cy), tournés vers
// l'ennemi (camp 0 vers l'est, camp 1 vers l'ouest) à peu près.
export function placeCluster(men, side, cx, cy, R, n, r, alpha = 1) {
  const face = side === 0 ? 0 : Math.PI;
  for (let q = 0; q < n; q++) {
    const d = R * Math.sqrt((q + 0.5) / n), a = q * 2.39996 + r.next() * 0.5;
    men.push(cx + Math.cos(a) * d * 1.15, cy + Math.sin(a) * d * 0.9, face + (r.next() - 0.5) * 1.2, alpha, ROLE.still, 0, 0, 0, 0);
  }
}

// ---------- Vignettes ----------

// Planche des silhouettes : une rangée par camp, une colonne par orientation, à res pixels par pixel monde (paliers
// en racine de 2, refaite seulement quand le zoom change de palier).
let manAtlas = null;
function atlasFor(res) {
  const step = Math.max(-2, Math.min(6, Math.round(Math.log2(res) * 2)));
  if (manAtlas?.step === step) return manAtlas;
  const px = 2 ** (step / 2), u = MAN.reach * MAN.k, cell = Math.ceil(2 * u * px) + 2;
  const c = document.createElement('canvas');
  c.width = cell * MAN.angles;
  c.height = cell * 2;
  const g = c.getContext('2d');
  const { shadow: sh, body, head, rifle } = MAN;
  for (let s = 0; s < 2; s++) {
    for (let k = 0; k < MAN.angles; k++) {
      g.setTransform(px * MAN.k, 0, 0, px * MAN.k, k * cell + cell / 2, s * cell + cell / 2);
      const a = (k / MAN.angles) * Math.PI * 2;
      g.fillStyle = `rgba(20, 16, 8, ${sh.a})`;
      g.beginPath(); g.ellipse(sh.dx, sh.dy, sh.rx, sh.ry, a, 0, Math.PI * 2); g.fill();
      g.rotate(a);
      g.fillStyle = MAN_RGB[s][0];
      g.beginPath(); g.ellipse(0, 0, body.rx, body.ry, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#2a2014';
      g.lineWidth = rifle[3] / MAN.k;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(rifle[0], rifle[2]); g.lineTo(rifle[1], rifle[2] - 0.4); g.stroke();
      g.fillStyle = MAN_RGB[s][1];
      g.beginPath(); g.arc(head.fwd, 0, head.r, 0, Math.PI * 2); g.fill();
    }
  }
  manAtlas = { step, c, cell, u, px };
  return manAtlas;
}

// ---------- Dessin ----------

const ease = (t) => t * t * (3 - 2 * t);
// Tirage visuel déterministe dans [0, 1) (coups de feu) : ni Math.random, ni le générateur du moteur.
const flick = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };

// Tranchées à créneaux, sous les hommes : un tronçon par case de contact, centré à TRENCH.back derrière le front ;
// les créneaux avancent vers l'ennemi au milieu du tronçon, le tronçon voisin raccorde par l'arrière. Deux passes
// (fond sombre, liseré clair), regroupées par palier d'opacité.
function drawTrenches(ctx, list, M) {
  const T = TRENCH, h = T.bay / 2, slope = 0.9;
  for (const pass of [0, 1]) {
    const buckets = new Map();
    for (const t of list) {
      for (let k = 0; k < t.length; k += 8) {
        const a = Math.round(t[k + 6] * t[k + 7] * 6) / 6;
        if (a <= 0) continue;
        if (!buckets.has(a)) buckets.set(a, []);
        buckets.get(a).push(k, t);
      }
    }
    ctx.lineWidth = (pass ? T.light : T.dark) * MAN.k * M;
    for (const [a, refs] of buckets) {
      ctx.beginPath();
      for (let q = 0; q < refs.length; q += 2) {
        const k = refs[q], t = refs[q + 1];
        const cx = t[k], cy = t[k + 1], tx = t[k + 2], ty = t[k + 3], ex = t[k + 4], ey = t[k + 5];
        const pt = (lat, o) => [cx + tx * lat + ex * o, cy + ty * lat + ey * o];
        const pts = [pt(-T.half, -T.amp), pt(-h - slope, -T.amp), pt(-h + slope, T.amp), pt(h - slope, T.amp), pt(h + slope, -T.amp), pt(T.half, -T.amp)];
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.strokeStyle = pass ? `rgba(176, 150, 104, ${0.9 * a})` : `rgba(62, 44, 26, ${0.7 * a})`;
      ctx.stroke();
    }
  }
}

// Dessine les hommes (D : { men: [[], []], trenches: [[], []] }). s : zoom ; dpr : densité de l'écran ; live : la
// journée se joue et le mouvement n'est pas réduit (bonds, colonnes, coups de feu) ; sinon, chacun à sa place de
// départ.
export function drawMen(ctx, D, { now, s, dpr, live }) {
  const M = manScale(s);
  drawTrenches(ctx, D.trenches, M);
  const A = atlasFor(Math.max(s, MAN.screen) * dpr);
  const w = (A.cell / A.px / 2) * M, n16 = MAN.angles / (Math.PI * 2);
  const sec = now / 1000;
  const flashes = [], dust = [];
  for (const side of [0, 1]) {
    const a = D.men[side], sy = side * A.cell;
    let alpha = -1;
    for (let k = 0; k < a.length; k += MAN_STRIDE) {
      let x = a[k], y = a[k + 1], al = a[k + 3];
      const role = live ? a[k + 4] : ROLE.still, ang = a[k + 2], ph = a[k + 7];
      let fire = role === ROLE.fire;
      if (role === ROLE.wave0 || role === ROLE.wave1) {
        // Bonds alternés : u dans [0, 2) ; de 0 à 1 la vague avance, de 1 à 2 elle tient et tire, puis repart de sa
        // ligne de départ (fondu bref à la reprise).
        const u = ((sec + ph) / BOUND.dur + (role === ROLE.wave1 ? 1 : 0)) % 2;
        const b = BOUND.len * (u < 1 ? ease(u) : 1);
        x += a[k + 5] * b; y += a[k + 6] * b;
        if (u < 0.15) al *= 0.35 + (0.65 * u) / 0.15;
        fire = u >= 1;
      } else if (role === ROLE.file) {
        // Colonne : tout le monde glisse d'un pas vers l'arrière ; la tête apparaît, la queue s'efface (boucle sans
        // saut). Bouffées de poussière derrière chacun.
        const f = (sec * BOUND.speed + ph) % 1;
        x += a[k + 5] * f; y += a[k + 6] * f;
        if (a[k + 8] === 1) al *= f; else if (a[k + 8] === 2) al *= 1 - f;
        dust.push(x - a[k + 5] * 0.55, y - a[k + 6] * 0.55, al * (0.6 + 0.4 * Math.sin(sec * 7 + ph * 40)));
      }
      if (fire && flick(Math.floor(now / BOUND.slot + ph * 13), ph) < BOUND.flash) flashes.push(x + Math.cos(ang) * 5.5 * MAN.k * M, y + Math.sin(ang) * 5.5 * MAN.k * M, al);
      if (al !== alpha) { alpha = al; ctx.globalAlpha = al; }
      const i = ((Math.round(ang * n16) % MAN.angles) + MAN.angles) % MAN.angles;
      ctx.drawImage(A.c, i * A.cell, sy, A.cell, A.cell, x - w, y - w, 2 * w, 2 * w);
    }
  }
  ctx.globalAlpha = 1;
  if (dust.length) {
    ctx.fillStyle = 'rgb(196, 176, 136)';
    for (let k = 0; k < dust.length; k += 3) {
      ctx.globalAlpha = 0.22 * dust[k + 2];
      ctx.beginPath(); ctx.arc(dust[k], dust[k + 1], 1.9 * MAN.k * M, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (flashes.length) {
    // Coup de feu : point jaune et halo pâle, juste devant le tireur.
    for (const [r, style] of [[2.6, 'rgba(255, 214, 120, 0.3)'], [0.9, '#ffe066']]) {
      ctx.fillStyle = style;
      ctx.beginPath();
      for (let k = 0; k < flashes.length; k += 3) { const rr = r * MAN.k * M * 1.2; ctx.moveTo(flashes[k] + rr, flashes[k + 1]); ctx.arc(flashes[k], flashes[k + 1], rr, 0, Math.PI * 2); }
      ctx.fill();
    }
  }
}
