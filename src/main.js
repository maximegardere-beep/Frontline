// Contrôleur : menus, phases de déploiement / planification, animation de l'exécution, campagne.

import { Renderer, HEX, splineAt } from './render.js';
import { createBattle, executeTurn, onMap, active, unitAt, canDeployAt, updateVisibility, HOLD_TO_WIN } from './game.js';
import { planSide, DIRECTIVES } from './ai.js';
import { buildCombatFx } from './fx.js';
import { sound } from './audio.js';
import { createRng } from './rng.js';
import { reachable, pathFrom, hexKey, pathCost } from './path.js';
import { unitStats, UNIT_TYPES, LEVELS, SIDES, other, hpState, resetIds, XP_FOR_LEVEL } from './units.js';
import { tileAt, describeTile, terrainDefense } from './terrain.js';
import { hexDistance, hexToPixel, sameHex } from './hex.js';
import { newCampaign, battleSetup, concludeBattle, campaignOver, campaignVerdict, CAMPAIGN_LENGTH, KIND_LABELS } from './campaign.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'frontline.campaign.v1';
const touchUI = window.matchMedia?.('(hover: none)').matches;
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const ui = {
  campaign: null,
  setup: null,
  state: null,
  renderer: new Renderer($('map')),
  selectedId: null,
  mode: 'move',
  hover: null,
  anim: null,
  animVisible: null,
  fx: null,
  busy: false,
  tab: 'unit',
  preview: null,
  // Mode directives : le joueur fixe des intentions (attaquer, défendre, se replier), l'état-major en tire les ordres.
  command: false,
  directives: [],
  dirTool: null,
  manual: new Set(),
  assignment: null,
};

const MAX_DIRECTIVES = 3;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const player = () => ui.campaign.playerSide;

// ---------- Sauvegarde ----------

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(ui.campaign)); } catch { /* stockage indisponible */ }
}
function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null'); } catch { return null; }
}
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* rien */ }
}

// ---------- Dossiers (menu, briefing, débriefing) ----------

function showDossier(html, bind) {
  $('dossier').innerHTML = html;
  $('overlay').hidden = false;
  $('dossier').scrollTop = 0;
  bind?.();
  syncAmbient();
}
function hideDossier() { $('overlay').hidden = true; syncAmbient(); }

// Fond sonore (vent, canonnade lointaine) seulement sur le champ de bataille, pas derrière les menus.
function syncAmbient() {
  sound.ambient(!!ui.inGame && $('overlay').hidden && ui.state?.phase !== 'over');
}

const FACTION_TEXT = {
  DE: 'Moins nombreux, mieux entraînés. Blindés plus meurtriers, reconnaissance plus rapide, davantage de vétérans.',
  SU: 'La masse et le feu. Bataillons de fusiliers plus résistants, artillerie plus lourde, effectifs supérieurs.',
};

function showMenu() {
  const saved = loadSave();
  const seed = Math.random().toString(36).slice(2, 7).toUpperCase();
  showDossier(`
    <p class="eyebrow">Front de l'Est · été 1943</p>
    <h1 class="title-xl">Frontline</h1>
    <p class="lede">Vous commandez un groupement tactique pendant cinq batailles, sur des cartes à chaque fois différentes. Tracez votre plan, anticipez celui de l'adversaire, puis regardez-le se dérouler sans pouvoir intervenir.</p>
    <div class="factions">
      ${['DE', 'SU'].map((s) => `
        <button class="faction faction-${s}" data-side="${s}">
          <span class="faction-flag"></span>
          <span class="faction-name">${SIDES[s].name}</span>
          <span class="faction-country">${SIDES[s].country} · ${s === 'DE' ? 'attaque depuis l\'ouest' : 'tient l\'est'}</span>
          <span class="faction-text">${FACTION_TEXT[s]}</span>
        </button>`).join('')}
    </div>
    <div class="row-between">
      <label class="seed" for="seed">Graine de campagne <input id="seed" value="${seed}" maxlength="12" autocomplete="off"></label>
      ${ui.inGame ? '<button class="btn btn-primary" id="back">Retour à la bataille</button>' : ''}
      ${!ui.inGame && saved && !campaignOver(saved) ? `<button class="btn" id="resume">Reprendre (${SIDES[saved.playerSide].name}, bataille ${saved.index + 1}/${CAMPAIGN_LENGTH})</button>` : ''}
    </div>
    ${rulesHtml()}
  `, () => {
    document.querySelectorAll('.faction').forEach((b) => b.addEventListener('click', () => {
      const s = $('seed').value.trim() || seed;
      resetIds();
      ui.campaign = newCampaign(b.dataset.side, s);
      save();
      showBriefing();
    }));
    $('back')?.addEventListener('click', hideDossier);
    $('resume')?.addEventListener('click', () => {
      ui.campaign = saved;
      const maxId = Math.max(0, ...saved.army.map((u) => Number(u.id.slice(2)) || 0));
      resetIds(maxId + 1000);
      showBriefing();
    });
  });
}

