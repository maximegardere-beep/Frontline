// Contrôleur : menus, phases de déploiement / planification, animation de l'exécution, campagne.

import { Renderer, HEX } from './render.js';
import { createBattle, executeTurn, onMap, active, unitAt, canDeployAt, updateVisibility, HOLD_TO_WIN } from './game.js';
import { planSide } from './ai.js';
import { reachable, pathFrom, hexKey, pathCost } from './path.js';
import { unitStats, UNIT_TYPES, LEVELS, SIDES, other, hpState, resetIds, XP_FOR_LEVEL } from './units.js';
import { tileAt, describeTile, terrainDefense } from './terrain.js';
import { hexDistance, hexToPixel, sameHex } from './hex.js';
import { newCampaign, battleSetup, concludeBattle, campaignOver, campaignVerdict, CAMPAIGN_LENGTH, KIND_LABELS } from './campaign.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'frontline.campaign.v1';
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
};

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
}
function hideDossier() { $('overlay').hidden = true; }

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
        <li><b>Moral.</b> Une unité très éprouvée teste son moral (d6 + niveau ≥ 5). En cas d'échec elle se débande et fuit vers sa zone de repli.</li>
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
  ui.renderer.setMap(ui.state.map);
  ui.selectedId = null;
  const s = ui.state;
  requestAnimationFrame(() => {
    const sc = document.querySelector('.board-scroll');
    sc.scrollLeft = c.playerSide === 'SU' ? sc.scrollWidth : 0;
  });
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

function playerReach(u) {
  const s = ui.state;
  const vis = s.visibility[player()];
  const blocked = new Set(s.units.filter((e) => e.side !== u.side && onMap(e) && vis.units.has(e.id)).map((e) => hexKey(s.map, e)));
  return reachable(s.map, u, { blocked });
}

function select(u) {
  ui.selectedId = u?.id ?? null;
  ui.mode = 'move';
  refresh();
}

function onMapClick(ev) {
  const s = ui.state;
  if (!s || ui.busy || !$('overlay').hidden) return;
  const h = ui.renderer.hexAt(ev.clientX, ev.clientY);
  if (!h) return;
  const here = unitAt(s, h);
  const sel = selected();

  if (s.phase === 'deploy') {
    if (here && here.side === player()) return select(here.id === ui.selectedId ? null : here);
    if (sel && canDeployAt(s, player(), h)) {
      sel.col = h.col;
      sel.row = h.row;
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
      return refresh();
    }
  }
  // Une unité amie qui a déjà un ordre de mouvement libérera sa case : on peut la viser.
  const leaving = here && here.side === player() && here.orders.path.length > 0;
  if (here && here.side === player() && here.status === 'ok' && here !== sel && !(sel && leaving && ui.mode === 'move')) return select(here);
  if (sel && sel.status === 'ok') {
    if (sameHex(sel, h)) { sel.orders.path = []; return refresh(); }
    const reach = playerReach(sel);
    if (reach.has(hexKey(s.map, h))) {
      if (here && !leaving) return;
      sel.orders.path = pathFrom(s.map, reach, h);
      sel.orders.entrench = false;
      sel.orders.fireAt = null;
      return refresh();
    }
  }
  if (here && here.side !== player()) { ui.selectedId = here.id; return refresh(); }
  select(null);
}

function onMapMove(ev) {
  if (!ui.state) return;
  const h = ui.renderer.hexAt(ev.clientX, ev.clientY);
  if (sameHex(h, ui.hover)) return;
  ui.hover = h;
  draw();
  const t = h && tileAt(ui.state.map, h.col, h.row);
  $('hint').textContent = t ? `${describeTile(t)}${terrainDefense(t) ? ` · défense ${terrainDefense(t) > 0 ? '+' : ''}${terrainDefense(t)}` : ''}` : '';
}

function setOrder(kind) {
  const u = selected();
  if (!u || u.side !== player() || u.status !== 'ok' || ui.state.phase !== 'plan') return;
  if (kind === 'entrench') {
    u.orders.entrench = !u.orders.entrench;
    if (u.orders.entrench) u.orders.path = [];
  } else if (kind === 'hold') {
    u.orders = { path: [], entrench: false, fireAt: null };
  } else if (kind === 'barrage' && u.type === 'artillery') {
    ui.mode = ui.mode === 'barrage' ? 'move' : 'barrage';
  } else if (kind === 'move') ui.mode = 'move';
  refresh();
}

