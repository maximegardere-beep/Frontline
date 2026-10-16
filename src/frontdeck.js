// Interface des atouts : la main tirée (on coche les cartes à garder) et la bataille des airs mise en scène (combat
// de chasseurs sur un petit canvas, rejouant le journal des manches calculé d'avance par frontairwar.js).

import { ATOUTS, RARITY_LABEL, ATOUT_RULES, cardText } from './frontatout.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Petite icône de carte, selon son genre.
const ICON = {
  armor: 'M3 13h14l-2 3H5zM5 13V10h8l2 3M9 10V8h6',
  heavyArt: 'M3 15l11-7M12 9l3-2M4 16h4',
  rockets: 'M4 16l10-10M7 16l10-10M4 12l10-10',
  air: 'M2 10h16M8 5l2 5-2 5M15 8v4',
  fighters: 'M2 10h16M9 6l1 4-1 4M14 8v4M4 8v4',
  sappers: 'M6 4l8 12M14 4L6 16M10 2v3',
  paras: 'M4 9a6 6 0 0112 0M4 9l6 7 6-7M10 9v7',
  antitank: 'M4 14l12-6M12 10l2 6M5 15h4',
  support: 'M5 15l10-10M5 5l10 10M3 16h14',
  strongpoint: 'M3 16V8l3 2 4-4 4 4 3-2v8z',
  divArt: 'M3 15l10-6M11 10l2-1M4 16h4',
  aa: 'M10 16V9M10 9l-5-6M10 9l5-6M6 16h8',
};

// Une carte de la main (bouton à cocher).
export function cardHtml(front, s, card, on) {
  const A = ATOUTS[card.key];
  return `<button class="card card-${card.rarity}" data-card="${card.id}" aria-pressed="${on}">
    <span class="card-top"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="${ICON[card.key] ?? ICON.divArt}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="card-rarity">${RARITY_LABEL[card.rarity]}</span></span>
    <span class="card-name">${esc(A.label)}</span>
    <span class="card-text">${esc(cardText(front, s, card))}</span>
  </button>`;
}

// Dossier du tirage : la main, et combien en garder.
export function drawHtml(front, s) {
  const A = front.atouts;
  const keep = ATOUT_RULES.keep[A.round];
  const hand = A.hands[s];
  const role = s === front.attacker ? 'attaquant' : 'défenseur';
  return `
    <p class="eyebrow">${A.round ? `Renforts du ${ATOUT_RULES.day}e jour` : 'Atouts · avant la bataille'}</p>
    <h1 class="title-l">Tirage</h1>
    <p class="lede">Vous tirez ${hand.length} cartes du paquet de l'${role}${A.round && hand.length > ATOUT_RULES.hand[1] ? ' (une de plus : vous êtes mené aux points)' : ''}. Gardez-en <b>${keep}</b> : leurs unités rejoignent vos lignes${A.round ? ' ce matin' : ''}, et vous les placerez sur la carte.</p>
    <div class="deck" id="f-deck">${hand.map((c) => cardHtml(front, s, c, false)).join('')}</div>
    <p class="muted small">Commun, rare, élite : plus la carte est rare, plus son groupement est fort. Les cartes de chasseurs et de soutien aérien pèsent dans la bataille des airs qui suit${A.round ? '' : ' ; celles des deux camps restent secrètes'}.</p>
    <div class="row-between">
      <button class="btn" id="f-deck-auto">Choix de l'état-major</button>
      <button class="btn btn-primary" id="f-deck-ok" disabled>Garder ces cartes (<span id="f-deck-n">0</span>/${keep})</button>
    </div>`;
}

// ---------- Bataille des airs ----------

export function airWarHtml(front, s, w) {
  return `
    <p class="eyebrow">${w.round ? `Matin du ${ATOUT_RULES.day}e jour` : 'Avant la bataille'}</p>
    <h1 class="title-l">Bataille des airs</h1>
    <p class="lede">Vos chasseurs (${w.start[s]}) contre ceux de l'ennemi (${w.start[1 - s]}) : trois manches ; qui touche le plus gagne la manche et abat un appareil adverse.</p>
    <canvas class="dogfight" id="f-dogfight" width="640" height="220" aria-label="Combat de chasseurs"></canvas>
    <ol class="air-rounds" id="f-air-rounds"></ol>
    <p class="air-verdict" id="f-air-verdict" hidden></p>
    <div class="row-end"><button class="btn" id="f-air-skip">Passer</button><button class="btn btn-primary" id="f-air-ok" hidden>Continuer</button></div>`;
}

function roundText(r, s, k) {
  const mine = r.hits[s], theirs = r.hits[1 - s];
  const res = r.winner === null ? 'manche nulle' : r.winner === s ? 'gagnée, un chasseur ennemi abattu' : 'perdue, un de vos chasseurs abattu';
  return `Manche ${k + 1} : ${mine} touche${mine > 1 ? 's' : ''} contre ${theirs} — ${res}.`;
}

export function verdictText(w, s) {
  if (w.sup === null) return 'Ciel disputé : chaque camp ne garde que la moitié de ses sorties.';
  return w.sup === s ? 'Suprématie aérienne : toutes vos sorties volent, l\'ennemi n\'en a plus.' : 'Le ciel est à l\'ennemi : plus aucune sortie pour vous. Votre DCA tire toujours.';
}

