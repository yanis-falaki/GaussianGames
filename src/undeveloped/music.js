// Background music for Undeveloped: gentle, procedural and mostly absent. A plucked harp
// (Karplus-Strong, buffers cached per pitch), a soft felt-piano melody now and then, a dim pad and
// a sine bass, in a major key at 62-72 BPM. A section plays for a couple of minutes, ends on the
// tonic, then leaves 30-60s of birds and room tone before the next one (often in another key).
// It rides on UndevelopedAudio's context, master and reverb, so it sits in the same mix.

const LOOKAHEAD = 0.3; // seconds scheduled ahead of ctx.currentTime
const LEVEL = 0.25; // overall music level into the master
const STORE_KEY = "undeveloped.music";

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const chance = (p) => Math.random() < p;
const above = (pc, lo) => lo + ((pc - lo) % 12 + 12) % 12; // lowest midi >= lo with pitch class pc
const inRange = (pcs, lo, hi) => { const r = []; for (let m = lo; m <= hi; m++) if (pcs.includes(m % 12)) r.push(m); return r; };

const QUAL = { maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], sus: [0, 5, 7, 10], add9: [0, 4, 7, 14], maj9: [0, 4, 7, 11, 14], m6: [0, 3, 7, 9], six: [0, 4, 7, 9] };
// [scale degree in semitones, quality, bars]
const PROGRESSIONS = [
  [[0, "maj7", 2], [9, "m7", 2], [5, "maj7", 2], [7, "sus", 2]], // I - vi - IV - Vsus
  [[5, "maj7", 2], [4, "m7", 2], [9, "m7", 2], [7, "sus", 2]], // IV - iii - vi - Vsus
  [[0, "add9", 2], [5, "maj9", 2], [0, "maj7", 2], [5, "six", 2]], // I - IV, lilting
  [[2, "m7", 2], [7, "sus", 2], [0, "maj7", 2], [5, "maj7", 2]], // ii - Vsus - I - IV
  [[0, "maj7", 2], [4, "m7", 2], [5, "maj7", 2], [5, "m6", 2]], // I - iii - IV - iv (a little wistful)
];
const KEYS = [5, 2, 7, 3, 10, 0]; // F, D, G, Eb, Bb, C major
const PENTA = [0, 2, 4, 7, 9];
const ARP_W = [1, 0.35, 0.7, 0.35, 0.85, 0.35, 0.6, 0.4]; // per eighth in a 4/4 bar

export class UndevelopedMusic {
  constructor(audio) {
    this.audio = audio;
    this.enabled = true;
    try { this.enabled = localStorage.getItem(STORE_KEY) !== "off"; } catch {}
    this.ks = new Map();
  }

  // opts.manual: no timer, the caller drives tick() (offline rendering); opts.delay: first section
  start(opts = {}) {
    if (this.ctx || !this.audio.ctx) return;
    const ctx = (this.ctx = this.audio.ctx);
    const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    this.out = gain(LEVEL);
    this.out.connect(this.audio.master);
    this.out.connect(gain(0.6)).connect(this.audio.reverb);
    this.pauseGain = gain(1); this.userGain = gain(this.enabled ? 1 : 0);
    this.mix = gain(1);
    this.mix.connect(this.userGain).connect(this.pauseGain).connect(this.out);
    const lp = (f, q = 0.5) => { const b = ctx.createBiquadFilter(); b.type = "lowpass"; b.frequency.value = f; b.Q.value = q; return b; };
    this.pluckBus = gain(1); this.pluckBus.connect(lp(2600)).connect(this.mix);
    this.padBus = gain(1); this.padBus.connect(lp(850)).connect(this.mix);
    this.melBus = gain(1); this.melBus.connect(this.mix);
    this.bassBus = gain(1); this.bassBus.connect(lp(400)).connect(this.mix);
    const real = new Float32Array([0, 1, 0.4, 0.15, 0.07, 0.03]);
    this.feltWave = ctx.createPeriodicWave(real, new Float32Array(real.length));
    this.sec = null;
    this.nextSectionAt = ctx.currentTime + (opts.delay ?? 2.5);
    if (!opts.manual) this.timer = setInterval(() => this.tick(), 100);
  }

