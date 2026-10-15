// Alerte « SOS » du front stratégique : pendant la journée, un secteur du joueur qui craque (cases perdues depuis
// quelques heures, jauges de brèche presque pleines) fait apparaître un officier au combiné qui appelle à l'aide en
// morse, au-dessus du secteur (frontrender.js, drawAlerts), avec le message radio (audio.js, « sos »).

export const ALERT = {
  window: 6, // ticks pendant lesquels une case perdue compte
  block: 8, // taille des blocs de lecture (cases)
  pressed: 0.6, // jauge de brèche au-delà de laquelle une case est « sur le point de céder »
  score: 6, // seuil d'un secteur qui craque : case perdue 1 point, case qui va céder 0,5
  lost: 4, // … et au moins tant de cases perdues
  hold: 6, // ticks d'affichage après la dernière fois que le secteur a craqué
  max: 3, // alertes à l'écran au plus
};

// À appeler après chaque tick : note les cases que chaque camp vient de perdre.
export function noteLosses(front, events) {
  front.lostLog ??= [];
  for (const e of events) if (e.kind === 'capture') front.lostLog.push({ i: e.i, side: 1 - e.side, clock: front.clock });
  const from = front.clock - ALERT.window;
  while (front.lostLog.length && front.lostLog[0].clock <= from) front.lostLog.shift();
}

// Secteurs du camp s qui craquent maintenant : [{ key, x, y, score, lost }] (grille), les plus graves d'abord.
export function crackingSectors(front, s) {
  const { W, H, N } = front.map;
  const B = ALERT.block, bw = Math.ceil(W / B), bh = Math.ceil(H / B);
  const score = new Float32Array(bw * bh), lost = new Uint16Array(bw * bh), sx = new Float32Array(bw * bh), sy = new Float32Array(bw * bh), n = new Float32Array(bw * bh);
  const blockOf = (i) => Math.floor(Math.floor(i / W) / B) * bw + Math.floor((i % W) / B);
  const add = (i, v) => { const b = blockOf(i); score[b] += v; sx[b] += front.centers.x[i] * v; sy[b] += front.centers.y[i] * v; n[b] += v; };
  for (const l of front.lostLog ?? []) if (l.side === s) { add(l.i, 1); lost[blockOf(l.i)]++; }
  const frac = front.breachFrac;
  if (frac) for (let i = 0; i < N; i++) if (front.owner[i] === s && frac[i] >= ALERT.pressed) add(i, 0.5);
  const out = [];
  for (let b = 0; b < bw * bh; b++) {
    if (score[b] < ALERT.score || lost[b] < ALERT.lost) continue;
    // Position : la case amie la plus proche du foyer, pour que l'officier parle depuis ses lignes.
    const x = sx[b] / n[b], y = sy[b] / n[b];
    let best = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      if (front.owner[i] !== s) continue;
      const d = Math.hypot(front.centers.x[i] - x, front.centers.y[i] - y);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0 || bd > B) continue;
    out.push({ key: b, x: front.centers.x[best], y: front.centers.y[best], score: score[b], lost: lost[b] });
  }
  return out.sort((a, b) => b.score - a.score);
}

// Alertes à l'écran : celles d'avant restent hold ticks après leur dernier signal. Renvoie les nouvelles (pour le son).
export function updateAlerts(front, s, alerts) {
  const fresh = [];
  for (const c of crackingSectors(front, s)) {
    const a = alerts.find((x) => x.key === c.key);
    if (a) Object.assign(a, { x: c.x, y: c.y, score: c.score, last: front.clock });
    else if (alerts.length < ALERT.max) { const n = { ...c, since: front.clock, last: front.clock }; alerts.push(n); fresh.push(n); }
  }
  for (let k = alerts.length - 1; k >= 0; k--) if (front.clock - alerts[k].last > ALERT.hold) alerts.splice(k, 1);
  return fresh;
}
