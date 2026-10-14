// Contrôleur du front stratégique : briefing, ordres du matin, journée animée, bilans et débriefing.
// Le moteur (front.js) reste la vérité ; ici, on traduit les gestes en ordres et l'état en écrans.
//
// Geste : on choisit un outil, puis on touche le départ et la cible. Le jeu prend lui-même la case la plus
// pertinente autour du doigt (la plus garnie au contact pour un vecteur, la plus proche pour une ligne) : nul besoin
// de viser une case précise. Sans outil, toucher la carte donne une estimation des forces dans la zone.

import {
  createFront, beginDay, stepTick, addVector, addLine, setLineLevel, addBarrage, removeOrder, deployReserve, undoDeployment,
  repeatOrders, setPocketMode, vectorCatchment, troops, territory, townsHeld, attackerTowns, pocketName,
  cellAtPoint, FRONT_WEATHER, POCKET_MODES, VECTOR_TYPES, sideIndex,
} from './front.js';
import { installAI } from './frontai.js';
import { GUN_KINDS, GUN_POSTURES, gunPower, gunFor, setGunOrder } from './frontguns.js';
import { setArmorOrder, expLabel } from './frontarmor.js';
import { scoreBreakdown, objectiveState, GRADES, SCORE } from './frontscore.js';
import { FrontRenderer, CELL } from './frontrender.js';
import { bigPockets, menRange, pickCell, areaReport, combatSpots } from './frontinput.js';
import { WeatherLayer } from './weather.js';
import { SEASON } from './conditions.js';
import { FRONT_BIOMES } from './mapgen.js';
import { describeCell } from './terrain.js';
import { createRng } from './rng.js';
import { sound } from './audio.js';

const byId = (id) => document.getElementById(id);
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const touchOnly = () => window.matchMedia?.('(hover: none)').matches;
const stillMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const DAY_MS = 20000; // une journée dure ~20 s : le front se déplace lentement, on le regarde vivre
const SKIP_MS = 45; // « Passer la journée » : les ticks restants défilent en accéléré
const DAY_START = 6, DAY_END = 20; // heures de la journée de combat

const SIDE_NAME = ['Wehrmacht', 'Armée rouge'];

// Outils du matin : vecteurs (deux appuis), ligne (deux appuis), barrage et réserves (un appui).
const TOOLS = {
  infantry: { label: 'Infanterie', short: 'Inf.', taps: 2, hint: 'Touchez le départ dans vos lignes, puis l\'objectif.' },
  armor: { label: 'Blindés', short: 'Blindés', taps: 1, hint: 'Formation blindée : touchez son objectif (ou une autre formation pour la choisir). Elle rejoint le front par vos lignes puis perce.' },
  retreat: { label: 'Repli', short: 'Repli', taps: 2, hint: 'Repli ordonné : touchez le secteur à dégager, puis où se replier dans vos lignes.' },
  line: { label: 'Ligne de défense', short: 'Ligne', taps: 2, hint: 'Ligne de défense : touchez une extrémité, puis l\'autre, dans vos lignes. Tranchées en un jour, barbelés en deux, antichar en trois (niveau réglable dans le panneau).' },
  barrage: { label: 'Barrage', short: 'Barrage', taps: 1, hint: 'Barrage de zone : touchez la zone à pilonner. Le groupe d\'artillerie disponible le plus puissant qui l\'a à portée tirera.' },
  reserve: { label: 'Réserves', short: 'Réserves', taps: 1, hint: 'Chaque appui fait monter 800 hommes en ligne autour du point touché.' },
};

const fui = {
  front: null,
  r: null,
  weather: null,
  side: 0,
  seed: '',
  tool: null,
  pending: null, // premier appui d'un ordre à deux appuis : { cell, point }
  breakout: null, // id de la poche dont on trace la percée
  gun: null, // id du groupe d'artillerie sélectionné (le prochain appui fixe sa destination)
  armor: null, // id de la formation blindée sélectionnée (outil Blindés : le prochain appui fixe son objectif)
  hoverPoint: null,
  probe: null, // estimation au toucher : { x, y, r }
  tab: 'orders',
  acc: 0,
  skip: false,
  ending: false,
  loop: 0,
  last: 0,
  dayStats: null,
  hooks: {},
  bound: false,
  hintTimer: 0,
  showAll: false, // après la bataille : vue omnisciente
};

export const frontActive = () => !!fui.front && !byId('front-app').hidden;
// Fond sonore : seulement pendant la journée, carte visible.
export const frontAmbient = () => frontActive() && byId('overlay').hidden && fui.front?.phase === 'resolve';

const men = (d) => Math.round(d * (fui.front?.cfg.men ?? 10));
const fmtMen = (n) => `${(Math.round(n / 100) * 100).toLocaleString('fr-FR')} h`;
// ---------- Entrée et sortie du mode ----------

export function initFront(hooks) {
  fui.hooks = hooks;
}

export function openFront(sideCode, seed) {
  stopLoop();
  byId('tac-app').hidden = true;
  byId('front-app').hidden = false;
  if (!fui.bound) bind();
  const rng = createRng(`front:setup:${seed}`);
  const attacker = rng.chance(0.5) ? 'DE' : 'SU';
  const biome = rng.weighted({ steppe: 22, bocage: 16, polesie: 12, bourg: 12, montagne: 12, foret: 12, fleuve: 14 });
  const season = rng.weighted({ 0: 30, 1: 25, 2: 20, 3: 15, 4: 10 });
  const front = createFront({ seed, playerSide: sideCode, attacker, biome, season: Number(season) });
  installAI(front);
  Object.assign(fui, { front, seed, side: sideIndex(sideCode), tool: null, pending: null, breakout: null, probe: null, acc: 0, skip: false, ending: false, showAll: false, tab: 'orders', hoverPoint: null });
  fui.r.setMap(front);
  fui.r.resize();
  fui.r.initialView(sideCode);
  resnap();
  refreshFront();
  showFrontBriefing();
}

export function closeFront() {
  stopLoop();
  fui.front = null;
  byId('front-app').hidden = true;
  byId('tac-app').hidden = false;
  fui.weather?.set('clear', 'day');
}

function viewer() { return fui.showAll ? null : fui.side; }
function resnap() {
  fui.r.cur = null;
  fui.r.snapshot(viewer());
}

// ---------- Dossiers ----------

function biomeText(f) {
  const b = FRONT_BIOMES[f.map.biome];
  const water = f.map.rivers?.length ? (f.map.rivers[0].big ? ' Un fleuve traverse le secteur : ponts rares, à tenir ou à faire sauter.' : ' Une rivière coupe le secteur : ponts et gués sont les seuls passages rapides.') : '';
  return b ? `<p><b>${b.label}.</b> ${b.text}${water}</p>` : '';
}

function weatherText(f) {
  const w = FRONT_WEATHER[f.weather];
  return `<p><b>${w.label}.</b> ${w.text}</p>`;
}

function goalText(f) {
  const att = f.attacker === fui.side;
  return att
    ? `Bataille aux points. Prenez les villes ★ tôt et tenez-les : chaque soir où vous les tenez rapporte, et davantage au dernier soir. Terrain gagné, pertes infligées, troupes prises dans des poches et objectifs secondaires comptent aussi. Environ deux villes ★ tenues font une victoire, trois une victoire décisive.`
    : `Bataille aux points. Chaque soir où l'ennemi tient une ville ★ lui rapporte : reprenez-les vite, ou retardez leur chute. Saignez l'offensive, encerclez ses pointes, remplissez vos objectifs secondaires : une offensive qui ne gagne presque rien est une victoire défensive.`;
}

