// Sound for the game-select menu: two ambient beds that crossfade with the half you point at, a
// little sound as you cross onto each side, and a sting plus a fade as you pick one. All procedural
// WebAudio, apart from RESIDUE's own breathing recording, used very quietly and far away.
//
//   night (RESIDUE):     a low detuned drone breathing through a lowpass, tape hiss and camcorder
//                        motor whine, and now and then a distant creak, knock or breath
//   day (Undeveloped):   the game's own daylight soundscape (CaseAudio: wind, birds) and harp score
//                        (CaseMusic), routed into this bed instead of the speakers
//
// MenuAudio takes any BaseAudioContext, so the same graph renders offline for listening tests.
// The page wiring (sound switch, hover, leaving) is in main.js.
import { CaseAudio } from "../undeveloped/audio.js";
import { CaseMusic } from "../undeveloped/music.js";

const MASTER = 0.75;
const RAMP = 0.8; // crossfade time, seconds
// [night, day] bed levels for each state of the split
const LEVELS = { neutral: [0.5, 0.5], residue: [1, 0.13], undeveloped: [0.13, 1] };
const DAY_TRIM = 3.2; // the daylight bed is sparse; lift it to sit level with the drone
const HARP_CHORD = [53, 60, 65, 69, 72, 79]; // F major add9, rolled upward

const rand = (a, b) => a + Math.random() * (b - a);