function rulesHtml() {
  return `
    <details class="rules">
      <summary>Comment jouer</summary>
      <ol>
        <li><b>Déploiement.</b> Placez vos unités dans les trois colonnes de votre bord de carte. La colonne extrême est votre zone de repli.</li>
        <li><b>Plan.</b> Sélectionnez une unité, puis cliquez un hexagone éclairé pour tracer son mouvement. <kbd>E</kbd> : se retrancher (seulement sans bouger). <kbd>B</kbd> : barrage d'artillerie sur un hexagone, même invisible. L'adversaire planifie en même temps que vous.</li>
        <li><b>Exécution.</b> Tous les mouvements sont simultanés. Une unité qui arrive au contact d'un ennemi s'arrête. Puis chacun tire : dés d6, touche sur 4+ modifié par le couvert, le relief, le retranchement, le mouvement et le blindage. Un 6 inflige 2 dégâts.</li>
        <li><b>Directives.</b> Le drapeau à droite de la carte (<kbd>D</kbd>) active le mode directives : placez jusqu'à ${MAX_DIRECTIVES} intentions (attaquer, défendre, se replier) et l'état-major répartit vos unités et rédige leurs ordres à chaque tour. Un ordre donné à la main prime pour le tour. « Contrôle direct » rend la main en gardant le plan en cours.</li>
        <li><b>Clouage.</b> Une unité qui encaisse 2 touches dans le tour (3 si retranchée) ou un barrage d'artillerie est clouée : au tour suivant elle ne bouge pas et tire à −1. Les blindés ne sont immobilisés que par un 6 d'une arme qui perce. Le marqueur jaune sur le pion le signale.</li>
        <li><b>Moral.</b> Une unité très éprouvée, ou qui voit une unité voisine anéantie, teste son moral (d6 + niveau ≥ 5) : +1 retranchée, +1 à couvert, +1 si un voisin est retranché, −1 isolée (aucun allié à 2 hex), −1 prise en tenaille (feu venu de côtés opposés). En cas d'échec elle se débande et fuit vers sa zone de repli.</li>
        <li><b>Victoire.</b> Détruire ou mettre en déroute toutes les unités ennemies ; ou, sur les cartes à objectif, tenir la position étoilée ${HOLD_TO_WIN} tours sans ennemi au contact. Après 12 tours, le détenteur de l'objectif ou le camp le moins éprouvé l'emporte.</li>
        <li><b>Campagne.</b> Les survivants gagnent de l'expérience (Recrue → Vétéran → Élite) et sont rejoints par des renforts.</li>
      </ol>
    </details>`;
}

function intelReport(state) {
  const foe = other(player());
  const enemies = state.units.filter((u) => u.side === foe);
  const hasRecon = state.units.some((u) => u.side === player() && u.type === 'recon');
  if (!hasRecon) return `Sans reconnaissance, l'état-major estime l'ennemi à environ ${enemies.length + (state.rng.chance(0.5) ? 1 : -1)} unités.`;
  const counts = {};
  for (const u of enemies) counts[u.type] = (counts[u.type] ?? 0) + 1;
  return `Vos éclaireurs signalent : ${Object.entries(counts).map(([t, n]) => `${n} × ${UNIT_TYPES[t].label.toLowerCase()}`).join(', ')}.`;
}

function showBriefing() {
  const c = ui.campaign;
  ui.inGame = true;
  ui.setup = battleSetup(c);
  ui.state = createBattle({ seed: ui.setup.seed, playerSide: c.playerSide, armies: ui.setup.armies, kind: ui.setup.kind });
  ui.reopenReport = null;
  ui.directives = [];
  ui.dirTool = null;
  ui.manual = new Set();
  ui.assignment = null;
  ui.staffRng = createRng(`staff:${ui.setup.seed}`);
  ui.renderer.setMap(ui.state.map);
  ui.renderer.initialView(c.playerSide);
  ui.selectedId = null;
  const s = ui.state;
  const goals = [
    'Détruire ou mettre en déroute toutes les unités ennemies.',
    s.objective ? `Tenir ${esc(tileAt(s.map, s.objective.col, s.objective.row).name ?? 'la cote')} (★) pendant ${HOLD_TO_WIN} tours, sans ennemi au contact.` : null,
    `Limite : ${s.maxTurns} tours.`,
  ].filter(Boolean);
  refresh();
  showDossier(`
    <p class="eyebrow">Bataille ${c.index + 1} / ${CAMPAIGN_LENGTH} · ${esc(ui.setup.date)}</p>
    <h1 class="title-l">${esc(s.title)}</h1>
    <p class="kind">${KIND_LABELS[s.kind]}</p>
    <div class="brief-grid">
      <section>
        <h2>Objectifs</h2>
        <ul class="ticks">${goals.map((g) => `<li>${g}</li>`).join('')}</ul>
        <h2>Renseignements</h2>
        <p>${esc(intelReport(s))}</p>
      </section>
      <section>
        <h2>Vos forces</h2>
        <ul class="roster">${c.army.map((u) => `<li><span class="chip chip-${u.type}">${UNIT_TYPES[u.type].label}</span> ${esc(u.name)} <em>${LEVELS[u.level]}</em></li>`).join('')}</ul>
      </section>
    </div>
    <div class="row-end"><button class="btn btn-primary" id="go-deploy">Déployer les troupes</button></div>
  `, () => $('go-deploy').addEventListener('click', () => { hideDossier(); refresh(); }));
}

