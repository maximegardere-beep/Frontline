// Couche météo animée (pluie, neige, nappes de brouillard), dessinée sur un canvas séparé au-dessus de la carte :
// la carte elle-même n'est pas redessinée à chaque image. ~30 images/s, en pause quand l'onglet est caché.
// Avec « réduire les animations », une seule image fixe.

const prefersStill = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export class WeatherLayer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.kind = 'clear';
    this.night = false;
    this.parts = [];
    this.raf = 0;
    this.last = 0;
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
  }

  set(kind, light) {
    const night = light === 'night';
    if (kind === this.kind && night === this.night) return;
    this.kind = kind;
    this.night = night;
    this.seed();
    this.start();
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.seed();
    if (prefersStill()) this.frame(0);
  }

  // Densité proportionnelle à la surface : autant de gouttes par cm² sur iPhone que sur grand écran.
  seed() {
    if (!this.w) this.resize();
    const area = (this.w * this.h) / 1e5;
    const n = { rain: Math.round(area * 22), snow: Math.round(area * 12), fog: 7 }[this.kind] ?? 0;
    const R = Math.random;
    this.parts = Array.from({ length: n }, () => ({ x: R() * this.w, y: R() * this.h, z: 0.4 + R() * 0.6, p: R() * Math.PI * 2 }));
  }

  start() {
    if (this.raf || this.kind === 'clear' || document.hidden) {
      if (this.kind === 'clear') this.clear();
      return;
    }
    if (prefersStill()) return this.frame(0);
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      if (now - this.last < 32) return;
      const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
  }

  clear() {
    this.stop();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  frame(dt) {
    const { ctx, w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    if (this.clip) {
      ctx.beginPath();
      ctx.rect(this.clip.x, this.clip.y, this.clip.w, this.clip.h);
      ctx.clip();
    }
    if (this.kind === 'rain') {
      ctx.strokeStyle = this.night ? 'rgba(150, 170, 200, 0.35)' : 'rgba(220, 230, 240, 0.42)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const p of this.parts) {
        p.y += 620 * p.z * dt;
        p.x += 110 * p.z * dt;
        if (p.y > h) { p.y -= h + 20; p.x = Math.random() * w; }
        if (p.x > w) p.x -= w;
        const len = 9 + 9 * p.z;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - len * 0.18, p.y - len);
      }
      ctx.stroke();
    } else if (this.kind === 'snow') {
      ctx.fillStyle = this.night ? 'rgba(200, 210, 230, 0.75)' : 'rgba(255, 255, 255, 0.9)';
      for (const p of this.parts) {
        p.p += dt * 1.3;
        p.y += 34 * p.z * dt;
        p.x += (Math.sin(p.p) * 18 + 10) * p.z * dt;
        if (p.y > h) { p.y -= h + 10; p.x = Math.random() * w; }
        if (p.x > w) p.x -= w;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.8 + 1.6 * p.z, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (this.kind === 'fog') {
      // Nappes larges et lentes qui dérivent vers l'est.
      const col = this.night ? '150, 160, 175' : '236, 238, 232';
      for (const p of this.parts) {
        p.x += 9 * p.z * dt;
        const r = Math.max(w, h) * (0.22 + 0.2 * p.z);
        if (p.x - r > w) p.x = -r;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, `rgba(${col}, ${0.22 * p.z})`);
        g.addColorStop(1, `rgba(${col}, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
      }
    }
    ctx.restore();
  }
}
