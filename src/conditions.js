// Conditions de bataille : météo, heure du jour et biome, tirés au briefing à partir de la graine.
// Elles passent toutes par les mêmes réglages : vision, coûts de mouvement, génération de carte et rendu.

import { createRng } from './rng.js';

// Coûts en points doublés (2 = un hexagone de plaine) : la boue ajoute ½ point par hexagone hors route aux véhicules.
// Appliquée à tous, elle divisait par deux la marche de l'infanterie (4 hexagones de plaine → 2).
export const WEATHER = {
  clear: { label: 'Temps clair', vision: 0, mud: 0, text: 'Bonne visibilité.' },
  rain: { label: 'Pluie', vision: -1, mud: 1, text: 'Vision −1 ; hors route, les véhicules s\'enlisent (½ point de plus par hexagone) : les routes deviennent vitales.' },
  fog: { label: 'Brouillard', vision: -2, mud: 0, noHeights: true, text: 'Vision −2 et les hauteurs ne voient pas plus loin : on se heurte à bout portant.' },
  snow: { label: 'Neige', vision: -1, mud: 1, frozen: true, text: 'Vision −1 ; hors route, ½ point de plus par hexagone pour les véhicules ; rivières et marais gelés se franchissent.' },
};

export const LIGHT = {
  dawn: { label: 'Aube', vision: -1 },
  day: { label: 'Jour', vision: 0 },
  dusk: { label: 'Crépuscule', vision: -1 },
  night: { label: 'Nuit', vision: -2 },
};

// Paramètres de génération par biome (quantiles d'humidité, nombre de villages, eau…).
export const BIOMES = {
  steppe: {
    label: 'Steppe ouverte', text: 'Peu de couvert et de longues vues : le terrain des chars, et des antichars qui les attendent.',
    forestQ: 0.93, grove: 0.008, marshQ: 0.93, marshElev: 0, villages: [3, 4], farms: [5, 9], water: { river: 30, stream: 30, none: 40 },
  },
  bocage: {
    label: 'Forêts et bocages', text: 'Couvert dense et vues courtes : le terrain de l\'infanterie et des embuscades.',
    forestQ: 0.52, grove: 0.06, marshQ: 0.9, marshElev: 0, villages: [4, 5], farms: [4, 7], water: { river: 30, stream: 40, none: 30 },
  },
  polesie: {
    label: 'Marais de Polésie', text: 'Marais étendus : les routes, véritables digues, décident de tout.',
    forestQ: 0.72, grove: 0.03, marshQ: 0.64, marshElev: 1, villages: [3, 4], farms: [1, 3], water: { river: 45, stream: 40, none: 15 },
  },
  bourg: {
    label: 'Bourg', text: 'Un bourg de plusieurs pâtés de maisons au centre : combats rapprochés de rue en rue.',
    forestQ: 0.82, grove: 0.03, marshQ: 0.86, marshElev: 0, villages: [2, 3], farms: [3, 6], water: { river: 35, stream: 30, none: 35 }, town: true,
  },
};

// Saison par bataille de la campagne : lever et coucher du soleil (heure), probabilités de météo.
export const SEASON = [
  { month: 'Juillet 1943', sunrise: 4, sunset: 20, weather: { clear: 60, rain: 25, fog: 15 } },
  { month: 'Août 1943', sunrise: 5, sunset: 19, weather: { clear: 55, rain: 30, fog: 15 } },
  { month: 'Septembre 1943', sunrise: 6, sunset: 18, weather: { clear: 40, rain: 35, fog: 25 } },
  { month: 'Octobre 1943', sunrise: 7, sunset: 17, weather: { clear: 30, rain: 40, fog: 25, snow: 5 } },
  { month: 'Novembre 1943', sunrise: 7, sunset: 16, weather: { clear: 20, rain: 25, fog: 20, snow: 35 } },
];

// Conditions neutres (journée claire d'été, carte standard) : pour les tests et les batailles hors campagne.
export const DEFAULT_CONDITIONS = { weather: 'clear', biome: null, month: SEASON[0].month, sunrise: 4, sunset: 20, startHour: 8 };

export function rollConditions(seed, seasonIndex = 0, kind = 'rencontre') {
  const rng = createRng(`conditions:${seed}`);
  const season = SEASON[Math.max(0, Math.min(SEASON.length - 1, seasonIndex))];
  const biomeOdds = kind === 'assaut'
    ? { steppe: 25, bocage: 25, polesie: 15, bourg: 35 }
    : { steppe: 35, bocage: 30, polesie: 20, bourg: 15 };
  return {
    weather: rng.weighted(season.weather),
    biome: rng.weighted(biomeOdds),
    month: season.month,
    sunrise: season.sunrise,
    sunset: season.sunset,
    // Le plus souvent une attaque au matin ; parfois l'après-midi, et la bataille (12 tours d'une heure) finit de nuit.
    // Les journées courtes de l'automne y mènent plus souvent.
    startHour: rng.chance(0.7)
      ? rng.int(season.sunrise - 1, Math.max(season.sunrise - 1, season.sunset - 11))
      : rng.int(season.sunset - 9, season.sunset - 4),
  };
}

// Un tour = une heure.
export const hourAt = (c, turn) => c.startHour + turn - 1;
export const clockLabel = (c, turn) => `${hourAt(c, turn) % 24} h`;

export function lightAt(c, turn) {
  const h = hourAt(c, turn);
  const hh = h % 24;
  if (h >= 24 || hh < c.sunrise - 1 || hh > c.sunset + 1) return 'night';
  if (hh <= c.sunrise) return 'dawn';
  if (hh >= c.sunset) return 'dusk';
  return 'day';
}

export function visionModifier(c, turn) {
  return WEATHER[c.weather].vision + LIGHT[lightAt(c, turn)].vision;
}

// Plancher : une unité voit toujours au moins l'hexagone voisin.
export function effectiveVision(base, c, turn) {
  return Math.max(1, base + visionModifier(c, turn));
}

// Premier tour (≤ maxTurns) où la lumière change de phase : sert au briefing (« la nuit tombe au tour 7 »).
export function lightChanges(c, maxTurns) {
  const out = [];
  let prev = lightAt(c, 1);
  for (let t = 2; t <= maxTurns; t++) {
    const l = lightAt(c, t);
    if (l !== prev) out.push({ turn: t, light: l });
    prev = l;
  }
  return out;
}