function showDebrief() {
  const c = ui.campaign;
  const s = ui.state;
  const won = s.result.winner === c.playerSide;
  const draw = !s.result.winner;
  const report = concludeBattle(c, s);
  const over = campaignOver(c);
  if (over) clearSave(); else save();
  const verdict = over ? campaignVerdict(c) : null;
  ui.reopenReport = () => showDossier(`
    <p class="eyebrow">Rapport après action · ${esc(report.title)}</p>
    <h1 class="title-l ${won ? 'win' : draw ? '' : 'loss'}">${won ? 'Victoire' : draw ? 'Indécis' : 'Défaite'}</h1>
    <p class="lede">${esc(report.reason)}</p>
    <div class="brief-grid">
      <section>
        <h2>Pertes</h2>
        <p>${report.lost.length ? report.lost.map(esc).join(', ') : 'Aucune unité perdue.'}</p>
        <h2>Promotions</h2>
        <p>${report.promoted.length ? report.promoted.map(esc).join(', ') : 'Aucune.'}</p>
      </section>
      <section>
        <h2>Renforts</h2>
        <p>${report.reinforcements.length ? report.reinforcements.map(esc).join(', ') : 'Aucun.'}</p>
        <h2>Campagne</h2>
        <p class="campaign-track">${c.results.map((r) => `<span class="pip ${r.won ? 'win' : r.draw ? 'draw' : 'loss'}" title="${esc(r.title)}"></span>`).join('')}${'<span class="pip"></span>'.repeat(Math.max(0, CAMPAIGN_LENGTH - c.results.length))}</p>
      </section>
    </div>
    ${verdict ? `<div class="verdict"><h2>${esc(verdict.title)}</h2><p>${esc(verdict.text)}</p></div>` : ''}
    <div class="row-end">
      ${over ? '<button class="btn btn-primary" id="to-menu">Nouvelle campagne</button>' : '<button class="btn btn-ghost" id="see-map">Revoir la carte</button><button class="btn btn-primary" id="next">Bataille suivante</button>'}
    </div>
  `, () => {
    $('to-menu')?.addEventListener('click', () => { ui.inGame = false; showMenu(); });
    $('next')?.addEventListener('click', showBriefing);
    $('see-map')?.addEventListener('click', () => { hideDossier(); refresh(); });
  });
  ui.reopenReport();
}

// ---------- Interaction avec la carte ----------

function selected() {
  return ui.state?.units.find((u) => u.id === ui.selectedId) ?? null;
}

// Mémoïsé : la carte est redessinée à chaque image pendant un glissement.
function playerReach(u) {
  const s = ui.state;
  const key = `${u.id}:${u.col},${u.row}:${s.turn}:${s.phase}:${s.visibility[player()].units.size}`;
  if (ui.reachMemo?.key === key) return ui.reachMemo.reach;
  const reach = computeReach(u);
  ui.reachMemo = { key, reach, keys: new Set(reach.keys()) };
  return reach;
}

function computeReach(u) {
  const s = ui.state;
  const vis = s.visibility[player()];
  const blocked = new Set(s.units.filter((e) => e.side !== u.side && onMap(e) && vis.units.has(e.id)).map((e) => hexKey(s.map, e)));
  return reachable(s.map, u, { blocked });
}

function select(u, { focus = false } = {}) {
  ui.selectedId = u?.id ?? null;
  ui.mode = 'move';
  ui.preview = null;
  if (u) { ui.tab = 'unit'; sound.ui('select'); }
  if (u && focus) ui.renderer.focus(u);
  refresh();
}

function onMapClick(ev) {
  const s = ui.state;
  if (!s || ui.busy || !$('overlay').hidden) return;
  const h = ui.renderer.hexAt(ev.clientX, ev.clientY);
  if (!h) return;
  showTileInfo(h);
  if (ui.command && ui.dirTool && (s.phase === 'plan' || s.phase === 'deploy')) return placeDirective(h);
  const here = unitAt(s, h);
  const sel = selected();

  if (s.phase === 'deploy') {
    if (here && here.side === player()) return select(here.id === ui.selectedId ? null : here);
    if (sel && canDeployAt(s, player(), h)) {
      sel.col = h.col;
      sel.row = h.row;
      sound.ui('order');
      updateVisibility(s);
      refresh();
    }
    return;
  }
  if (s.phase !== 'plan') return;

  if (sel && ui.mode === 'barrage') {
    const st = unitStats(sel);
    const d = hexDistance(sel, h);
    if (d >= st.minRange && d <= st.range) {
      sel.orders.fireAt = sameHex(sel.orders.fireAt, h) ? null : { col: h.col, row: h.row };
      sel.orders.path = [];
      ui.mode = 'move';
      takeOver(sel);
      return refresh();
    }
  }
  // Une unité amie qui a déjà un ordre de mouvement libérera sa case : on peut la viser.
  const leaving = here && here.side === player() && here.orders.path.length > 0;
  if (here && here.side === player() && here.status === 'ok' && here !== sel && !(sel && leaving && ui.mode === 'move')) return select(here);
  if (sel && sel.status === 'ok' && !sel.pinned) {
    if (sameHex(sel, h)) { sel.orders.path = []; takeOver(sel); return refresh(); }
    const reach = playerReach(sel);
    if (reach.has(hexKey(s.map, h))) {
      if (here && !leaving) return;
      sel.orders.path = pathFrom(s.map, reach, h);
      sel.orders.entrench = false;
      sel.orders.fireAt = null;
      ui.preview = null;
      takeOver(sel);
      return refresh();
    }
  }
  if (here && here.side !== player()) { ui.selectedId = here.id; ui.tab = 'unit'; return refresh(); }
  select(null);
}

function showTileInfo(h) {
  const t = h && tileAt(ui.state.map, h.col, h.row);
  const d = t && terrainDefense(t);
  const tool = ui.command && ui.dirTool ? `${DIRECTIVES[ui.dirTool].label} → ` : '';
  $('hint').textContent = t ? `${tool}${describeTile(t)}${d ? ` · défense ${d > 0 ? '+' : ''}${d}` : ''}` : '';
  $('hint').hidden = !t;
}

// Survol à la souris : surlignage et aperçu du trajet que prendrait l'unité sélectionnée.
function onMapHover(ev) {
  if (!ui.state || ui.busy) return;
  const h = ui.renderer.hexAt(ev.clientX, ev.clientY);
  if (sameHex(h, ui.hover)) return;
  ui.hover = h;
  showTileInfo(h);
  ui.preview = null;
  const sel = selected();
  if (h && sel && sel.side === player() && sel.status === 'ok' && !sel.pinned && ui.state.phase === 'plan' && ui.mode === 'move' && !sameHex(h, sel)) {
    const reach = playerReach(sel);
    if (reach.has(hexKey(ui.state.map, h))) ui.preview = { unit: sel, path: pathFrom(ui.state.map, reach, h) };
  }
  scheduleDraw();
}

