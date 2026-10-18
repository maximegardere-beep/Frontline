// Sons du champ de bataille, entièrement synthétisés (Web Audio) : aucun fichier, aucune dépendance.
// Tirs et explosions suivent la chronologie des effets visuels ; moteurs et pas pendant les mouvements ;
// raids aériens (moteurs, DCA, piqué, bombes) ; vent et canonnade lointaine en fond ; quelques sons d'interface ;
// musique du menu et du briefing, notes du bilan, télégrammes, téléscripteur, et la pièce du QG (téléphone, machine à
// écrire le matin, poêle le soir).
// Une réverbération de plaine (réponse impulsionnelle synthétisée) fait rouler les détonations au loin.
// Sans Web Audio (Node, tests), toutes les méthodes sont sans effet.

const MUTE_KEY = 'frontline.mute';
const mf = (m) => 440 * 2 ** ((m - 69) / 12); // note MIDI → fréquence

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
    this.summer = false;
    this.winter = false;
    this.mus = null; // musique en cours : { kind, bus, timer }
    this.musWanted = null;
    this.rm = null; // pièce du QG : { kind, bus, timer }
    this.roomWanted = null;
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
      // Compresseur de sortie, presque un limiteur : les gros calibres et leur réverbération ne saturent pas.
      this.comp.threshold.value = -18;
      this.comp.knee.value = 8;
      this.comp.ratio.value = 12;
      this.comp.attack.value = 0.002;
      this.comp.release.value = 0.25;
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
      // Saturation douce (tanh) : les coups graves gagnent des harmoniques, audibles même sur un haut-parleur de téléphone.
      this.curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = (i / 511.5) - 1; this.curve[i] = Math.tanh(2.6 * x) / Math.tanh(2.6); }
      // Réverbération : chaque son y envoie une part de lui-même (plus forte s'il est lointain).
      this.verb = ctx.createConvolver();
      this.verb.buffer = this.plainImpulse();
      const wet = ctx.createGain();
      wet.gain.value = 0.38;
      this.verb.connect(this.filter('lowpass', 3200)).connect(wet).connect(this.master);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.ctx.suspend();
        else if (!this.muted) this.ctx.resume();
      });
    }
    if (this.ctx.state === 'suspended' && !this.muted) this.ctx.resume();
    if (this.ambWanted) this.ambient(true);
    if (this.musWanted && !this.mus) this.music(this.musWanted);
    if (this.roomWanted && !this.rm) this.room(this.roomWanted);
  }

  // Réponse impulsionnelle d'une plaine ouverte : quelques échos francs (lisière, village, colline), puis une queue
  // diffuse qui s'assombrit en s'éteignant (≈ 3 s) ; légèrement différente à gauche et à droite.
  plainImpulse() {
    const ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(sr * 3.2);
    const ir = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let y = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const c = 0.5 * Math.exp(-t * 1.6) + 0.03; // filtre passe-bas qui se referme
        y += c * ((Math.random() * 2 - 1) - y);
        d[i] = y * Math.min(1, t / 0.02) * Math.exp(-t / 0.75) * 0.9;
      }
      for (let e = 0; e < 6; e++) {
        const at = Math.floor(sr * (0.07 + e * 0.08 + Math.random() * 0.12)), amp = 0.5 * Math.exp(-e * 0.35);
        let z = 0;
        for (let i = 0; i < sr * 0.03 && at + i < len; i++) { z += 0.25 * ((Math.random() * 2 - 1) - z); d[at + i] += z * amp * Math.exp(-i / (sr * 0.008)); }
      }
    }
    return ir;
  }

  get live() { return !!this.ctx && !this.muted; }

  setMuted(m) {
    this.muted = m;
    try { globalThis.localStorage?.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* idem */ }
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : 0.8, t, 0.05);
    if (m) { this.stopAmbient(); this.stopMusic(); this.stopRoom(); }
    else { this.ctx.resume(); this.ambient(this.ambWanted); this.room(this.roomWanted); this.music(this.musWanted); }
  }

  // ---------- Briques ----------

  // Sortie placée dans l'espace stéréo ; wet : part envoyée à la réverbération (davantage pour un son lointain).
  out(pan = 0, gain = 1, wet = 0.32) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    if (wet > 0 && this.verb) {
      const w = this.ctx.createGain();
      w.gain.value = wet * Math.max(0.45, gain) * (1.6 - gain * 0.6);
      g.connect(w).connect(this.verb);
    }
    return g;
  }

  // Saturation douce, vers dest.
  drive(dest) {
    const w = this.ctx.createWaveShaper();
    w.curve = this.curve;
    w.connect(dest);
    return w;
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
  tone(t, { wave = 'sine', f0, f1 = f0, peak, attack = 0.004, decay, sat = false }, dest) {
    const o = this.ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    o.connect(this.env(t, peak, attack, decay)).connect(sat ? this.drive(dest) : dest);
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

  // Départ de coup : claquement de bouche (de près), coup sourd saturé qui glisse vers le grave, souffle qui roule.
  cannon(t, dest, far, heavy) {
    const v = 0.9 + Math.random() * 0.2;
    const k = far ? 0.5 : 1;
    if (!far) this.burst(t, { type: 'bandpass', f0: 1300, q: 0.6, peak: 0.4, attack: 0.001, decay: 0.05 }, dest);
    this.tone(t, { f0: (heavy ? 62 : 80) * v, f1: 26, peak: 0.85 * k, attack: 0.004, decay: heavy ? 0.9 : 0.6, sat: true }, dest);
    this.burst(t, { type: 'lowpass', f0: far ? 380 : 900, f1: 70, peak: 0.85 * k, attack: 0.005, decay: heavy ? 1.5 : 1.0 }, dest);
    this.burst(t + 0.02, { type: 'lowpass', f0: 120, peak: 0.5 * k, attack: 0.02, decay: heavy ? 1.8 : 1.2, buffer: this.brown }, dest);
  }

  // Rafale de mitrailleuse lointaine : claquements secs et rapprochés.
  mg(t, dest, f = 1100, peak = 0.16, shots = 5 + ((Math.random() * 4) | 0)) {
    const v = 0.9 + Math.random() * 0.2;
    for (let i = 0; i < shots; i++) this.burst(t + i * 0.065, { type: 'bandpass', f0: f * v, q: 1.1, peak, attack: 0.001, decay: 0.05 }, dest);
  }

  // Mitrailleuses au contact, reconnaissables à l'oreille : la MG 42 allemande déchire (20 coups/s, claquement aigu),
  // la Maxim soviétique bat lourdement (10 coups/s, plus grave). side : 0 Wehrmacht, 1 Armée rouge.
  mgSide(t, dest, side) {
    const de = side === 0, gap = de ? 0.05 : 0.1;
    const n = de ? 8 + ((Math.random() * 14) | 0) : 10 + ((Math.random() * 12) | 0);
    for (let i = 0; i < n; i++) {
      const tt = t + i * gap * (de ? 1 : 0.97 + Math.random() * 0.06);
      this.burst(tt, { type: 'bandpass', f0: (de ? 1500 : 900) * (0.95 + Math.random() * 0.1), q: 0.9, peak: de ? 0.22 : 0.26, attack: 0.001, decay: de ? 0.03 : 0.05 }, dest);
      this.burst(tt, { type: 'lowpass', f0: de ? 320 : 220, peak: de ? 0.19 : 0.28, attack: 0.002, decay: de ? 0.045 : 0.08 }, dest);
    }
  }

  // Canon antichar : claquement supersonique au départ, puis l'obus sur le blindage, sonnerie métallique (coup au
  // but) ou ricochet qui miaule. gun, tgt : sorties de la pièce et de la cible.
  pak(t, gun, tgt) {
    this.burst(t, { type: 'highpass', f0: 2500, peak: 0.6, attack: 0.001, decay: 0.015 }, gun);
    this.burst(t, { type: 'bandpass', f0: 1800, peak: 0.35, attack: 0.001, decay: 0.05 }, gun);
    this.tone(t, { f0: 110, f1: 40, peak: 0.55, attack: 0.003, decay: 0.5, sat: true }, gun);
    this.burst(t + 0.01, { type: 'lowpass', f0: 600, f1: 90, peak: 0.4, attack: 0.004, decay: 0.8 }, gun);
    const ti = t + 0.3 + Math.random() * 0.15;
    if (Math.random() < 0.65) {
      for (const [f, a, d] of [[523, 0.11, 0.9], [1311, 0.08, 0.6], [2087, 0.06, 0.4], [3150, 0.04, 0.3]]) this.tone(ti, { f0: f * (0.98 + Math.random() * 0.04), peak: a, attack: 0.001, decay: d }, tgt);
      this.burst(ti, { type: 'bandpass', f0: 2600, q: 0.8, peak: 0.3, attack: 0.001, decay: 0.04 }, tgt);
      this.burst(ti, { type: 'lowpass', f0: 400, peak: 0.28, attack: 0.002, decay: 0.25 }, tgt);
    } else {
      this.tone(ti, { f0: 1700, peak: 0.06, attack: 0.001, decay: 0.15 }, tgt);
      const ctx = this.ctx, o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(3000, ti + 0.02);
      o.frequency.exponentialRampToValueAtTime(1300, ti + 0.7);
      const vib = ctx.createOscillator();
      vib.frequency.value = 28;
      const vd = ctx.createGain();
      vd.gain.value = 70;
      vib.connect(vd).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ti);
      g.gain.exponentialRampToValueAtTime(0.06, ti + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, ti + 0.75);
      o.connect(g).connect(tgt);
      o.start(ti); vib.start(ti); o.stop(ti + 0.8); vib.stop(ti + 0.8);
    }
  }

  // Obus qui arrive : de l'air déchiré plutôt qu'un sifflet. Un chuintement en bande étroite qui descend et enfle
  // jusqu'à l'impact, une note sourde qui glisse dessous, un froissement grave dans la dernière fraction de seconde.
  // f0 : hauteur nominale (les gros calibres plus bas).
  whistle(t, dur, dest, level = 0.09, f0 = 1500 + Math.random() * 400) {
    if (dur < 0.25) return;
    const ctx = this.ctx, end = t + dur, fa = f0 * 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level * 0.5, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(level * 1.6, end - 0.04);
    g.gain.linearRampToValueAtTime(0, end);
    g.connect(dest);
    const air = this.src(this.noise, t, dur + 0.02);
    const bp = this.filter('bandpass', fa, 5);
    bp.frequency.setValueAtTime(fa, t);
    bp.frequency.exponentialRampToValueAtTime(fa * 0.38, end);
    air.connect(bp).connect(g);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(fa * 0.5, t);
    o.frequency.exponentialRampToValueAtTime(fa * 0.16, end);
    const og = ctx.createGain();
    og.gain.value = 0.22;
    o.connect(og).connect(this.filter('lowpass', 900)).connect(g);
    o.start(t);
    o.stop(end + 0.02);
    this.burst(end - 0.18, { type: 'lowpass', f0: 500, f1: 160, peak: level * 1.2, attack: 0.12, decay: 0.06 }, dest);
  }

  // Explosion : claquement bref, souffle qui s'assombrit, coup sourd saturé, long grondement, puis la terre
  // soulevée qui retombe en mottes.
  blast(t, size, dest, kill) {
    const k = Math.min(1.3, size / 18);
    const decay = (kill ? 2.0 : 1.3) * Math.max(0.6, k);
    this.burst(t, { type: 'bandpass', f0: 1100, q: 0.5, peak: 0.28 * k, attack: 0.002, decay: 0.05 }, dest);
    this.burst(t, { type: 'lowpass', f0: 1100, f1: 70, peak: 0.8 * k, attack: 0.005, decay }, dest);
    this.burst(t, { type: 'lowpass', f0: 130, peak: 0.85 * k, attack: 0.012, decay: decay * 1.5, buffer: this.brown }, dest);
    this.tone(t, { f0: 70, f1: 22, peak: 0.7 * k, attack: 0.006, decay: decay * 0.8, sat: true }, dest);
    for (let i = 0; i < 3 + k * 3; i++) {
      this.burst(t + 0.35 + Math.random() * 0.9, { type: 'lowpass', f0: 380 + Math.random() * 400, peak: 0.05 + 0.06 * Math.random() * k, attack: 0.004, decay: 0.06 }, dest);
    }
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
        // Mitrailleuses : un camp puis l'autre, au hasard de qui ouvre le feu.
        const first = Math.random() < 0.5 ? 0 : 1;
        for (let i = 0; i < Math.min(2, Math.max(s.n >= 2 ? 1 : 0, Math.floor(s.n / 3))); i++) this.mgSide(at(0.7), dest, i % 2 ? 1 - first : first);
        // Percée blindée qui bute sur un secteur tenu : les antichars répondent.
        if (s.armor > 0) for (let i = 0; i < Math.min(2, 1 + Math.floor(s.armor * 0.1)); i++) if (Math.random() < 0.7) this.pak(at(0.8), this.out(s.pan - 0.15, s.gain * 0.9), dest);
        // Blindés au contact : départs de canons plus nombreux et plus proches.
        const guns = s.armor > 0 ? Math.min(3, 1 + Math.floor(s.armor * 0.2)) : Math.min(2, Math.floor(s.n / 4));
        for (let i = 0; i < guns; i++) this.cannon(at(), dest, !(s.armor > 0 && i === 0), Math.random() < 0.3);
      } else if (s.k === 'barrage') {
        const guns = s.gun ? this.out(s.gun.pan, s.gun.gain) : null;
        const play = { rocket: this.katyusha, nebel: this.nebel, mortar: this.mortars }[s.kind] ?? this.barrage;
        play.call(this, t0 + Math.random() * dur * 0.3, dest, guns, s.kind === 'heavy');
      }
      else if (s.k === 'shell') { const t = at(0.7); this.whistle(t, 0.8, dest); this.blast(t + 0.8, 6, dest); }
      else if (s.k === 'town') { this.blast(t0, 24, dest, true); this.telegram(t0 + 1.6, s.won ? 'VILLE PRISE' : 'VILLE PERDUE'); }
      else if (s.k === 'bridge') this.bridge(t0 + Math.random() * dur * 0.3, dest);
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
  barrage(t, dest, guns, heavy = false) {
    const from = guns ?? dest;
    const n = 3 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) this.cannon(t + i * (0.13 + Math.random() * 0.05), from, true, true);
    const tw = t + n * 0.15 + 0.4 + Math.random() * 0.2;
    const fall = 0.9 + Math.random() * 0.4;
    for (let i = 0; i < 3; i++) {
      const d = fall + (Math.random() - 0.5) * 0.25;
      this.whistle(tw + i * 0.09, d, dest, 0.07, (heavy ? 900 : 1150) + Math.random() * 500);
    }
    const ti = tw + fall;
    for (let c = 0; c < 3; c++) {
      const tc = ti + c * (0.28 + Math.random() * 0.2);
      for (let i = 0; i < 2 + (Math.random() < 0.5); i++) this.blast(tc + i * (0.04 + Math.random() * 0.07), (heavy ? 18 : 13) + Math.random() * 8, dest, false);
    }
    // Queue : grondement sourd qui remplit l'espace, et retombées de terre.
    this.burst(ti + 0.2, { type: 'lowpass', f0: 140, f1: 50, peak: 0.45, attack: 0.25, decay: 3.2, buffer: this.brown }, dest);
    for (let i = 0; i < 7; i++) {
      this.burst(ti + 0.5 + Math.random() * 1.6, { type: 'bandpass', f0: 2500 + Math.random() * 2500, q: 1.5, peak: 0.02 + Math.random() * 0.03, attack: 0.002, decay: 0.03 }, dest);
    }
  }

  // Orgues de Staline : les rails crachent leurs roquettes en rafale, chacune dans un feulement rauque qui file au
  // loin ; un hurlement collectif en l'air ; puis un chapelet d'impacts serrés qui balaie la zone.
  katyusha(t, dest, guns) {
    const from = guns ?? this.out(0, 0.25, 0.6);
    const n = 12 + ((Math.random() * 5) | 0);
    for (let i = 0; i < n; i++) {
      const tl = t + i * (0.11 + Math.random() * 0.06);
      this.burst(tl, { type: 'bandpass', f0: 350, f1: 1600, q: 1.4, peak: guns ? 0.3 : 0.12, attack: 0.03, decay: 0.55 }, from);
      this.burst(tl, { type: 'lowpass', f0: 200, peak: guns ? 0.35 : 0.12, attack: 0.01, decay: 0.2, buffer: this.brown }, from);
      for (let c = 0; c < 3; c++) this.burst(tl + 0.03 + c * 0.05, { type: 'highpass', f0: 2600, peak: 0.04, attack: 0.001, decay: 0.02 }, from);
    }
    const ti = t + 2.2 + Math.random() * 0.3;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, ti - 1.4);
    g.gain.exponentialRampToValueAtTime(0.06, ti - 0.1);
    g.gain.linearRampToValueAtTime(0, ti);
    g.connect(dest);
    const air = this.src(this.noise, ti - 1.4, 1.45);
    const bp = this.filter('bandpass', 1300, 2.5);
    bp.frequency.setValueAtTime(1300, ti - 1.4);
    bp.frequency.exponentialRampToValueAtTime(520, ti);
    air.connect(bp).connect(g);
    for (let i = 0; i < n; i++) {
      const tb = ti + i * (0.07 + Math.random() * 0.06);
      this.blast(tb, 9 + Math.random() * 5, dest, false);
    }
    this.burst(ti + 0.3, { type: 'lowpass', f0: 140, f1: 50, peak: 0.6, attack: 0.3, decay: 3, buffer: this.brown }, dest);
  }

  // Mortiers lourds de 120 mm : le « tchonk » creux des tubes, un sifflement court et haut, des impacts secs,
  // plus médiums que graves.
  mortars(t, dest, tubes) {
    const from = tubes ?? this.out(0, 0.25, 0.6);
    const n = 4 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const tt = t + i * (0.35 + Math.random() * 0.1);
      this.tone(tt, { f0: 160, f1: 90, peak: tubes ? 0.45 : 0.15, attack: 0.002, decay: 0.15, sat: true }, from);
      this.burst(tt, { type: 'bandpass', f0: 400, q: 3, peak: tubes ? 0.3 : 0.1, attack: 0.001, decay: 0.12 }, from);
      this.burst(tt + 0.01, { type: 'lowpass', f0: 250, peak: tubes ? 0.26 : 0.1, attack: 0.003, decay: 0.2 }, from);
      this.whistle(tt + 1.1, 0.7, dest, 0.05, 2300 + Math.random() * 400);
      this.blast(tt + 1.8, 11 + Math.random() * 3, dest, false);
    }
  }

  // Nebelwerfer : six tubes qui partent en gémissant (la « vache qui meugle »), puis six impacts lourds.
  nebel(t, dest, guns) {
    const ctx = this.ctx, from = guns ?? this.out(0, 0.3, 0.6), lvl = guns ? 0.12 : 0.05;
    for (let i = 0; i < 6; i++) {
      const tl = t + i * (0.2 + Math.random() * 0.06), end = tl + 1.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tl);
      g.gain.exponentialRampToValueAtTime(lvl, tl + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      const bp = this.filter('bandpass', 700, 2);
      bp.connect(g).connect(from);
      const sat = this.drive(bp);
      for (const d of [1, 1.013]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(220 * d, tl);
        o.frequency.exponentialRampToValueAtTime(520 * d, tl + 0.9);
        o.frequency.exponentialRampToValueAtTime(430 * d, end);
        const og = ctx.createGain();
        og.gain.value = 0.35;
        o.connect(og).connect(sat);
        o.start(tl); o.stop(end + 0.05);
      }
      this.burst(tl, { type: 'bandpass', f0: 500, f1: 1500, q: 1.2, peak: guns ? 0.2 : 0.07, attack: 0.04, decay: 0.7 }, from);
      this.blast(t + 2.5 + i * (0.14 + Math.random() * 0.08), 16 + Math.random() * 5, dest, false);
    }
    this.burst(t + 2.8, { type: 'lowpass', f0: 140, f1: 50, peak: 0.5, attack: 0.3, decay: 3, buffer: this.brown }, dest);
  }

  // Pont qui saute : charge de démolition, gerbe d'eau qui retombe, débris qui claquent dans la rivière, poutres
  // qui gémissent.
  bridge(t, dest) {
    this.blast(t, 30, dest, false);
    this.burst(t + 0.25, { type: 'bandpass', f0: 1200, f1: 4000, q: 0.6, peak: 0.2, attack: 0.3, decay: 1.8 }, dest);
    for (let i = 0; i < 16; i++) this.burst(t + 0.9 + Math.random() * 2.6, { type: 'bandpass', f0: 600 + Math.random() * 1900, q: 1.5, peak: 0.05 + Math.random() * 0.07, attack: 0.004, decay: 0.12 + Math.random() * 0.1 }, dest);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t + 2.3);
    o.frequency.linearRampToValueAtTime(70, t + 3.5);
    o.connect(this.filter('bandpass', 600, 8)).connect(this.env(t + 2.3, 0.1, 0.2, 1.1)).connect(dest);
    o.start(t + 2.3); o.stop(t + 3.7);
    this.burst(t + 3.4, { type: 'lowpass', f0: 300, peak: 0.3, attack: 0.005, decay: 0.3 }, dest);
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
    if (this.verb) { const w = ctx.createGain(); w.gain.value = 0.25; out.node.connect(w).connect(this.verb); }
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

  // « Trompette de Jéricho » du Stuka en piqué : une sirène entraînée par le vent relatif, dont le hurlement monte
  // avec la vitesse. Timbre de tuyau (dents de scie désaccordées et saturées, trois formants), battement irrégulier,
  // souffle de l'air, et sous elle le moteur qui rugit de plus en plus fort.
  siren(t, dur, dest) {
    const ctx = this.ctx, end = t + dur, stop = end + 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.11, end);
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.3);
    g.connect(dest);
    const sum = ctx.createGain();
    for (const [f, q, a] of [[480, 3, 1], [1150, 4, 0.7], [2400, 5, 0.35]]) {
      const bp = this.filter('bandpass', f, q);
      const bg = ctx.createGain();
      bg.gain.value = a;
      sum.connect(bp).connect(bg).connect(g);
    }
    const sat = this.drive(sum);
    const wob = [ctx.createOscillator(), ctx.createOscillator()];
    wob[0].frequency.value = 3.7 + Math.random(); wob[1].frequency.value = 6.1 + Math.random();
    for (const [i, d] of [[0, 1], [1, 1.007], [2, 0.5]]) {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'square' : 'sawtooth';
      o.frequency.setValueAtTime(175 * d, t);
      o.frequency.exponentialRampToValueAtTime(230 * d, t + dur * 0.4);
      o.frequency.exponentialRampToValueAtTime(410 * d, end);
      for (const w of wob) { const wd = ctx.createGain(); wd.gain.value = 3 * d; w.connect(wd).connect(o.frequency); }
      const og = ctx.createGain();
      og.gain.value = i === 2 ? 0.25 : 0.4;
      o.connect(og).connect(sat);
      o.start(t); o.stop(stop);
    }
    for (const w of wob) { w.start(t); w.stop(stop); }
    // Souffle de l'air qui siffle sur la cellule.
    const air = this.src(this.noise, t, dur + 0.35);
    const ab = this.filter('bandpass', 700, 0.9);
    ab.frequency.setValueAtTime(700, t);
    ab.frequency.exponentialRampToValueAtTime(1900, end);
    const ag = ctx.createGain();
    ag.gain.setValueAtTime(0.0001, t);
    ag.gain.exponentialRampToValueAtTime(0.05, end);
    ag.gain.exponentialRampToValueAtTime(0.0001, end + 0.3);
    air.connect(ab).connect(ag).connect(dest);
    // Moteur : grondement qui enfle, puis la ressource (régime qui retombe en s'éloignant).
    this.roar(t, dur + 1.6, dur, dest);
  }

  // Moteur d'un avion qui pique puis dégage : régime qui monte, crête à l'instant peak (s), puis s'éloigne.
  roar(t, dur, peak, dest) {
    const ctx = this.ctx, end = t + dur, tp = t + peak;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, tp);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    const lp = this.filter('lowpass', 260, 0.8);
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.exponentialRampToValueAtTime(700, tp);
    lp.frequency.exponentialRampToValueAtTime(220, end);
    lp.connect(g).connect(dest);
    for (const f of [72, 74.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.9, t);
      o.frequency.linearRampToValueAtTime(f * 1.12, tp);
      o.frequency.linearRampToValueAtTime(f * 0.8, end);
      o.connect(lp);
      o.start(t); o.stop(end + 0.05);
    }
    const rum = this.src(this.brown, t, dur + 0.05, true);
    const rg = ctx.createGain();
    rg.gain.value = 1.6;
    rum.connect(rg).connect(lp);
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

  // Il-2 Sturmovik en rase-mottes : surgit bas d'un côté, salve de roquettes, rafales de canons de 23 mm, et
  // repart de l'autre côté, moteur en Doppler.
  sturmovik(t, s) {
    const ctx = this.ctx, end = t + 4.5, tp = t + 1.6, side = Math.random() < 0.5 ? -1 : 1;
    const m = this.outMoving(-0.95 * side, 1);
    if (m.pan) { m.pan.setValueAtTime(s.pan - 0.8 * side, t); m.pan.linearRampToValueAtTime(s.pan, tp); m.pan.linearRampToValueAtTime(s.pan + 0.8 * side, end); }
    const peak = 0.5 * Math.max(0.3, s.gain);
    m.gain.setValueAtTime(0.0001, t);
    m.gain.exponentialRampToValueAtTime(peak, tp);
    m.gain.exponentialRampToValueAtTime(0.0001, end);
    if (this.verb) { const w = ctx.createGain(); w.gain.value = 0.28; m.node.connect(w).connect(this.verb); }
    const lp = this.filter('lowpass', 300, 0.8);
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(900, tp);
    lp.frequency.exponentialRampToValueAtTime(250, end);
    lp.connect(m.node);
    for (const f of [80, 82.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 1.1, t);
      o.frequency.linearRampToValueAtTime(f * 1.02, tp);
      o.frequency.linearRampToValueAtTime(f * 0.85, tp + 0.5);
      o.connect(lp);
      o.start(t); o.stop(end);
    }
    const r = this.src(this.brown, t, end - t, true);
    const rg = ctx.createGain();
    rg.gain.value = 1.6;
    r.connect(rg).connect(lp);
    const air = this.out(s.pan - 0.1 * side, 0.8 * s.gain), zone = this.out(s.pan, s.gain);
    for (let i = 0; i < 4; i++) this.burst(t + 0.9 + i * 0.12, { type: 'bandpass', f0: 600, f1: 2200, q: 1.3, peak: 0.22, attack: 0.02, decay: 0.45 }, air);
    for (const t1 of [t + 1.15, t + 1.65]) {
      for (let i = 0; i < 8; i++) {
        const tt = t1 + i * 0.1;
        this.tone(tt, { f0: 130, f1: 60, peak: 0.26, attack: 0.002, decay: 0.08, sat: true }, air);
        this.burst(tt, { type: 'bandpass', f0: 800, peak: 0.22, attack: 0.001, decay: 0.05 }, air);
      }
    }
    for (let i = 0; i < 4; i++) this.blast(t + 1.5 + i * 0.13, 10 + Math.random() * 3, zone, false);
  }

  // Frappe sur l'objectif (s.kind : strike, appui rapproché ; hunt, chasse de batterie ; s.first : premier passage).
  // Appui rapproché soviétique : les Sturmovik, en rase-mottes, au lieu des Stuka en piqué.
  bombs(t, s, dest) {
    if (s.kind === 'strike' && s.side === 1) return this.sturmovik(t, s);
    let tb = t;
    if (s.kind === 'strike' && s.first) { this.siren(t, 2.3, dest); tb = t + 2.1; }
    if (s.kind === 'hunt') {
      this.pass(t, dest);
      this.mg(t + 0.35, dest, 650, 0.2, 10);
      this.mg(t + 1.1, dest, 620, 0.18, 8);
      tb = t + 1.4;
    }
    const n = s.kind === 'strike' ? 5 : 2;
    for (let i = 0; i < n; i++) {
      const tt = tb + i * 0.15;
      this.whistle(tt, 0.45, dest, 0.05, 1300 + Math.random() * 300);
      this.blast(tt + 0.45, 14 + Math.random() * 5, this.out(s.pan + (i / (n - 1 || 1) - 0.5) * 0.3, s.gain), false);
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

  // Le fond sonore suit la météo : pluie, vent de neige, calme du brouillard ; summer : juillet ou août (grillons et
  // alouette par temps clair) ; winter : novembre (le vent siffle, même sans neige).
  setWeather(kind, summer = false, winter = false) {
    if (kind === this.weather && summer === this.summer && winter === this.winter) return;
    this.weather = kind;
    this.summer = summer;
    this.winter = winter;
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
    // Hiver : deux sifflements dans les fils et les branches, à gauche et à droite. Le filtre étroit glisse au gré de
    // deux oscillations lentes de périodes différentes, ce qui ne revient jamais tout à fait au même.
    if (w === 'snow' || this.winter) {
      for (const [pan, f0, a, b] of [[-0.5, 760, 0.13, 0.31], [0.45, 820, 0.17, 0.23]]) {
        const n = this.src(this.noise, t, null, true), f = this.filter('bandpass', f0, 14), g = ctx.createGain();
        g.gain.value = 0.11;
        const mods = [[f.frequency, a, 190], [f.frequency, b, 110], [g.gain, a * 0.7, 0.07]].map(([param, fr, depth]) => {
          const o = ctx.createOscillator(), d = ctx.createGain();
          o.frequency.value = fr; d.gain.value = depth;
          o.connect(d).connect(param); o.start(t);
          return o;
        });
        const p = ctx.createStereoPanner?.();
        n.connect(f).connect(g);
        if (p) { p.pan.value = pan; g.connect(p).connect(bus); } else g.connect(bus);
        if (this.verb) { const v = ctx.createGain(); v.gain.value = 0.25; g.connect(v).connect(this.verb); }
        nodes.push(n, ...mods);
      }
    }
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
    this.amb = { bus, nodes, timer: null, steppe: null, fire: null };
    this.scheduleDistant();
    if (this.summer && w === 'clear') this.scheduleSteppe();
  }

  // Steppe en été : grillons en trains de trois impulsions (quatre individus en stéréo), alouette qui grisolle haut
  // de temps en temps. Programmé par tranches de 4 s ; le calme rend le premier coup de canon plus brutal.
  scheduleSteppe() {
    if (!this.amb) return;
    const t = this.ctx.currentTime + 0.05, span = 4;
    if (!this.amb.crickets) this.amb.crickets = [0, 1, 2, 3].map((c) => ({ f: 4400 + Math.random() * 500, pan: -0.8 + c * 0.53, per: 0.45 + Math.random() * 0.2, next: Math.random() * 0.4 }));
    for (const c of this.amb.crickets) {
      const out = this.ambOut(c.pan, 0.5, 0.15);
      for (; c.next < span; c.next += c.per) for (let k = 0; k < 3; k++) this.tone(t + c.next + k * 0.03, { f0: c.f, peak: 0.022, attack: 0.003, decay: 0.018 }, out);
      c.next -= span;
    }
    if (Math.random() < 0.3) {
      const ctx = this.ctx, a = t + Math.random() * 1.5, b = a + 1.4 + Math.random() * 1.2;
      const o = ctx.createOscillator();
      for (let tt = a; tt < b; tt += 0.06) o.frequency.setTargetAtTime(3000 + Math.random() * 1500, tt, 0.012);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, a);
      g.gain.exponentialRampToValueAtTime(0.025, a + 0.1);
      g.gain.setValueAtTime(0.025, b - 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, b);
      o.connect(g).connect(this.ambOut(Math.random() * 1.2 - 0.6, 0.5, 0.35));
      o.start(a); o.stop(b + 0.05);
    }
    this.amb.steppe = setTimeout(() => this.scheduleSteppe(), span * 1000);
  }

  // Sortie du fond sonore (s'éteint avec lui).
  ambOut(pan, gain, wet) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const p = this.ctx.createStereoPanner?.();
    if (p) { p.pan.value = pan; g.connect(p).connect(this.amb.bus); } else g.connect(this.amb.bus);
    if (wet > 0 && this.verb) { const w = this.ctx.createGain(); w.gain.value = wet; g.connect(w).connect(this.verb); }
    return g;
  }

  // Ville en flammes : grondement d'incendie tant qu'elle brûle sous nos yeux, crépitement de bois, et de temps en
  // temps une charpente qui s'effondre. spot : { pan, gain, heat 0..1 } du plus gros incendie visible, ou null.
  setFire(spot) {
    if (!this.amb) return;
    const ctx = this.ctx, t = ctx.currentTime;
    let F = this.amb.fire;
    if (!spot) {
      if (F) F.g.gain.setTargetAtTime(0.0001, t, 1.2);
      if (F) F.level = 0;
      return;
    }
    if (!F) {
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      const p = ctx.createStereoPanner?.();
      if (p) g.connect(p).connect(this.amb.bus); else g.connect(this.amb.bus);
      if (this.verb) { const w = ctx.createGain(); w.gain.value = 0.3; g.connect(w).connect(this.verb); }
      const roar = this.src(this.brown, t, null, true);
      const rg = ctx.createGain();
      rg.gain.value = 0.55;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.7;
      const lg = ctx.createGain();
      lg.gain.value = 0.15;
      lfo.connect(lg).connect(rg.gain);
      lfo.start(t);
      roar.connect(this.filter('lowpass', 300)).connect(rg).connect(g);
      this.amb.nodes.push(roar, lfo);
      F = this.amb.fire = { g, pan: p?.pan ?? null, level: 0, timer: null };
      const crackle = () => {
        if (this.amb?.fire !== F) return;
        if (F.level > 0.02) {
          const t1 = this.ctx.currentTime + 0.02;
          for (let i = 0; i < 25; i++) this.burst(t1 + Math.random(), { type: 'bandpass', f0: 1500 + Math.random() * 3000, q: 2.5, peak: 0.03 + Math.random() * 0.07, attack: 0.001, decay: 0.012 + Math.random() * 0.02 }, g);
          // Charpente qui s'effondre : coup sourd, éclats de bois, gravats.
          if (Math.random() < 0.08) {
            const tc = t1 + Math.random() * 0.5;
            this.burst(tc, { type: 'lowpass', f0: 180, peak: 0.6, attack: 0.01, decay: 0.8, buffer: this.brown }, g);
            for (let i = 0; i < 8; i++) this.burst(tc + i * 0.05 + Math.random() * 0.1, { type: 'bandpass', f0: 800 + Math.random() * 600, q: 2, peak: 0.15, attack: 0.002, decay: 0.05 }, g);
            for (let i = 0; i < 12; i++) this.burst(tc + 0.3 + Math.random() * 1.2, { type: 'lowpass', f0: 500 + Math.random() * 600, peak: 0.06, attack: 0.003, decay: 0.07 }, g);
          }
        }
        F.timer = setTimeout(crackle, 1000);
      };
      crackle();
    }
    F.level = Math.min(1, spot.heat) * spot.gain;
    F.g.gain.setTargetAtTime(Math.max(0.0001, 0.35 + 0.65 * F.level) * spot.gain * 0.5, t, 0.8);
    if (F.pan) F.pan.setTargetAtTime(spot.pan, t, 0.8);
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
      if (this.verb) { const w = this.ctx.createGain(); w.gain.value = 0.9; dest.connect(w).connect(this.verb); }
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
    const { bus, nodes, timer, steppe, fire } = this.amb;
    this.amb = null;
    clearTimeout(timer);
    clearTimeout(steppe);
    if (fire) clearTimeout(fire.timer);
    const t = this.ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setTargetAtTime(0.0001, t, 0.3);
    for (const n of nodes) n.stop(t + 1.5);
  }

  // ---------- Musique, radio, QG ----------

  // Enveloppe tenue, linéaire : nappes, cordes, cuivres.
  held(g, t, peak, attack, dur, release) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + Math.max(attack, dur - release));
    g.gain.linearRampToValueAtTime(0, t + dur);
  }

  // Sortie vers un bus (musique, pièce du QG) plutôt que vers la sortie générale.
  busOut(bus, pan, gain, wet) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const p = this.ctx.createStereoPanner?.();
    if (p) { p.pan.value = pan; g.connect(p).connect(bus); } else g.connect(bus);
    if (wet > 0 && this.verb) { const w = this.ctx.createGain(); w.gain.value = wet; g.connect(w).connect(bus.send); }
    return g;
  }

  // Bus fondu à l'entrée, avec son propre envoi vers la réverbération (coupé avec lui).
  makeBus(level) {
    const ctx = this.ctx, t = ctx.currentTime, bus = ctx.createGain(), send = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(level, t + 0.6);
    send.gain.value = 1;
    bus.connect(this.master);
    if (this.verb) send.connect(this.verb);
    bus.send = send;
    return bus;
  }

  dropBus(bus, fade = 0.6) {
    const t = this.ctx.currentTime;
    for (const g of [bus, bus.send]) { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0.0001, t, fade / 3); }
    setTimeout(() => { bus.disconnect(); bus.send.disconnect(); }, fade * 1000 + 400);
  }

  // Nappe : deux dents de scie désaccordées, filtrées.
  pad(t, f, dur, { attack = 1, release = 1.4, peak = 0.06, cut = 900 }, dest) {
    const g = this.ctx.createGain(), lp = this.filter('lowpass', cut, 0.5);
    this.held(g, t, peak, attack, dur, release);
    lp.connect(g).connect(dest);
    for (const det of [-7, 6]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur + 0.05);
    }
  }

  // Corde frottée : dent de scie, vibrato, formant de caisse.
  bow(t, f, dur, dest, { peak = 0.05, attack = 0.5, release = 0.7, cut = 2200 } = {}) {
    const ctx = this.ctx, o = ctx.createOscillator(), lfo = ctx.createOscillator(), depth = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = f;
    depth.gain.value = f * 0.006;
    lfo.frequency.value = 5.3; lfo.connect(depth).connect(o.frequency);
    const body = this.filter('peaking', 700, 1.2); body.gain.value = 5;
    const g = ctx.createGain(); this.held(g, t, peak, attack, dur, release);
    o.connect(this.filter('lowpass', cut, 0.6)).connect(body).connect(g).connect(dest);
    o.start(t); lfo.start(t + 0.3); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  }

  // Cuivre : le filtre s'ouvre à l'attaque, comme un cor qu'on embouche.
  brass(t, f, dur, dest, peak = 0.07) {
    const ctx = this.ctx, o = ctx.createOscillator(), lp = this.filter('lowpass', 500, 1.5), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = f;
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.linearRampToValueAtTime(1700, t + 0.12);
    lp.frequency.linearRampToValueAtTime(1100, t + Math.max(0.2, dur - 0.1));
    this.held(g, t, peak, 0.08, dur, Math.min(0.4, dur / 2));
    o.connect(lp).connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  piano(t, f, vel, dest) {
    const lp = this.filter('lowpass', 2600 + vel * 1500, 0.5);
    lp.connect(dest);
    for (const [k, amp, dec] of [[1, 1, 2.6], [2, 0.45, 1.6], [3, 0.2, 0.9], [4, 0.1, 0.6]]) {
      this.tone(t, { f0: f * k * (1 + (k - 1) * 0.0007), peak: 0.11 * vel * amp, attack: 0.004, decay: dec }, lp);
    }
    this.burst(t, { f0: Math.min(6000, f * 5), q: 1.5, peak: 0.02 * vel, attack: 0.002, decay: 0.03 }, lp);
  }

  timpani(t, f, peak, dest) {
    this.tone(t, { f0: f * 1.06, f1: f, peak, attack: 0.006, decay: 1.6 }, dest);
    this.burst(t, { type: 'lowpass', f0: 300, peak: peak * 0.5, attack: 0.002, decay: 0.25, buffer: this.brown }, dest);
  }

  // Cloche à partiels inharmoniques (sonnette de téléscripteur, de machine à écrire, de téléphone).
  bellStrike(t, f, peak, dest) {
    for (const [k, amp, d] of [[1, 1, 0.5], [2.76, 0.45, 0.22], [5.4, 0.22, 0.1]]) this.tone(t, { wave: 'triangle', f0: f * k, peak: peak * amp, attack: 0.002, decay: d }, dest);
  }

  // Frappe mécanique : claquement, coup sourd du marteau, tintement de métal.
  clack(t, dest, k = 1) {
    this.burst(t, { f0: 3400, q: 1.1, peak: 0.28 * k, attack: 0.002, decay: 0.022 }, dest);
    this.tone(t, { wave: 'triangle', f0: 230, f1: 140, peak: 0.16 * k, attack: 0.004, decay: 0.035 }, dest);
    this.tone(t + 0.004, { f0: 4800 + Math.random() * 800, peak: 0.025 * k, attack: 0.004, decay: 0.018 }, dest);
  }

  // Chaîne d'un poste radio ou d'un combiné : bande étroite et saturation.
  radioChain(dest) {
    const hp = this.filter('highpass', 380), lp = this.filter('lowpass', 2700, 0.9);
    hp.connect(lp).connect(this.drive(dest));
    return hp;
  }

  // Voix lointaine et indistincte : syllabes en dent de scie passées dans deux formants de voyelle.
  babble(t, phrases, pitch, dest) {
    const V = [[800, 1200], [500, 1800], [300, 2300], [500, 900], [330, 800], [420, 2000]];
    for (const [a, b] of phrases) {
      for (let tt = t + a; tt < t + b;) {
        const d = 0.07 + Math.random() * 0.13, p = pitch * (0.92 + Math.random() * 0.2), [f1, f2] = V[(Math.random() * V.length) | 0];
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(p, tt);
        o.frequency.linearRampToValueAtTime(p * (0.85 + Math.random() * 0.27), tt + d);
        this.held(g, tt, 0.45, 0.02, d, 0.035);
        o.connect(this.filter('bandpass', f1, 5)).connect(g);
        o.connect(this.filter('bandpass', f2, 7)).connect(g);
        g.connect(dest);
        o.start(tt); o.stop(tt + d + 0.05);
        if (Math.random() < 0.4) this.burst(tt - 0.03, { type: 'highpass', f0: 3200, peak: 0.12, attack: 0.002, decay: 0.045 }, dest);
        tt += d + 0.02 + Math.random() * 0.07;
      }
    }
  }

  // Musique : menu (choral des steppes, repris après un silence), briefing (piano du QG, une fois), ou rien.
  // Jamais pendant la journée de combat ; demandée avant le premier geste, elle attend unlock().
  music(kind) {
    this.musWanted = kind;
    if (this.mus?.kind === kind) return;
    this.stopMusic();
    if (!kind || !this.live) return;
    const bus = this.makeBus(0.75), mus = this.mus = { kind, bus, timer: null };
    const play = () => {
      if (this.mus !== mus) return;
      const t = this.ctx.currentTime + 0.1;
      if (kind === 'menu') {
        this.choral(t, bus);
        mus.timer = setTimeout(play, 34000);
      } else this.pianoTheme(t, bus);
    };
    play();
  }

  stopMusic() {
    if (!this.mus) return;
    clearTimeout(this.mus.timer);
    this.dropBus(this.mus.bus, 1.5);
    this.mus = null;
  }

  // Choral des steppes (14 s) : nappe de cordes en ré mineur, quatre accords, une ligne de violon au-dessus.
  choral(t, bus) {
    const d = this.busOut(bus, 0, 0.55, 0.7), lead = this.busOut(bus, 0.15, 0.5, 0.8);
    [[50, 53, 57, 62], [46, 53, 58, 62], [43, 50, 55, 58], [45, 52, 57, 61]].forEach((c, i) => c.forEach((m) => this.pad(t + i * 3.2, mf(m), 4.2, { attack: 1.3, release: 1.6, peak: 0.055 }, d)));
    for (const [m, s, l] of [[69, 0.8, 2.6], [70, 3.9, 2.4], [67, 7.1, 2.6], [69, 10.2, 3.4]]) this.bow(t + s, mf(m), l, lead);
  }

  // Piano du QG (14 s) : quelques notes espacées en la mineur, comme jouées dans la pièce voisine.
  pianoTheme(t, bus) {
    const d = this.busOut(bus, -0.1, 0.8, 0.55);
    for (const [s, m] of [[0, 45], [3.2, 41], [6.4, 48], [9.6, 40], [12.4, 45]]) { this.piano(t + s, mf(m), 0.7, d); this.piano(t + s + 0.4, mf(m + 7), 0.45, d); }
    for (const [s, m, v] of [[0.8, 76, 0.7], [1.6, 72, 0.6], [2.0, 71, 0.5], [2.4, 69, 0.6], [4.0, 72, 0.6], [4.8, 74, 0.6], [5.2, 72, 0.5], [5.6, 71, 0.55],
      [7.2, 67, 0.6], [8.0, 69, 0.6], [8.8, 71, 0.65], [10.4, 69, 0.55], [11.2, 64, 0.5], [12.4, 69, 0.6]]) this.piano(t + s, mf(m), v, d);
  }

  // Quelques notes au bilan : journée gagnée (ré majeur qui s'ouvre, cor qui monte) ou perdue (bourdon, violoncelle
  // qui descend). delay : après la cloche de fin de journée.
  sting(won, delay = 1.1) {
    if (!this.live) return;
    const t = this.ctx.currentTime + delay, d = this.out(0, 0.6, 0.7);
    if (won) {
      for (const m of [50, 54, 57, 62]) this.pad(t, mf(m), 4.6, { attack: 0.9, release: 2, peak: 0.05, cut: 1200 }, d);
      const h = this.out(0.1, 0.6, 0.75);
      for (const [m, s, l] of [[62, 0.3, 0.5], [66, 0.8, 0.5], [69, 1.3, 0.5], [74, 1.8, 2.6]]) this.brass(t + s, mf(m), l, h, 0.06);
      this.timpani(t + 1.8, 73, 0.3, d);
    } else {
      for (const m of [38, 45]) this.pad(t, mf(m), 6.8, { attack: 1.2, release: 2.4, peak: 0.06, cut: 420 }, d);
      const c = this.out(-0.15, 0.7, 0.7);
      for (const [m, s, l] of [[45, 0.4, 1.7], [43, 1.9, 1.7], [41, 3.4, 1.4], [40, 4.6, 2.3]]) this.bow(t + s, mf(m), l, c, { peak: 0.08, cut: 1400 });
      this.timpani(t + 4.6, 55, 0.25, d);
    }
  }

  // Télégramme en morse d'une ville qui tombe, au QG : porteuse qui ondule dans les parasites.
  telegram(t, text) {
    const d = this.out(-0.2, 0.55, 0.1), ch = this.radioChain(d), unit = 0.07;
    const M = { V: '...-', I: '..', L: '.-..', E: '.', P: '.--.', R: '.-.', S: '...', D: '-..', U: '..-' };
    let tt = t + 0.3;
    const qsb = this.ctx.createGain();
    qsb.connect(ch);
    for (const w of text.split(' ')) {
      for (const c of w) {
        for (const k of M[c]) {
          const len = k === '.' ? unit : unit * 3, o = this.ctx.createOscillator(), g = this.ctx.createGain();
          o.frequency.value = 690;
          g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.16, tt + 0.006);
          g.gain.setValueAtTime(0.16, tt + len - 0.006); g.gain.linearRampToValueAtTime(0, tt + len);
          o.connect(g).connect(qsb); o.start(tt); o.stop(tt + len + 0.01);
          tt += len + unit;
        }
        tt += unit * 2;
      }
      tt += unit * 4;
    }
    for (let x = t; x < tt; x += 0.3) qsb.gain.setTargetAtTime(0.55 + Math.random() * 0.45, x, 0.15);
    const hiss = this.src(this.noise, t, tt - t + 0.3), hg = this.ctx.createGain();
    this.held(hg, t, 0.06, 0.15, tt - t + 0.3, 0.25);
    hiss.connect(this.filter('bandpass', 1500, 0.4)).connect(hg).connect(ch);
    for (let x = t; x < tt; x += 0.05 + Math.random() * 0.35) this.burst(x, { type: 'highpass', f0: 2500, peak: 0.02 + Math.random() * 0.1, attack: 0.001, decay: 0.004 }, ch);
  }

  // Téléscripteur : la réserve qu'on fait monter est confirmée par une ligne de frappe et un retour à la ligne.
  teletype() {
    if (!this.live) return;
    const t = this.ctx.currentTime + 0.02, d = this.out(0.15, 0.6, 0.15);
    const n = 6 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) this.clack(t + i * 0.09, d, 0.7 + Math.random() * 0.3);
    for (let k = 0; k < 3; k++) this.clack(t + n * 0.09 + 0.08 + k * 0.04, d, 0.45);
  }

  // Pièce du QG : 'hq' le matin des ordres (téléphone de campagne, machine à écrire), 'stove' le soir du bilan
  // (poêle qui crépite), ou rien.
  room(kind) {
    this.roomWanted = kind;
    if (this.rm?.kind === kind) return;
    this.stopRoom();
    if (!kind || !this.live) return;
    const bus = this.makeBus(kind === 'hq' ? 0.5 : 0.7), rm = this.rm = { kind, bus, timer: null };
    if (kind === 'stove') return this.stove(rm);
    // Le téléphone sonne une fois sur deux en arrivant au QG ; puis la machine à écrire, de loin en loin.
    let first = 4 + Math.random() * 4;
    if (Math.random() < 0.5) { this.phone(this.ctx.currentTime + 1.2, bus); first += 7; }
    const type = () => {
      if (this.rm !== rm) return;
      if (!document.hidden) this.typewriter(this.ctx.currentTime + 0.05, bus, Math.random() < 0.35);
      rm.timer = setTimeout(type, 12000 + Math.random() * 16000);
    };
    rm.timer = setTimeout(type, first * 1000);
  }

  stopRoom() {
    if (!this.rm) return;
    clearTimeout(this.rm.timer);
    this.rm.nodes?.forEach((n) => n.stop(this.ctx.currentTime + 1.5));
    this.dropBus(this.rm.bus, 1);
    this.rm = null;
  }

  // Sonnerie à magnéto, deux fois, puis le combiné décroché : la ligne grésille, une voix lointaine.
  phone(t, bus) {
    const d = this.busOut(bus, 0.35, 0.75, 0.25);
    for (const s of [0.2, 2.2]) for (let x = 0; x < 1.25; x += 0.045) this.bellStrike(t + s + x, 920, 0.07, d);
    this.tone(t + 4.0, { f0: 150, f1: 90, peak: 0.3, attack: 0.004, decay: 0.08 }, d);
    this.burst(t + 4.0, { type: 'lowpass', f0: 1200, peak: 0.15, attack: 0.002, decay: 0.05 }, d);
    const ch = this.radioChain(this.busOut(bus, 0.35, 0.5, 0.05));
    const line = this.src(this.noise, t + 4.1, 3.6), g = this.ctx.createGain();
    this.held(g, t + 4.1, 0.05, 0.3, 3.6, 0.6);
    line.connect(this.filter('bandpass', 1500, 0.6)).connect(g).connect(ch);
    this.babble(t + 4.1, [[0.4, 1.6], [2.0, 3.0]], 135, ch);
  }

  // Machine à écrire : frappe par mots, barre d'espace plus sourde ; line : sonnette et retour du chariot.
  typewriter(t, bus, line) {
    const d = this.busOut(bus, -0.25, 0.85, 0.25);
    let x = 0;
    const words = 2 + ((Math.random() * 4) | 0);
    for (let w = 0; w < words; w++) {
      const n = 3 + ((Math.random() * 5) | 0);
      for (let k = 0; k < n; k++) { this.clack(t + x, d, 0.75 + Math.random() * 0.25); x += 0.07 + Math.random() * 0.06; }
      this.tone(t + x, { wave: 'triangle', f0: 150, f1: 110, peak: 0.18, attack: 0.004, decay: 0.05 }, d);
      this.burst(t + x, { f0: 1800, q: 0.8, peak: 0.12, attack: 0.002, decay: 0.03 }, d);
      x += 0.18 + Math.random() * 0.22;
    }
    if (!line) return;
    this.bellStrike(t + x, 2600, 0.14, d);
    for (let k = 0; k < 12; k++) this.burst(t + x + 0.5 + k * 0.04, { f0: 2600, q: 2, peak: 0.08, attack: 0.002, decay: 0.012 }, d);
  }

  // Poêle du soir : grondement du feu dans la fonte, crépitements, une bûche qui éclate, le métal qui travaille.
  stove(rm) {
    const ctx = this.ctx, t = ctx.currentTime, d = this.busOut(rm.bus, -0.2, 1, 0.2);
    const roar = this.src(this.brown, t, null, true), rg = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    rg.gain.value = 0.18;
    lfo.frequency.value = 0.6; lg.gain.value = 0.05;
    lfo.connect(lg).connect(rg.gain);
    roar.connect(this.filter('lowpass', 260)).connect(rg).connect(d);
    lfo.start(t);
    rm.nodes = [roar, lfo];
    const crackle = () => {
      if (this.rm !== rm) return;
      if (document.hidden) { rm.timer = setTimeout(crackle, 2000); return; }
      const t1 = this.ctx.currentTime + 0.05;
      for (let x = Math.random() * 0.2; x < 2; x += -Math.log(1 - Math.random()) / 8) {
        const cl = Math.random() < 0.12 ? 5 : 1;
        for (let k = 0; k < cl; k++) this.burst(t1 + x + k * (0.01 + Math.random() * 0.02), { type: 'highpass', f0: 1200 + Math.random() * 3000, peak: Math.random() ** 2 * 0.22 + 0.01, attack: 0.001, decay: 0.002 + Math.random() * 0.008 }, d);
      }
      if (Math.random() < 0.25) {
        const tp = t1 + Math.random() * 1.5;
        this.burst(tp, { f0: 900, q: 1, peak: 0.3, attack: 0.002, decay: 0.04 }, d);
        this.tone(tp, { f0: 420, f1: 190, peak: 0.12, attack: 0.004, decay: 0.05 }, d);
      }
      if (Math.random() < 0.15) this.tone(t1 + Math.random() * 1.5, { f0: 2900 + Math.random() * 600, peak: 0.02, attack: 0.004, decay: 0.06 }, d);
      rm.timer = setTimeout(crackle, 2000);
    };
    crackle();
  }

  // ---------- Interface ----------

  ui(kind, where = null) {
    if (!this.live) return;
    const t = this.ctx.currentTime + 0.005;
    const dest = this.out(0, 1, 0);
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
    } else if (kind === 'sos') {
      // Appel à l'aide d'un secteur qui craque : souffle radio, puis · · · — — — · · · pressé, deux fois.
      const d = this.out(where?.pan ?? 0, 0.7 + 0.3 * (where?.gain ?? 1), 0.15);
      this.burst(t, { type: 'bandpass', f0: 1300, q: 0.6, peak: 0.07, attack: 0.02, decay: 0.3 }, d);
      let tt = t + 0.25;
      for (let r = 0; r < 2; r++) {
        for (const c of '...---...') {
          const len = c === '-' ? 0.13 : 0.05;
          this.tone(tt, { wave: 'sine', f0: 820, peak: 0.06, attack: 0.004, decay: len }, d);
          tt += len + 0.055;
        }
        tt += 0.22;
      }
      for (let i = 0; i < 6; i++) this.burst(t + Math.random() * (tt - t), { type: 'highpass', f0: 3200, peak: 0.035, attack: 0.001, decay: 0.012 }, d);
    } else if (kind === 'bell') {
      // Cloche de fin de tour : partiels inharmoniques.
      for (const [r, a] of [[1, 0.12], [2.76, 0.05], [5.4, 0.025]]) this.tone(t, { f0: 660 * r, peak: a, attack: 0.003, decay: 1.4 / r }, dest);
    }
  }
}

export const sound = new AudioBoard();