// Dessin d'un chasseur vu de dessus (même silhouette que frontfx.js), couleur du camp.
function plane(ctx, x, y, ang, side, k, burning) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.scale(k, k);
  ctx.fillStyle = burning ? '#5a4a3a' : side ? '#6c7a4a' : '#7c8590';
  ctx.strokeStyle = '#22261c';
  ctx.lineWidth = 0.5;
  const poly = (pts) => { ctx.beginPath(); pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath(); ctx.fill(); ctx.stroke(); };
  poly([[7, 0], [-6, -0.9], [-6, 0.9]]);
  poly([[2, -8], [3.6, -8], [3.6, 8], [2, 8]]);
  poly([[-5, -3], [-4, -3], [-4, 3], [-5, 3]]);
  ctx.fillStyle = side ? '#c0392b' : '#1d1b17';
  ctx.fillRect(2.2, -6.5, 1.1, 1.6);
  ctx.fillRect(2.2, 4.9, 1.1, 1.6);
  ctx.restore();
}

// Anime la bataille des airs ; s : camp du joueur (à gauche). onRound(k) après chaque manche, onEnd() à la fin.
// Renvoie { skip } pour tout montrer d'un coup. sound : le moteur audio (facultatif).
export function playAirWar(canvas, w, s, { onRound, onEnd, sound, still } = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const ROUND = 2600;
  const sides = [s, 1 - s]; // à gauche, à droite
  // Formations : un appareil par point de force (8 au plus), en échelons.
  const slots = (n, left) => Array.from({ length: Math.min(8, n) }, (_, i) => ({
    y: 40 + ((i % 4) + 0.5) * ((H - 80) / 4) + (i >= 4 ? 14 : 0),
    off: (i >= 4 ? 30 : 0) + (i % 2) * 12,
    ph: i * 1.7 + (left ? 0 : 0.9),
  }));
  let t0 = performance.now(), raf = 0, done = false, k = 0;
  const smoke = [];
  const heard = new Set();
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    for (; k < w.rounds.length; k++) onRound?.(k);
    drawStatic();
    onEnd?.();
  };
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#b9c6c9'); g.addColorStop(1, '#e3dcc5');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    for (const [x, y, r] of [[90, 50, 36], [300, 160, 48], [520, 70, 40]]) { ctx.beginPath(); ctx.ellipse(x, y, r * 1.8, r * 0.6, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  function drawStatic() {
    drawSky();
    const f = w.force;
    sides.forEach((side, j) => slots(f[side], j === 0).forEach((p) => plane(ctx, j === 0 ? 70 + p.off : W - 70 - p.off, p.y, j === 0 ? 0 : Math.PI, side, 1.6, false)));
  }
  function frame(now) {
    if (done) return;
    const t = Math.max(0, now - t0); // la première image peut dater d'avant le départ
    const r = Math.floor(t / ROUND);
    if (r >= w.rounds.length) return finish();
    while (k < r) onRound?.(k++);
    const u = (t % ROUND) / ROUND;
    const R = w.rounds[r];
    const before = r ? w.rounds[r - 1].force : w.start;
    drawSky();
    // Les formations se croisent au milieu de la manche, en ondulant.
    const meet = Math.sin(Math.min(1, u * 1.4) * Math.PI / 2);
    sides.forEach((side, j) => {
      const left = j === 0;
      const list = slots(before[side], left);
      list.forEach((p, i) => {
        const shotDown = R.winner === 1 - side && i === list.length - 1 && u > 0.62;
        let x = left ? 40 + p.off + meet * (W / 2 - 90) : W - 40 - p.off - meet * (W / 2 - 90);
        let y = p.y + Math.sin(now / 260 + p.ph) * 10 * meet;
        let ang = (left ? 0 : Math.PI) + Math.cos(now / 260 + p.ph) * 0.25 * meet;
        if (shotDown) {
          const v = (u - 0.62) / 0.38;
          y += v * v * 120; x += (left ? 1 : -1) * v * 40; ang += (left ? 1 : -1) * v * 1.2;
          if (Math.random() < 0.6) smoke.push({ x, y, t: now });
        }
        plane(ctx, x, y, ang, side, 1.6, shotDown);
        // Rafales : traçantes vers l'adversaire, d'autant plus que la manche lui coûte de touches.
        if (!shotDown && u > 0.3 && u < 0.75 && Math.random() < 0.08 + R.hits[side] * 0.05) {
          ctx.strokeStyle = side === 0 ? 'rgba(255, 220, 90, 0.9)' : 'rgba(255, 150, 60, 0.9)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(ang) * 10, y + Math.sin(ang) * 10);
          ctx.lineTo(x + Math.cos(ang) * 38, y + Math.sin(ang) * 38);
          ctx.stroke();
          if (sound?.live && Math.random() < 0.25) try { sound.mgSide(sound.ctx.currentTime, sound.out(left ? -0.5 : 0.5, 0.5), side); } catch { /* son indisponible */ }
        }
      });
    });
    // Fumée des appareils abattus.
    for (let q = smoke.length - 1; q >= 0; q--) {
      const m = smoke[q], a = (now - m.t) / 1400;
      if (a >= 1) { smoke.splice(q, 1); continue; }
      ctx.fillStyle = `rgba(40, 36, 30, ${0.45 * (1 - a)})`;
      ctx.beginPath(); ctx.arc(m.x, m.y - a * 8, 3 + a * 7, 0, Math.PI * 2); ctx.fill();
    }
    if (R.winner !== null && sound?.live && u > 0.62 && !heard.has(r)) {
      heard.add(r);
      try { sound.planeDown(sound.ctx.currentTime, 1.2, sound.out(R.winner === s ? 0.4 : -0.4, 0.7)); } catch { /* son indisponible */ }
    }
    ctx.fillStyle = 'rgba(29, 26, 18, 0.75)';
    ctx.font = '600 13px "IBM Plex Mono", monospace';
    ctx.fillText(`Manche ${r + 1}`, 14, 22);
    raf = requestAnimationFrame(frame);
  }
  if (still) finish();
  else raf = requestAnimationFrame(frame);
  return { skip: finish };
}

export { roundText };