function setOrder(kind) {
  const u = selected();
  if (!u || u.side !== player() || u.status !== 'ok' || ui.state.phase !== 'plan') return;
  if (kind === 'entrench') {
    u.orders.entrench = !u.orders.entrench;
    if (u.orders.entrench) u.orders.path = [];
    takeOver(u);
  } else if (kind === 'hold') {
    u.orders = { path: [], entrench: false, fireAt: null };
    takeOver(u);
  } else if (kind === 'staff') {
    ui.manual.delete(u.id);
    staffPlan();
  } else if (kind === 'barrage' && u.type === 'artillery') {
    ui.mode = ui.mode === 'barrage' ? 'move' : 'barrage';
  } else if (kind === 'move') ui.mode = 'move';
  refresh();
}

// ---------- Mode directives ----------

// L'état-major répartit les unités entre les directives et rédige leurs ordres ; les unités reprises en main gardent les leurs.
function staffPlan() {
  const s = ui.state;
  if (!ui.command || s?.phase !== 'plan') return;
  const mine = s.units.filter((u) => u.side === player() && active(u));
  for (const u of mine) if (!ui.manual.has(u.id)) u.orders = { path: [], entrench: false, fireAt: null };
  if (!ui.directives.length) { ui.assignment = null; return; }
  ui.assignment = planSide(s, player(), { directives: ui.directives, fixed: ui.manual, rng: ui.staffRng }).assignment;
}

// Un ordre donné à la main suspend la directive de cette unité jusqu'à la fin du tour.
function takeOver(u) {
  sound.ui('order');
  if (ui.command) ui.manual.add(u.id);
}

function placeDirective(h) {
  const i = ui.directives.findIndex((d) => sameHex(d, h));
  if (i >= 0 && ui.directives[i].kind === ui.dirTool) ui.directives.splice(i, 1);
  else if (i >= 0) ui.directives[i].kind = ui.dirTool;
  else {
    ui.directives.push({ kind: ui.dirTool, col: h.col, row: h.row });
    if (ui.directives.length > MAX_DIRECTIVES) ui.directives.shift();
  }
  ui.dirTool = null;
  staffPlan();
  refresh();
}

function setCommand(on) {
  ui.command = on;
  ui.dirTool = null;
  ui.manual = new Set();
  // En reprenant le contrôle direct, on garde les ordres rédigés par l'état-major : on peut les retoucher.
  if (on) staffPlan(); else ui.assignment = null;
  refresh();
}

function pickDirectiveTool(kind) {
  if (!ui.command) setCommand(true);
  ui.dirTool = ui.dirTool === kind ? null : kind;
  ui.selectedId = null;
  refresh();
}

function cycleUnit() {
  const mine = ui.state.units.filter((u) => u.side === player() && active(u));
  if (!mine.length) return;
  const i = mine.findIndex((u) => u.id === ui.selectedId);
  select(mine[(i + 1) % mine.length], { focus: true });
}

