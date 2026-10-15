// Aperçu du rendu du front : bataille IA contre IA en direct (outil de développement, avant l'interface du mode).
import { createFront, beginDay, stepTick, FRONT_WEATHER, townsHeld } from './front.js';
import { installAI } from './frontai.js';
import { FrontRenderer } from './frontrender.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const front = createFront({ seed: params.get('seed') ?? 'apercu', playerSide: null, attacker: params.get('att') ?? 'DE', biome: params.get('biome'), season: Number(params.get('season') ?? 0) });
installAI(front);
const r = new FrontRenderer($('map'));
r.setMap(front);
r.fitAll();
let viewer = 0, paused = false, speed = 1, last = performance.now(), acc = 0;
const TICK_MS = 667; // ~20 s par journée de 30 ticks
r.snapshot(viewer);
r.snapshot(viewer);
window.preview = { front, r, step: () => tick() };

function tick() {
  if (front.result) return;
  if (front.phase === 'plan') beginDay(front);
  const events = stepTick(front);
  r.snapshot(viewer);
  r.fx.spawn(front, viewer, performance.now(), TICK_MS / speed, r.viewRect(), events);
}

function frame(now) {
  const dt = now - last;
  last = now;
  if (!paused && !front.result) {
    acc += dt * speed;
    while (acc >= TICK_MS) { acc -= TICK_MS; tick(); }
  }
  const s = viewer === null ? 0 : viewer;
  const orders = viewer === null ? null : { vectors: front.orders[s], lines: front.lines[s], barrages: front.barrages[s], pontoons: front.pontoonOrders[s] };
  r.draw({ viewer, t: acc / TICK_MS, orders });
  $('status').textContent = `Jour ${Math.min(front.day, front.cfg.days)} · tick ${front.tick}/${front.cfg.ticks} · ${FRONT_WEATHER[front.weather].label} · villes ${townsHeld(front, 0)}–${townsHeld(front, 1)}${front.result ? ' · ' + front.result.reason : ''}`;
  $('log').textContent = front.log.slice(-3).map((l) => l.text).join('\n');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
  viewer = b.dataset.view === 'null' ? null : Number(b.dataset.view);
  r.cur = null;
  r.snapshot(viewer);
  r.snapshot(viewer);
  document.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
}));
$('pause').addEventListener('click', () => { paused = !paused; $('pause').textContent = paused ? 'Reprendre' : 'Pause'; });
$('fast').addEventListener('click', () => { speed = speed === 1 ? 4 : 1; $('fast').setAttribute('aria-pressed', String(speed > 1)); });
new ResizeObserver(() => { r.resize(); }).observe($('map').parentElement);
const c = $('map');
c.addEventListener('wheel', (e) => { e.preventDefault(); const m = r.local(e.clientX, e.clientY); r.zoomAt(Math.exp(-e.deltaY * 0.0015), m.x, m.y); }, { passive: false });
let drag = null;
c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; c.setPointerCapture(e.pointerId); });
c.addEventListener('pointermove', (e) => { if (!drag) return; r.pan(e.clientX - drag.x, e.clientY - drag.y); drag = { x: e.clientX, y: e.clientY }; });
c.addEventListener('pointerup', () => { drag = null; });