function cycleUnit() {
  const mine = ui.state.units.filter((u) => u.side === player() && active(u));
  if (!mine.length) return;
  const i = mine.findIndex((u) => u.id === ui.selectedId);
  select(mine[(i + 1) % mine.length]);
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
    return refresh();
  }
  if (s.phase !== 'plan') return;
  ui.busy = true;
  ui.selectedId = null;
  ui.mode = 'move';
  planSide(s, other(player()));
  const me = player();
  const visStart = new Set(s.visibility[me].units);
  const hpStart = Object.fromEntries(s.units.map((u) => [u.id, u.hp]));
  s.phase = 'execute';
  refresh();
  const res = executeTurn(s);
  const visEnd = s.visibility[me].units;
  ui.animVisible = new Set([...visStart, ...visEnd]);
  for (const f of res.fires) {
    const a = s.units.find((u) => u.id === f.attacker);
    if (a.side !== me) ui.animVisible.add(a.id);
  }
  const px = (snap) => Object.fromEntries(Object.entries(snap).map(([id, p]) => [id, { ...hexToPixel(p.col, p.row, HEX), status: p.status }]));
  const frames = res.ticks.map(px);
  const tickMs = reduceMotion ? 60 : 260;
  for (let i = 1; i < frames.length; i++) {
    const A = frames[i - 1], B = frames[i];
    await tween(tickMs, (k) => {
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const pos = {};
      for (const id of Object.keys(A)) {
        const b = B[id] ?? A[id];
        pos[id] = { x: A[id].x + (b.x - A[id].x) * e, y: A[id].y + (b.y - A[id].y) * e, status: A[id].status };
      }
      ui.anim = { pos, hp: hpStart };
      draw();
    });
  }
  // Combat : tirs simultanés.
  if (res.fires.length) {
    const last = frames[frames.length - 1];
    const fx = res.fires.map((f, i) => {
      const hiddenShooter = !ui.animVisible.has(f.attacker) && !f.attacker.startsWith(me);
      return { ...f, from: hiddenShooter ? f.to : f.from, delay: (i % 6) * 0.05 };
    });
    await tween(reduceMotion ? 300 : 1500, (k) => {
      ui.fx = fx.map((f) => ({ ...f, t: Math.max(0, Math.min(1, (k - f.delay) / (1 - 0.3))) }));
      ui.anim = { pos: last, hp: k > 0.5 ? null : hpStart };
      draw();
    });
  }
  ui.anim = null;
  ui.fx = null;
  ui.animVisible = null;
  ui.busy = false;
  if (s.phase === 'execute') s.phase = 'plan';
  refresh();
  if (s.result) {
    await wait(reduceMotion ? 100 : 900);
    showDebrief();
  }
}

// ---------- Affichage ----------

