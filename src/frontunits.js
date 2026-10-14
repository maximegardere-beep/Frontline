// Front stratégique : symboles d'unités dessinés par-dessus les masses (PROTOTYPE : trois styles à comparer).
// - 'dots' : un point par 100 hommes, posé dans sa case ;
// - 'companies' : un rectangle par bataillon (~400 hommes), groupés par blocs de 4 × 4 cases ;
// - 'nato' : un symbole OTAN par secteur de 8 × 8 cases (régiment, division), avec l'effectif.
// Nos troupes sont exactes ; l'ennemi, d'après la mémoire du camp (estimation), estompé hors de vue.

const INK = ['#1c3358', '#5e120a'];
const FILL = ['#7f9cc8', '#d9705c'];

// Hachage stable : mêmes positions d'un tick à l'autre.
const hash = (a, b) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function knowledge(front, viewer) {
  const { N } = front.map;
  const side = new Int8Array(N), dens = new Float32Array(N), vis = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const own = viewer === null || front.owner[i] === viewer;
    side[i] = own ? front.owner[i] : front.memory[viewer].owner[i];
    dens[i] = own ? front.dens[i] : front.memory[viewer].est[i];
    vis[i] = own || front.vision[viewer][i] ? 1 : 0;
  }
  return { side, dens, vis };
}

export function drawUnits(ctx, front, viewer, style, C, px) {
  if (!style) return;
  const k = knowledge(front, viewer);
  if (style === 'dots') return drawDots(ctx, front, k, C, px);
  if (style === 'companies') return drawCompanies(ctx, front, k, C, px);
  if (style === 'nato') return drawNato(ctx, front, k, C, px);
}

function drawDots(ctx, front, k, C, px) {
  const { N } = front.map, men = front.cfg.men;
  const r = Math.max(1.25, 1.6 * px);
  for (const s of [0, 1]) {
    for (const faded of [false, true]) {
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        if (k.side[i] !== s || !k.vis[i] === !faded) continue;
        const n = (k.dens[i] * men) / 100;
        const cnt = Math.floor(n) + (hash(i, 99) < n % 1 ? 1 : 0);
        for (let q = 0; q < Math.min(cnt, 12); q++) {
          const x = (front.centers.x[i] + (hash(i, q * 2) - 0.5) * 1.5) * C, y = (front.centers.y[i] + (hash(i, q * 2 + 1) - 0.5) * 1.3) * C;
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      ctx.globalAlpha = faded ? 0.45 : 0.9;
      ctx.fillStyle = INK[s];
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// Blocs de b × b cases : effectif et barycentre par camp.
function blocks(front, k, b) {
  const { W, H, N } = front.map, men = front.cfg.men;
  const bw = Math.ceil(W / b), bh = Math.ceil(H / b);
  const out = [];
  for (const s of [0, 1]) {
    const sum = new Float32Array(bw * bh), sx = new Float32Array(bw * bh), sy = new Float32Array(bw * bh), vis = new Float32Array(bw * bh);
    for (let i = 0; i < N; i++) {
      if (k.side[i] !== s || !(k.dens[i] > 0)) continue;
      const B = Math.floor(Math.floor(i / W) / b) * bw + Math.floor((i % W) / b);
      const d = k.dens[i];
      sum[B] += d;
      sx[B] += d * front.centers.x[i];
      sy[B] += d * front.centers.y[i];
      vis[B] += d * k.vis[i];
    }
    for (let B = 0; B < bw * bh; B++) if (sum[B] > 0) out.push({ s, B, men: sum[B] * men, x: sx[B] / sum[B], y: sy[B] / sum[B], seen: vis[B] / sum[B] > 0.5 });
  }
  return out;
}

function drawCompanies(ctx, front, k, C, px) {
  const w = 10, h = 6.5, gap = 2;
  ctx.lineWidth = Math.max(0.7, 1 * px);
  for (const bl of blocks(front, k, 4)) {
    const n = Math.min(6, Math.round(bl.men / 400));
    if (!n) continue;
    const cols = Math.min(n, 3), rows = Math.ceil(n / cols);
    const x0 = bl.x * C - (cols * (w + gap) - gap) / 2, y0 = bl.y * C - (rows * (h + gap) - gap) / 2;
    ctx.globalAlpha = bl.seen ? 1 : 0.45;
    for (let q = 0; q < n; q++) {
      const x = x0 + (q % cols) * (w + gap), y = y0 + Math.floor(q / cols) * (h + gap);
      ctx.fillStyle = FILL[bl.s];
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = INK[bl.s];
      ctx.strokeRect(x, y, w, h);
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + w, y + h);
      ctx.moveTo(x + w, y); ctx.lineTo(x, y + h);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawNato(ctx, front, k, C, px) {
  const w = 24, h = 15;
  for (const bl of blocks(front, k, 8)) {
    if (bl.men < 1200) continue;
    const x = bl.x * C - w / 2, y = bl.y * C - h / 2;
    const armor = front.phase === 'resolve' && armorShare(front, bl) > 0.4;
    ctx.globalAlpha = bl.seen ? 1 : 0.55;
    ctx.fillStyle = FILL[bl.s];
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = Math.max(1.2, 1.4 * px);
    ctx.strokeStyle = INK[bl.s];
    ctx.setLineDash(bl.seen ? [] : [3, 2]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.beginPath();
    if (armor) ctx.ellipse(x + w / 2, y + h / 2, w * 0.32, h * 0.26, 0, 0, Math.PI * 2);
    else { ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); }
    ctx.stroke();
    // Échelon : III (régiment), X (brigade), XX (division).
    ctx.font = '700 7px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = INK[bl.s];
    ctx.fillText(bl.men >= 8000 ? 'XX' : bl.men >= 4000 ? 'X' : 'III', x + w / 2, y - 2);
    const label = bl.seen ? `${(Math.round(bl.men / 100) * 100).toLocaleString('fr-FR')}` : `~${(Math.round(bl.men / 500) * 500).toLocaleString('fr-FR')}`;
    ctx.font = '600 7.5px "IBM Plex Mono", monospace';
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = 'rgba(244, 236, 210, 0.85)';
    ctx.strokeText(label, x + w / 2, y + h + 8);
    ctx.fillText(label, x + w / 2, y + h + 8);
  }
  ctx.globalAlpha = 1;
}

function armorShare(front, bl) {
  const { W } = front.map, F = front.field[bl.s];
  let a = 0, n = 0;
  for (let i = 0; i < front.map.N; i++) {
    if (front.owner[i] !== bl.s) continue;
    const B = Math.floor(Math.floor(i / W) / 8) * Math.ceil(W / 8) + Math.floor((i % W) / 8);
    if (B !== bl.B) continue;
    n++;
    if (F.atk[i] >= 1.45) a++;
  }
  return n ? a / n : 0;
}
