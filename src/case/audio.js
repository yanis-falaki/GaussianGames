// Daylight soundscape for Undeveloped: all synthesized. Soft room tone, wind and the odd bird
// outside the windows, footsteps, a mechanical camera shutter, paper.
export class CaseAudio {
  // opts.ctx / opts.output (optional): ride on an existing context and route into a given node
  // instead of the speakers (the game-select menu uses this for its daylight bed)
  start(opts = {}) {
    if (this.ctx) return;
    const ctx = (this.ctx = opts.ctx || new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(opts.output || ctx.destination);
    // short, dark room reverb
    this.reverb = ctx.createConvolver();
    const n = ctx.sampleRate * 1.6, ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c); let y = 0;
      for (let i = 0; i < n; i++) { y += 0.25 * ((Math.random() * 2 - 1) - y); d[i] = y * 2 * Math.pow(1 - i / n, 3); }
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    this.reverb.connect(wet).connect(this.master);
    const len = ctx.sampleRate * 3;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
    // wind through broken windows: slowly breathing filtered noise
    const wind = this.noise(true), lp = ctx.createBiquadFilter(), wg = ctx.createGain();
    lp.type = "lowpass"; lp.frequency.value = 400; wg.gain.value = 0.05;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.06; lg.gain.value = 0.035; lfo.connect(lg).connect(wg.gain); lfo.start();
    wind.connect(lp).connect(wg).connect(this.master); wind.start();
    this.nextBird = 4;
  }

  noise(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = loop;
    return s;
  }

  out(dry = 1, wet = 0.4) {
    const g = this.ctx.createGain(); g.gain.value = dry; g.connect(this.master);
    const w = this.ctx.createGain(); w.gain.value = wet; g.connect(w).connect(this.reverb);
    return g;
  }

  footstep(intensity = 1, surface = 0.5) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, s = this.noise();
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 450 + surface * 250;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32 * intensity, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    s.connect(lp).connect(g).connect(this.out(0.9, 0.35));
    s.start(t, Math.random() * 2); s.stop(t + 0.2);
  }

  click() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, s = this.noise(), hp = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    hp.type = "highpass"; hp.frequency.value = 2000;
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    s.connect(hp).connect(g).connect(this.out(1, 0.1)); s.start(t, Math.random()); s.stop(t + 0.05);
  }

  // mechanical shutter: two clacks and a little mirror slap
  shutter() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (const [dt, v, f] of [[0, 0.5, 1800], [0.07, 0.35, 1200]]) {
      const t = ctx.currentTime + dt, s = this.noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = 1.5;
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      s.connect(bp).connect(g).connect(this.out(1, 0.25)); s.start(t, Math.random()); s.stop(t + 0.08);
    }
  }

  paper(vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, s = this.noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = "bandpass"; bp.frequency.value = 3500; bp.Q.value = 0.7;
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < 6; i++) g.gain.linearRampToValueAtTime((0.05 + Math.random() * 0.08) * vol, t + 0.03 + i * 0.04);
    g.gain.linearRampToValueAtTime(0, t + 0.3);
    s.connect(bp).connect(g).connect(this.out(1, 0.2)); s.start(t, Math.random()); s.stop(t + 0.35);
  }

  chime(notes, vol = 0.1, gap = 0.12) {
    const ctx = this.ctx, o = this.out(1, 0.8);
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * gap, osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = "triangle"; osc.frequency.value = f;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + 1.6);
      osc.connect(g).connect(o); osc.start(t); osc.stop(t + 1.7);
    });
  }
  solve() { if (this.ctx) this.chime([392, 494, 587, 784], 0.08); }
  wrong() { if (this.ctx) this.chime([220, 207], 0.06, 0.15); }

  // a distant bird outside: a few quick frequency sweeps
  bird() {
    const ctx = this.ctx, o = this.out(0.25, 0.6), base = 2400 + Math.random() * 1800, n = 2 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + i * (0.11 + Math.random() * 0.06), osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(base, t); osc.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.5), t + 0.06);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
      osc.connect(g).connect(o); osc.start(t); osc.stop(t + 0.1);
    }
  }

  update(dt, camera) {
    if (!this.ctx) return;
    this.nextBird -= dt;
    if (this.nextBird < 0) { this.bird(); this.nextBird = 3 + Math.random() * 9; }
  }
}
