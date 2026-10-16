// Bataille des airs du front stratégique : avant le premier jour, et de nouveau au matin du 7e (renforts), les
// chasseurs des deux camps se disputent le ciel en quelques manches de dés. Le vainqueur a la suprématie aérienne :
// ses sorties du jour (celles de l'année et des cartes) ; le vaincu n'en a plus aucune. À égalité, ciel disputé :
// chacun garde la moitié de ses sorties. La DCA ne dépend pas du ciel : celle qu'on a tirée tire toujours.
// Force aérienne : sorties de l'année + cartes (chasseurs, soutien aérien). Chaque manche, chaque camp lance autant
// de d6 que sa force et touche sur 5+ ; plus de touches gagne la manche, et le perdant y perd 1 de force (avions
// abattus). La force restante, plus les nouvelles cartes, sert au 7e jour. Le journal des manches sert à
// l'animation ; il est calculé d'avance, d'après la graine.

import { createRng } from './rng.js';

export const AIRWAR = {
  rounds: 3,
  hit: 5, // touche sur 5+
  maxDice: 8,
};

export const AIRWAR_LABEL = { sup: 'suprématie aérienne', lost: 'ciel perdu', contested: 'ciel disputé', none: '' };

// force[s] : force aérienne engagée. round : 0 avant la bataille, 1 au 7e jour.
export function airBattle(front, force, round) {
  const rng = createRng(`airwar:${front.seed}:${round}`);
  const f = force.slice();
  const rounds = [];
  const won = [0, 0];
  for (let k = 0; k < AIRWAR.rounds; k++) {
    const rolls = f.map((n) => Array.from({ length: Math.min(AIRWAR.maxDice, Math.max(0, n)) }, () => rng.d6()));
    const hits = rolls.map((r) => r.filter((d) => d >= AIRWAR.hit).length);
    const winner = hits[0] > hits[1] ? 0 : hits[1] > hits[0] ? 1 : null;
    if (winner !== null) { won[winner]++; f[1 - winner] = Math.max(0, f[1 - winner] - 1); }
    rounds.push({ rolls, hits, winner, force: f.slice() });
  }
  const sup = won[0] > won[1] ? 0 : won[1] > won[0] ? 1 : null;
  return { round, start: force.slice(), force: f, rounds, won, sup };
}

// Part des sorties autorisées pour le camp s (1 sans bataille des airs).
export function airShare(front, s) {
  const w = front.airWar;
  if (!w) return 1;
  return w.sup === null ? 0.5 : w.sup === s ? 1 : 0;
}

export const airStatus = (front, s) => (!front.airWar ? 'none' : front.airWar.sup === null ? 'contested' : front.airWar.sup === s ? 'sup' : 'lost');

const NAME = ['la Luftwaffe', 'l\'aviation soviétique'];

// Résout la bataille des airs et la note au journal (les deux camps la voient : le ciel se lit).
export function fightAirWar(front, bonus, round) {
  const base = front.cfg.airBase ?? front.cfg.sorties;
  const force = round === 0 ? [0, 1].map((s) => base[s] + bonus[s]) : [0, 1].map((s) => front.airWar.force[s] + bonus[s]);
  const w = airBattle(front, force, round);
  front.airWar = w;
  front.airWars ??= [];
  front.airWars.push(w);
  const score = `${Math.max(...w.won)} manche${Math.max(...w.won) > 1 ? 's' : ''} à ${Math.min(...w.won)}`;
  const text = w.sup === null
    ? `Bataille des airs${round ? ' du 7e jour' : ''} : ciel disputé (${score}) ; chaque camp ne garde que la moitié de ses sorties.`
    : `Bataille des airs${round ? ' du 7e jour' : ''} : ${NAME[w.sup]} prend la suprématie aérienne (${score}) ; l'adversaire n'a plus de sorties.`;
  front.log.push({ day: front.day, tick: 0, kind: 'airwar', side: w.sup, text });
  return w;
}