const signed = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(Math.round(n))}`;

// Issue vue du joueur : victoire, défaite ou indécis, et le libellé gradué.
function gradeFor(f, grade) {
  const G = GRADES[grade];
  const mine = G.att === null ? null : G.att === (f.attacker === fui.side);
  return { label: G.label, mine };
}

function objectivesHtml(f, side, final = false) {
  const list = f.objectives.filter((o) => o.side === side);
  if (!list.length) return '<p class="muted">Aucun.</p>';
  return `<ul class="f-objs">${list.map((o) => {
    const st = objectiveState(f, o);
    const ok = st.final ?? (final ? st.done : null);
    const mark = ok === true ? '✓' : ok === false ? '✗' : st.done ? '◐' : '○';
    return `<li class="${ok === true ? 'ok' : ok === false ? 'ko' : ''}"><span class="obj-mark" aria-hidden="true">${mark}</span> ${escHtml(o.label)} <em>${escHtml(st.text)}</em></li>`;
  }).join('')}</ul>`;
}

function enemyEstimate(f) {
  const mem = f.memory[fui.side];
  let est = 0;
  for (let i = 0; i < f.map.N; i++) if (mem.owner[i] === 1 - fui.side) est += mem.est[i];
  return est * f.cfg.men;
}

function showFrontBriefing() {
  const f = fui.front;
  const s = fui.side;
  const att = f.attacker === s;
  fui.hooks.showDossier(`
    <p class="eyebrow">Front stratégique · ${escHtml(SEASON[f.season].month)} · ${f.cfg.days} jours</p>
    <h1 class="title-l">${escHtml(f.map.name)}</h1>
    <p class="kind">${SIDE_NAME[s]} · ${att ? 'vous attaquez' : 'vous défendez'}</p>
    <p class="lede">${att
      ? 'Vos divisions sont massées face à une ligne retranchée, inégalement fortifiée : trouvez ses points faibles, percez, encerclez.'
      : 'Vos positions sont retranchées, plus solidement autour des villes. L\'ennemi a davantage de réserves : cédez du terrain s\'il le faut, mais gardez les villes.'}</p>
    <div class="brief-grid">
      <section>
        <h2>Objectif</h2>
        <p>${goalText(f)}</p>
        <h2>Objectifs secondaires (+${SCORE.secondary} points chacun)</h2>
        ${objectivesHtml(f, s)}
        <p class="muted small">L'ennemi a les siens : ${f.objectives.filter((o) => o.side !== s).map((o) => escHtml(o.label.toLowerCase())).join(' ; ')}.</p>
        <p class="muted small">Fin immédiate si un camp tombe sous 12 % de ses effectifs ou de son terrain, ou si l'attaquant prend toutes les villes.</p>
        <h2>Forces</h2>
        <p>En ligne : ${fmtMen(men(troops(f, s)))}. Réserves : ${fmtMen(men(f.reserve[s]))}, renforcées chaque soir selon le ravitaillement et les villes tenues.</p>
        <p>Renseignement : en face, ${menRange(enemyEstimate(f), 0.8, 1.4)} repérés ; le reste est dans le brouillard.</p>
      </section>
      <section>
        <h2>Conditions</h2>
        <div class="conditions">${biomeText(f)}${weatherText(f)}</div>
        <h2>Ordres</h2>
        <p>Chaque matin, choisissez un outil puis touchez le départ et la cible : le jeu prend la case la plus pertinente autour du doigt. Puis la journée se déroule seule, en une vingtaine de secondes.</p>
      </section>
    </div>
    <div class="row-end"><button class="btn btn-primary" id="f-start">Prendre le commandement</button></div>
  `, () => byId('f-start').addEventListener('click', () => { fui.hooks.hideDossier(); setHint(TOOLS_HELP()); refreshFront(); }));
}

const TOOLS_HELP = () => `${touchOnly() ? 'Touchez' : 'Cliquez'} la carte pour estimer les forces ; choisissez un outil pour donner un ordre.`;

function frontRules() {
  const c = fui.front?.cfg ?? { maxVectors: 4, maxArmor: 2, maxLines: 2, days: 10 };
  return `
    <details class="rules" open>
      <summary>Front stratégique</summary>
      <ol>
        <li><b>Masses.</b> Plus d'unités : chaque camp est une masse de troupes, plus sombre où elle est dense. Le trait noir est le front. Hors de vue, l'ennemi n'est qu'une estimation estompée.</li>
        <li><b>Le matin.</b> Le jeu est en pause. Donnez jusqu'à ${c.maxVectors} vecteurs d'infanterie ou de repli : les troupes autour du départ s'y engagent et poussent vers la cible. Un vecteur draine son voisinage : là où il prend, le front se dégarnit.</li>
        <li><b>Outils.</b> Infanterie : large, lente, tenace. Blindés : vos formations (divisions de Panzer, corps blindés), visibles sur la carte ; touchez-en une puis son objectif. Elle rejoint le front par vos lignes (vite sur route, mal en forêt, jamais à travers une rivière sans pont), perce, dépose ses grenadiers dans les cases prises et exploite ; riposte, hérissons, villes et forêts lui coûtent des chars, elle consomme du carburant, se refait la nuit si elle est ravitaillée, et meurt encerclée. Repli ordonné : les troupes décrochent avec moins de pertes. Ligne de défense (${c.maxLines} nouvelles par jour, 4 chantiers au plus) : un chantier de plusieurs jours, trois fois plus lent au contact de l'ennemi. Tranchées en un jour (défense de l'infanterie, à moitié pour qui les prend), barbelés en deux (l'assaut d'infanterie qui les traverse s'use), hérissons antichar en trois (les chars y perdent élan et vitesse). Barbelés et hérissons gênent quiconque les traverse, dans les deux sens. Un barrage les détruit (l'artillerie lourde vient seule à bout des hérissons) et fait sauter les ponts ; les ruines restent sur la carte. Barrage : une zone pilonnée au début de la journée, même dans le brouillard, par un groupe d'artillerie qui l'a à portée (une mission par groupe et par jour). Artillerie : touchez un groupe puis sa destination ; en batterie il tire à 100 %, en appui mobile à 40 %, en déplacement pas du tout. Sans mission, il frappe les assaillants à sa portée ; un groupe dont la position tombe est perdu. Réserves : chaque appui fait monter des renforts en ligne.</li>
        <li><b>La journée.</b> Une vingtaine de secondes, sans intervention : le combat compare les pressions de part et d'autre du front, selon la densité, le terrain, le retranchement et la qualité des troupes. Le bouton discret « Passer » abrège la journée.</li>
        <li><b>Défense élastique.</b> Sans ordre, les troupes colmatent d'elles-mêmes les secteurs menacés.</li>
        <li><b>Encerclement.</b> Des troupes coupées de leur bord de carte forment une poche, qui fond d'environ 30 % par jour. Chaque matin, choisissez pour les vôtres : statu quo, Festung (se resserrer, tenir et fondre moins vite) ou percée d'évasion vers un point que vous touchez.</li>
        <li><b>Brouillard.</b> Vous voyez à quelques cases de vos troupes (moins par brouillard). Touchez la carte : vos forces sont comptées, celles de l'ennemi estimées en fourchette.</li>
        <li><b>Victoire aux points.</b> Le score de l'offensive additionne les villes ★ tenues par l'attaquant (chaque soir, et davantage au dernier), le terrain gagné, le rapport des pertes, les troupes perdues dans les poches, l'exploitation jusqu'au bord de la carte et les objectifs secondaires des deux camps. Au soir du ${c.days}<sup>e</sup> jour, l'issue va de la victoire décisive de l'attaquant (≥ ${SCORE.attDecisive}) à la victoire défensive décisive (&lt; ${SCORE.defWin}), en passant par une issue indécise. Un camp qui tombe sous 12 % de ses effectifs ou de son terrain a perdu sur-le-champ ; l'attaquant qui prend toutes les villes gagne aussitôt.</li>
      </ol>
    </details>`;
}

function showHelp() {
  fui.hooks.showDossier(`<p class="eyebrow">Manuel</p><h1 class="title-l">Front stratégique</h1>${frontRules()}<div class="row-end"><button class="btn btn-primary" id="f-close-help">Reprendre</button></div>`,
    () => byId('f-close-help').addEventListener('click', fui.hooks.hideDossier));
}

// Instantané de début de journée, pour le bilan du soir.
function takeStats() {
  const f = fui.front, s = fui.side;
  return {
    day: f.day,
    troops: troops(f, s),
    reserve: f.reserve[s],
    losses: f.stats.losses.slice(),
    territory: territory(f, s),
    towns: townsHeld(f, s),
    objective: attackerTowns(f),
    score: scoreBreakdown(f).total,
    logFrom: f.log.length,
    pockets: f.pockets[s].length,
  };
}

function showDayReport() {
  const f = fui.front, s = fui.side, d = fui.dayStats;
  if (!d) return;
  const lost = men(f.stats.losses[s] - d.losses[s]);
  const theirs = men(f.stats.losses[1 - s] - d.losses[1 - s]);
  const terr = (territory(f, s) - d.territory) * 100;
  const reinf = men(f.reserve[s] - d.reserve);
  const events = f.log.slice(d.logFrom).filter((e) => e.kind === 'town' || e.kind === 'pocket');
  const obj = attackerTowns(f);
  const att = f.attacker === s;
  const myPockets = bigPockets(f, s);
  fui.hooks.showDossier(`
    <p class="eyebrow">${escHtml(f.map.name)} · bilan du soir</p>
    <h1 class="title-l">Jour ${d.day} / ${f.cfg.days}</h1>
    <div class="brief-grid">
      <section>
        <h2>Pertes</h2>
        <p>Vos pertes : <b>${fmtMen(lost)}</b>.<br>Pertes ennemies estimées : ${theirs < 50 ? 'négligeables' : menRange(theirs, 0.7, 1.35)}.</p>
        <h2>Terrain</h2>
        <p>${Math.abs(terr) < 0.5 ? 'Le front n\'a guère bougé.' : terr > 0 ? `Vous gagnez ${terr.toFixed(1).replace('.', ',')} % du secteur.` : `Vous cédez ${(-terr).toFixed(1).replace('.', ',')} % du secteur.`} Vous tenez ${Math.round(territory(f, s) * 100)} % du terrain et ${townsHeld(f, s)} ville${townsHeld(f, s) > 1 ? 's' : ''}.</p>
        <p>Villes ★ : ${obj} sur ${f.defTowns.length} ${att ? 'prises' : 'perdues'}.</p>
        ${(() => { const sc = scoreBreakdown(f); const g = gradeFor(f, sc.grade); return `<p>Score de ${att ? 'votre offensive' : 'l\'offensive ennemie'} : <b>≈ ${signed(sc.total)}</b> (${signed(sc.total - d.score)} aujourd'hui). Issue en vue : <b>${g.label.toLowerCase()}</b>${g.mine === true ? ' en votre faveur' : g.mine === false ? ' pour l\'ennemi' : ''}.</p>`; })()}
        <h2>Vos objectifs secondaires</h2>
        ${objectivesHtml(f, s)}
      </section>
      <section>
        <h2>Événements</h2>
        ${events.length ? `<ul class="ticks">${events.slice(0, 6).map((e) => `<li>${escHtml(e.text)}</li>`).join('')}${events.length > 6 ? `<li>… et ${events.length - 6} autres (journal).</li>` : ''}</ul>` : '<p>Pas de ville prise, pas d\'encerclement.</p>'}
        <h2>Demain</h2>
        ${f.phase === 'over' ? '' : `<p>Renforts reçus : ${fmtMen(reinf)} (réserves : ${fmtMen(men(f.reserve[s]))}).</p>${weatherText(f)}`}
        ${myPockets.length && f.phase !== 'over' ? `<p class="warn-note">${myPockets.length > 1 ? `${myPockets.length} poches de vos troupes attendent` : 'Une poche de vos troupes attend'} vos ordres (onglet Ordres).</p>` : ''}
      </section>
    </div>
    <div class="row-end"><button class="btn btn-primary" id="f-next">${f.phase === 'over' ? 'Résultat' : `Ordres du jour ${f.day}`}</button></div>
  `, () => byId('f-next').addEventListener('click', () => {
    if (f.phase === 'over') return showFrontDebrief();
    fui.hooks.hideDossier();
    sound.ui('select');
    refreshFront();
  }));
}

function showFrontDebrief() {
  const f = fui.front, s = fui.side;
  const won = f.result.winner === s;
  const draw = f.result.winner === null;
  const sc = scoreBreakdown(f, true);
  const g = gradeFor(f, f.result.grade ?? sc.grade);
  fui.showAll = true;
  resnap();
  drawFront();
  const L = f.stats.losses;
  fui.hooks.showDossier(`
    <p class="eyebrow">${escHtml(f.map.name)} · rapport final</p>
    <h1 class="title-l ${won ? 'win' : draw ? '' : 'loss'}">${won ? g.label : draw ? 'Issue indécise' : 'Défaite'}</h1>
    ${!won && !draw ? `<p class="kind">${escHtml(g.label)} de l'ennemi</p>` : ''}
    <p class="lede">${escHtml(f.result.reason)}</p>
    <div class="brief-grid">
      <section>
        <h2>Pertes</h2>
        <p>${SIDE_NAME[0]} : ${fmtMen(men(L[0]))}<br>${SIDE_NAME[1]} : ${fmtMen(men(L[1]))}</p>
        <h2>Terrain</h2>
        <p>${SIDE_NAME[0]} ${Math.round(territory(f, 0) * 100)} % · ${SIDE_NAME[1]} ${Math.round(territory(f, 1) * 100)} %. Villes ★ prises par l'attaquant : ${attackerTowns(f)} sur ${f.defTowns.length}.</p>
      </section>
      <section>
        <h2>Score de l'offensive : ${signed(sc.total)}</h2>
        <table class="score-table">${sc.rows.filter((r) => r.pts || r.objective).map((r) => `<tr class="${r.objective ? (r.ok ? 'ok' : 'ko') : ''}"><td>${escHtml(r.label)}</td><td>${signed(r.pts)}</td></tr>`).join('')}</table>
        <p class="muted small">Seuils : victoire décisive de l'attaquant ≥ ${SCORE.attDecisive}, victoire ≥ ${SCORE.attWin}, indécis ≥ ${SCORE.draw}, victoire défensive ≥ ${SCORE.defWin}, au-dessous victoire défensive décisive.</p>
        <h2>Après la bataille</h2>
        <p>Le brouillard est levé : la carte montre maintenant les forces réelles des deux camps.</p>
      </section>
    </div>
    <div class="row-end">
      <button class="btn btn-ghost" id="f-see">Revoir la carte</button>
      <button class="btn btn-primary" id="f-new">Nouvelle bataille</button>
    </div>
  `, () => {
    byId('f-see').addEventListener('click', () => { fui.hooks.hideDossier(); refreshFront(); });
    byId('f-new').addEventListener('click', () => fui.hooks.showMenu());
  });
}

// ---------- Choix de la case autour du doigt ----------

// Rayon de recherche autour du doigt, en unités de grille : ~32 px d'écran, jamais moins de 1,5 case.
function reach() { return Math.max(1.5, 32 / (CELL * fui.r.cam.s)); }
// La case la plus pertinente autour du doigt (voir frontinput.js).
const pickNear = (p, purpose) => pickCell(fui.front, fui.side, p, purpose, reach());

const cellPoint = (i) => ({ x: fui.front.centers.x[i], y: fui.front.centers.y[i] });

// ---------- Ordres ----------

function setTool(t) {
  const f = fui.front;
  if (!f || f.phase !== 'plan') return;
  // Blindés : chaque appui sur l'outil passe à la formation suivante.
  if (t === 'armor') {
    const list = f.armor.filter((a) => a.side === fui.side && !a.lost);
    if (!list.length) return setHint('Aucune formation blindée disponible.', true);
    const k = fui.tool === 'armor' ? list.findIndex((a) => a.id === fui.armor) + 1 : 0;
    if (fui.tool === 'armor' && k >= list.length) { cancelTool(); return; }
    fui.gun = null;
    fui.pending = null;
    return selectArmor(list[k].id);
  }
  fui.tool = fui.tool === t ? null : t;
  fui.pending = null;
  fui.gun = null;
  fui.armor = null;
  fui.breakout = null;
  fui.probe = null;
  setHint(fui.tool ? TOOLS[fui.tool].hint : TOOLS_HELP());
  sound.ui('select');
  refreshFront();
}

function cancelTool() {
  fui.tool = null;
  fui.gun = null;
  fui.armor = null;
  fui.pending = null;
  fui.breakout = null;
  setHint(TOOLS_HELP());
  refreshFront();
}

function fail(r) {
  if (!r?.error) return false;
  setHint(r.error, true);
  return true;
}

function placed(text) {
  sound.ui('order');
  setHint(text);
}

function onTap(p) {
  const f = fui.front;
  if (!f || !byId('overlay').hidden) return;
  const s = fui.side;
  if (f.phase === 'plan' && !fui.tool && !fui.breakout) {
    // Artillerie : toucher un de ses groupes le sélectionne ; l'appui suivant fixe sa destination.
    const g = gunNear(p);
    if (fui.gun != null) {
      if (g && g.id === fui.gun) { fui.gun = null; setHint(TOOLS_HELP()); return refreshFront(); }
      if (g) return selectGun(g.id);
      let to = { x: p.x, y: p.y };
      if (f.owner[cellAtPoint(f, to)] !== s) { const j = pickNear(p, 'near'); if (j >= 0) to = cellPoint(j); }
      const r = setGunOrder(f, s, fui.gun, { dest: to });
      if (!fail(r)) { placed(`${r.name} : ${GUN_POSTURES[r.posture].label.toLowerCase()} vers sa nouvelle position (${Math.round(GUN_POSTURES[r.posture].fire * 100)} % de sa puissance de feu aujourd'hui).`); fui.gun = null; }
      return refreshFront();
    }
    const a = armorNear(p);
    // Le plus proche du doigt, groupe d'artillerie ou formation blindée.
    if (a && (!g || Math.hypot(a.x - p.x, a.y - p.y) < Math.hypot(g.x - p.x, g.y - p.y))) return selectArmor(a.id);
    if (g) return selectGun(g.id);
  }
  if (f.phase !== 'plan' || (!fui.tool && !fui.breakout)) return probeAt(p);

  if (fui.breakout) {
    const r = setPocketMode(f, s, fui.breakout, 'breakout', { x: p.x, y: p.y });
    fui.breakout = null;
    if (!fail(r)) placed(`Percée d'évasion de la poche ${pocketName(f, r)} : toutes ses forces convergent vers la sortie.`);
    return refreshFront();
  }

  const tool = fui.tool;
  if (tool === 'armor') {
    const a = armorNear(p);
    if (a && a.id !== fui.armor) return selectArmor(a.id);
    const unit = f.armor.find((x) => x.id === fui.armor);
    if (!unit) return cancelTool();
    if (a && a.id === unit.id) { fui.tool = null; fui.armor = null; setHint(TOOLS_HELP()); return refreshFront(); }
    const r = setArmorOrder(f, s, unit.id, { x: p.x, y: p.y });
    if (!fail(r)) { placed(`${r.name} : en route vers son objectif. Elle gagne le front par vos lignes, puis perce.`); fui.tool = null; fui.armor = null; }
    return refreshFront();
  }
  if (tool === 'barrage') {
    const r = addBarrage(f, s, { x: p.x, y: p.y });
    if (!fail(r)) { placed(`Barrage réglé : ${f.guns.find((g) => g.id === r.gun).name} pilonnera la zone au lever du jour.`); fui.tool = null; }
    return refreshFront();
  }
  if (tool === 'reserve') {
    const i = pickNear(p, 'reserve');
    if (i < 0) { setHint('Touchez vos lignes ravitaillées.', true); return; }
    const r = deployReserve(f, s, i, f.cfg.chunk);
    if (!fail(r)) {
      placed(`${fmtMen(men(r.amount))} montent en ligne. Réserves restantes : ${fmtMen(men(f.reserve[s]))}.`);
      fui.probe = { ...cellPoint(i), r: 2.5 };
      resnap();
    }
    return refreshFront();
  }

  // Ordres à deux appuis.
  if (!fui.pending) {
    const purpose = tool === 'line' ? 'near' : 'push';
    const i = pickNear(p, purpose);
    if (i < 0) { setHint('Touchez vos lignes.', true); return; }
    fui.pending = { cell: i, point: tool === 'line' ? { x: p.x, y: p.y } : cellPoint(i) };
    if (tool === 'line' && f.owner[cellAtPoint(f, p)] !== s) fui.pending.point = cellPoint(i);
    sound.ui('select');
    setHint(tool === 'line' ? 'Touchez l\'autre extrémité de la ligne.' : tool === 'retreat' ? 'Touchez où se replier, dans vos lignes.' : 'Touchez l\'objectif.');
    return refreshFront();
  }
  const a = fui.pending;
  fui.pending = null;
  let r;
  if (tool === 'line') {
    let b = { x: p.x, y: p.y };
    if (f.owner[cellAtPoint(f, b)] !== s) { const j = pickNear(p, 'near'); if (j >= 0) b = cellPoint(j); }
    r = addLine(f, s, a.point, b);
    if (!fail(r)) placed(`Ligne de défense : ${r.cells.length} cases se retranchent pendant la journée.`);
  } else {
    let to = { x: p.x, y: p.y };
    if (tool === 'retreat' && f.owner[cellAtPoint(f, to)] !== s) { const j = pickNear(p, 'near'); if (j >= 0) to = cellPoint(j); }
    r = addVector(f, s, tool, a.cell, to);
    if (!fail(r)) placed(`${VECTOR_TYPES[tool].label} : environ ${fmtMen(men(vectorCatchment(f, r)))} engagés.`);
  }
  if (!r.error) fui.tool = null;
  refreshFront();
}

