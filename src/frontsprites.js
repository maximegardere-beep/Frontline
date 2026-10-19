// Pièces vues de dessus, dessinées en code (aucune image à charger) : chars, obusiers, mortiers, lance-roquettes,
// camions tracteurs, épaulements de terre. Chaque fonction dessine une pièce centrée sur l'origine, tournée vers +x,
// en unités monde (un char mesure ~11 unités ; deux cases voisines sont à ~15,6). L'appelant place et oriente.

// Teintes : jaune sable sali (Wehrmacht, 1943), vert 4BO (Armée rouge).
export const SPRITE_PAL = [
  { body: '#86805c', dark: '#3b3a2c', track: '#2a2a24', light: '#c2bd92' },
  { body: '#56603a', dark: '#2c321c', track: '#24261c', light: '#8e9a62' },
];

// Épaves : la peinture a brûlé ; seul un reste de teinte du camp sur le glacis.
export const WRECK_PAL = [
  { body: '#4a463a', dark: '#1c1a16', track: '#161512', light: '#6a6450' },
  { body: '#3c4030', dark: '#1a1c14', track: '#151611', light: '#5a6046' },
];

const CREW = '#2b2a20';

// Ombre portée puis pièce : fn(g, pal, shadow).
export function piece(g, x, y, ang, k, fn, pal) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.scale(k, k);
  g.save();
  g.translate(1.1, 1.3);
  g.globalAlpha *= 0.35;
  fn(g, pal, true);
  g.restore();
  fn(g, pal, false);
  g.restore();
}

const fill = (g, c, sh) => { g.fillStyle = sh ? '#000' : c; };
const stroke = (g, c, sh) => { g.strokeStyle = sh ? '#000' : c; };

export function tank(g, P, sh, heavy = false) {
  const L = heavy ? 12 : 10.5, W = heavy ? 6.6 : 6;
  fill(g, P.track, sh);
  g.fillRect(-L / 2, -W / 2, L, 1.7);
  g.fillRect(-L / 2, W / 2 - 1.7, L, 1.7);
  fill(g, P.body, sh);
  g.fillRect(-L / 2 + 0.6, -W / 2 + 1.2, L - 1.2, W - 2.4);
  if (!sh) { g.strokeStyle = P.dark; g.lineWidth = 0.35; g.strokeRect(-L / 2 + 0.6, -W / 2 + 1.2, L - 1.2, W - 2.4); }
  fill(g, P.light, sh);
  g.beginPath();
  g.ellipse(-0.6, 0, 2.6, 2.1, 0, 0, Math.PI * 2);
  g.fill();
  if (!sh) { g.strokeStyle = P.dark; g.lineWidth = 0.35; g.stroke(); }
  stroke(g, P.dark, sh);
  g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(1.5, 0);
  g.lineTo(heavy ? 8.5 : 7.5, 0);
  g.stroke();
}

// Char détruit : caisse noircie, une chenille déroulée, tourelle de travers (turn, radians), tube pendant.
export function wreck(g, P, sh, turn = 0.6) {
  const L = 10.5, W = 6;
  fill(g, P.track, sh);
  g.fillRect(-L / 2, -W / 2, L, 1.7);
  g.fillRect(-L / 2 - 2.5, W / 2 - 1.5, L * 0.6, 1.2);
  fill(g, P.body, sh);
  g.fillRect(-L / 2 + 0.6, -W / 2 + 1.2, L - 1.2, W - 2.4);
  if (!sh) { g.fillStyle = 'rgba(12, 10, 8, 0.55)'; g.beginPath(); g.ellipse(1.5, -0.4, 2.6, 1.6, 0.4, 0, Math.PI * 2); g.fill(); }
  g.save();
  g.translate(-0.6, 0.3);
  g.rotate(turn);
  fill(g, P.light, sh);
  g.beginPath();
  g.ellipse(0, 0, 2.4, 2, 0, 0, Math.PI * 2);
  g.fill();
  stroke(g, P.dark, sh);
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(2, 0);
  g.lineTo(5.5, 0.9);
  g.stroke();
  g.restore();
}

