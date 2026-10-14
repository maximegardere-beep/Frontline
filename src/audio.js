// Sons du champ de bataille, entièrement synthétisés (Web Audio) : aucun fichier, aucune dépendance.
// Tirs et explosions suivent la chronologie des effets visuels ; moteurs et pas pendant les mouvements ;
// raids aériens (moteurs, DCA, piqué, bombes) ; vent et canonnade lointaine en fond ; quelques sons d'interface.
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
    this.assault = true; // infanterie : le premier mouvement est une marche, puis assaut, et ainsi de suite
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

  // Sortie dont le panoramique et le volume peuvent être automatisés (avions qui traversent la carte).
  outMoving(pan = 0, gain = 1) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const p = this.ctx.createStereoPanner?.();
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p).connect(this.master); } else g.connect(this.master);
    return { node: g, gain: g.gain, pan: p?.pan ?? null };
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

  // Rafale de mitrailleuse lointaine : claquements secs et rapprochés.
  mg(t, dest, f = 1100, peak = 0.16, shots = 5 + ((Math.random() * 4) | 0)) {
    const v = 0.9 + Math.random() * 0.2;
    for (let i = 0; i < shots; i++) this.burst(t + i * 0.065, { type: 'bandpass', f0: f * v, q: 1.1, peak, attack: 0.001, decay: 0.05 }, dest);
  }

  whistle(t, dur, dest, level = 0.09, f0 = 1500 + Math.random() * 400) {
    if (dur < 0.25) return;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.42, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + dur * 0.7);
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

  // Front stratégique : sons d'un tick, étalés sur sa durée (dur, en s). items : [{ k, pan, gain, n }]
  // - fire : fusillade et canons d'un secteur au contact, n ≈ intensité (coups de fusil) ;
  // - barrage : sifflements et explosions d'un barrage de zone ;
  // - town : une ville tombe (grosse explosion, incendie) ; pocket : message radio d'encerclement.
  front(items, dur) {
    if (!this.live) return;
    const t0 = this.ctx.currentTime + 0.03;
    const at = (k = 1) => t0 + Math.random() * dur * k;
    for (const s of items) {
      const dest = this.out(s.pan, s.gain);
      if (s.k === 'fire') {
        const n = Math.min(8, Math.round(s.n)); // sobre : jusqu'à trois foyers par tick, sur iPhone
        for (let i = 0; i < n; i++) this.rifle(at(), dest, true);
        for (let i = 0; i < Math.min(2, Math.floor(s.n / 3)); i++) this.mg(at(0.7), dest);
        // Blindés au contact : départs de canons plus nombreux et plus proches.
        const guns = s.armor > 0 ? Math.min(3, 1 + Math.floor(s.armor * 0.2)) : Math.min(2, Math.floor(s.n / 4));
        for (let i = 0; i < guns; i++) this.cannon(at(), dest, !(s.armor > 0 && i === 0), Math.random() < 0.3);
      } else if (s.k === 'barrage') this.barrage(t0 + Math.random() * dur * 0.3, dest, s.gun ? this.out(s.gun.pan, s.gun.gain) : null);
      else if (s.k === 'town') this.blast(t0, 24, dest, true);
      else if (s.k === 'pocket') {
        this.burst(t0, { type: 'bandpass', f0: 1600, q: 0.8, peak: 0.1, attack: 0.01, decay: 0.18 }, dest);
        for (let i = 0; i < 3; i++) this.tone(t0 + 0.16 + i * 0.11, { wave: 'square', f0: 700, peak: 0.03, attack: 0.005, decay: 0.06 }, dest);
      } else if (s.k === 'raid') this.raid(t0, s, dur);
      else if (s.k === 'bombs') this.bombs(t0 + Math.random() * dur * 0.2, s, dest);
      else if (s.k === 'drone') this.drone(t0, dur * 3);
    }
  }

  // Barrage : la batterie tire en salve au loin (guns : sa position, ou null si on ne la voit pas),
  // un silence, les obus qui sifflent ensemble, des impacts groupés, puis un long grondement et la terre qui retombe.
  barrage(t, dest, guns) {
    const from = guns ?? dest;
    const n = 3 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) this.cannon(t + i * (0.13 + Math.random() * 0.05), from, true, true);
    const tw = t + n * 0.15 + 0.4 + Math.random() * 0.2;
    const fall = 0.8 + Math.random() * 0.4;
    for (let i = 0; i < 4; i++) {
      const d = fall + (Math.random() - 0.5) * 0.25;
      this.whistle(tw + i * 0.07, d, dest, 0.06, 1250 + Math.random() * 700);
    }
    const ti = tw + fall;
    for (let c = 0; c < 3; c++) {
      const tc = ti + c * (0.28 + Math.random() * 0.2);
      for (let i = 0; i < 2 + (Math.random() < 0.5); i++) this.blast(tc + i * (0.04 + Math.random() * 0.07), 12 + Math.random() * 8, dest, false);
    }
    // Queue : grondement sourd qui remplit l'espace, et retombées de terre.
    this.burst(ti + 0.2, { type: 'lowpass', f0: 140, f1: 50, peak: 0.55, attack: 0.25, decay: 2.8, buffer: this.brown }, dest);
    for (let i = 0; i < 7; i++) {
      this.burst(ti + 0.5 + Math.random() * 1.6, { type: 'bandpass', f0: 2500 + Math.random() * 2500, q: 1.5, peak: 0.02 + Math.random() * 0.03, attack: 0.002, decay: 0.03 }, dest);
    }
  }

  // ---------- Aviation ----------

  // Moteurs d'une escadrille de bimoteurs : dents de scie désaccordées (battement), souffle d'hélices.
  // Panoramique de from à to (arrivée à arrive s), puis dégagement ; effet Doppler au passage.
  engines(t, dur, arrive, from, to, level = 0.13) {
    const ctx = this.ctx, end = t + dur;
    const out = this.outMoving(from.pan, 1);
    if (out.pan) {
      out.pan.setValueAtTime(from.pan, t);
      out.pan.linearRampToValueAtTime(to.pan, t + arrive);
      out.pan.linearRampToValueAtTime((to.pan + from.pan) / 2, end);
    }
    const g = out.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(level * Math.max(0.15, from.gain), t + arrive * 0.3);
    g.exponentialRampToValueAtTime(level * Math.max(0.2, to.gain), t + arrive);
    g.exponentialRampToValueAtTime(level * 0.4 * Math.max(0.2, to.gain), t + arrive + (dur - arrive) * 0.5);
    g.exponentialRampToValueAtTime(0.0001, end);
    const lp = this.filter('lowpass', 380, 0.9);
    lp.frequency.setValueAtTime(380, t);
    lp.frequency.exponentialRampToValueAtTime(1100, t + arrive);
    lp.frequency.exponentialRampToValueAtTime(260, end);
    lp.connect(out.node);
    for (const f of [86, 88.5, 104]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f1 = f * (0.98 + Math.random() * 0.04);
      o.frequency.setValueAtTime(f1 * 0.94, t);
      o.frequency.linearRampToValueAtTime(f1 * 1.03, t + arrive - 0.3);
      o.frequency.linearRampToValueAtTime(f1 * 0.86, t + arrive + 0.6);
      const og = ctx.createGain();
      og.gain.value = 0.33;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(end + 0.05);
    }
    const prop = this.src(this.noise, t, dur + 0.05, true);
    const pg = ctx.createGain();
    pg.gain.value = 0.25;
    prop.connect(this.filter('bandpass', 700, 0.8)).connect(pg).connect(lp);
  }

  // DCA : canons automatiques (« poum-poum » en rafale) et éclatements secs en altitude.
  flak(t, dest) {
    for (let r = 0; r < 2; r++) {
      const tr = t + r * (0.5 + Math.random() * 0.4), n = 4 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const ts = tr + i * 0.17;
        this.tone(ts, { f0: 150, f1: 60, peak: 0.3, attack: 0.002, decay: 0.12 }, dest);
        this.burst(ts, { type: 'bandpass', f0: 650, q: 1, peak: 0.22, attack: 0.001, decay: 0.07 }, dest);
      }
    }
    for (let i = 0; i < 5; i++) {
      const ta = t + 0.6 + Math.random() * 1.6;
      this.burst(ta, { type: 'highpass', f0: 2200, peak: 0.2, attack: 0.001, decay: 0.035 }, dest);
      this.burst(ta, { type: 'lowpass', f0: 700, f1: 200, peak: 0.16, attack: 0.003, decay: 0.3 }, dest);
    }
  }

  // Avion touché : moteur qui tousse, sifflement de chute, puis impact lointain.
  planeDown(t, fall, dest) {
    for (let i = 0; i < 6; i++) {
      const tc = t + i * (0.09 + Math.random() * 0.1);
      this.tone(tc, { wave: 'sawtooth', f0: 95, f1: 70, peak: 0.08, attack: 0.01, decay: 0.07 }, dest);
      if (Math.random() < 0.5) this.burst(tc, { type: 'lowpass', f0: 500, peak: 0.12, attack: 0.002, decay: 0.05 }, dest);
    }
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1150, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(260, t + fall);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.09, t + fall - 0.05);
    g.gain.linearRampToValueAtTime(0, t + fall);
    o.connect(g).connect(dest);
    o.start(t + 0.3);
    o.stop(t + fall + 0.05);
    this.blast(t + fall, 9, dest, false);
  }

  // Sirène de piqué : hurlement qui monte jusqu'au largage.
  siren(t, dur, dest) {
    const bp = this.filter('bandpass', 1000, 1.4);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    bp.connect(g).connect(dest);
    for (const d of [1, 1.012]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(260 * d, t);
      o.frequency.exponentialRampToValueAtTime(820 * d, t + dur);
      const vib = this.ctx.createOscillator();
      vib.frequency.value = 5.5;
      const vd = this.ctx.createGain();
      vd.gain.value = 12;
      vib.connect(vd).connect(o.frequency);
      o.connect(bp);
      o.start(t); vib.start(t);
      o.stop(t + dur + 0.3); vib.stop(t + dur + 0.3);
    }
  }

  // Passage en rase-mottes : moteur qui surgit et s'éloigne aussitôt, souffle.
  pass(t, dest) {
    this.burst(t, { type: 'bandpass', f0: 500, f1: 1400, q: 0.7, peak: 0.25, attack: 0.5, decay: 0.7 }, dest);
    for (const f of [92, 95]) this.tone(t, { wave: 'sawtooth', f0: f * 1.08, f1: f * 0.8, peak: 0.1, attack: 0.5, decay: 0.8 }, dest);
  }

  // Raid d'une mission (s : { kind, from, to, flak: [{ at (0..1 de l'approche), pan, gain }], downed }) ;
  // tick : durée d'un tick (s). Calé sur frontfx : approche sur 2,2 ticks, puis dégagement.
  raid(t, s, tick) {
    const life = tick * 4.4, arrive = life * 0.5;
    this.engines(t, life, arrive, s.from, s.to, s.kind === 'strike' ? 0.14 : 0.11);
    for (const a of s.flak ?? []) this.flak(t + a.at * arrive * 0.9, this.out(a.pan, a.gain));
    for (let i = 0; i < (s.downed ?? 0); i++) {
      const hit = t + life * 0.38 + i * 0.26;
      this.planeDown(hit, arrive - life * 0.38, this.out((s.from.pan + s.to.pan * 3) / 4, s.to.gain));
    }
  }

  // Frappe sur l'objectif (s.kind : strike, appui rapproché ; hunt, chasse de batterie ; s.first : premier passage).
  bombs(t, s, dest) {
    let tb = t;
    if (s.kind === 'strike' && s.first) { this.siren(t, 1.5, dest); tb = t + 1.4; }
    if (s.kind === 'hunt') {
      this.pass(t, dest);
      this.mg(t + 0.35, dest, 650, 0.2, 10);
      this.mg(t + 1.1, dest, 620, 0.18, 8);
      tb = t + 1.4;
    }
    const n = s.kind === 'strike' ? 5 : 2;
    for (let i = 0; i < n; i++) {
      const tt = tb + i * 0.15;
      this.whistle(tt, 0.35, dest, 0.05, 1700 + Math.random() * 300);
      this.blast(tt + 0.35, 9 + Math.random() * 4, this.out(s.pan + (i / (n - 1 || 1) - 0.5) * 0.3, s.gain), false);
    }
  }

  // Escadrille qui passe en altitude, au matin : ronronnement lointain d'un bord à l'autre.
  drone(t, dur) {
    const p = Math.random() < 0.5 ? -0.8 : 0.8;
    this.engines(t, dur, dur * 0.5, { pan: p, gain: 0.4 }, { pan: 0, gain: 0.6 }, 0.08);
  }

  // ---------- Mouvements ----------

  // groups : { tanks: [{ x, y }], foot: [{ x, y }] } — unités visibles qui se déplacent ; dur en secondes.
  // L'infanterie alterne d'un mouvement à l'autre : troupe en marche, puis assaut.
  movement(groups, dur) {
    if (!this.live || dur <= 0) return;
    const t = this.ctx.currentTime + 0.02;
    const where = (pts) => {
      const xs = pts.map((p) => this.locate(p.x, p.y));
      return { pan: xs.reduce((s, l) => s + l.pan, 0) / xs.length, gain: Math.max(...xs.map((l) => l.gain)) };
    };
    if (groups.tanks.length) this.tanks(t, dur, groups.tanks.length, where(groups.tanks));
    if (groups.foot.length) {
      this.assault = !this.assault;
      const { pan, gain } = where(groups.foot);
      (this.assault ? this.charge : this.march).call(this, t, dur, groups.foot.length, this.out(pan, gain));
    }
  }

  // Colonne blindée : démarrage avec pétarade, moteurs graves qui travaillent (un par char, jusqu'à quatre,
  // légèrement désaccordés), sous-basse, grincements et chocs de chenilles, puis le régime qui retombe.
  tanks(t, dur, count, { pan, gain }) {
    const ctx = this.ctx, end = t + dur, n = Math.min(4, count);
    const level = 0.15 * Math.min(1, 0.5 + count * 0.15) * gain;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.8);
    g.gain.setValueAtTime(level, end - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.9);
    g.connect(this.out(pan, 1));
    const lp = this.filter('lowpass', 300, 1.3);
    lp.connect(g);
    const stop = end + 1;
    const osc = (type, f, amt, dest) => {
      const o = ctx.createOscillator();
      o.type = type;
      // Régime : monte au démarrage, travaille (vibrato lent), retombe à l'arrêt.
      o.frequency.setValueAtTime(f * 0.6, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.8);
      o.frequency.setValueAtTime(f, end - 0.2);
      o.frequency.exponentialRampToValueAtTime(f * 0.55, end + 0.8);
      const vib = ctx.createOscillator();
      vib.frequency.value = 0.3 + Math.random() * 0.4;
      const vd = ctx.createGain();
      vd.gain.value = f * 0.04;
      vib.connect(vd).connect(o.frequency);
      const og = ctx.createGain();
      og.gain.value = amt;
      o.connect(og).connect(dest);
      o.start(t); vib.start(t);
      o.stop(stop); vib.stop(stop);
    };
    for (let i = 0; i < n; i++) {
      const d = 0.96 + Math.random() * 0.08;
      osc('sawtooth', 42 * d, 0.6, lp);
      osc('sawtooth', 63 * d, 0.35, lp);
    }
    osc('sine', 30, 1.2, g); // sous-basse : directement sur le bus, sans filtre
    const rumble = this.src(this.brown, t, dur + 1, true);
    const rg = ctx.createGain();
    rg.gain.value = 1.4;
    rumble.connect(rg).connect(lp);
    const dest = this.out(pan, gain);
    // Pétarade du démarrage.
    for (let i = 0; i < 7; i++) this.burst(t + 0.05 + i * (0.06 + Math.random() * 0.07), { type: 'lowpass', f0: 220, peak: 0.25, attack: 0.004, decay: 0.08 }, dest);
    // Chenilles : grincements métalliques irréguliers et chocs de maillons.
    for (let tt = t + 0.6; tt < end; tt += 0.25 + Math.random() * 0.6) {
      if (Math.random() < 0.45) this.burst(tt, { type: 'bandpass', f0: 1200 + Math.random() * 800, f1: 1100 + Math.random() * 900, q: 9, peak: 0.07, attack: 0.04, decay: 0.18 + Math.random() * 0.2 }, dest);
      else this.burst(tt, { type: 'bandpass', f0: 2400 + Math.random() * 900, q: 3, peak: 0.05, attack: 0.001, decay: 0.03 }, dest);
    }
    // Arrêt : dernier souffle grave.
    this.burst(end + 0.1, { type: 'lowpass', f0: 180, f1: 70, peak: 0.3 * gain, attack: 0.05, decay: 0.6, buffer: this.brown }, dest);
  }

  // Pas lourd de botte (le sol change avec la météo : neige étouffée, pluie qui clapote).
  step(t, peak, dest) {
    const snow = this.weather === 'snow', rain = this.weather === 'rain';
    this.burst(t, { type: 'lowpass', f0: snow ? 140 : 200, peak: peak * 1.3, attack: 0.004, decay: 0.07 }, dest);
    this.burst(t, { type: 'bandpass', f0: snow ? 500 : 350 + Math.random() * 400, q: 1.5, peak: peak * (snow ? 0.4 : 0.8), attack: snow ? 0.02 : 0.003, decay: 0.05 }, dest);
    if (rain) this.burst(t + 0.015, { type: 'bandpass', f0: 1500 + Math.random() * 600, q: 2.5, peak: peak * 0.5, attack: 0.01, decay: 0.08 }, dest);
  }

  // Troupe en marche : pas cadencés (≈ 2 par seconde) sur plusieurs rangs décalés, équipement qui s'entrechoque.
  march(t, dur, count, dest) {
    const end = t + dur, ranks = Math.min(4, 1 + count);
    for (let r = 0; r < ranks; r++) {
      const off = r * 0.11 + Math.random() * 0.05, pk = r === 0 ? 0.3 : 0.18;
      for (let tt = t + off; tt < end; tt += 0.5 + (Math.random() - 0.5) * 0.04) {
        this.step(tt, pk, dest);
        if (Math.random() < 0.18) this.burst(tt + 0.03, { type: 'bandpass', f0: 2800 + Math.random() * 1500, q: 6, peak: 0.08, attack: 0.001, decay: 0.04 }, dest);
      }
    }
  }

  // Assaut : clameur au départ (voix imitées par des voyelles filtrées), course rapide, souffles haletants.
  charge(t, dur, count, dest) {
    const end = t + dur, ctx = this.ctx;
    const shout = ctx.createGain();
    shout.gain.setValueAtTime(0.0001, t);
    shout.gain.exponentialRampToValueAtTime(0.12, t + 0.3);
    shout.gain.setValueAtTime(0.12, t + 0.9);
    shout.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    shout.connect(dest);
    const vowel = [this.filter('bandpass', 700, 6), this.filter('bandpass', 1150, 7)];
    for (const v of vowel) v.connect(shout);
    for (let i = 0; i < Math.min(6, 2 + count); i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f = 120 + Math.random() * 90;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 1.3, t + 0.5);
      o.frequency.exponentialRampToValueAtTime(f * 1.15, t + 1.6);
      for (const v of vowel) o.connect(v);
      o.start(t + Math.random() * 0.15);
      o.stop(t + 1.8);
    }
    const ranks = Math.min(4, 1 + count);
    for (let r = 0; r < ranks; r++) {
      for (let tt = t + 0.4 + Math.random() * 0.2; tt < end; tt += 0.2 + Math.random() * 0.08) this.step(tt, r === 0 ? 0.25 : 0.14, dest);
    }
    // Halètements : bouffées de souffle rythmées.
    for (let tt = t + 0.8; tt < end; tt += 0.32 + Math.random() * 0.12) {
      this.burst(tt, { type: 'bandpass', f0: 900 + Math.random() * 300, q: 1.2, peak: 0.07, attack: 0.05, decay: 0.12 }, dest);
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
      // Transmission radio : grésillement, message en morse, puis le combiné qu'on raccroche.
      this.burst(t, { type: 'bandpass', f0: 1500, q: 0.7, peak: 0.08, attack: 0.02, decay: 0.45 }, dest);
      for (let i = 0; i < 10; i++) this.burst(t + Math.random() * 0.5, { type: 'highpass', f0: 3000, peak: 0.05, attack: 0.001, decay: 0.015 }, dest);
      let tt = t + 0.4;
      for (const c of '-.-.--.-..') {
        const len = c === '-' ? 0.12 : 0.045;
        this.tone(tt, { wave: 'sine', f0: 760, peak: 0.05, attack: 0.004, decay: len }, dest);
        tt += len + 0.06;
      }
      this.burst(tt + 0.15, { type: 'lowpass', f0: 400, peak: 0.3, attack: 0.001, decay: 0.05 }, dest);
      this.burst(tt + 0.15, { type: 'bandpass', f0: 2000, q: 2, peak: 0.15, attack: 0.001, decay: 0.03 }, dest);
    } else if (kind === 'bell') {
      // Cloche de fin de tour : partiels inharmoniques.
      for (const [r, a] of [[1, 0.12], [2.76, 0.05], [5.4, 0.025]]) this.tone(t, { f0: 660 * r, peak: a, attack: 0.003, decay: 1.4 / r }, dest);
    }
  }
}

export const sound = new AudioBoard();