// Formation blindée à soi sous le doigt.
function armorNear(p) {
  const f = fui.front, R = reach() * 1.6;
  let best = null, bd = R;
  for (const a of f.armor) {
    if (a.side !== fui.side || a.lost) continue;
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

function selectArmor(id) {
  const a = fui.front.armor.find((x) => x.id === id);
  if (!a || a.lost || fui.front.phase !== 'plan') return;
  fui.tool = 'armor';
  fui.armor = id;
  fui.gun = null;
  fui.probe = null;
  sound.ui('select');
  setHint(`${a.name} · ${Math.round(a.tanks)} chars · ${expLabel(a.exp).toLowerCase()} · carburant ${Math.round(a.fuel * 100)} %. Touchez son objectif.`);
  refreshFront();
}

// Groupe d'artillerie à soi sous le doigt.
function gunNear(p) {
  const f = fui.front, R = reach() * 1.2;
  let best = null, bd = R;
  for (const g of f.guns) {
    if (g.side !== fui.side || g.lost) continue;
    const d = Math.hypot(g.x - p.x, g.y - p.y);
    if (d < bd) { bd = d; best = g; }
  }
  return best;
}

function selectGun(id) {
  const g = fui.front.guns.find((x) => x.id === id);
  if (!g || g.lost || fui.front.phase !== 'plan') return;
  fui.gun = id;
  fui.probe = null;
  sound.ui('select');
  setHint(`${g.name} · ${GUN_KINDS[g.kind].label}, portée ${Math.round(GUN_KINDS[g.kind].range / 1.73)} cases. Touchez sa destination, ou réglez sa posture dans le panneau.`);
  refreshFront();
}

function gunPosture(id, posture) {
  const r = setGunOrder(fui.front, fui.side, id, { posture });
  if (!fail(r)) placed(`${r.name} : ${GUN_POSTURES[posture].label.toLowerCase()}.`);
  refreshFront();
}

// Estimation au toucher : nos forces sont comptées, celles de l'ennemi estimées en fourchette.
function probeAt(p) {
  const f = fui.front, s = fui.side;
  const i = cellAtPoint(f, p);
  if (i < 0) { fui.probe = null; setHint(TOOLS_HELP()); return drawFront(); }
  const R = 3;
  const omni = viewer() === null;
  const { side, sum, visible, age: seen } = areaReport(f, s, p, i, R, omni);
  fui.probe = { x: p.x, y: p.y, r: R };
  const terrain = describeCell(f.map, i);
  let text;
  if (side < 0) text = terrain;
  else if (omni || side === s) {
    const pocket = bigPockets(f, side).find((q) => q.cells.includes(i));
    text = `${side === s && !omni ? 'Vos troupes' : SIDE_NAME[side]} : ${fmtMen(men(sum))} dans la zone · ${terrain}${pocket ? ` · poche ${pocketName(f, pocket)}` : ''}`;
  } else {
    const n = men(sum);
    const age = visible ? '' : seen < Infinity ? ` (vu il y a ${hoursAgo(seen)})` : '';
    text = `Ennemi estimé : ${n < 50 ? 'quelques éléments' : menRange(n)}${age} · ${terrain}`;
  }
  setHint(text);
  drawFront();
}

function hoursAgo(ticks) {
  const h = Math.round((ticks * (DAY_END - DAY_START)) / fui.front.cfg.ticks);
  return h < 1 ? 'moins d\'une heure' : h < 24 ? `${h} h` : `${Math.round(h / 24)} j`;
}

function removeMine(id) {
  removeOrder(fui.front, fui.side, id);
  sound.ui('select');
  refreshFront();
}

function undoReserve() {
  if (undoDeployment(fui.front, fui.side)) { resnap(); sound.ui('select'); }
  refreshFront();
}

function repeatYesterday() {
  repeatOrders(fui.front, fui.side);
  sound.ui('order');
  refreshFront();
}

function pocketMode(id, mode) {
  const f = fui.front;
  if (mode === 'breakout') {
    fui.tool = null;
    fui.pending = null;
    fui.breakout = id;
    setHint('Touchez la direction de la percée : en général, vos lignes les plus proches.');
    return refreshFront();
  }
  fail(setPocketMode(f, fui.side, id, mode));
  sound.ui('order');
  refreshFront();
}

// ---------- Journée ----------

function launchDay() {
  const f = fui.front;
  if (!f || !byId('overlay').hidden) return;
  if (f.phase === 'over') return showFrontDebrief();
  if (f.phase === 'resolve') { fui.skip = true; return refreshFront(); }
  fui.tool = null;
  fui.pending = null;
  fui.breakout = null;
  fui.probe = null;
  fui.dayStats = takeStats();
  beginDay(f);
  fui.r.fx.clear();
  fui.acc = 0;
  fui.skip = false;
  fui.ending = false;
  sound.ui('go');
  setHint('');
  refreshFront();
  startLoop();
}

function tickMs() { return fui.skip || stillMotion() ? SKIP_MS : DAY_MS / fui.front.cfg.ticks; }

function startLoop() {
  stopLoop();
  fui.last = performance.now();
  const frame = (now) => {
    fui.loop = requestAnimationFrame(frame);
    const f = fui.front;
    if (!f) return stopLoop();
    const dt = Math.min(250, now - fui.last);
    fui.last = now;
    if (byId('overlay').hidden) fui.acc += dt;
    const T = tickMs();
    while (fui.acc >= T) {
      if (fui.ending) { fui.acc = T; return endOfDay(); }
      fui.acc -= T;
      const tick = f.tick;
      const events = stepTick(f);
      fui.r.snapshot(viewer());
      tickSounds(events, tick, T);
      if (!fui.skip && !stillMotion()) fui.r.fx.spawn(f, viewer(), now, T, fui.r.viewRect(), events);
      else fui.r.fx.glow = [];
      if (f.phase !== 'resolve') fui.ending = true;
      // Panneau d'ordres : chars, carburant et état des formations suivent la journée (toutes les 3 ticks).
      if (tick % 3 === 0 && fui.tab === 'orders' && !fui.skip) renderOrders();
      if (fui.skip) break; // une image par tick, même en accéléré
    }
    drawFront(fui.acc / T);
    renderClock();
  };
  fui.loop = requestAnimationFrame(frame);
}

// Panoramique et volume d'un point de la carte (unités de grille) selon sa place à l'écran.
function frontLocate(x, y) {
  const r = fui.r, c = r.cam;
  const sx = (x * CELL - c.x) * c.s, sy = (y * CELL - c.y) * c.s;
  const off = Math.max(0, -sx, sx - r.vw, -sy, sy - r.vh) / Math.max(r.vw, r.vh, 1);
  return { pan: Math.max(-0.8, Math.min(0.8, (sx / (r.vw || 1)) * 1.6 - 0.8)), gain: 1 / (1 + 2.5 * off) };
}

// Sons d'un tick : fusillades des secteurs au contact (là où l'on a des troupes ou une vue), barrages du matin
// (les nôtres, et ceux de l'ennemi qui tombent sous nos yeux), villes qui tombent, encerclements.
// Rien en accéléré : « Passer » est silencieux.
function tickSounds(events, tick, T) {
  if (!sound.live || fui.skip || stillMotion()) return;
  const f = fui.front, s = fui.side, items = [];
  for (const sp of combatSpots(f, s)) {
    // Front calme (aucun assaut dans le secteur) : quelques coups épars, pas à chaque tick.
    if (sp.assault > 0) items.push({ k: 'fire', n: 1 + sp.loss * 0.5, armor: sp.armor, ...frontLocate(sp.x, sp.y) });
    else if (Math.random() < 0.35) items.push({ k: 'fire', n: 1, armor: 0, ...frontLocate(sp.x, sp.y) });
  }
  if (tick < f.cfg.barrageTicks && f.phase === 'resolve') {
    for (const side of [0, 1]) {
      for (const b of f.barrages[side]) {
        const i = cellAtPoint(f, b);
        if (side !== s && !(i >= 0 && (f.owner[i] === s || f.vision[s][i]))) continue;
        items.push({ k: 'barrage', ...frontLocate(b.x, b.y) });
      }
    }
  }
  for (const e of events) {
    if (e.kind === 'capture' && f.map.towns.some((t) => t.i === e.i)) items.push({ k: 'town', ...frontLocate(f.centers.x[e.i], f.centers.y[e.i]) });
    else if (e.kind === 'pocket' && (e.side === s || f.pockets[e.side].some((p) => p.id === e.id && p.troops >= 20))) items.push({ k: 'pocket', pan: 0, gain: 0.8 });
  }
  sound.front(items, T / 1000);
}

function stopLoop() {
  if (fui.loop) cancelAnimationFrame(fui.loop);
  fui.loop = 0;
}

function endOfDay() {
  stopLoop();
  fui.r.fx.clear();
  fui.ending = false;
  fui.skip = false;
  resnap();
  refreshFront();
  sound.ui('bell');
  showDayReport();
}

// ---------- Affichage ----------

function drawFront(t = 1) {
  const f = fui.front;
  if (!f) return;
  const s = fui.side;
  const v = viewer();
  const planning = f.phase === 'plan';
  const orders = { vectors: f.orders[s], lines: f.lines[s], barrages: f.barrages[s] };
  let preview = null;
  if (planning && fui.hoverPoint) {
    const h = fui.hoverPoint;
    if (fui.pending && fui.tool === 'line') preview = { lines: [{ a: fui.pending.point, b: h, side: s }] };
    else if (fui.pending) preview = { vectors: [{ type: fui.tool, from: fui.pending.point, to: h }] };
    else if (fui.tool === 'armor' && fui.armor != null) { const a = f.armor.find((x) => x.id === fui.armor); if (a) preview = { vectors: [{ type: 'armor', from: { x: a.x, y: a.y }, to: h }] }; }
    else if (fui.tool === 'barrage') {
      const g = gunFor(f, s, h);
      preview = { barrages: [{ x: h.x, y: h.y, r: g ? GUN_KINDS[g.kind].r : 3, gun: g?.id }] };
    }
  }
  fui.r.draw({
    viewer: v,
    t,
    orders: f.phase === 'over' ? null : orders,
    preview,
    origin: planning && fui.pending ? fui.pending.cell : null,
    gun: planning ? fui.gun : null,
    armor: planning ? fui.armor : null,
    probe: fui.probe,
  });
  const { cam, worldW, worldH } = fui.r;
  fui.weather.clip = { x: -cam.x * cam.s, y: -cam.y * cam.s, w: worldW * cam.s, h: worldH * cam.s };
}

let frontDrawQueued = false;
function queueFrontDraw() {
  if (frontDrawQueued || fui.loop) return;
  frontDrawQueued = true;
  requestAnimationFrame(() => { frontDrawQueued = false; drawFront(); });
}

function setHint(text, error = false) {
  const el = byId('f-hint');
  clearTimeout(fui.hintTimer);
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('error', error);
  if (error) {
    sound.ui('select');
    fui.hintTimer = setTimeout(() => setHint(fui.tool ? TOOLS[fui.tool].hint : TOOLS_HELP()), 2600);
  }
}

function dayClock() {
  const f = fui.front;
  const frac = Math.min(1, (f.tick + (fui.loop ? Math.min(1, fui.acc / tickMs()) : 0)) / f.cfg.ticks);
  const mins = Math.round((DAY_START + frac * (DAY_END - DAY_START)) * 60);
  return { frac, text: `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')}` };
}

// Pendant la journée, l'horloge (et « Passer ») prend la place du bouton de lancement.
function renderClock() {
  const f = fui.front;
  const el = byId('f-clock');
  el.hidden = f.phase !== 'resolve' && !fui.ending;
  byId('f-go').hidden = !el.hidden;
  if (el.hidden) return;
  const c = dayClock();
  byId('f-clock-time').textContent = c.text;
  byId('f-clock-track').style.setProperty('--p', `${(c.frac * 100).toFixed(1)}%`);
  byId('f-skip').disabled = fui.skip;
}

// Panneau latéral (ou tiroir, en portrait) réduit : la carte prend tout l'écran ; il n'en reste qu'un rail
// (déplier, vue d'ensemble, son) et le bouton du jour. Mémorisé d'une partie à l'autre.
const SIDE_KEY = 'frontline.front.collapsed';
function setCollapsed(on) {
  const side = byId('f-side'), btn = byId('f-collapse');
  side.classList.toggle('collapsed', on);
  byId('front-app').classList.toggle('side-collapsed', on);
  btn.setAttribute('aria-expanded', String(!on));
  btn.setAttribute('aria-label', on ? 'Déplier le panneau' : 'Réduire le panneau');
  btn.title = `${on ? 'Déplier' : 'Réduire'} le panneau (P)`;
  try { localStorage.setItem(SIDE_KEY, on ? '1' : '0'); } catch { /* stockage indisponible */ }
}
function storedCollapsed() {
  try { return localStorage.getItem(SIDE_KEY) === '1'; } catch { return false; }
}

const PHASE = { plan: 'Ordres du matin', resolve: 'Journée en cours', over: 'Terminée' };

function refreshFront() {
  const f = fui.front;
  if (!f) return;
  const s = fui.side;
  const compact = window.matchMedia?.('(max-width: 600px)').matches;
  const day = Math.min(f.day, f.cfg.days);
  byId('f-name').textContent = f.map.name;
  byId('f-day').textContent = compact ? `J${day}/${f.cfg.days}` : `Jour ${day} / ${f.cfg.days}`;
  byId('f-cond').textContent = compact && f.weather === 'clear' ? '· Clair' : `${compact ? '· ' : ''}${FRONT_WEATHER[f.weather].label}`;
  byId('f-cond').title = FRONT_WEATHER[f.weather].text;
  byId('f-phase').textContent = PHASE[f.phase];
  byId('f-phase').dataset.phase = f.phase === 'resolve' ? 'execute' : f.phase;
  const obj = attackerTowns(f);
  const sc = scoreBreakdown(f);
  byId('f-goal').innerHTML = `<span class="star">★</span> ${obj}/${f.defTowns.length}${compact ? '' : f.attacker === s ? ' prises' : ' perdues'} · ${signed(sc.total)}`;
  byId('f-goal').title = `Villes ★ ${f.attacker === s ? 'prises' : 'perdues'} : ${obj} sur ${f.defTowns.length}. Score de l'offensive : ≈ ${signed(sc.total)} (${GRADES[sc.grade].label.toLowerCase()}).`;
  fui.weather.set(f.weather, 'day');
  sound.setWeather(f.weather);
  const go = byId('f-go');
  byId('f-go-label').textContent = f.phase === 'plan' ? `Lancer le jour ${f.day}` : 'Rapport final';
  go.title = f.phase === 'plan' ? `Lancer le jour ${f.day} (Entrée)` : 'Rapport final';
  go.setAttribute('aria-label', go.title);
  renderTools();
  renderClock();
  document.querySelectorAll('[data-ftab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.ftab === fui.tab)));
  document.querySelectorAll('[data-fpanel]').forEach((p) => p.classList.toggle('active', p.dataset.fpanel === fui.tab));
  renderOrders();
  renderForces();
  renderFrontLog();
  fui.hooks.syncAmbient?.();
  drawFront();
}

function used(tool) {
  const f = fui.front, s = fui.side;
  const mine = f.orders[s].filter((v) => !v.pocket);
  if (tool === 'infantry' || tool === 'retreat') return [mine.length, f.cfg.maxVectors];
  if (tool === 'armor') {
    const alive = f.armor.filter((a) => a.side === s && !a.lost);
    return [alive.filter((a) => a.target).length, alive.length + 1, !alive.length];
  }
  if (tool === 'line') return [f.lines[s].filter((l) => l.day === f.day).length, f.cfg.maxLines, f.lines[s].length >= 4];
  if (tool === 'barrage') {
    const able = f.guns.filter((g) => g.side === s && gunPower(g) > 0).length;
    return [f.barrages[s].length, able];
  }
  return [0, Infinity, f.reserve[s] < 1];
}

function renderTools() {
  const f = fui.front;
  const bar = byId('f-tools');
  bar.hidden = f.phase !== 'plan';
  if (bar.hidden) return;
  for (const b of bar.querySelectorAll('[data-tool]')) {
    const t = b.dataset.tool;
    const [n, max, full] = used(t);
    b.setAttribute('aria-pressed', String(fui.tool === t));
    b.disabled = (n >= max || full) && fui.tool !== t;
    const left = max === Infinity ? fmtMen(men(f.reserve[fui.side])).replace(' h', '') : `${max - n}`;
    b.querySelector('.tool-n').textContent = left;
  }
}

// Chantier de ligne de défense : avancement des ouvrages et, le matin, choix de leur niveau.
function lineItem(f, l, planning) {
  const mine = l.cells.filter((i) => f.owner[i] === l.side);
  const avg = (arr) => (mine.length ? Math.round((mine.reduce((a, i) => a + arr[i], 0) / mine.length) * 100) : 0);
  const prog = [`tranchées ${avg(f.entrench)} %`, l.level >= 2 ? `barbelés ${avg(f.wire)} %` : '', l.level >= 3 ? `antichar ${avg(f.at)} %` : ''].filter(Boolean).join(' · ');
  const since = l.day < f.day ? ` · chantier du jour ${l.day}` : '';
  const seg = planning ? `<div class="seg" role="group" aria-label="Ouvrages de la ligne">${[[1, 'Tranchées'], [2, '+ Barbelés'], [3, '+ Antichar']].map(([k, lab]) => `<button class="btn btn-sm ${l.level === k ? 'on' : ''}" data-line="${l.id}" data-level="${k}">${lab}</button>`).join('')}</div>` : '';
  return `<li class="f-order f-line"><span><b>Ligne de défense</b> <em>${l.cells.length} cases · ${prog}${since}</em></span>${planning ? `<button class="btn btn-sm btn-x" data-remove="${l.id}" aria-label="Retirer : ligne de défense">✕</button>` : ''}${seg}</li>`;
}

function orderLine(label, detail, id) {
  return `<li class="f-order"><span><b>${label}</b>${detail ? ` <em>${detail}</em>` : ''}</span>${id != null ? `<button class="btn btn-sm btn-x" data-remove="${id}" aria-label="Retirer : ${label}">✕</button>` : ''}</li>`;
}

function renderOrders() {
  const f = fui.front, s = fui.side;
  const el = byId('f-orders');
  const planning = f.phase === 'plan';
  const vecs = f.orders[s].filter((v) => !v.pocket);
  const items = [
    ...vecs.map((v) => orderLine(VECTOR_TYPES[v.type].label, `≈ ${fmtMen(men(vectorCatchment(f, v)))}`, planning ? v.id : null)),
    ...f.lines[s].map((l) => lineItem(f, l, planning)),
    ...f.barrages[s].map((b) => orderLine('Barrage', f.guns.find((g) => g.id === b.gun)?.name ?? '', planning ? b.id : null)),
  ];
  const guns = f.guns.filter((g) => g.side === s);
  const armor = f.armor.filter((a) => a.side === s);
  const deployed = f.deployments[s].reduce((a, d) => a + d.amount, 0);
  const pockets = bigPockets(f, s);
  const canRepeat = planning && f.lastOrders[s].length > 0 && !vecs.length;
  el.innerHTML = `
    <p class="eyebrow">${planning ? `Ordres du jour ${f.day}` : f.phase === 'resolve' ? 'Ordres en cours d\'exécution' : 'Bataille terminée'}</p>
    ${items.length ? `<ul class="f-orders">${items.join('')}</ul>` : `<p class="muted">${planning ? 'Aucun ordre : vos troupes tiennent et colmatent les brèches d\'elles-mêmes.' : f.phase === 'over' ? 'Le brouillard est levé : la carte montre les forces réelles des deux camps.' : 'Défense élastique sur tout le front.'}</p>`}
    ${planning ? `
      <div class="orders">
        ${canRepeat ? '<button class="btn btn-sm" id="f-repeat">Reprendre les ordres de la veille</button>' : ''}
        ${deployed ? `<button class="btn btn-sm" id="f-undo">Annuler le dernier renfort</button>` : ''}
      </div>
      <p class="muted small">Réserves : ${fmtMen(men(f.reserve[s]))}${deployed ? ` · ${fmtMen(men(deployed))} montés en ligne ce matin` : ''}.</p>` : ''}
    ${armor.length ? `<h3 class="f-sub f-sub-art">Blindés</h3><ul class="f-guns">${armor.map((a) => armorItem(f, a, planning)).join('')}</ul>` : ''}
    ${guns.length ? `<h3 class="f-sub f-sub-art">Artillerie</h3><ul class="f-guns">${guns.map((g) => gunItem(f, g, planning)).join('')}</ul>` : ''}
    ${pockets.length ? `<h3 class="f-sub">Troupes encerclées</h3><ul class="f-pockets">${pockets.map((p) => `
      <li>
        <p><b>Poche ${escHtml(pocketName(f, p))}</b> · ${fmtMen(men(p.troops))} · ${POCKET_MODES[p.mode]}</p>
        ${planning ? `<div class="seg" role="group" aria-label="Comportement de la poche">${Object.entries({ hold: 'Statu quo', festung: 'Festung', breakout: 'Percée' }).map(([m, l]) => `<button class="btn btn-sm ${p.mode === m || (m === 'breakout' && fui.breakout === p.id) ? 'on' : ''}" data-pocket="${p.id}" data-mode="${m}">${l}</button>`).join('')}</div>` : ''}
      </li>`).join('')}</ul>` : ''}`;
  el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => removeMine(Number(b.dataset.remove))));
  el.querySelectorAll('[data-line]').forEach((b) => b.addEventListener('click', () => { const r = setLineLevel(f, s, Number(b.dataset.line), Number(b.dataset.level)); if (!fail(r)) placed(`Ligne de défense : ${['', 'tranchées seules (un jour)', 'tranchées et barbelés (deux jours)', 'tranchées, barbelés et obstacles antichar (trois jours)'][r.level]}.`); refreshFront(); }));
  el.querySelectorAll('[data-armor-sel]').forEach((b) => b.addEventListener('click', () => (fui.armor === Number(b.dataset.armorSel) ? cancelTool() : selectArmor(Number(b.dataset.armorSel)))));
  el.querySelectorAll('[data-armor-halt]').forEach((b) => b.addEventListener('click', () => { const r = setArmorOrder(f, s, Number(b.dataset.armorHalt), null); if (!fail(r)) placed(`${r.name} : halte, elle tient sa position.`); refreshFront(); }));
  el.querySelectorAll('[data-gun-sel]').forEach((b) => b.addEventListener('click', () => (fui.gun === Number(b.dataset.gunSel) ? cancelTool() : selectGun(Number(b.dataset.gunSel)))));
  el.querySelectorAll('[data-gun]').forEach((b) => b.addEventListener('click', () => gunPosture(Number(b.dataset.gun), b.dataset.posture)));
  el.querySelectorAll('[data-pocket]').forEach((b) => b.addEventListener('click', () => pocketMode(Number(b.dataset.pocket), b.dataset.mode)));
  byId('f-repeat')?.addEventListener('click', repeatYesterday);
  byId('f-undo')?.addEventListener('click', undoReserve);
  byId('f-tab-orders').classList.toggle('badge', planning && pockets.length > 0);
  byId('f-collapse').classList.toggle('badge', planning && pockets.length > 0);
}

// Une formation blindée dans le panneau : chars, expérience, carburant, état ; le matin, halte.
function armorItem(f, a, planning) {
  if (a.lost) return `<li class="f-gun lost"><p><b>${escHtml(a.name)}</b> · détruite</p></li>`;
  const state = a.attacking ? 'à l\'attaque' : a.target ? (planning ? 'objectif fixé' : 'en marche') : 'en réserve';
  const sel = fui.armor === a.id;
  return `<li class="f-gun${sel ? ' sel' : ''}">
    <p><button class="linkish" data-armor-sel="${a.id}" aria-pressed="${sel}"><b>${escHtml(a.name)}</b></button> · ${Math.round(a.tanks)} chars · ${expLabel(a.exp)} · carburant ${Math.round(a.fuel * 100)} % · <em>${state}</em></p>
    ${planning && a.target ? `<div class="seg"><button class="btn btn-sm" data-armor-halt="${a.id}">Halte</button></div>` : ''}
  </li>`;
}

// Un groupe d'artillerie dans le panneau : nom, état, mission ; le matin, sa posture.
function gunItem(f, g, planning) {
  if (g.lost) return `<li class="f-gun lost"><p><b>${escHtml(g.name)}</b> · perdu</p></li>`;
  const mission = f.barrages[g.side].some((b) => b.gun === g.id);
  const state = gunPower(g) <= 0 ? 'en route, ne tire pas' : mission ? 'barrage au lever du jour' : 'appui défensif';
  const sel = fui.gun === g.id;
  return `<li class="f-gun${sel ? ' sel' : ''}">
    <p><button class="linkish" data-gun-sel="${g.id}" aria-pressed="${sel}"><b>${escHtml(g.name)}</b></button> · ${GUN_KINDS[g.kind].short} · ${Math.round(g.str * 100)} % · <em>${state}</em></p>
    ${planning ? `<div class="seg" role="group" aria-label="Posture de ${escHtml(g.name)}">${Object.entries(GUN_POSTURES).map(([k, P]) => `<button class="btn btn-sm ${g.posture === k ? 'on' : ''}" data-gun="${g.id}" data-posture="${k}" ${k !== 'battery' && !g.dest ? 'disabled title="Touchez d\'abord le groupe puis sa destination"' : ''}>${P.label}</button>`).join('')}</div>` : ''}
  </li>`;
}

function fstat(label, value) { return `<div class="stat"><dt>${label}</dt><dd>${value}</dd></div>`; }

function renderForces() {
  const f = fui.front, s = fui.side;
  const lost = men(f.stats.losses[s]);
  byId('f-forces').innerHTML = `
    <p class="eyebrow">${SIDE_NAME[s]} · ${f.attacker === s ? 'attaque' : 'défense'}</p>
    <dl class="stats">
      ${fstat('En ligne', fmtMen(men(troops(f, s))))}
      ${fstat('Réserves', fmtMen(men(f.reserve[s])))}
      ${fstat('Pertes', fmtMen(lost))}
      ${fstat('Terrain', `${Math.round(territory(f, s) * 100)} %`)}
      ${fstat('Villes', townsHeld(f, s))}
      ${fstat('Score', `≈ ${signed(scoreBreakdown(f).total)}`)}
    </dl>
    <p class="muted">Issue en vue : <b>${GRADES[scoreBreakdown(f).grade].label.toLowerCase()}</b> (score de l'offensive ${f.attacker === s ? 'que vous menez' : 'ennemie'}).</p>
    <h3 class="f-sub f-sub-art">Vos objectifs secondaires</h3>
    ${objectivesHtml(f, s)}
    <p class="muted small">${goalText(f)}</p>
    <p class="muted small">En face (estimation) : ${menRange(enemyEstimate(f), 0.8, 1.4)} repérés.</p>`;
}

// Le journal n'affiche pas le bilan chiffré du moteur (il révèle les pertes ennemies exactes).
function renderFrontLog() {
  const f = fui.front;
  const days = new Map();
  for (const e of f.log) {
    if (e.kind === 'report' || e.kind === 'day') continue;
    if (!days.has(e.day)) days.set(e.day, []);
    days.get(e.day).push(e);
  }
  byId('f-log').innerHTML = [...days].reverse().map(([d, list]) => `
    <li class="log-turn">Jour ${Math.min(d, f.cfg.days)}</li>
    ${list.map((e) => `<li class="log-${e.kind === 'result' ? 'result' : e.kind === 'town' ? 'destroy' : 'info'} ${e.side == null ? '' : e.side === fui.side ? 'mine' : 'theirs'}">${escHtml(e.text)}</li>`).join('')}`).join('')
    || '<li class="log-dig">Rien à signaler pour l\'instant.</li>';
}

// ---------- Entrées ----------

function bind() {
  fui.bound = true;
  fui.r = new FrontRenderer(byId('f-map'));
  fui.weather = new WeatherLayer(byId('f-weather'));
  const canvas = byId('f-map');
  const r = fui.r;
  const pts = new Map();
  let gesture = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) gesture = { x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, pinch: false };
    else if (gesture) gesture.pinch = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === 'mouse' && fui.front?.phase === 'plan' && (fui.tool || fui.pending)) {
        const p = r.pointAt(e.clientX, e.clientY);
        fui.hoverPoint = { x: p.x, y: p.y };
        queueFrontDraw();
      }
      return;
    }
    if (pts.size === 1) {
      if (!gesture.moved && Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0) > 8) gesture.moved = true;
      if (gesture.moved) r.pan(e.clientX - prev.x, e.clientY - prev.y);
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const o = a === prev ? b : a;
      const d0 = Math.hypot(prev.x - o.x, prev.y - o.y), d1 = Math.hypot(e.clientX - o.x, e.clientY - o.y);
      const m = r.local((e.clientX + o.x) / 2, (e.clientY + o.y) / 2);
      if (d0 > 0) r.zoomAt(d1 / d0, m.x, m.y);
      r.pan((e.clientX - prev.x) / 2, (e.clientY - prev.y) / 2);
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    queueFrontDraw();
  });
  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size === 0 && gesture && !gesture.moved && !gesture.pinch && e.type === 'pointerup' && performance.now() - gesture.t0 < 600) onTap(r.pointAt(e.clientX, e.clientY));
    if (pts.size === 0) gesture = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { fui.hoverPoint = null; queueFrontDraw(); } });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const m = r.local(e.clientX, e.clientY);
    r.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), m.x, m.y);
    queueFrontDraw();
  }, { passive: false });
  canvas.addEventListener('gesturestart', (e) => e.preventDefault());
  const zoom = (k) => { r.zoomAt(k, r.vw / 2, r.vh / 2); queueFrontDraw(); };
  byId('f-collapse').addEventListener('click', () => setCollapsed(!byId('f-side').classList.contains('collapsed')));
  setCollapsed(storedCollapsed());
  byId('f-zoom-fit').addEventListener('click', () => { r.fitAll(); queueFrontDraw(); });
  byId('f-sound').addEventListener('click', () => fui.hooks.toggleSound?.());
  document.querySelectorAll('#f-tools [data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  byId('f-go').addEventListener('click', launchDay);
  byId('f-skip').addEventListener('click', () => { fui.skip = true; renderClock(); });
  byId('f-help').addEventListener('click', showHelp);
  byId('f-menu').addEventListener('click', () => fui.hooks.showMenu());
  document.querySelectorAll('[data-ftab]').forEach((b) => b.addEventListener('click', () => {
    // En portrait, toucher l'onglet déjà ouvert replie le tiroir.
    setCollapsed(fui.tab === b.dataset.ftab && !byId('f-side').classList.contains('collapsed'));
    fui.tab = b.dataset.ftab;
    refreshFront();
  }));
  window.addEventListener('keydown', (e) => {
    if (!frontActive() || !byId('overlay').hidden || e.target.tagName === 'INPUT') return;
    const keys = { 1: 'infantry', 2: 'armor', 3: 'retreat', 4: 'line', 5: 'barrage', 6: 'reserve' };
    if (keys[e.key]) setTool(keys[e.key]);
    else if (e.key === 'Escape') cancelTool();
    else if (e.key === 'Enter') { if (fui.front.phase === 'resolve') fui.skip = true; else launchDay(); }
    else if (e.key === 'u' || e.key === 'U') undoReserve();
    else if (e.key === 'p' || e.key === 'P') byId('f-collapse').click();
    else if (e.key === '+' || e.key === '=') zoom(1.35);
    else if (e.key === '-') zoom(1 / 1.35);
    else if (e.key === '0') { r.fitAll(); queueFrontDraw(); }
  });
  new ResizeObserver(() => {
    if (!frontActive()) return;
    fui.weather.resize();
    // Le panneau se replie ou se déplie : la carte garde le même centre (ou reste cadrée en entier si elle l'était) ;
    // Si la carte couvrait tout l'écran, elle le couvre encore (pas de bandes vides en dépliant la vue).
    const c = r.cam, fit = r.worldW && c.s <= r.fitScale() * 1.001;
    const cover = () => Math.max(r.vw / r.worldW, r.vh / r.worldH);
    const covered = r.worldW && c.s >= cover() * 0.999;
    const mx = c.x + r.vw / 2 / c.s, my = c.y + r.vh / 2 / c.s;
    r.resize();
    if (fit) r.fitAll();
    else {
      if (covered) c.s = Math.max(c.s, cover());
      c.x = mx - r.vw / 2 / c.s;
      c.y = my - r.vh / 2 / c.s;
      r.clampCam();
    }
    drawFront();
  }).observe(canvas.parentElement);
}

window.frontlineFront = fui; // accès console pour le débogage