// Obusier en batterie : flèches d'affût ouvertes, roues, bouclier, tube, servants.
export function howitzer(g, P, sh, k = 1) {
  g.lineCap = 'round';
  stroke(g, P.dark, sh);
  g.lineWidth = 0.9 * k;
  g.beginPath();
  g.moveTo(-0.5, -0.8 * k); g.lineTo(-5.5 * k, -2.2 * k);
  g.moveTo(-0.5, 0.8 * k); g.lineTo(-5.5 * k, 2.2 * k);
  g.stroke();
  fill(g, P.track, sh);
  g.fillRect(-1.4 * k, -3.4 * k, 2.8 * k, 1.3 * k);
  g.fillRect(-1.4 * k, 2.1 * k, 2.8 * k, 1.3 * k);
  fill(g, P.body, sh);
  g.fillRect(0.4 * k, -2.3 * k, 0.9 * k, 4.6 * k);
  stroke(g, P.body, sh);
  g.lineWidth = 1.5 * k;
  g.beginPath(); g.moveTo(-1.6 * k, 0); g.lineTo(6.5 * k, 0); g.stroke();
  if (sh) return;
  g.lineWidth = 0.5; g.strokeStyle = P.dark;
  g.beginPath(); g.moveTo(-1.6 * k, 0); g.lineTo(6.5 * k, 0); g.stroke();
  g.fillStyle = CREW;
  for (const [x, y] of [[-3, -4.4], [-3.6, 4.2], [-7, 0]]) { g.beginPath(); g.arc(x * k, y * k, 0.8, 0, Math.PI * 2); g.fill(); }
}

// Obusier attelé (déplacement) : flèches refermées derrière le tube, tiré par un camion.
export function towed(g, P, sh) {
  fill(g, P.body, sh);
  g.fillRect(-4.5, -1.7, 9, 3.4);
  fill(g, P.dark, sh);
  g.fillRect(2.6, -1.8, 2.2, 3.6);
  stroke(g, P.dark, sh);
  g.lineWidth = 0.9;
  g.beginPath(); g.moveTo(-4.5, 0); g.lineTo(-9, 0); g.stroke();
  fill(g, P.track, sh);
  g.fillRect(-10.6, -2.2, 1.8, 1); g.fillRect(-10.6, 1.2, 1.8, 1);
  stroke(g, P.body, sh);
  g.lineWidth = 1.3;
  g.beginPath(); g.moveTo(-9.6, 0); g.lineTo(-15, 0); g.stroke();
}

// Mortier lourd : plaque de base ronde, tube court, deux servants.
export function mortar(g, P, sh) {
  fill(g, P.dark, sh);
  g.beginPath(); g.arc(-1, 0, 1.8, 0, Math.PI * 2); g.fill();
  stroke(g, P.body, sh);
  g.lineWidth = 1.3;
  g.beginPath(); g.moveTo(-1, 0); g.lineTo(3, 0); g.stroke();
  if (sh) return;
  g.fillStyle = CREW;
  for (const [x, y] of [[-3, -2.4], [-3.4, 2.2]]) { g.beginPath(); g.arc(x, y, 0.75, 0, Math.PI * 2); g.fill(); }
}

// Lance-roquettes sur camion : cabine à l'avant, rampe de rails sur le plateau.
export function rocket(g, P, sh) {
  fill(g, P.body, sh);
  g.fillRect(-6, -2.2, 12, 4.4);
  fill(g, P.dark, sh);
  g.fillRect(3.4, -2.3, 2.8, 4.6);
  if (sh) return;
  g.strokeStyle = P.light;
  g.lineWidth = 0.35;
  for (let k = -1.6; k <= 1.65; k += 0.53) { g.beginPath(); g.moveTo(-6.4, k); g.lineTo(2.6, k); g.stroke(); }
}