// ---------- Exécution animée ----------

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function tween(ms, fn) {
  return new Promise((res) => {
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      fn(k);
      if (k < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
}

async function endPhase() {
  const s = ui.state;
  if (!s || ui.busy) return;
  if (s.phase === 'over') return ui.reopenReport?.();
  if (s.phase === 'deploy') {
    s.phase = 'plan';
    s.log.push({ turn: 1, kind: 'info', text: 'Déploiement terminé. Tracez votre plan de bataille.' });
    ui.selectedId = null;
    staffPlan();
    return refresh();
  }
  if (s.phase !== 'plan') return;
  ui.busy = true;
  ui.selectedId = null;
  ui.mode = 'move';
  ui.dirTool = null;
  planSide(s, other(player()));
  const me = player();
  const visStart = new Set(s.visibility[me].units);
  const hpStart = Object.fromEntries(s.units.map((u) => [u.id, u.hp]));
  s.phase = 'execute';
  refresh();
  sound.ui('go');
  const res = executeTurn(s);
  const visEnd = s.visibility[me].units;
  ui.animVisible = new Set([...visStart, ...visEnd]);
  // Un tir direct trahit le tireur ; une batterie qui tire de loin reste invisible.
  for (const f of res.fires) {
    const a = s.units.find((u) => u.id === f.attacker);
    if (a.side !== me && !f.indirect) ui.animVisible.add(a.id);
  }
  // Mouvement continu : chaque unité glisse à vitesse constante le long d'une spline passant par ses positions successives.
  const ids = Object.keys(res.ticks[0]);
  const tracks = {};
  for (const id of ids) {
    const pts = [];
    let last = null;
    res.ticks.forEach((snap) => {
      const p = snap[id] ?? last;
      pts.push(hexToPixel(p.col, p.row, HEX));
      last = p;
    });
    tracks[id] = { pts, status: res.ticks[0][id].status, end: res.ticks[res.ticks.length - 1][id] };
  }
  const steps = res.ticks.length - 1;
  const tickMs = reduceMotion ? 60 : 330;
  const trails = {};
  if (steps > 0) {
    // Moteurs et pas des unités visibles qui se déplacent, situés au milieu de leur trajet.
    const moving = { tanks: [], foot: [] };
    for (const id of ids) {
      const pts = tracks[id].pts;
      const u = s.units.find((x) => x.id === id);
      if (!(u.side === me || ui.animVisible.has(id)) || pts.every((p) => p.x === pts[0].x && p.y === pts[0].y)) continue;
      (u.type === 'tank' ? moving.tanks : moving.foot).push(pts[pts.length >> 1]);
    }
    sound.movement(moving, (tickMs * steps) / 1000);
    await tween(tickMs * steps, (k) => {
      const u = k * steps;
      const pos = {};
      for (const id of ids) {
        const tr = tracks[id];
        const p = splineAt(tr.pts, u);
        const q = splineAt(tr.pts, Math.min(steps, u + 0.08));
        const vx = q.x - p.x, vy = q.y - p.y, sp = Math.hypot(vx, vy);
        pos[id] = { x: p.x, y: p.y, status: tr.status, heading: sp > 0.3 ? vx / sp : 0 };
        if (sp > 0.3) (trails[id] ??= []).push({ x: p.x, y: p.y });
        if (trails[id]?.length > 26) trails[id].shift();
      }
      ui.anim = { pos, hp: hpStart, trails };
      draw();
    });
  }
  // Ornières : les chenilles marquent durablement le terrain.
  for (const id of ids) {
    const u = s.units.find((x) => x.id === id);
    if (u.type === 'tank' && (u.side === me || ui.animVisible.has(id))) ui.renderer.stampTracks(tracks[id].pts);
  }
  const last = Object.fromEntries(ids.filter((id) => tracks[id].end).map((id) => {
    const p = tracks[id].pts[tracks[id].pts.length - 1];
    return [id, { x: p.x, y: p.y, status: tracks[id].end.status }];
  }));
  // Combat : tirs simultanés, puis traces laissées sur le terrain (cratères, épaves).
  const dead = new Set(res.events.filter((e) => e.kind === 'destroyed').map((e) => e.id));
  if (res.fires.length) {
    const lastShot = new Map();
    res.fires.forEach((f, i) => { if (f.target) lastShot.set(f.target, i); });
    const fires = res.fires.map((f, i) => {
      const a = s.units.find((u) => u.id === f.attacker);
      return {
        a: hexToPixel(f.from.col, f.from.row, HEX),
        b: hexToPixel(f.to.col, f.to.row, HEX),
        type: a.type,
        indirect: f.indirect,
        hidden: a.side !== me && !ui.animVisible.has(a.id),
        dice: f.rolls?.length ?? 3,
        hits: f.hits ?? 0,
        damage: f.damage ?? 0,
        empty: !!f.empty,
        kill: dead.has(f.target) && lastShot.get(f.target) === i,
      };
    });
    const seed = `fx:${s.seed}:${s.turn}`;
    const fx = buildCombatFx(fires, seed);
    const speed = reduceMotion ? 3 : 1;
    sound.combat(fx.sounds, speed);
    await tween((fx.duration / speed) * 1000, (k) => {
      const T = k * fx.duration;
      ui.fx = { fx, T };
      // Les PV baissent quand les premiers coups arrivent.
      ui.anim = { pos: last, hp: T > Math.min(0.6, fx.duration * 0.4) ? null : hpStart };
      draw();
    });
    ui.renderer.stampScars(fx, seed);
  }
  for (const id of dead) {
    const u = s.units.find((x) => x.id === id);
    const p = last[id] ?? hexToPixel(u.col, u.row, HEX);
    const r = createRng(`wreck:${id}:${s.turn}`);
    ui.renderer.addWreck({ x: p.x + (r.next() - 0.5) * 10, y: p.y + (r.next() - 0.5) * 8, type: u.type, side: u.side, rot: r.next() * Math.PI * 2, turn: s.turn, seed: `${id}` });
  }
  ui.anim = null;
  ui.fx = null;
  ui.animVisible = null;
  ui.busy = false;
  ui.manual = new Set();
  if (s.phase === 'execute') s.phase = 'plan';
  staffPlan();
  refresh();
  ambient();
  if (!s.result) sound.ui('bell');
  if (s.result) {
    await wait(reduceMotion ? 100 : 900);
    showDebrief();
  }
}

// ---------- Affichage ----------

// Les épaves fument encore : on anime doucement la carte (une douzaine d'images par seconde), sans plus.
let ambientOn = false;
function ambient() {
  if (ambientOn || reduceMotion) return;
  ambientOn = true;
  let lastT = 0;
  const step = (now) => {
    if (!ui.state || !ui.renderer.hasSmoke(ui.state.turn)) { ambientOn = false; return; }
    if (!ui.busy && now - lastT > 80 && document.visibilityState === 'visible') { lastT = now; draw(); }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let drawQueued = false;
function scheduleDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}

function draw() {
  const s = ui.state;
  if (!s) return;
  const sel = selected();
  const mine = sel && sel.side === player() && sel.status === 'ok';
  ui.renderer.draw({
    state: s,
    side: player(),
    selectedId: ui.selectedId,
    reach: !ui.anim && mine && !sel.pinned && s.phase === 'plan' && ui.mode === 'move' ? playerReach(sel) : null,
    reachKeys: ui.reachMemo?.keys,
    rangeOf: !ui.anim && mine && sel.type === 'artillery' && (ui.mode === 'barrage' || sel.orders.fireAt) ? sel : null,
    hover: ui.anim ? null : ui.hover,
    directives: ui.command && s.phase !== 'over' ? ui.directives : null,
    assignment: ui.assignment,
    shake: !reduceMotion,
    preview: ui.anim ? null : ui.preview,
    anim: ui.anim,
    animVisible: ui.animVisible,
    fx: ui.fx,
  });
}

const PHASE_LABEL = { deploy: 'Déploiement', plan: 'Plan de bataille', execute: 'Exécution', over: 'Terminée' };

function refresh() {
  const s = ui.state;
  if (!s) return;
  draw();
  $('battle-name').textContent = s.title;
  $('turn').textContent = `Tour ${Math.min(s.turn, s.maxTurns)} / ${s.maxTurns}`;
  $('phase').textContent = PHASE_LABEL[s.phase];
  $('phase').dataset.phase = s.phase;
  const go = $('btn-go');
  go.textContent = s.phase === 'deploy' ? 'Terminer le déploiement' : s.phase === 'execute' ? 'Exécution…' : s.phase === 'over' ? 'Rapport de bataille' : 'Exécuter le tour';
  go.disabled = ui.busy || s.phase === 'execute' || (s.phase === 'over' && !ui.reopenReport);
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)));
  document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('active', p.dataset.panel === ui.tab));
  renderObjective();
  renderDirectiveBar();
  renderUnitCard();
  renderArmy();
  renderLog();
  syncAmbient();
}