  setPaused(p) {
    if (!this.ctx || p === this.paused) return;
    this.paused = p;
    const g = this.pauseGain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.setTargetAtTime(p ? 0 : 1, t, p ? 0.25 : 0.6);
  }

  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem(STORE_KEY, on ? "on" : "off"); } catch {}
    if (!this.ctx) return;
    const g = this.userGain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    if (on) { g.linearRampToValueAtTime(1, t + 0.05); this.sec = null; this.nextSectionAt = t + 1.5; }
    else g.setTargetAtTime(0, t, 0.3); // tick() stops scheduling; what's queued fades away
  }

  bindButton(btn) {
    const label = () => (btn.textContent = `Music: ${this.enabled ? "on" : "off"}`);
    label();
    btn.addEventListener("click", () => { this.setEnabled(!this.enabled); label(); btn.blur(); });
  }

  tick() {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    if (!this.sec) {
      if (now + LOOKAHEAD < this.nextSectionAt) return;
      this.newSection(Math.max(now + 0.05, this.nextSectionAt));
    }
    if (this.t < now - 0.2) this.t = now; // the tab was throttled: carry on from here, don't catch up
    while (this.sec && this.t < now + LOOKAHEAD) this.step(this.t);
  }

  newSection(t0) {
    const prev = this.sec0;
    const key = !prev ? 5 : chance(0.7) ? pick(KEYS.filter((k) => k !== prev.key)) : prev.key;
    const prog = !prev ? PROGRESSIONS[0] : pick(PROGRESSIONS.filter((p) => p !== prev.prog));
    const eighth = 30 / rand(62, 72);
    const cycleSlots = prog.reduce((n, c) => n + c[2] * 8, 0);
    const cycles = Math.max(3, Math.round(rand(90, 170) / (cycleSlots * eighth)));
    this.sec = this.sec0 = {
      key, prog, eighth, total: cycles * cycleSlots, g: 0, ci: 0, si: 0,
      dens: rand(0.42, 0.6), melChance: rand(0.16, 0.3), melVoice: chance(0.65) ? "felt" : "pluck",
      melQ: [], melUntil: 0, rest: false,
    };
    this.t = t0;
    this.arpM = 64 + key;
    // prewarm the pluck buffers this section will use
    for (const [deg, q] of prog) for (const m of inRange(QUAL[q].map((i) => (key + deg + i) % 12), 43, 79)) this.ksBuffer(m);
  }

  // one eighth-note slot
  step(t) {
    const s = this.sec, e = s.eighth;
    if (s.g >= s.total) return this.outro(t, s);
    const [deg, q, bars] = s.prog[s.ci], root = (s.key + deg) % 12;
    const pcs = QUAL[q].map((i) => (root + i) % 12), slots = bars * 8, pos = s.si % 8;
    const p = s.g / s.total;
    if (s.si === 0) {
      this.pad(t, QUAL[q].slice(1).map((i) => (root + i) % 12), slots * e);
      this.bass(t, root, slots * e, 1);
    }
    if (s.si === 12 && chance(0.35)) this.bass(t, (root + 7) % 12, 4 * e, 0.55);
    if (pos === 0) {
      s.rest = s.g > 8 && chance(0.12); // now and then the harp takes a breath for a bar
      if (chance(s.si === 0 ? 0.85 : 0.45)) this.pluck(t + rand(0, 0.015), above(chance(0.7) ? root : (root + 7) % 12, 43), rand(0.45, 0.6));
    }
    // arpeggio
    const melActive = s.g < s.melUntil;
    let prob = ARP_W[pos] * s.dens * 1.5 * (0.25 + 0.75 * Math.pow(Math.sin(Math.PI * p), 0.6));
    if (s.g < 8) prob *= 0.35;
    if (s.rest) prob = 0;
    if (melActive) prob *= 0.55;
    if (chance(prob)) {
      const accent = pos === 0 ? 1 : pos % 2 ? 0.72 : 0.86;
      this.pluck(t + rand(-0.01, 0.02) + (pos % 2 ? e * 0.06 : 0), this.walk(pcs), rand(0.55, 0.9) * accent);
    }
    // melody: an occasional short pentatonic phrase
    if (pos === 0 && !melActive && p > 0.15 && p < 0.85 && s.g + 16 < s.total && chance(s.melChance)) this.phrase(s);
    for (const n of s.melQ) if (n.at === s.g) {
      let m = n.m;
      if (n.last) m = inRange(pcs, m - 3, m + 3).sort((a, b) => Math.abs(a - n.m) - Math.abs(b - n.m))[0] ?? m;
      this.melody(t + rand(-0.01, 0.025), m, n.v, s.melVoice);
    }
    s.melQ = s.melQ.filter((n) => n.at > s.g);
    s.g++; s.si++; this.t += e;
    if (s.si >= slots) { s.si = 0; s.ci = (s.ci + 1) % s.prog.length; }
  }

  phrase(s) {
    const notes = inRange(PENTA.map((i) => (s.key + i) % 12), 67, 84);
    let idx = (notes.length * rand(0.3, 0.7)) | 0, at = s.g + pick([0, 0, 2, 1]);
    const n = 3 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      s.melQ.push({ at, m: notes[idx], v: rand(0.6, 0.85) * (last ? 0.85 : 1), last });
      at += pick([2, 2, 2, 3, 4, 1]);
      idx = Math.max(0, Math.min(notes.length - 1, idx + pick(i >= n - 3 ? [-2, -1, -1, 1] : [-2, -1, -1, 1, 1, 2])));
    }
    s.melUntil = at + 4;
  }

  // the arpeggio wanders up and down the chord tones, voice-leading through chord changes
  walk(pcs) {
    const notes = inRange(pcs, 57, 79);
    let i = 0;
    for (let j = 1; j < notes.length; j++) if (Math.abs(notes[j] - this.arpM) < Math.abs(notes[i] - this.arpM)) i = j;
    if (chance(0.25) || this.dir === undefined) this.dir = chance(0.5) ? 1 : -1;
    i += this.dir * (chance(0.2) ? 2 : 1);
    if (i < 0 || i >= notes.length) { this.dir *= -1; i = Math.max(0, Math.min(notes.length - 1, i + 2 * this.dir)); }
    return (this.arpM = notes[i]);
  }

  // the section ends on a rolled tonic chord, then silence until the next one
  outro(t, s) {
    const e = s.eighth, dur = 16 * e, k = s.key;
    this.pad(t, [4, 7, 11].map((i) => (k + i) % 12), dur);
    this.bass(t, k, dur, 0.9);
    inRange([0, 4, 7, 14].map((i) => (k + i) % 12), 50, 74).slice(-5)
      .forEach((m, i) => this.pluck(t + i * 0.09 + rand(0, 0.02), m, 0.5 + i * 0.04));
    this.nextSectionAt = t + dur + rand(30, 60);
    this.sec = null;
  }

  // -------------------------------------------------------------------------- voices
  ksBuffer(m) {
    let b = this.ks.get(m);
    if (b) return b;
    const sr = this.ctx.sampleRate, f = mtof(m);
    const N = Math.max(2, Math.round(sr / f + 0.5));
    const t60 = Math.max(1.4, Math.min(4, 4 - (m - 45) * 0.07));
    const len = Math.ceil(sr * (t60 + 0.3));
    const rho = Math.pow(0.001, 1 / (t60 * sr / (N - 0.5)));
    // a soft excitation: smoothed noise, DC removed, so the attack is round rather than twangy
    const line = new Float32Array(N);
    let y = 0, mean = 0;
    for (let i = 0; i < N; i++) { y += 0.45 * (Math.random() * 2 - 1 - y); line[i] = y; mean += y / N; }
    for (let i = 0; i < N; i++) line[i] -= mean;
    b = this.ctx.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    let peak = 1e-6;
    for (let n = 0, i = 0; n < len; n++) {
      const cur = line[i], j = i + 1 === N ? 0 : i + 1;
      d[n] = cur; line[i] = rho * 0.5 * (cur + line[j]); i = j;
      if (Math.abs(cur) > peak) peak = Math.abs(cur);
    }
    const fadeIn = Math.ceil(sr * 0.004), fadeOut = Math.ceil(sr * 0.1);
    for (let n = 0; n < len; n++) {
      let g = 1 / peak;
      if (n < fadeIn) g *= n / fadeIn;
      if (n > len - fadeOut) g *= (len - n) / fadeOut;
      d[n] *= g;
    }
    b.rate = f / (sr / (N - 0.5)); // playbackRate that corrects the integer delay length
    this.ks.set(m, b);
    return b;
  }

  pluck(t, m, v, bus = this.pluckBus) {
    const ctx = this.ctx, buf = this.ksBuffer(m), s = ctx.createBufferSource(), g = ctx.createGain(), pan = ctx.createStereoPanner();
    s.buffer = buf; s.playbackRate.value = buf.rate;
    g.gain.value = 0.3 * v;
    pan.pan.value = Math.max(-0.45, Math.min(0.45, (m - 64) / 30 + rand(-0.12, 0.12)));
    s.connect(g).connect(pan).connect(bus);
    s.start(t);
  }

  melody(t, m, v, voice) {
    if (voice === "pluck") return this.pluck(t, m, v * 0.85, this.melBus);
    // felt piano: a few soft partials, a muted hammer, a filter that closes as it rings
    const ctx = this.ctx, f = mtof(m), g = ctx.createGain(), lp = ctx.createBiquadFilter(), pan = ctx.createStereoPanner();
    lp.type = "lowpass"; lp.Q.value = 0.3;
    lp.frequency.setValueAtTime(Math.min(f * 5, 4000), t); lp.frequency.setTargetAtTime(f * 1.6, t, 0.6);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12 * v, t + 0.014);
    g.gain.setTargetAtTime(0, t + 0.014, 0.8);
    pan.pan.value = rand(-0.2, 0.2);
    for (const det of [-3, 3]) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.feltWave); o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + 4.5);
    }
    lp.connect(g).connect(pan).connect(this.melBus);
  }

  pad(t, pcs, dur) {
    const ctx = this.ctx, att = Math.min(2.5, dur * 0.5), rel = 3, lvl = 0.009;
    for (const pc of pcs) {
      const f = mtof(above(pc, 55)), g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lvl, t + att);
      g.gain.setValueAtTime(lvl, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + rel);
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = "triangle"; o.frequency.value = f; o.detune.value = det + rand(-2, 2);
        o.connect(g); o.start(t); o.stop(t + dur + rel + 0.05);
      }
      g.connect(this.padBus);
    }
  }

  bass(t, pc, dur, v) {
    const ctx = this.ctx, f = mtof(above(pc, 38)), g = ctx.createGain(), lvl = 0.035 * v;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lvl, t + 0.06);
    g.gain.setTargetAtTime(lvl * 0.45, t + 0.06, 1.2);
    g.gain.setTargetAtTime(0, t + dur, 0.25);
    for (const [mul, a] of [[1, 1], [2, 0.22]]) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.frequency.value = f * mul; og.gain.value = a;
      o.connect(og).connect(g); o.start(t); o.stop(t + dur + 1.5);
    }
    g.connect(this.bassBus);
  }
}
