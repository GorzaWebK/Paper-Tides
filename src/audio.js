// All sound is synthesised with the Web Audio API: no audio files.
//
// Effects: a soft paper "thup" when a tile lands, a paper swish for rotating, a pencil
// tick for picking a tile, wind-chime notes for goals and a low bell when the tide
// rises. Ambience: gentle filtered-noise waves. Music: slow generative notes from a
// pentatonic scale over a soft drone that changes chord every few bars.

const PENTA = [0, 2, 4, 7, 9]; // major pentatonic (D E F# A B from D)
const ROOT = 62; // D4
const CHORDS = [
  [38, 45, 50], // D
  [43, 50, 55], // G
  [47, 54, 57], // Bm
  [45, 52, 57], // A
];

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.musicVolume = 0.5;
    this.muted = false;
    this.musicOn = false;
    this.timer = 0;
  }

  /** Audio can only start after a user gesture; call this from one. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.55;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.reverb);
    this.noise = this.noiseBuffer(2);
    this.applyVolumes();
    this.startWaves();
    if (this.musicOn) this.startMusic();
  }

  impulse(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  noiseBuffer(seconds, brown = false) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volume, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.musicVolume * 0.6, t, 0.1);
    if (this.waveGain) this.waveGain.gain.setTargetAtTime(this.volume * 0.5, t, 0.2);
  }

  setVolume(v) {
    this.volume = v;
    this.applyVolumes();
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    this.applyVolumes();
  }

  setMuted(m) {
    this.muted = m;
    this.applyVolumes();
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Pause everything while the tab is hidden. */
  setHidden(hidden) {
    if (!this.ctx) return;
    if (hidden) this.ctx.suspend();
    else this.ctx.resume();
  }

  // --- building blocks ------------------------------------------------------

  noiseHit({ freq = 1000, q = 1, type = 'bandpass', gain = 0.3, attack = 0.002, decay = 0.08, when = 0, sweepTo = null, dest = null }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + attack + decay);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f);
    f.connect(g);
    g.connect(dest || this.sfx);
    src.start(t, Math.random());
    src.stop(t + attack + decay + 0.05);
  }

  tone({ freq, type = 'sine', gain = 0.2, attack = 0.005, decay = 1, when = 0, to = null, dest = null }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + attack + decay * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g);
    g.connect(dest || this.sfx);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  // --- effects --------------------------------------------------------------

  /** A paper cut-out landing on the table. */
  thup() {
    this.noiseHit({ freq: 700, q: 0.7, gain: 0.35, decay: 0.07 });
    this.noiseHit({ freq: 2600, q: 1.2, gain: 0.06, decay: 0.03 });
    this.tone({ freq: 150, to: 70, gain: 0.35, attack: 0.003, decay: 0.14 });
  }

  /** Paper sliding round as a tile turns. */
  swish() {
    this.noiseHit({ freq: 1800, sweepTo: 3600, q: 2, gain: 0.06, attack: 0.03, decay: 0.12 });
  }

  /** A pencil tick for picking a tile. */
  tick() {
    this.noiseHit({ freq: 4200, type: 'highpass', q: 0.5, gain: 0.05, decay: 0.02 });
    this.tone({ freq: 1320, gain: 0.025, decay: 0.08 });
  }

  /** A soft "no" when a tile can't go somewhere. */
  nope() {
    this.tone({ freq: 196, gain: 0.08, decay: 0.18, type: 'triangle' });
  }

  undo() {
    this.noiseHit({ freq: 3000, sweepTo: 1400, q: 2, gain: 0.05, attack: 0.02, decay: 0.12 });
    this.tone({ freq: 660, to: 440, gain: 0.04, decay: 0.2 });
  }

  /** Wind chimes for a finished goal. */
  chime() {
    const notes = [81, 83, 86, 90, 93];
    notes.forEach((m, i) => {
      const f = mtof(m);
      const when = i * 0.13 + Math.random() * 0.04;
      this.tone({ freq: f, gain: 0.08, decay: 2.6, when, dest: this.musicBus });
      this.tone({ freq: f * 2.76, gain: 0.015, decay: 1.2, when, dest: this.musicBus });
    });
  }

  /** A low bell (and a swell of surf) as the tide rises. */
  bell() {
    const base = 98;
    const partials = [
      [0.5, 0.25, 5],
      [1, 0.3, 4.5],
      [1.19, 0.12, 3.5],
      [1.56, 0.1, 3],
      [2, 0.08, 2.5],
      [2.74, 0.05, 2],
      [3.76, 0.03, 1.5],
    ];
    for (const [ratio, g, d] of partials) this.tone({ freq: base * ratio, gain: g * 0.6, decay: d, attack: 0.004, dest: this.musicBus });
    this.noiseHit({ freq: 400, type: 'lowpass', q: 0.3, gain: 0.25, attack: 0.9, decay: 1.8, when: 0.2 });
  }

  /** A short rising flourish for the end of a run. */
  fanfare() {
    [74, 78, 81, 86].forEach((m, i) => this.tone({ freq: mtof(m), gain: 0.07, decay: 2.4, when: i * 0.22, type: 'triangle', dest: this.musicBus }));
  }

  // --- ambience ------------------------------------------------------------

  startWaves() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(6, true);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const swell = ctx.createGain();
    swell.gain.value = 0.05;
    // slow swell of the waves, like breathing
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.075;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain);
    lfoGain.connect(swell.gain);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.05;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 180;
    lfo2.connect(lfo2Gain);
    lfo2Gain.connect(lp.frequency);
    this.waveGain = ctx.createGain();
    this.waveGain.gain.value = this.volume * 0.5;
    src.connect(lp);
    lp.connect(swell);
    swell.connect(this.waveGain);
    this.waveGain.connect(this.master);
    src.start();
    lfo.start();
    lfo2.start();
  }

  startMusic() {
    this.musicOn = true;
    if (!this.ctx || this.timer) return;
    this.nextNote = this.ctx.currentTime + 1;
    this.nextChord = this.ctx.currentTime + 0.5;
    this.chordIndex = 0;
    this.lastStep = 5;
    this.timer = setInterval(() => this.schedule(), 250);
  }

  stopMusic() {
    this.musicOn = false;
    clearInterval(this.timer);
    this.timer = 0;
  }

  schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const ahead = ctx.currentTime + 0.8;
    while (this.nextChord < ahead) {
      this.pad(CHORDS[this.chordIndex % CHORDS.length], this.nextChord, 15);
      this.chordIndex++;
      this.nextChord += 14;
    }
    while (this.nextNote < ahead) {
      // a gentle random walk over two octaves of the scale
      this.lastStep = Math.max(0, Math.min(10, this.lastStep + Math.round((Math.random() - 0.5) * 4)));
      const m = ROOT + PENTA[this.lastStep % 5] + 12 * Math.floor(this.lastStep / 5);
      this.pluck(mtof(m), this.nextNote);
      if (Math.random() < 0.25) this.pluck(mtof(m + 12 + PENTA[(this.lastStep + 2) % 5] - PENTA[this.lastStep % 5]), this.nextNote + 0.35, 0.5);
      this.nextNote += 1.6 + Math.random() * 2.8;
    }
  }

  pluck(freq, when, level = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.09 * level, when + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 3.2);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(g);
    g.connect(this.musicBus);
    o.start(when);
    o2.start(when);
    o.stop(when + 3.3);
    o2.stop(when + 3.3);
  }

  pad(notes, when, dur) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.045, when + 4);
    g.gain.setValueAtTime(0.045, when + dur - 5);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    lp.connect(g);
    g.connect(this.musicBus);
    for (const m of notes) {
      for (const det of [-6, 5]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        o.connect(lp);
        o.start(when);
        o.stop(when + dur + 0.1);
      }
    }
  }
}
