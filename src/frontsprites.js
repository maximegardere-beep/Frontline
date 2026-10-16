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