// Nebelwerfer : six tubes en barillet sur un affût à deux roues, flèche vers l'arrière, deux servants.
export function nebelwerfer(g, P, sh) {
  stroke(g, P.body, sh);
  g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(-1.5, 0); g.lineTo(-6, 0); g.stroke();
  fill(g, P.track, sh);
  g.fillRect(-1.2, -3, 2, 0.9); g.fillRect(-1.2, 2.1, 2, 0.9);
  fill(g, P.dark, sh);
  g.beginPath(); g.arc(0.6, 0, 2.3, 0, Math.PI * 2); g.fill();
  if (sh) return;
  g.fillStyle = P.light;
  for (let q = 0; q < 6; q++) { const a = (q / 6) * Math.PI * 2; g.beginPath(); g.arc(0.6 + Math.cos(a) * 1.35, Math.sin(a) * 1.35, 0.45, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = CREW;
  for (const [x, y] of [[-3.4, -2.6], [-3.8, 2.4]]) { g.beginPath(); g.arc(x, y, 0.75, 0, Math.PI * 2); g.fill(); }
}

// Épaulement : rempart de terre en fer à cheval, ouvert vers l'arrière (pièce en batterie).
export function pit(g, x, y, ang, r) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.strokeStyle = 'rgba(92, 72, 44, 0.75)';
  g.lineWidth = r * 0.32;
  g.beginPath();
  g.arc(0.5, 0, r, -2.1, 2.1);
  g.stroke();
  g.restore();
}

// Poussière derrière un véhicule en mouvement.
export function dust(g, x, y, ang, k) {
  g.fillStyle = 'rgba(200, 180, 140, 0.35)';
  g.beginPath();
  g.ellipse(x - 9 * k * Math.cos(ang), y - 9 * k * Math.sin(ang), 7 * k, 3 * k, ang, 0, Math.PI * 2);
  g.fill();
}

// ---------- Avions ----------
// Silhouettes vues de dessus, nez vers +x, envergure le long de y ; une unité ≈ 1 m. Ju 87 Stuka (bombardier en
// piqué allemand : ailes en W, carénages de roues fixes), He 111 (bombardier horizontal : ailes elliptiques, deux
// moteurs, nez vitré), Pe-2 (bombardier en piqué soviétique : deux moteurs, double dérive), Il-2 Sturmovik (assaut
// au sol : nez blindé, bords d'attaque en flèche). Type inconnu : la silhouette générique.
// Teintes : gris-vert et bande jaune du front de l'Est (Luftwaffe), vert et étoiles rouges (VVS).
export const PLANE_PAL = [
  { body: '#7c8590', dark: '#4e5560', band: '#d8b13a' },
  { body: '#6c7a4a', dark: '#46512e', band: null },
];

const outline = (g, pts) => { g.beginPath(); pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b))); g.closePath(); };
// Contour symétrique : points du côté y < 0, du nez à la queue ; le côté y > 0 s'en déduit.
const sym = (pts) => [...pts, ...pts.slice().reverse().map(([a, b]) => [a, -b])];

