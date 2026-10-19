import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createFront, beginDay, stepTick, runDay } from '../src/front.js';
import { installAI } from '../src/frontai.js';
import { pickCell, contactCells, areaReport, combatSpots, menRange, bigPockets, MIN_POCKET } from '../src/frontinput.js';

const root = new URL('..', import.meta.url).pathname;
const digits = (s) => s.split(' à ').map((x) => Number(x.replace(/\D/g, '')));
const dist = (f, i, p) => Math.hypot(f.centers.x[i] - p.x, f.centers.y[i] - p.y);

test('fourchette d\'estimation : encadre la valeur, arrondie', () => {
  for (const n of [120, 950, 2400, 7300, 26000]) {
    const txt = menRange(n);
    assert.match(txt, / à .* hommes$/);
    const [a, b] = digits(txt);
    assert.ok(a <= n && n <= b, `${n} dans ${txt}`);
    const step = n >= 4000 ? 500 : 100;
    assert.equal(a % step, 0);
    assert.equal(b % step, 0);
  }
  assert.deepEqual(digits(menRange(0)), [0, 100], 'jamais « 0 à 0 »');
});

test('case autour du doigt : départ garni au contact, case proche, réserves ravitaillées', () => {
  const f = createFront({ seed: 'doigt' });
  const s = 0;
  const contact = contactCells(f, s);
  const c = contact.findIndex((v, i) => v && Math.abs(Math.floor(i / f.map.W) - 32) < 4);
  assert.ok(c >= 0);
  // On touche à côté du front, deux cases en arrière : le départ d'un vecteur est une case amie, au contact.
  const p = { x: f.centers.x[c] - 2, y: f.centers.y[c] + 0.5 };
  const push = pickCell(f, s, p, 'push', 3);
  assert.equal(f.owner[push], s);
  assert.equal(contact[push], 1, 'départ au contact');
  assert.ok(dist(f, push, p) <= 3);
  // Une ligne prend simplement la case amie la plus proche.
  const near = pickCell(f, s, p, 'near', 3);
  for (let i = 0; i < f.map.N; i++) if (f.owner[i] === s) assert.ok(dist(f, i, p) >= dist(f, near, p) - 1e-6);
  // Réserves : jamais une case hors ravitaillement.
  f.supplied[s].fill(0);
  assert.equal(pickCell(f, s, p, 'reserve', 3), -1);
  // Loin de nos lignes (au fond du territoire ennemi), rien.
  assert.equal(pickCell(f, s, { x: f.map.W - 2, y: 30 }, 'push', 2), -1);
  // Un peu au-delà du rayon : la recherche s'élargit au double.
  assert.ok(pickCell(f, s, { x: f.centers.x[c] + 3, y: f.centers.y[c] }, 'push', 2) >= 0);
});

test('estimation au toucher : nos troupes exactes, l\'ennemi d\'après la mémoire seulement', () => {
  const f = createFront({ seed: 'sonde', playerSide: 'DE' });
  const s = 0;
  const own = f.map.towns.find((t) => f.owner[t.i] === s);
  const p = { x: f.centers.x[own.i], y: f.centers.y[own.i] };
  const r = areaReport(f, s, p, own.i, 3);
  let exact = 0;
  for (let i = 0; i < f.map.N; i++) if (f.owner[i] === s && dist(f, i, p) <= 3) exact += f.dens[i];
  assert.equal(r.side, s);
  assert.ok(Math.abs(r.sum - exact) < 1e-3);
  // Ennemi hors de vue : modifier sa vraie densité ne change rien à l'estimation.
  const far = f.map.towns.find((t) => f.owner[t.i] === 1 && !f.vision[s][t.i]);
  assert.ok(far, 'une ville ennemie hors de vue');
  const q = { x: f.centers.x[far.i], y: f.centers.y[far.i] };
  const before = areaReport(f, s, q, far.i, 3);
  for (let i = 0; i < f.map.N; i++) if (f.owner[i] === 1 && dist(f, i, q) <= 3 && !f.vision[s][i]) f.dens[i] *= 5;
  const after = areaReport(f, s, q, far.i, 3);
  assert.equal(after.sum, before.sum, 'le brouillard ne fuit pas');
  assert.equal(after.side, 1);
  // Après la bataille (vue omnisciente), c'est la vraie densité.
  const omni = areaReport(f, s, q, far.i, 3, true);
  assert.ok(omni.sum > before.sum);
  assert.equal(omni.visible, true);
});