function renderObjective() {
  const s = ui.state;
  const el = $('objective');
  if (!s.objective) { el.hidden = true; return; }
  el.hidden = false;
  const o = s.objective;
  const name = tileAt(s.map, o.col, o.row).name ?? 'Objectif';
  el.innerHTML = `<span class="star">★</span> ${esc(name)} : ${o.owner ? `${SIDES[o.owner].name}${o.contested ? ', disputé' : ''} · ${o.hold}/${HOLD_TO_WIN}` : 'non tenu'}`;
}

function renderDirectiveBar() {
  const s = ui.state;
  $('cmd-toggle').setAttribute('aria-pressed', String(ui.command));
  $('directive-bar').hidden = !ui.command || s.phase === 'over';
  document.querySelectorAll('[data-dir]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dir === ui.dirTool)));
  $('dir-clear').disabled = !ui.directives.length;
  if (!ui.dirTool && $('hint').dataset.tool) { $('hint').hidden = true; delete $('hint').dataset.tool; }
  if (ui.dirTool) {
    $('hint').dataset.tool = '1';
    $('hint').textContent = `${touchUI ? 'Touchez' : 'Cliquez'} la carte pour placer « ${DIRECTIVES[ui.dirTool].label} » (${ui.directives.length}/${MAX_DIRECTIVES})`;
    $('hint').hidden = false;
  }
}

function statRow(label, value) {
  return `<div class="stat"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function orderSummary(u) {
  const o = u.orders;
  if (u.status === 'routed') return 'En déroute : fuit vers la zone de repli.';
  if (o.path.length) return `Se déplacer de ${o.path.length} hexagone${o.path.length > 1 ? 's' : ''} (${pathCost(ui.state.map, u, o.path) / 2} pts / ${unitStats(u).move}).`;
  const parts = [];
  if (o.fireAt) parts.push(`barrage sur ${describeTile(tileAt(ui.state.map, o.fireAt.col, o.fireAt.row)).split(' · ')[0].toLowerCase()} (${hexDistance(u, o.fireAt)} hex.)`);
  if (o.entrench) parts.push(u.entrench >= unitStats(u).entrenchMax ? 'tenir la position retranchée' : 'se retrancher');
  return parts.length ? parts.join(' et ').replace(/^./, (c) => c.toUpperCase()) + '.' : 'Tenir la position et tirer sur tout ennemi à portée.';
}

function renderUnitCard() {
  const s = ui.state;
  const u = selected();
  const el = $('unit-card');
  if (!u && ui.command && s.phase !== 'over') {
    const counts = ui.directives.map((d, i) => `<li><b>${DIRECTIVES[d.kind].label}</b> : ${[...(ui.assignment ?? new Map()).values()].filter((v) => v === i).length} unité(s)</li>`).join('');
    el.innerHTML = `
      <p class="eyebrow">Mode directives</p>
      ${ui.directives.length ? `<ul class="ticks">${counts}</ul>` : ''}
      <p class="muted">Choisissez <b>Attaquer</b>, <b>Défendre</b> ou <b>Repli</b>, puis ${touchUI ? 'touchez' : 'cliquez'} la carte (${MAX_DIRECTIVES} au plus). L'état-major répartit les unités et rédige leurs ordres à chaque tour. Un ordre donné à la main à une unité prime pour ce tour.</p>`;
    return;
  }
  if (!u) {
    el.innerHTML = s.phase === 'deploy'
      ? `<p class="muted">${touchUI ? 'Touchez' : 'Sélectionnez'} une unité, puis un emplacement libre dans la zone de déploiement (pointillés rouges).</p>`
      : touchUI
        ? '<p class="muted">Touchez une unité, puis sa destination dans la zone claire. Glissez pour déplacer la carte, pincez pour zoomer.</p>'
        : '<p class="muted">Sélectionnez une unité, puis sa destination dans la zone claire. <kbd>Tab</kbd> passe à l\'unité suivante, <kbd>Entrée</kbd> exécute le tour, molette pour zoomer.</p>';
    return;
  }
  if (u.side !== player()) {
    const m = s.memory[player()][u.id];
    el.innerHTML = `
      <p class="eyebrow enemy">Ennemi repéré</p>
      <h3>${UNIT_TYPES[u.type].label} ${SIDES[u.side].name === 'Wehrmacht' ? 'allemande' : 'soviétique'}</h3>
      <p class="muted">État apparent : ${m?.hpState ?? hpState(u)}${u.entrench ? ' · retranchée' : ''}${u.pinned ? ' · clouée' : ''}${u.status === 'routed' ? ' · en déroute' : ''}.</p>`;
    return;
  }
  const st = unitStats(u);
  const canAct = s.phase === 'plan' && u.status === 'ok';
  el.innerHTML = `
    <p class="eyebrow">${UNIT_TYPES[u.type].label} · ${LEVELS[u.level]}</p>
    <h3>${esc(u.name)}</h3>
    <dl class="stats">
      ${statRow('PV', `${u.hp}/${st.maxHp}`)}
      ${statRow('Mouvement', st.move)}
      ${statRow('Portée', st.minRange > 1 ? `${st.minRange}–${st.range}` : st.range)}
      ${statRow('Attaque', `${st.attack}d6`)}
      ${statRow('Vision', st.vision)}
      ${statRow('Retranch.', `${u.entrench}/${st.entrenchMax}`)}
      ${statRow('Expérience', u.level < 3 ? `${u.xp}/${XP_FOR_LEVEL[u.level + 1]}` : `${u.xp}`)}
    </dl>
    ${u.pinned && u.status === 'ok' ? `<p class="pinned-note">${unitStats(u).armored ? 'Immobilisée' : 'Clouée au sol'} : ne peut pas bouger ce tour, tir à −1.</p>` : ''}
    <p class="order">${esc(orderSummary(u))}</p>
    ${canAct && ui.command ? staffNote(u) : ''}
    ${canAct ? `
    <div class="orders">
      <button class="btn btn-sm ${ui.mode === 'move' && u.orders.path.length ? 'on' : ''}" data-order="move"${u.pinned ? ' disabled' : ''}>Déplacer</button>
      <button class="btn btn-sm ${u.orders.entrench ? 'on' : ''}" data-order="entrench" title="Raccourci : E">Retrancher</button>
      ${u.type === 'artillery' ? `<button class="btn btn-sm ${ui.mode === 'barrage' ? 'on' : ''}" data-order="barrage" title="Raccourci : B">Barrage</button>` : ''}
      <button class="btn btn-sm" data-order="hold" title="Raccourci : H">Annuler</button>
    </div>
    ${ui.mode === 'barrage' ? '<p class="muted">Cliquez un hexagone de la zone rouge. Le tir frappe ce qui s\'y trouvera à la fin des mouvements.</p>' : ''}` : ''}`;
  el.querySelectorAll('[data-order]').forEach((b) => b.addEventListener('click', () => setOrder(b.dataset.order)));
}