// Croix noire liserée de blanc (Balkenkreuz) ou étoile rouge, à plat sur l'aile.
function mark(g, side, x, y, s) {
  if (side === 0) {
    g.fillStyle = '#f2f0e6';
    g.fillRect(x - s, y - s * 0.38, s * 2, s * 0.76);
    g.fillRect(x - s * 0.38, y - s, s * 0.76, s * 2);
    g.fillStyle = '#16140f';
    g.fillRect(x - s * 0.8, y - s * 0.2, s * 1.6, s * 0.4);
    g.fillRect(x - s * 0.2, y - s * 0.8, s * 0.4, s * 1.6);
    return;
  }
  g.fillStyle = '#c8281c';
  g.beginPath();
  for (let q = 0; q < 10; q++) {
    const a = (q / 10) * Math.PI * 2 - Math.PI / 2, r = q % 2 ? s * 0.42 : s;
    g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
}

// Demi-aile elliptique (He 111), côté y < 0 : de la racine y0 au saumon b, corde c à la racine, centrée sur x0.
function ellipticWing(b, y0, c, x0) {
  const pts = [];
  for (let q = 0; q <= 8; q++) { const t = q / 8, k = Math.sqrt(1 - t * t * 0.96); pts.push([x0 + c * 0.55 * k, -(y0 + (b - y0) * t)]); }
  for (let q = 8; q >= 0; q--) { const t = q / 8, k = Math.sqrt(1 - t * t * 0.96); pts.push([x0 - c * 0.45 * k + t * 0.5, -(y0 + (b - y0) * t)]); }
  return pts;
}

// Dessine l'avion (type, camp side) centré sur l'origine ; shadow : silhouette noire, sans détails.
export function planeShape(g, type, side, shadow) {
  const P = PLANE_PAL[side];
  const part = (pts, c) => { g.fillStyle = shadow ? '#141008' : c; outline(g, pts); g.fill(); if (!shadow) g.stroke(); };
  const both = (pts, c) => { part(pts, c); part(pts.map(([a, b]) => [a, -b]), c); };
  const disc = (x, y, rx, ry, c) => { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); };
  g.strokeStyle = '#22261c';
  g.lineWidth = 0.4;
  if (type === 'stuka') {
    // Ailes en W inversé : section intérieure plus sombre (elle plonge), cassure, carénages de roues sous la cassure.
    both([[2.7, -1], [3, -3.3], [-0.8, -3.3], [-0.7, -1]], P.dark);
    both([[3, -3.3], [2.2, -6.6], [1.5, -7.1], [0.4, -7], [-0.8, -3.3]], P.body);
    if (!shadow) { disc(3.4, -3.3, 1, 0.45, P.dark); disc(3.4, 3.3, 1, 0.45, P.dark); }
    part(sym([[6.4, -0.5], [5.8, -1], [1.5, -1.1], [-4.8, -0.45], [-5.6, -0.1]]), P.body);
    part(sym([[-4, -0.4], [-4.2, -2.8], [-5.4, -2.8], [-5.7, -0.4]]), P.body);
    if (shadow) return;
    g.fillStyle = '#9fb0ba'; g.fillRect(0, -0.5, 3, 1); // longue verrière
    g.fillStyle = '#2a2a26'; g.fillRect(6.2, -1.6, 0.35, 3.2); // hélice
    g.fillStyle = P.band; g.fillRect(-3.2, -0.75, 0.9, 1.5);
    mark(g, 0, 1.2, -5.2, 0.9); mark(g, 0, 1.2, 5.2, 0.9);
  } else if (type === 'he111') {
    both(ellipticWing(11, 1, 5.2, 0.6), P.body);
    both([[5, -3.2], [5.4, -3.8], [5, -4.4], [-2.2, -4.2], [-2.2, -3.4]], P.dark); // moteurs
    part(sym([[8.4, -0.1], [7.6, -1.1], [3, -1.35], [-6, -0.8], [-9, -0.25]]), P.body);
    part(sym([[-6.6, -0.5], [-7, -4], [-8.4, -4.2], [-9, -0.4]]), P.body);
    if (shadow) return;
    disc(7.2, 0, 1.4, 1.05, '#b8c8d0'); // nez vitré
    disc(5.6, -3.8, 1.7, 1.7, 'rgba(30, 30, 26, 0.5)'); disc(5.6, 3.8, 1.7, 1.7, 'rgba(30, 30, 26, 0.5)'); // hélices
    g.fillStyle = P.band; g.fillRect(-5.4, -0.9, 1, 1.8);
    mark(g, 0, 0.4, -7.4, 1.1); mark(g, 0, 0.4, 7.4, 1.1);
  } else if (type === 'pe2') {
    both([[2.1, -0.9], [1.2, -8.6], [0.2, -8.6], [-1.3, -0.9]], P.body);
    both([[4.4, -2.2], [4.6, -2.7], [4.4, -3.2], [-2.4, -3], [-2.4, -2.4]], P.dark);
    part(sym([[7, -0.1], [6.4, -0.8], [2.6, -1], [-6, -0.5], [-6.8, -0.2]]), P.body);
    part([[-5.2, -3], [-6.6, -3], [-6.6, 3], [-5.2, 3]], P.body);
    if (shadow) return;
    g.fillStyle = P.dark; g.fillRect(-7.2, -3.3, 2.6, 0.6); g.fillRect(-7.2, 2.7, 2.6, 0.6); // double dérive
    disc(6, 0, 1.1, 0.7, '#b8c8d0');
    disc(4.8, -2.7, 1.4, 1.4, 'rgba(30, 30, 26, 0.5)'); disc(4.8, 2.7, 1.4, 1.4, 'rgba(30, 30, 26, 0.5)');
    mark(g, 1, 0.4, -5.8, 1.1); mark(g, 1, 0.4, 5.8, 1.1);
  } else if (type === 'il2') {
    // Plan central droit, panneaux extérieurs en flèche (bord d'attaque), saumons arrondis.
    both([[2.6, -1.2], [2.6, -2.8], [0.9, -7.1], [0.2, -7.4], [-0.6, -7], [-0.9, -1.2]], P.body);
    part(sym([[6.3, -0.4], [5.6, -1.3], [2.4, -1.3], [-4.6, -0.5], [-5.6, -0.1]]), P.body);
    part(sym([[-3.9, -0.4], [-4.1, -2.7], [-5.3, -2.6], [-5.6, -0.4]]), P.body);
    if (shadow) return;
    g.fillStyle = P.dark; g.fillRect(3, -1.1, 3, 2.2); // capot blindé
    g.fillStyle = '#b8c8d0'; g.fillRect(0.4, -0.5, 2.2, 1);
    g.fillStyle = '#2a2a26'; g.fillRect(6.1, -1.7, 0.35, 3.4);
    mark(g, 1, 0.9, -4.8, 1); mark(g, 1, 0.9, 4.8, 1);
  } else {
    part([[7, 0], [-6, -0.9], [-6, 0.9]], P.body);
    part([[2, -8], [3.6, -8], [3.6, 8], [2, 8]], P.body);
    part([[-5, -3], [-4, -3], [-4, 3], [-5, 3]], P.body);
    if (shadow) return;
    g.fillStyle = side ? '#c0392b' : '#1d1b17';
    g.fillRect(2.2, -6.5, 1.1, 1.6);
    g.fillRect(2.2, 4.9, 1.1, 1.6);
  }
}