test('foyers de combat : seulement là où l\'on voit, les plus violents d\'abord', () => {
  const f = createFront({ seed: 'foyers', playerSide: null });
  installAI(f);
  beginDay(f);
  let spots = [];
  for (let k = 0; k < 10 && !spots.length; k++) { stepTick(f); spots = combatSpots(f, 0); }
  assert.ok(spots.length > 0, 'des combats au contact');
  for (let k = 1; k < spots.length; k++) assert.ok(spots[k - 1].loss >= spots[k].loss);
  // Sans vue ni troupes nulle part, on n'entend rien.
  f.vision[0].fill(0);
  const owner = f.owner.slice();
  f.owner.fill(1);
  assert.deepEqual(combatSpots(f, 0), []);
  f.owner.set(owner);
});

test('poches affichées : les miettes sont ignorées', () => {
  const f = createFront({ seed: 'poches', playerSide: null });
  installAI(f);
  for (let d = 0; d < 4; d++) runDay(f);
  for (const s of [0, 1]) {
    const big = bigPockets(f, s);
    for (const p of big) assert.ok(p.troops >= MIN_POCKET);
    for (let k = 1; k < big.length; k++) assert.ok(big[k - 1].troops >= big[k].troops);
    assert.equal(big.length, f.pockets[s].filter((p) => p.troops >= MIN_POCKET).length);
  }
});

test('interface : chaque élément cherché par le contrôleur existe dans la page', () => {
  const html = readFileSync(`${root}index.html`, 'utf8');
  for (const file of ['frontui.js', 'main.js']) {
    const src = readFileSync(`${root}src/${file}`, 'utf8');
    const ids = new Set([...src.matchAll(/(?:byId|\$)\('([\w-]+)'\)/g)].map((m) => m[1]));
    // Identifiants créés dans les dossiers (HTML injecté) : présents dans le source du contrôleur lui-même.
    const deck = readFileSync(`${root}src/frontdeck.js`, 'utf8'); // dossiers du tirage et de la bataille des airs
    for (const id of ids) assert.ok(html.includes(`id="${id}"`) || src.includes(`id="${id}"`) || deck.includes(`id="${id}"`), `#${id} (${file})`);
  }
  for (const tool of ['infantry', 'armor', 'retreat', 'barrage', 'reserve', 'priority']) assert.ok(html.includes(`data-tool="${tool}"`), tool);
  assert.ok(!html.includes('data-tool="line"'), 'plus d\'outil « Ligne » : les ouvrages viennent des bataillons de soutien');
  assert.ok(!html.includes('data-tool="transfer"'), 'plus de transfert du joueur : seul l\'état-major regroupe la nuit');
});

test('rails d\'ordres : Manœuvre et Renforts à gauche, Feux à droite, icônes nommées avec leur touche', () => {
  const html = readFileSync(`${root}index.html`, 'utf8');
  const rail = (cls) => html.slice(html.indexOf(`order-rail ${cls}`), html.indexOf('order-rail', html.indexOf(`order-rail ${cls}`) + 12));
  const tools = (s) => [...s.matchAll(/data-tool="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(tools(rail('rail-l')), ['infantry', 'armor', 'fix', 'retreat', 'reserve', 'priority', 'drop', 'pontoon']);
  assert.deepEqual(tools(rail('rail-r')), ['barrage', 'salvo', 'air']);
  for (const g of ['Manœuvre', 'Renforts', 'Feux']) assert.ok(html.includes(`role="group" aria-label="${g}"`), g);
  assert.ok(!html.includes('order-bar') && !html.includes('tool-l'), 'plus de barre du bas ni d\'étiquettes');
  for (const m of html.matchAll(/<button class="otool"[^>]*>.*?<\/button>/g)) {
    const b = m[0];
    const label = b.match(/aria-label="([^"]+)"/)?.[1];
    assert.match(label ?? '', /^\S.* \(\w\)$/, `${b.slice(0, 60)} : nom et touche`);
    assert.ok(b.includes(`title="${label}"`), `${label} : info-bulle`);
    assert.ok(b.includes('<svg') && b.includes('class="tool-n"'), `${label} : icône et pastille`);
  }
});

test('fichier unique : les modules assemblés se compilent (pas de nom déclaré deux fois)', () => {
  const r = spawnSync(process.execPath, [`${root}tools/bundle.mjs`, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