function staffNote(u) {
  if (ui.manual.has(u.id)) return '<p class="staff-note">Ordre donné à la main pour ce tour. <button class="btn btn-sm" data-order="staff">Rendre à l\'état-major</button></p>';
  const i = ui.assignment?.get(u.id);
  if (i === undefined) return '<p class="staff-note">Aucune directive : placez-en une sur la carte.</p>';
  const d = ui.directives[i];
  return `<p class="staff-note">Directive : <b>${DIRECTIVES[d.kind].label}</b> (${hexDistance(u, d)} hex.). Tout ordre donné ici la suspend pour ce tour.</p>`;
}

const STATUS_LABEL = { ok: '', routed: 'en déroute', destroyed: 'anéantie', withdrawn: 'repliée' };

function renderArmy() {
  const s = ui.state;
  const mine = s.units.filter((u) => u.side === player());
  const seen = s.visibility[player()].units.size;
  $('army').innerHTML = `
    <ul class="army">${mine.map((u) => {
      const o = u.orders;
      let tag = u.status !== 'ok' ? STATUS_LABEL[u.status] : o.path.length ? 'mouvement' : o.fireAt ? 'barrage' : o.entrench ? 'retranche' : '';
      if (u.pinned && u.status === 'ok') tag = tag ? `clouée · ${tag}` : 'clouée';
      if (ui.command && u.status === 'ok') tag = ui.manual.has(u.id) ? `${tag} · main` : ui.assignment?.has(u.id) ? `${DIRECTIVES[ui.directives[ui.assignment.get(u.id)].kind].label.toLowerCase()} · ${tag}` : tag;
      const ratio = u.hp / unitStats(u).maxHp;
      return `<li><button class="army-row ${u.id === ui.selectedId ? 'sel' : ''} st-${u.status}" data-id="${u.id}" ${onMap(u) ? '' : 'disabled'}>
        <span class="chip chip-${u.type}">${UNIT_TYPES[u.type].label.slice(0, 3)}</span>
        <span class="army-name">${esc(u.name)}</span>
        <span class="army-tag">${tag}</span>
        <span class="hpbar"><i style="width:${Math.round(ratio * 100)}%"></i></span>
      </button></li>`;
    }).join('')}</ul>
    <p class="muted small">Ennemis en vue : ${seen}</p>`;
  $('army').querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => select(s.units.find((u) => u.id === b.dataset.id), { focus: true })));
}

// Le journal ne révèle pas ce que le brouillard cache : les mouvements et travaux ennemis restent secrets.
const SECRET_KINDS = new Set(['dig', 'move', 'barrage']);

function renderLog() {
  const s = ui.state;
  const turns = new Map();
  for (const e of s.log) {
    if (e.side && e.side !== player() && SECRET_KINDS.has(e.kind)) continue;
    if (!turns.has(e.turn)) turns.set(e.turn, []);
    if (e.kind !== 'turn') turns.get(e.turn).push(e);
  }
  $('log').innerHTML = [...turns].reverse().slice(0, 8).map(([turn, entries]) => `
    <li class="log-turn">Tour ${turn}</li>
    ${entries.map((e) => `<li class="log-${e.kind} ${e.side ? (e.side === player() ? 'mine' : 'theirs') : ''}">${esc(e.text)}</li>`).join('') || '<li class="log-dig">Aucun contact.</li>'}`).join('');
}

// ---------- Démarrage ----------

