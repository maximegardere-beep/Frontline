// Générateur pseudo-aléatoire déterministe (mulberry32) : une graine = une partie reproductible.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed) {
  let s = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    d6: () => 1 + Math.floor(next() * 6),
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    weighted(table) {
      const total = Object.values(table).reduce((a, b) => a + b, 0);
      let r = next() * total;
      for (const [k, w] of Object.entries(table)) {
        r -= w;
        if (r < 0) return k;
      }
      return Object.keys(table)[0];
    },
  };
}
