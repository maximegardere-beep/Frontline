// Scénarios du front stratégique, par année, et forces propres à chaque camp.
//
// Plutôt qu'un multiplicateur de qualité uniforme, chaque camp a ses atouts (FRONT_TRAITS) :
// - Wehrmacht : blindés plus expérimentés qui se ravitaillent plus vite, reconnaissance d'une case de plus ;
// - Armée rouge : masse (réserves et renforts plus forts), ténacité dans les villes, aguerrie à l'hiver.
// Chaque année règle ensuite le rapport des forces (qualité, effectifs, blindés, artillerie), le camp qui attaque le
// plus souvent, et l'exigence du score (bias) : points retranchés à l'offensive quand elle part favorite, pour que
// la victoire se mérite.
// armor et guns : formations et groupes historiques ; avec les atouts (frontatout.js), armor ne sert plus qu'aux noms
// et aux chiffres de référence des formations tirées, guns qu'au mode sans atouts.

export const FRONT_TRAITS = {
  visionBonus: [1, 0], // cases de reconnaissance en plus
  refuel: [0.8, 0.6], // plein de carburant de la nuit (formations blindées)
  townHold: [1, 1.25], // défense des villes
  winter: [false, true], // la neige ne ralentit pas ses troupes à pied et moins ses chars
};

const PZ = (name, tanks, exp) => ({ name, tanks, exp, gren: 120 });

export const SCENARIOS = {
  1941: {
    label: '1941 · Barbarossa',
    text: 'La Wehrmacht, rodée et mobile, enfonce une Armée rouge nombreuse mais désorganisée. L\'offensive allemande doit aller loin pour compter.',
    attacker: { DE: 85, SU: 15 },
    seasons: { 0: 40, 1: 35, 2: 25 },
    setup: { quality: [1.45, 0.9], troops: [5600, 6400], reserve: [600, 900], reinforce: [220, 320], sorties: [3, 1], aaBatteries: [2, 1] },
    armor: [
      [PZ('7. Panzer-Division', 170, 2.0), PZ('10. Panzer-Division', 150, 1.8)],
      [PZ('6e corps mécanisé', 220, 0), PZ('8e corps mécanisé', 200, 0.1), PZ('15e corps mécanisé', 180, 0)],
    ],
    guns: [['div', 'div', 'heavy'], ['div', 'div', 'mortar']],
    // Atouts (frontatout.js) : poids des raretés par camp ; bataillon de chars lourds de l'élite (null : division d'élite).
    rarity: [{ commun: 45, rare: 37, elite: 18 }, { commun: 70, rare: 25, elite: 5 }],
    heavy: [null, 'Brigade de chars lourds KV'],
    bias: 4,
  },
  1942: {
    label: '1942 · Fall Blau',
    text: 'La Wehrmacht pousse vers le Don et le Caucase ; l\'Armée rouge apprend à céder du terrain pour durer.',
    attacker: { DE: 70, SU: 30 },
    seasons: { 0: 35, 1: 35, 2: 20, 3: 10 },
    setup: { quality: [1.38, 1], troops: [5700, 6200], reserve: [600, 800], reinforce: [230, 310], sorties: [3, 1], aaBatteries: [2, 2] },
    armor: [
      [PZ('3. Panzer-Division', 160, 1.6), PZ('24. Panzer-Division', 150, 1.2)],
      [PZ('4e corps blindé', 160, 0.4), PZ('13e corps blindé', 150, 0.5), PZ('24e corps blindé', 130, 0.3)],
    ],
    guns: [['div', 'nebel', 'heavy'], ['div', 'mortar', 'rocket']],
    // Atouts (frontatout.js) : poids des raretés par camp ; bataillon de chars lourds de l'élite (null : division d'élite).
    rarity: [{ commun: 50, rare: 35, elite: 15 }, { commun: 62, rare: 30, elite: 8 }],
    heavy: ['s.Pz.Abt. 502 (Tiger)', 'Brigade de chars lourds KV'],
    bias: 0,
  },
  1943: {
    label: '1943 · Koursk',
    text: 'Forces équilibrées : la Wehrmacht garde la qualité, l\'Armée rouge a la masse et des défenses profondes.',
    attacker: { DE: 50, SU: 50 },
    seasons: { 0: 30, 1: 25, 2: 20, 3: 15, 4: 10 },
    setup: { quality: [1.38, 1], troops: [5800, 6000], reserve: [600, 800], reinforce: [240, 300], sorties: [2, 2], aaBatteries: [2, 2] },
    armor: [
      [PZ('3. Panzer-Division', 160, 1.4), PZ('11. Panzer-Division', 140, 1.8)],
      [PZ('1er corps blindé', 150, 0.4), PZ('5e corps blindé de la Garde', 170, 0.9), PZ('18e corps blindé', 120, 0.2)],
    ],
    guns: [['div', 'nebel', 'heavy'], ['div', 'mortar', 'rocket']],
    // Atouts (frontatout.js) : poids des raretés par camp ; bataillon de chars lourds de l'élite (null : division d'élite).
    rarity: [{ commun: 55, rare: 32, elite: 13 }, { commun: 55, rare: 32, elite: 13 }],
    heavy: ['s.Pz.Abt. 503 (Tiger)', 'Rég. de chars lourds de la Garde (KV-85)'],
    bias: 0,
  },
  1944: {
    label: '1944 · Bagration',
    text: 'L\'Armée rouge, désormais maîtresse de l\'art opératif, frappe en masse un front allemand dégarni. Son offensive doit aller loin pour compter.',
    attacker: { DE: 10, SU: 90 },
    seasons: { 0: 50, 1: 35, 2: 15 },
    setup: { quality: [1.3, 1.1], troops: [5200, 6800], reserve: [500, 1000], reinforce: [200, 340], sorties: [1, 3], aaBatteries: [3, 2] },
    armor: [
      [PZ('5. Panzer-Division', 120, 2.0)],
      [PZ('3e corps blindé de la Garde', 190, 1.4), PZ('29e corps blindé', 180, 1.2), PZ('1er corps mécanisé', 170, 1.0)],
    ],
    guns: [['div', 'heavy'], ['div', 'div', 'mortar', 'rocket']],
    // Atouts (frontatout.js) : poids des raretés par camp ; bataillon de chars lourds de l'élite (null : division d'élite).
    rarity: [{ commun: 60, rare: 30, elite: 10 }, { commun: 48, rare: 36, elite: 16 }],
    heavy: ['s.Pz.Abt. 505 (Tigre royal)', 'Rég. de chars lourds de la Garde (IS-2)'],
    bias: 26,
  },
};

export const DEFAULT_YEAR = 1943;
export const scenarioOf = (year) => SCENARIOS[year] ?? SCENARIOS[DEFAULT_YEAR];