// Carte : un doigt déplace, deux doigts zooment, un appui bref sélectionne ; molette pour zoomer à la souris.
function bindMapInput() {
  const canvas = $('map');
  const r = ui.renderer;
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
      if (e.pointerType === 'mouse') onMapHover(e);
      return;
    }
    if (pts.size === 1) {
      if (!gesture.moved && Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0) > 8) gesture.moved = true;
      if (gesture.moved) r.pan(e.clientX - prev.x, e.clientY - prev.y);
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const other = a === prev ? b : a;
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      const m = r.local((e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
      if (d0 > 0) r.zoomAt(d1 / d0, m.x, m.y);
      r.pan((e.clientX - prev.x) / 2, (e.clientY - prev.y) / 2);
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    scheduleDraw();
  });
  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size === 0 && gesture && !gesture.moved && !gesture.pinch && e.type === 'pointerup' && performance.now() - gesture.t0 < 600) onMapClick(e);
    if (pts.size === 0) gesture = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !pts.size) { ui.hover = null; ui.preview = null; scheduleDraw(); }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const m = r.local(e.clientX, e.clientY);
    r.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), m.x, m.y);
    scheduleDraw();
  }, { passive: false });
  // Safari iOS : empêche le zoom de page natif sur la carte.
  canvas.addEventListener('gesturestart', (e) => e.preventDefault());

  const zoomCenter = (f) => { r.zoomAt(f, r.vw / 2, r.vh / 2); scheduleDraw(); };
  $('zoom-in').addEventListener('click', () => zoomCenter(1.35));
  $('zoom-out').addEventListener('click', () => zoomCenter(1 / 1.35));
  $('zoom-fit').addEventListener('click', () => { r.fitAll(); scheduleDraw(); });
  $('cmd-toggle').addEventListener('click', () => setCommand(!ui.command));
  document.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', () => pickDirectiveTool(b.dataset.dir)));
  $('dir-clear').addEventListener('click', () => { ui.directives = []; ui.dirTool = null; staffPlan(); refresh(); });
  $('dir-off').addEventListener('click', () => setCommand(false));
  $('grid-toggle').addEventListener('click', () => {
    r.gridAlpha = r.gridAlpha === 0 ? 0.12 : r.gridAlpha < 0.2 ? 0.3 : 0;
    $('grid-toggle').setAttribute('aria-pressed', String(r.gridAlpha > 0));
    scheduleDraw();
  });
  new ResizeObserver(() => { if (ui.state) { r.resize(); draw(); } }).observe($('map').parentElement);
}

// Panoramique et volume d'un son selon sa place à l'écran : plus faible hors champ.
function locateSound(x, y) {
  const r = ui.renderer, c = r.cam;
  const sx = (x - c.x) * c.s, sy = (y - c.y) * c.s;
  const off = Math.max(0, -sx, sx - r.vw, -sy, sy - r.vh) / Math.max(r.vw, r.vh, 1);
  return { pan: Math.max(-0.8, Math.min(0.8, (sx / (r.vw || 1)) * 1.6 - 0.8)), gain: 1 / (1 + 2.5 * off) };
}

function setMuted(m) {
  sound.setMuted(m);
  $('sound-toggle').setAttribute('aria-pressed', String(!m));
  $('sound-toggle').setAttribute('aria-label', m ? 'Activer le son' : 'Couper le son');
}

function start() {
  bindMapInput();
  sound.locate = locateSound;
  // Le navigateur (iOS surtout) n'ouvre le son qu'à la suite d'un geste.
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => sound.unlock(), { capture: true });
  setMuted(sound.muted);
  $('sound-toggle').addEventListener('click', () => setMuted(!sound.muted));
  // Toucher l'onglet actif replie le tiroir (plus de place pour la carte sur téléphone).
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    const side = document.querySelector('.side');
    if (ui.tab === b.dataset.tab) side.classList.toggle('collapsed');
    else side.classList.remove('collapsed');
    ui.tab = b.dataset.tab;
    refresh();
  }));
  $('btn-go').addEventListener('click', endPhase);
  $('btn-help').addEventListener('click', () => showDossier(`<p class="eyebrow">Manuel de campagne</p><h1 class="title-l">Règles</h1>${rulesHtml().replace('<details class="rules">', '<details class="rules" open>')}<div class="row-end"><button class="btn btn-primary" id="close-help">Reprendre</button></div>`, () => $('close-help').addEventListener('click', hideDossier)));
  $('btn-menu').addEventListener('click', showMenu);
  window.addEventListener('keydown', (e) => {
    if (!$('overlay').hidden || e.target.tagName === 'INPUT') return;
    if (e.key === 'Enter') endPhase();
    else if (e.key === 'Escape') { if (ui.dirTool) { ui.dirTool = null; refresh(); } else select(null); }
    else if (e.key === 'd' || e.key === 'D') setCommand(!ui.command);
    else if (e.key === 'Tab') { e.preventDefault(); cycleUnit(); }
    else if (e.key === 'e' || e.key === 'E') setOrder('entrench');
    else if (e.key === 'b' || e.key === 'B') setOrder('barrage');
    else if (e.key === 'h' || e.key === 'H') setOrder('hold');
    else if (e.key === 'g' || e.key === 'G') $('grid-toggle').click();
    else if (e.key === 'm' || e.key === 'M') setMuted(!sound.muted);
  });
  // Partie de démonstration en fond derrière le menu.
  resetIds();
  ui.campaign = newCampaign('DE', 'DEMO');
  ui.setup = battleSetup(ui.campaign);
  ui.state = createBattle({ seed: ui.setup.seed, playerSide: 'DE', armies: ui.setup.armies, kind: 'assaut' });
  ui.renderer.setMap(ui.state.map);
  ui.renderer.fitAll();
  refresh();
  showMenu();
}

window.frontline = ui; // accès console pour le débogage

if (document.fonts?.ready) document.fonts.ready.then(start, start); else start();