function draw() {
  const s = ui.state;
  if (!s) return;
  const sel = selected();
  const mine = sel && sel.side === player() && sel.status === 'ok';
  ui.renderer.draw({
    state: s,
    side: player(),
    selectedId: ui.selectedId,
    reach: !ui.anim && mine && s.phase === 'plan' && ui.mode === 'move' ? playerReach(sel) : null,
    rangeOf: !ui.anim && mine && sel.type === 'artillery' && (ui.mode === 'barrage' || sel.orders.fireAt) ? sel : null,
    hover: ui.anim ? null : ui.hover,
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
  renderObjective();
  renderUnitCard();
  renderArmy();
  renderLog();
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
  if (!u) {
    el.innerHTML = s.phase === 'deploy'
      ? '<p class="muted">Sélectionnez une unité, puis un hexagone libre de la zone de déploiement (pointillés rouges).</p>'
      : '<p class="muted">Sélectionnez une unité sur la carte ou dans la liste. <kbd>Tab</kbd> passe à la suivante, <kbd>Entrée</kbd> exécute le tour.</p>';
    return;
  }
  if (u.side !== player()) {
    const m = s.memory[player()][u.id];
    el.innerHTML = `
      <p class="eyebrow enemy">Ennemi repéré</p>
      <h3>${UNIT_TYPES[u.type].label} ${SIDES[u.side].name === 'Wehrmacht' ? 'allemande' : 'soviétique'}</h3>
      <p class="muted">État apparent : ${m?.hpState ?? hpState(u)}${u.entrench ? ' · retranchée' : ''}${u.status === 'routed' ? ' · en déroute' : ''}.</p>`;
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
    <p class="order">${esc(orderSummary(u))}</p>
    ${canAct ? `
    <div class="orders">
      <button class="btn btn-sm ${ui.mode === 'move' && u.orders.path.length ? 'on' : ''}" data-order="move">Déplacer</button>
      <button class="btn btn-sm ${u.orders.entrench ? 'on' : ''}" data-order="entrench" title="Raccourci : E">Retrancher</button>
      ${u.type === 'artillery' ? `<button class="btn btn-sm ${ui.mode === 'barrage' ? 'on' : ''}" data-order="barrage" title="Raccourci : B">Barrage</button>` : ''}
      <button class="btn btn-sm" data-order="hold" title="Raccourci : H">Annuler</button>
    </div>
    ${ui.mode === 'barrage' ? '<p class="muted">Cliquez un hexagone de la zone rouge. Le tir frappe ce qui s\'y trouvera à la fin des mouvements.</p>' : ''}` : ''}`;
  el.querySelectorAll('[data-order]').forEach((b) => b.addEventListener('click', () => setOrder(b.dataset.order)));
}

const STATUS_LABEL = { ok: '', routed: 'en déroute', destroyed: 'anéantie', withdrawn: 'repliée' };

function renderArmy() {
  const s = ui.state;
  const mine = s.units.filter((u) => u.side === player());
  const seen = s.visibility[player()].units.size;
  $('army').innerHTML = `
    <ul class="army">${mine.map((u) => {
      const o = u.orders;
      const tag = u.status !== 'ok' ? STATUS_LABEL[u.status] : o.path.length ? 'mouvement' : o.fireAt ? 'barrage' : o.entrench ? 'retranche' : '';
      const ratio = u.hp / unitStats(u).maxHp;
      return `<li><button class="army-row ${u.id === ui.selectedId ? 'sel' : ''} st-${u.status}" data-id="${u.id}" ${onMap(u) ? '' : 'disabled'}>
        <span class="chip chip-${u.type}">${UNIT_TYPES[u.type].label.slice(0, 3)}</span>
        <span class="army-name">${esc(u.name)}</span>
        <span class="army-tag">${tag}</span>
        <span class="hpbar"><i style="width:${Math.round(ratio * 100)}%"></i></span>
      </button></li>`;
    }).join('')}</ul>
    <p class="muted small">Ennemis en vue : ${seen}</p>`;
  $('army').querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => select(s.units.find((u) => u.id === b.dataset.id))));
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

function start() {
  const canvas = $('map');
  canvas.addEventListener('click', onMapClick);
  canvas.addEventListener('mousemove', onMapMove);
  canvas.addEventListener('mouseleave', () => { ui.hover = null; $('hint').textContent = ''; draw(); });
  $('btn-go').addEventListener('click', endPhase);
  $('btn-help').addEventListener('click', () => showDossier(`<p class="eyebrow">Manuel de campagne</p><h1 class="title-l">Règles</h1>${rulesHtml().replace('<details class="rules">', '<details class="rules" open>')}<div class="row-end"><button class="btn btn-primary" id="close-help">Reprendre</button></div>`, () => $('close-help').addEventListener('click', hideDossier)));
  $('btn-menu').addEventListener('click', showMenu);
  window.addEventListener('keydown', (e) => {
    if (!$('overlay').hidden || e.target.tagName === 'INPUT') return;
    if (e.key === 'Enter') endPhase();
    else if (e.key === 'Escape') select(null);
    else if (e.key === 'Tab') { e.preventDefault(); cycleUnit(); }
    else if (e.key === 'e' || e.key === 'E') setOrder('entrench');
    else if (e.key === 'b' || e.key === 'B') setOrder('barrage');
    else if (e.key === 'h' || e.key === 'H') setOrder('hold');
  });
  // Partie de démonstration en fond derrière le menu.
  resetIds();
  ui.campaign = newCampaign('DE', 'DEMO');
  ui.setup = battleSetup(ui.campaign);
  ui.state = createBattle({ seed: ui.setup.seed, playerSide: 'DE', armies: ui.setup.armies, kind: 'assaut' });
  ui.renderer.setMap(ui.state.map);
  refresh();
  showMenu();
}

window.frontline = ui; // accès console pour le débogage

if (document.fonts?.ready) document.fonts.ready.then(start, start); else start();
