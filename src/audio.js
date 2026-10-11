// Sons du champ de bataille, entièrement synthétisés (Web Audio) : aucun fichier, aucune dépendance.
// Tirs et explosions suivent la chronologie des effets visuels ; moteurs et pas pendant les mouvements ;
// vent et canonnade lointaine en fond ; quelques sons d'interface.
// Sans Web Audio (Node, tests), toutes les méthodes sont sans effet.

const MUTE_KEY = 'frontline.mute';

class AudioBoard {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = globalThis.localStorage?.getItem(MUTE_KEY) === '1'; } catch { /* stockage indisponible */ }
    // Position d'un point de la carte (px monde) → { pan −1..1, gain 0..1 } ; fourni par l'interface.
    this.locate = () => ({ pan: 0, gain: 1 });
    this.amb = null;
    this.ambWanted = false;
    this.weather = 'clear';
  }

  // Le navigateur n'autorise le son qu'après un geste de l'utilisateur.
  unlock() {
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      const ctx = new AC();
      this.ctx = ctx;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -16;
      this.comp.ratio.value = 6;
      this.comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(this.comp);
      const len = ctx.sampleRate * 3;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // Bruit « brun » (grave) pour le vent et les grondements.
      this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
      const b = this.brown.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.ctx.suspend();
        else if (!this.muted) this.ctx.resume();
      });
    }
    if (this.ctx.state === 'suspended' && !this.muted) this.ctx.resume();
    if (this.ambWanted) this.ambient(true);
  }

  get live() { return !!this.ctx && !this.muted; }

  setMuted(m) {
    this.muted = m;
    try { globalThis.localStorage?.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* idem */ }
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : 0.8, t, 0.05);
    if (m) this.stopAmbient();
    else { this.ctx.resume(); this.ambient(this.ambWanted); }
  }

  // ---------- Briques ----------

  out(pan = 0, gain = 1) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  src(buffer, t, dur, loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = loop;
    // Départ au hasard dans le tampon de bruit (3 s), sans en dépasser la fin.
    s.start(t, Math.random() * (loop ? 1.5 : Math.max(0, 2.9 - (dur ?? 0))));
    if (dur != null) s.stop(t + dur);
    return s;
  }

  filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // Enveloppe percussive : attaque brève puis décroissance exponentielle.
  env(t, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  // Bouffée de bruit filtré.
  burst(t, { type = 'bandpass', f0, f1 = f0, q = 0.7, peak, attack = 0.003, decay, buffer = this.noise }, dest) {
    const dur = attack + decay + 0.05;
    const s = this.src(buffer, t, dur);
    const f = this.filter(type, f0, q);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    s.connect(f).connect(this.env(t, peak, attack, decay)).connect(dest);
  }

  // Ton dont la hauteur glisse (coup sourd, sifflement, cloche).
  tone(t, { wave = 'sine', f0, f1 = f0, peak, attack = 0.004, decay }, dest) {
    const o = this.ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    o.connect(this.env(t, peak, attack, decay)).connect(dest);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  // ---------- Combat ----------

  rifle(t, dest, far) {
    const v = 0.85 + Math.random() * 0.3;
    if (far) return this.burst(t, { type: 'lowpass', f0: 900 * v, peak: 0.25, decay: 0.12 }, dest);
    this.burst(t, { type: 'bandpass', f0: 2200 * v, f1: 900, q: 0.9, peak: 0.55, attack: 0.001, decay: 0.07 }, dest);
    this.burst(t, { type: 'lowpass', f0: 500, peak: 0.35, decay: 0.09 }, dest);
  }

  cannon(t, dest, far, heavy) {
    const v = 0.9 + Math.random() * 0.2;
    const k = far ? 0.45 : 1;
    if (!far) this.burst(t, { type: 'highpass', f0: 1800, peak: 0.5, attack: 0.001, decay: 0.04 }, dest);
    this.tone(t, { f0: (heavy ? 75 : 95) * v, f1: 32, peak: 0.9 * k, attack: 0.005, decay: heavy ? 0.7 : 0.45 }, dest);
    this.burst(t, { type: 'lowpass', f0: far ? 500 : 1400, f1: 120, peak: 0.8 * k, attack: 0.004, decay: heavy ? 1.1 : 0.7 }, dest);
  }

  whistle(t, dur, dest) {
    if (dur < 0.25) return;
    const f0 = 1500 + Math.random() * 400;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.42, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  blast(t, size, dest, kill) {
    const k = Math.min(1.3, size / 18);
    const decay = (kill ? 1.8 : 1.0) * k;
    this.burst(t, { type: 'highpass', f0: 1200, peak: 0.35 * k, attack: 0.002, decay: 0.06 }, dest);
    this.burst(t, { type: 'lowpass', f0: 1600, f1: 90, peak: 1.0 * k, attack: 0.006, decay }, dest);
    this.burst(t, { type: 'lowpass', f0: 160, peak: 0.9 * k, attack: 0.01, decay: decay * 1.2, buffer: this.brown }, dest);
    this.tone(t, { f0: 60, f1: 26, peak: 0.8 * k, attack: 0.008, decay: decay * 0.7 }, dest);
    // Destruction : munitions qui crépitent dans l'incendie.
    if (kill) {
      for (let i = 0; i < 9; i++) {
        const tt = t + 0.25 + Math.random() * 1.4;
        this.burst(tt, { type: 'bandpass', f0: 1500 + Math.random() * 2500, q: 2, peak: 0.12 + Math.random() * 0.15, attack: 0.001, decay: 0.03 }, dest);
      }
    }
  }

  // sounds : [{ t (s), k, x, y, ... }] produits par buildCombatFx ; speed : accélération de l'animation.
  combat(sounds, speed = 1) {
    if (!this.live) return;
    const t0 = this.ctx.currentTime + 0.03;
    let rifles = 0;
    for (const s of sounds) {
      // Au-delà d'une soixantaine de coups d'armes légères, on n'en garde qu'un sur deux (mobile).
      if (s.k === 'rifle' && ++rifles > 60 && rifles % 2) continue;
      const { pan, gain } = this.locate(s.x, s.y);
      const dest = this.out(pan, gain);
      const t = t0 + s.t / speed;
      if (s.k === 'rifle') this.rifle(t, dest, s.far);
      else if (s.k === 'cannon') this.cannon(t, dest, s.far, s.heavy);
      else if (s.k === 'whistle') this.whistle(t, s.dur / speed, dest);
      else if (s.k === 'blast') this.blast(t, s.size, dest, s.kill);
    }
  }

  // ---------- Mouvements ----------

  // groups : { tanks: [{ x, y }], foot: [{ x, y }] } — unités visibles qui se déplacent ; dur en secondes.
  movement(groups, dur) {
    if (!this.live || dur <= 0) return;
    const t = this.ctx.currentTime + 0.02, end = t + dur;
    const where = (pts) => {
      const xs = pts.map((p) => this.locate(p.x, p.y));
      return { pan: xs.reduce((s, l) => s + l.pan, 0) / xs.length, gain: Math.max(...xs.map((l) => l.gain)) };
    };
    if (groups.tanks.length) {
      const { pan, gain } = where(groups.tanks);
      const level = 0.16 * Math.min(1, 0.45 + groups.tanks.length * 0.18) * gain;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level, t + 0.5);
      g.gain.setValueAtTime(level, end - 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, end + 0.3);
      g.connect(this.out(pan, 1));
      const lp = this.filter('lowpass', 260, 1.2);
      lp.connect(g);
      // Moteur : deux dents de scie graves désaccordées, plus un grondement.
      for (const f of [41, 61.5]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f * (0.97 + Math.random() * 0.06);
        o.connect(lp);
        o.start(t);
        o.stop(end + 0.4);
      }
      const rumble = this.src(this.brown, t, dur + 0.4, true);
      const rg = this.ctx.createGain();
      rg.gain.value = 1.4;
      rumble.connect(rg).connect(lp);
      // Chenilles : cliquetis métallique modulé.
      const clank = this.src(this.noise, t, dur + 0.4, true);
      const bp = this.filter('bandpass', 2600, 3);
      const am = this.ctx.createGain();
      am.gain.value = 0;
      const lfo = this.ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 7.5;
      const depth = this.ctx.createGain();
      depth.gain.value = 0.18;
      lfo.connect(depth).connect(am.gain);
      lfo.start(t);
      lfo.stop(end + 0.4);
      clank.connect(bp).connect(am).connect(g);
    }
    if (groups.foot.length) {
      const { pan, gain } = where(groups.foot);
      const dest = this.out(pan, gain);
      const rate = Math.min(9, 2.5 + groups.foot.length * 1.5); // pas par seconde
      for (let tt = t + Math.random() * 0.2; tt < end; tt += (0.6 + Math.random() * 0.8) / rate) {
        this.burst(tt, { type: 'bandpass', f0: 300 + Math.random() * 500, q: 1.5, peak: 0.07 + Math.random() * 0.05, attack: 0.004, decay: 0.05 }, dest);
        // Équipement qui s'entrechoque, de temps en temps.
        if (Math.random() < 0.12) this.burst(tt + 0.02, { type: 'bandpass', f0: 3200, q: 4, peak: 0.04, attack: 0.001, decay: 0.03 }, dest);
      }
    }
  }

  // ---------- Fond sonore ----------

  // Le fond sonore suit la météo : pluie, vent de neige, calme du brouillard.
  setWeather(kind) {
    if (kind === this.weather) return;
    this.weather = kind;
    if (this.amb) { this.stopAmbient(); this.ambient(true); }
  }

  ambient(on) {
    this.ambWanted = on;
    if (!on || !this.live) return this.stopAmbient();
    if (this.amb) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(1, t + 2);
    bus.connect(this.master);
    // Vent : bruit grave filtré, dont le filtre et le volume ondulent lentement.
    const wind = this.src(this.brown, t, null, true);
    const bp = this.filter('bandpass', 420, 0.6);
    const wg = ctx.createGain();
    const w = this.weather;
    wg.gain.value = w === 'snow' ? 0.17 : w === 'fog' ? 0.06 : 0.11;
    if (w === 'snow') bp.frequency.value = 560;
    const lfos = [[bp.frequency, 0.07, 220], [wg.gain, 0.045, 0.06]].map(([param, f, depth]) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const d = ctx.createGain();
      d.gain.value = depth;
      o.connect(d).connect(param);
      o.start(t);
      return o;
    });
    wind.connect(bp).connect(wg).connect(bus);
    const nodes = [wind, ...lfos];
    // Pluie : bruit blanc adouci, régulier, avec un léger souffle de rafales.
    if (w === 'rain') {
      const rain = this.src(this.noise, t, null, true);
      const rg = ctx.createGain();
      rg.gain.value = 0.075;
      rain.connect(this.filter('highpass', 900)).connect(this.filter('lowpass', 6500)).connect(rg).connect(bus);
      const gust = ctx.createOscillator();
      gust.frequency.value = 0.11;
      const gd = ctx.createGain();
      gd.gain.value = 0.025;
      gust.connect(gd).connect(rg.gain);
      gust.start(t);
      nodes.push(rain, gust);
    }
    this.amb = { bus, nodes, timer: null };
    this.scheduleDistant();
  }

  // Canonnade lointaine : grondements sourds, isolés ou en salve, à intervalles irréguliers.
  scheduleDistant() {
    if (!this.amb) return;
    this.amb.timer = setTimeout(() => {
      if (!this.amb || !this.live) return;
      const t = this.ctx.currentTime;
      const dest = this.ctx.createGain();
      dest.gain.value = 0.13 + Math.random() * 0.1;
      const p = this.ctx.createStereoPanner?.();
      if (p) { p.pan.value = Math.random() * 1.6 - 0.8; dest.connect(p).connect(this.amb.bus); } else dest.connect(this.amb.bus);
      const n = Math.random() < 0.4 ? 2 + Math.floor(Math.random() * 3) : 1;
      for (let i = 0; i < n; i++) {
        const tt = t + i * (0.35 + Math.random() * 0.6);
        this.burst(tt, { type: 'lowpass', f0: 180, f1: 60, peak: 0.9, attack: 0.03, decay: 1.6, buffer: this.brown }, dest);
        this.tone(tt, { f0: 45, f1: 28, peak: 0.4, attack: 0.02, decay: 1.0 }, dest);
      }
      this.scheduleDistant();
    }, 5000 + Math.random() * 11000);
  }

  stopAmbient() {
    if (!this.amb) return;
    const { bus, nodes, timer } = this.amb;
    this.amb = null;
    clearTimeout(timer);
    const t = this.ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setTargetAtTime(0.0001, t, 0.3);
    for (const n of nodes) n.stop(t + 1.5);
  }

  // ---------- Interface ----------

  ui(kind) {
    if (!this.live) return;
    const t = this.ctx.currentTime + 0.005;
    const dest = this.out(0, 1);
    if (kind === 'select') {
      // Déclic d'interrupteur.
      this.burst(t, { type: 'bandpass', f0: 3000, q: 2, peak: 0.12, attack: 0.001, decay: 0.02 }, dest);
      this.tone(t, { wave: 'triangle', f0: 1400, f1: 1100, peak: 0.05, attack: 0.002, decay: 0.04 }, dest);
    } else if (kind === 'order') {
      // Crayon gras sur la carte : deux traits brefs.
      this.burst(t, { type: 'bandpass', f0: 1800, q: 1.2, peak: 0.08, attack: 0.01, decay: 0.06 }, dest);
      this.burst(t + 0.09, { type: 'bandpass', f0: 2300, q: 1.2, peak: 0.07, attack: 0.01, decay: 0.05 }, dest);
    } else if (kind === 'go') {
      // Transmission radio : souffle puis deux bips.
      this.burst(t, { type: 'bandpass', f0: 1600, q: 0.8, peak: 0.1, attack: 0.01, decay: 0.18 }, dest);
      this.tone(t + 0.16, { wave: 'square', f0: 900, peak: 0.03, attack: 0.005, decay: 0.07 }, dest);
      this.tone(t + 0.27, { wave: 'square', f0: 900, peak: 0.03, attack: 0.005, decay: 0.07 }, dest);
    } else if (kind === 'bell') {
      // Cloche de fin de tour : partiels inharmoniques.
      for (const [r, a] of [[1, 0.12], [2.76, 0.05], [5.4, 0.025]]) this.tone(t, { f0: 660 * r, peak: a, attack: 0.003, decay: 1.4 / r }, dest);
    }
  }
}

export const sound = new AudioBoard();