export class MenuAudio {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    const g = (this.gain = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; });

    // night / day / sfx -> user (sound toggle) -> master (exit fade) -> a soft limiter -> out
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12; limiter.knee.value = 6; limiter.ratio.value = 8;
    limiter.attack.value = 0.003; limiter.release.value = 0.25;
    this.master = g(MASTER);
    this.user = g(opts.enabled === false ? 0 : 1);
    this.user.connect(this.master).connect(limiter).connect(ctx.destination);
    this.night = g(LEVELS.neutral[0]); this.night.connect(this.user);
    this.day = g(LEVELS.neutral[1]); this.day.connect(this.user);
    this.sfx = g(1); this.sfx.connect(this.user);

    const len = ctx.sampleRate * 4;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;

    // a long, dark hall: the night bed and RESIDUE's effects ring in it
    this.verb = ctx.createConvolver();
    const n = Math.floor(ctx.sampleRate * 3.2), ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c); let y = 0;
      for (let i = 0; i < n; i++) { y += 0.15 * (Math.random() * 2 - 1 - y); d[i] = y * 1.6 * Math.pow(1 - i / n, 2.5); }
    }
    this.verb.buffer = ir;
    this.verbNight = g(0.5); this.verb.connect(this.verbNight).connect(this.night);
    this.verbSfx = ctx.createConvolver(); this.verbSfx.buffer = ir;
    this.verbSfx.connect(g(0.4)).connect(this.sfx);

    this.buildNight();
    this.buildDay();
    this.nextEvent = rand(4, 8);
    this.lastSide = null;
    this.ready = opts.breathUrl ? this.loadBreath(opts.breathUrl) : Promise.resolve();
  }

  async loadBreath(url) {
    try {
      const data = await (await fetch(url)).arrayBuffer();
      this.breathBuf = await this.ctx.decodeAudioData(data);
    } catch (e) { console.warn("menu: breathing sample failed to load", e); }
  }

  noise(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = loop;
    return s;
  }

  filter(type, f, q = 0.7) {
    const b = this.ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q;
    return b;
  }

  osc(type, f, t0 = this.ctx.currentTime) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = f; o.start(t0);
    return o;
  }

  lfo(f, depth, param, type = "sine") {
    const o = this.osc(type, f), d = this.gain(depth);
    o.connect(d).connect(param);
    return o;
  }

  pan(v) {
    const p = this.ctx.createStereoPanner(); p.pan.value = v;
    return p;
  }

  // ------------------------------------------------------------------------------------ night
  buildNight() {
    const out = this.night, g = this.gain;
    // the drone: detuned saws on A and a flat fifth, a sine underneath, through a low, slowly
    // breathing lowpass
    const lp = this.filter("lowpass", 150, 2.5);
    const drone = g(0.032);
    for (const [type, f, det, a] of [["sawtooth", 55, -7, 0.7], ["sawtooth", 55, 6, 0.7], ["sawtooth", 77.78, 3, 0.4], ["sine", 55, 0, 0.9], ["sine", 41.2, 0, 0.5]]) {
      const o = this.osc(type, f); o.detune.value = det;
      o.connect(g(a)).connect(lp);
    }
    this.lfo(0.043, 70, lp.frequency);
    this.lfo(0.071, 0.011, drone.gain);
    lp.connect(drone).connect(out);
    drone.connect(g(0.25)).connect(this.verb);
    // high above it, a faint minor second that beats against itself, mostly in the reverb
    for (const [f, rate] of [[622.25, 0.05], [659.26, 0.037]]) {
      const o = this.osc("sine", f), og = g(0.0025);
      this.lfo(rate, 0.0022, og.gain);
      o.connect(og); og.connect(g(0.4)).connect(out); og.connect(this.verb);
    }
    // camcorder: tape hiss and a thin motor whine with a little wow
    const hiss = this.noise(true);
    hiss.connect(this.filter("highpass", 3500)).connect(this.filter("lowpass", 9000)).connect(g(0.012)).connect(out);
    hiss.start();
    const motor = this.osc("triangle", 1180), mg = g(0.0022);
    this.lfo(0.23, 6, motor.frequency); this.lfo(5.1, 1.5, motor.frequency);
    this.lfo(0.13, 0.0012, mg.gain);
    motor.connect(this.filter("bandpass", 1180, 3)).connect(mg).connect(out);
  }

  // a distant creak, knock or breath now and then
  nightEvent(t = this.ctx.currentTime) {
    const r = Math.random();
    if (r < 0.4) this.creak(t);
    else if (r < 0.7) this.knock(t);
    else this.breath(t);
  }

  // stick-slip: a pulse train whose rate wanders, through woody resonances, far down a corridor
  creak(t) {
    const g = this.gain, dur = rand(0.7, 1.5);
    const o = this.osc("sawtooth", rand(14, 24), t);
    o.frequency.setValueAtTime(o.frequency.value, t);
    o.frequency.linearRampToValueAtTime(rand(28, 50), t + dur * rand(0.4, 0.7));
    o.frequency.linearRampToValueAtTime(rand(12, 30), t + dur);
    const env = g(0), f = rand(550, 1100);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.05, t + 0.15);
    env.gain.linearRampToValueAtTime(0.035, t + dur * 0.6);
    env.gain.linearRampToValueAtTime(0, t + dur);
    const b1 = this.filter("bandpass", f, 7), b2 = this.filter("bandpass", f * 2.3, 6), mix = g(1);
    o.connect(b1).connect(mix); o.connect(b2).connect(g(0.5)).connect(mix);
    const p = this.pan(rand(-0.7, 0.7));
    mix.connect(this.filter("lowpass", 1800)).connect(env).connect(p);
    p.connect(g(0.5)).connect(this.night); p.connect(this.verb);
    o.stop(t + dur + 0.05);
  }

  // two or three knocks on a door somewhere upstairs
  knock(t) {
    const g = this.gain, p = this.pan(rand(-0.6, 0.6)), lp = this.filter("lowpass", 700);
    lp.connect(p); p.connect(g(0.45)).connect(this.night); p.connect(this.verb);
    const n = 2 + (Math.random() < 0.4 ? 1 : 0), gap = rand(0.22, 0.34), v = rand(0.1, 0.16);
    for (let i = 0; i < n; i++) {
      const ti = t + i * gap * rand(0.9, 1.1);
      const o = this.osc("sine", 110, ti), og = g(0);
      o.frequency.setValueAtTime(110, ti); o.frequency.exponentialRampToValueAtTime(60, ti + 0.1);
      og.gain.setValueAtTime(v, ti); og.gain.exponentialRampToValueAtTime(0.0005, ti + 0.16);
      o.connect(og).connect(lp); o.stop(ti + 0.2);
      const s = this.noise(), sg = g(0);
      sg.gain.setValueAtTime(v * 0.8, ti); sg.gain.exponentialRampToValueAtTime(0.0005, ti + 0.05);
      s.connect(this.filter("bandpass", 400, 1.2)).connect(sg).connect(lp);
      s.start(ti, Math.random() * 3); s.stop(ti + 0.08);
    }
  }

  // RESIDUE's breathing, slowed and muffled, as if from another room; filtered noise if it failed
  breath(t) {
    const g = this.gain, p = this.pan(rand(-0.8, 0.8)), env = g(0);
    let s, dur;
    if (this.breathBuf) {
      s = this.ctx.createBufferSource(); s.buffer = this.breathBuf;
      s.playbackRate.value = rand(0.55, 0.7);
      dur = Math.min(this.breathBuf.duration / s.playbackRate.value, 4.5);
      s.connect(this.filter("lowpass", 650, 0.5)).connect(this.filter("highpass", 120)).connect(env);
      s.start(t);
    } else {
      s = this.noise(); dur = 3;
      s.connect(this.filter("bandpass", 500, 1.5)).connect(env);
      s.start(t, Math.random());
    }
    const peak = this.breathBuf ? 0.09 : 0.03;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + dur * 0.35);
    env.gain.linearRampToValueAtTime(peak * 0.6, t + dur * 0.7);
    env.gain.linearRampToValueAtTime(0, t + dur);
    s.stop(t + dur + 0.05);
    env.connect(p); p.connect(g(0.4)).connect(this.night); p.connect(this.verb);
  }

  // -------------------------------------------------------------------------------------- day
  buildDay() {
    const trim = this.gain(DAY_TRIM); trim.connect(this.day);
    this.caseAudio = new CaseAudio();
    this.caseAudio.start({ ctx: this.ctx, output: trim });
    this.caseAudio.nextBird = 1.5;
    this.music = new CaseMusic(this.caseAudio);
    this.music.enabled = true; // the menu has its own sound switch; the game's music setting is its own
    this.music.start({ manual: true, delay: 1.2 });
    // the Undeveloped sting borrows the score's harp
    this.harp = this.gain(0.4);
    this.harp.connect(this.filter("lowpass", 3200)).connect(this.sfx);
    this.harp.connect(this.gain(0.5)).connect(this.verbSfx);
    for (const m of HARP_CHORD) this.music.ksBuffer(m);
  }

  // ------------------------------------------------------------------------------------ state
  // call ~10x a second while running: random night events, birds, the score's scheduler
  tick(dt) {
    this.caseAudio.update(dt);
    this.music.tick();
    this.nextEvent -= dt;
    if (this.nextEvent <= 0) { this.nightEvent(); this.nextEvent = rand(7, 15); }
  }

  ramp(param, v, dur, t = this.ctx.currentTime) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(v, t + dur);
  }

  // crossfade the beds toward the side being pointed at (null: both even)
  setPick(name) {
    const [n, d] = LEVELS[name] || LEVELS.neutral;
    this.ramp(this.night.gain, n, RAMP);
    this.ramp(this.day.gain, d, RAMP);
  }

  // the pointer (or focus) arrived on a side; sfx only when it changes sides
  hover(name, withSound = true) {
    this.setPick(name);
    const changed = name !== this.lastSide;
    this.lastSide = name;
    if (!name || !changed || !withSound) return;
    const t = this.ctx.currentTime;
    if (name === "residue") this.recBeep(t);
    else this.shutterSoft(t);
  }

  setEnabled(on) {
    this.ramp(this.user.gain, on ? 1 : 0, on ? 0.4 : 0.25);
  }

  // pick a side: its sting, then everything fades out; returns when (s) it is safe to leave
  exit(name) {
    const t = this.ctx.currentTime;
    if (name === "residue") this.stingResidue(t); else this.stingUndeveloped(t);
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t + 0.2);
    this.master.gain.linearRampToValueAtTime(0, t + 0.6);
    return 0.62;
  }

  // back from the browser's page cache: bring the mix back
  restore() {
    this.ramp(this.master.gain, MASTER, 0.6);
    this.lastSide = null;
  }

  // ------------------------------------------------------------------------------------- sfx
  env(t, peak, attack, decay) {
    const e = this.gain(0);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(peak, t + attack);
    e.gain.exponentialRampToValueAtTime(0.0003, t + attack + decay);
    return e;
  }

  noiseHit(t, type, f, q, peak, attack, decay, dest = this.sfx) {
    const s = this.noise(), e = this.env(t, peak, attack, decay);
    s.connect(this.filter(type, f, q)).connect(e).connect(dest);
    s.start(t, Math.random() * 3); s.stop(t + attack + decay + 0.05);
    return e;
  }

  // camcorder REC: the transport engaging, a beep, and something low rising under it
  recBeep(t) {
    const g = this.gain;
    this.noiseHit(t, "lowpass", 500, 1, 0.07, 0.003, 0.05);
    const b = t + 0.06, beep = g(0);
    beep.gain.setValueAtTime(0, b);
    beep.gain.linearRampToValueAtTime(0.03, b + 0.004);
    beep.gain.setValueAtTime(0.03, b + 0.085);
    beep.gain.linearRampToValueAtTime(0, b + 0.092);
    for (const [f, a] of [[1960, 1], [3920, 0.12]]) { const o = this.osc("sine", f, b); o.connect(g(a)).connect(beep); o.stop(b + 0.1); }
    beep.connect(this.sfx);
    this.swell(t + 0.02, 1.9, 0.05);
  }

  swell(t, dur, peak) {
    const g = this.gain, lp = this.filter("lowpass", 60, 3), e = g(0);
    lp.frequency.setValueAtTime(60, t);
    lp.frequency.linearRampToValueAtTime(240, t + dur * 0.35);
    lp.frequency.linearRampToValueAtTime(70, t + dur);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(peak, t + dur * 0.3);
    e.gain.linearRampToValueAtTime(0, t + dur);
    for (const [f, det] of [[36.7, -8], [36.7, 9], [55, 0]]) {
      const o = this.osc("sawtooth", f, t); o.detune.value = det;
      o.connect(lp); o.stop(t + dur + 0.05);
    }
    lp.connect(e); e.connect(this.sfx); e.connect(g(0.5)).connect(this.verbSfx);
  }

  // a soft mechanical shutter and a little rustle of paper
  shutterSoft(t, v = 1) {
    this.noiseHit(t, "bandpass", 1800, 1.5, 0.13 * v, 0.001, 0.045);
    this.noiseHit(t + 0.065, "bandpass", 1150, 1.5, 0.09 * v, 0.001, 0.05);
    this.noiseHit(t + 0.004, "highpass", 5000, 0.7, 0.03 * v, 0.001, 0.02);
    const s = this.noise(), e = this.gain(0), r = t + 0.09;
    e.gain.setValueAtTime(0, r);
    for (let i = 0; i < 6; i++) e.gain.linearRampToValueAtTime((0.012 + Math.random() * 0.022) * v, r + 0.03 + i * 0.035);
    e.gain.linearRampToValueAtTime(0, r + 0.28);
    s.connect(this.filter("bandpass", 3300, 0.8)).connect(e).connect(this.sfx);
    s.start(r, Math.random() * 3); s.stop(r + 0.3);
  }

  // RESIDUE: a low hit and a dissonant cluster sagging into the hall
  stingResidue(t) {
    const g = this.gain;
    const o = this.osc("sine", 75, t), og = g(0);
    o.frequency.setValueAtTime(75, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.9);
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.2, t + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0005, t + 1.3);
    o.connect(og); og.connect(this.sfx); og.connect(g(0.4)).connect(this.verbSfx); o.stop(t + 1.4);
    this.noiseHit(t, "lowpass", 280, 1, 0.14, 0.004, 0.5);
    this.noiseHit(t, "lowpass", 280, 1, 0.2, 0.004, 0.9, this.verbSfx);
    const cl = g(0);
    cl.gain.setValueAtTime(0, t); cl.gain.linearRampToValueAtTime(0.014, t + 0.05);
    cl.gain.exponentialRampToValueAtTime(0.0005, t + 1.6);
    for (const f of [932.3, 987.8, 1046.5, 739.99]) {
      const c = this.osc("triangle", f, t);
      c.frequency.setValueAtTime(f, t); c.frequency.exponentialRampToValueAtTime(f * 0.94, t + 1.6);
      c.connect(cl); c.stop(t + 1.7);
    }
    cl.connect(this.pan(0)).connect(this.sfx); cl.connect(this.verbSfx);
  }

  // Undeveloped: the shutter, then a rolled harp chord from the score
  stingUndeveloped(t) {
    this.shutterSoft(t, 1.2);
    HARP_CHORD.forEach((m, i) => this.music.pluck(t + 0.08 + i * 0.06 + rand(0, 0.012), m, 0.55 + i * 0.05, this.harp));
  }
}

