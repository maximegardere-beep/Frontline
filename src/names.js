// Toponymes procéduraux à consonance russe / ukrainienne.

const PREFIXES = [
  'Prokho', 'Berez', 'Olkho', 'Pony', 'Znamen', 'Krasno', 'Lugo', 'Stari', 'Koro', 'Belo',
  'Mikhay', 'Voro', 'Yakov', 'Sokol', 'Gres', 'Ivan', 'Petro', 'Dubro', 'Lipo', 'Kamen',
  'Bori', 'Glin', 'Malo', 'Bolsh', 'Teter', 'Chern', 'Zhelto', 'Pesch', 'Kozel', 'Vysok',
  'Rzhav', 'Topol', 'Sukho', 'Nikol', 'Orlov', 'Ozer', 'Gorod', 'Sosn', 'Berd', 'Kurga',
];
const SUFFIXES = [
  'ovka', 'ivka', 'ovo', 'evo', 'ino', 'anka', 'enka', 'ichi', 'ets', 'oye', 'skoye', 'ishche', 'yany', 'ki', 'aya',
];

export function placeName(rng, used = new Set()) {
  for (let i = 0; i < 50; i++) {
    const n = rng.pick(PREFIXES) + rng.pick(SUFFIXES);
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  return rng.pick(PREFIXES) + rng.pick(SUFFIXES);
}
