// Grille hexagonale « pointy-top », coordonnées offset odd-r (col, row).
// Ordre des directions : E, NE, NO, O, SO, SE.

export const SQRT3 = Math.sqrt(3);

const NB_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const NB_ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];

export function neighborCoords(col, row) {
  const t = row & 1 ? NB_ODD : NB_EVEN;
  return t.map(([dc, dr]) => ({ col: col + dc, row: row + dr }));
}

export function toCube(col, row) {
  const x = col - (row - (row & 1)) / 2;
  return [x, -x - row, row];
}

export function fromCube(x, _y, z) {
  return { col: x + (z - (z & 1)) / 2, row: z };
}

export function hexDistance(a, b) {
  const [ax, ay, az] = toCube(a.col, a.row);
  const [bx, by, bz] = toCube(b.col, b.row);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
}

export function cubeRound(x, y, z) {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return [rx, ry, rz];
}

// Hexagones traversés par une ligne droite (extrémités incluses).
export function hexLine(a, b) {
  const n = hexDistance(a, b);
  const A = toCube(a.col, a.row).map((v) => v + 1e-6);
  const B = toCube(b.col, b.row).map((v) => v + 1e-6);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const c = cubeRound(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
    out.push(fromCube(...c));
  }
  return out;
}

export function hexToPixel(col, row, size) {
  return {
    x: size * SQRT3 * (col + 0.5 * (row & 1)) + (size * SQRT3) / 2,
    y: size * 1.5 * row + size,
  };
}

export function pixelToHex(px, py, size) {
  const x = px - (size * SQRT3) / 2;
  const y = py - size;
  const q = ((SQRT3 / 3) * x - y / 3) / size;
  const r = ((2 / 3) * y) / size;
  return fromCube(...cubeRound(q, -q - r, r));
}

// Coin i d'un hexagone (angle 60*i - 30°).
export function hexCorner(cx, cy, size, i) {
  const a = (Math.PI / 180) * (60 * i - 30);
  return { x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) };
}

// Coins délimitant l'arête dans la direction d.
export function edgeCorners(d) {
  return [(6 - d) % 6, (7 - d) % 6];
}

export const sameHex = (a, b) => a && b && a.col === b.col && a.row === b.row;
