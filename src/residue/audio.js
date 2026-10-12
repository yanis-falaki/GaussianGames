// RESIDUE's sound, synthesised with WebAudio apart from one breathing recording: room tone,
// HRTF footsteps, the entity's breath and steps, the lamp's ratchet, the bulb's hum, the piano,
// the plates' shimmer, scares and the heartbeat.
export class ResidueAudio {
  constructor() {
    this.ctx = null;
  }

  start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // shared reverb (synthetic impulse: a big tiled hall)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.4);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.reverb.connect(this.wet).connect(this.master);

    this.noiseBuf = this.makeNoise(4);
    this.buildDrone();
    this.buildEntityVoice();
    this.buildHeart();
    this.breath = { effort: 0 };
    this.beacons = [];
    this.loadBreathing();
  }

  // your own breathing: a recorded loop (CC0, opengameart.org "breathing tired" by mikeask),
  // sped up / opened up / made louder as you tire or panic; nearly silent when calm
  async loadBreathing() {
    try {
      const buf = await (await fetch("assets/audio/breathing.wav")).arrayBuffer();
      const audioBuf = await this.ctx.decodeAudioData(buf);
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = audioBuf; src.loop = true;
      this.breathLp = ctx.createBiquadFilter();
      this.breathLp.type = "lowpass"; this.breathLp.frequency.value = 900;
      this.breathGain = ctx.createGain(); this.breathGain.gain.value = 0;
      src.connect(this.breathLp).connect(this.breathGain).connect(this.master); // dry: it's you
      src.start();
      this.breathSrc = src;
      this.buildEntityBreath(audioBuf);
    } catch (e) { console.warn("breathing sample failed to load", e); }
  }

  // --- exposures: now and then a faint glassy shimmer from where each one waits ----------
  setBeacons(points) {
    if (!this.ctx) return;
    this.beacons = points.map((p, i) => ({ p, on: true, next: 3 + Math.random() * 6, base: [523.3, 587.3, 659.3, 698.5, 784.0, 880.0][i % 6] }));
  }
  silenceBeacon(i) {
    if (this.beacons[i]) this.beacons[i].on = false;
  }
  shimmer(b) {
    const ctx = this.ctx, t = ctx.currentTime;
    const pan = new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "exponential", refDistance: 1.0, rolloffFactor: 2.2,
      positionX: b.p.x, positionY: b.p.y + 0.5, positionZ: b.p.z });
    this.send(pan, 0.7, 0.9);
    const n = 2 + ((Math.random() * 2) | 0);
    for (let k = 0; k < n; k++) {
      const st = t + k * (0.18 + Math.random() * 0.12);
      const o = ctx.createOscillator(); o.type = "sine";
      o.frequency.value = b.base * [1, 1.5, 2, 1.335][(Math.random() * 4) | 0] * (1 + (Math.random() - 0.5) * 0.01);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(0.045, st + 0.02); g.gain.exponentialRampToValueAtTime(0.0005, st + 1.4);
      o.connect(g).connect(pan); o.start(st); o.stop(st + 1.5);
    }
  }

  // jump scare: a torn burst of noise with a falling shriek
  scare() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = this.noise(false), g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    s.connect(g).connect(this.master); s.start(t); s.stop(t + 1);
    const o = ctx.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.8);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.35, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
    const ws = ctx.createWaveShaper(); const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 6); }
    ws.curve = curve;
    o.connect(ws).connect(og).connect(this.master); o.start(t); o.stop(t + 0.9);
  }

  impulse(sec, decay) {
    const ctx = this.ctx, n = ctx.sampleRate * sec;
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      // one-pole low-passed noise whose cutoff falls over time: a dark, damp room, no hiss
      let y = 0;
      for (let i = 0; i < n; i++) {
        const k = 0.35 * (1 - i / n) + 0.04;
        y += k * ((Math.random() * 2 - 1) - y);
        d[i] = y * 2.2 * Math.pow(1 - i / n, decay);
      }
    }
    return b;
  }

  makeNoise(sec) {
    const ctx = this.ctx, n = ctx.sampleRate * sec;
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  noise(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = loop;
    s.loopStart = Math.random() * 3;
    return s;
  }

  send(node, dry = 1, wet = 0.5) {
    const g = this.ctx.createGain();
    g.gain.value = dry;
    node.connect(g).connect(this.master);
    const w = this.ctx.createGain();
    w.gain.value = wet;
    node.connect(w).connect(this.reverb);
  }

  // --- continuous layers -------------------------------------------------------------
  buildDrone() {
    const ctx = this.ctx;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.0;
    this.droneGain.gain.setTargetAtTime(0.22, ctx.currentTime, 4);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 180;
    const n = this.noise();
    n.connect(lp).connect(this.droneGain);
    n.start();
    // detuned low sines: a slowly beating "room tone" / building hum
    for (const [f, g] of [[48.9, 0.25], [49.6, 0.25], [97.7, 0.06], [146.3, 0.025]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.droneGain);
      o.start();
    }
    // slow breathing LFO on the filter
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 80;
    lfo.connect(lg).connect(lp.frequency);
    lfo.start();
    this.send(this.droneGain, 1, 0.3);

  }

  buildEntityVoice() {
    // its presence is only audible up close: a slow, reversed, muffled breath (your own
    // breathing recording, played backwards and far too slow) plus a step on every stop-motion
    // jump. Steep falloff: beyond ~8m you hear nothing.
    const ctx = this.ctx;
    this.entPanner = new PannerNode(ctx, {
      panningModel: "HRTF", distanceModel: "exponential", refDistance: 1.0, rolloffFactor: 2.6,
    });
    this.entGain = ctx.createGain();
    this.entGain.gain.value = 0;
    this.entGain.connect(this.entPanner);
    this.send(this.entPanner, 1, 0.45);
  }

  // called once the breathing sample has loaded: build the entity's reversed breath from it
  buildEntityBreath(audioBuf) {
    const ctx = this.ctx;
    const rev = ctx.createBuffer(audioBuf.numberOfChannels, audioBuf.length, audioBuf.sampleRate);
    for (let c = 0; c < audioBuf.numberOfChannels; c++) rev.getChannelData(c).set(audioBuf.getChannelData(c).slice().reverse());
    const src = ctx.createBufferSource();
    src.buffer = rev; src.loop = true; src.playbackRate.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 650;
    const g = ctx.createGain(); g.gain.value = 1.4;
    src.connect(lp).connect(g).connect(this.entGain);
    src.start();
  }

  // her footfalls: a soft, dull step for the good foot (kind 0); the broken one (kind 1) is
  // dragged, a dry scrape of toes on the floor ending in a weak, flat landing. Running flat out
  // (kinds 2, 3) they are loud bare-foot slaps on tile that carry down a corridor (20m+), the
  // broken foot slapping down crooked with a skid; every other stride a ragged rasp of breath.
  // Kind 4 is the sharp intake of breath before she charges.
  entityStep(pos, vol = 1, kind = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const far = kind >= 2;
    const out = new PannerNode(ctx, { panningModel: "HRTF", distanceModel: far ? "inverse" : "exponential",
      refDistance: far ? 3 : 1, rolloffFactor: far ? 1.1 : 2.4, maxDistance: 60,
      positionX: pos.x, positionY: pos.y + (kind === 4 ? 1.5 : 0.05), positionZ: pos.z });
    this.send(out, 1, far ? 0.9 : 0.5);
    if (kind === 4) return this.rasp(out, t, true);
    if (far) {
      const v = kind === 3 ? 0.75 : 1;
      // the slap: a sharp, wet transient over a heavy low thud
      const s1 = this.noise(false), hp = ctx.createBiquadFilter(), g1 = ctx.createGain();
      hp.type = "bandpass"; hp.frequency.value = 1800 + Math.random() * 900; hp.Q.value = 0.8;
      g1.gain.setValueAtTime(0, t); g1.gain.linearRampToValueAtTime(0.55 * v, t + 0.004); g1.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      s1.connect(hp).connect(g1).connect(out); s1.start(t, Math.random() * 3); s1.stop(t + 0.09);
      const s2 = this.noise(false), lp = ctx.createBiquadFilter(), g2 = ctx.createGain();
      lp.type = "lowpass"; lp.frequency.value = 220 + Math.random() * 80;
      g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(1.1 * v, t + 0.008); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      s2.connect(lp).connect(g2).connect(out); s2.start(t, Math.random() * 3); s2.stop(t + 0.18);
      if (kind === 3) {
        // the broken foot skids as it lands
        const s3 = this.noise(false), bp = ctx.createBiquadFilter(), g3 = ctx.createGain();
        bp.type = "bandpass"; bp.Q.value = 1.2; bp.frequency.setValueAtTime(1300, t); bp.frequency.linearRampToValueAtTime(700, t + 0.14);
        g3.gain.setValueAtTime(0, t + 0.01); g3.gain.linearRampToValueAtTime(0.22, t + 0.03); g3.gain.linearRampToValueAtTime(0, t + 0.15);
        s3.connect(bp).connect(g3).connect(out); s3.start(t, Math.random() * 3); s3.stop(t + 0.16);
        if (Math.random() < 0.75) this.rasp(out, t + 0.05, false);
      }
      return;
    }
    let land = t;
    if (kind === 1) {
      const dur = 0.22 + Math.random() * 0.12;
      const sc = this.noise(false), bp = ctx.createBiquadFilter(), sg = ctx.createGain();
      bp.type = "bandpass"; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(700 + Math.random() * 300, t); bp.frequency.linearRampToValueAtTime(1500 + Math.random() * 500, t + dur);
      sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(0.16 * vol, t + 0.05);
      sg.gain.setValueAtTime(0.16 * vol, t + dur - 0.04); sg.gain.linearRampToValueAtTime(0, t + dur);
      sc.connect(bp).connect(sg).connect(out); sc.start(t, Math.random() * 3); sc.stop(t + dur + 0.02);
      land = t + dur - 0.02;
      vol *= 0.6;
    }
    const s = this.noise(false), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = "lowpass"; lp.frequency.value = 260 + Math.random() * 120;
    g.gain.setValueAtTime(0, land); g.gain.linearRampToValueAtTime(0.5 * vol, land + 0.01); g.gain.exponentialRampToValueAtTime(0.001, land + 0.18);
    s.connect(lp).connect(g).connect(out); s.start(land, Math.random() * 3); s.stop(land + 0.22);
  }

  // a ragged, throaty breath: two formant bands over noise. `inhale` is the long, rising gasp
  // she takes before she runs; otherwise a short rasping exhale between strides.
  rasp(out, t, inhale) {
    const ctx = this.ctx, dur = inhale ? 0.5 + Math.random() * 0.15 : 0.16 + Math.random() * 0.08;
    const src = this.noise(false), g = ctx.createGain();
    for (const [f0, f1, q, amp] of [[650, 1100, 4, 1], [1900, 2700, 6, 0.6]]) {
      const bp = ctx.createBiquadFilter(), bg = ctx.createGain();
      bp.type = "bandpass"; bp.Q.value = q;
      bp.frequency.setValueAtTime(inhale ? f0 : f1, t); bp.frequency.linearRampToValueAtTime(inhale ? f1 : f0, t + dur);
      bg.gain.value = amp;
      src.connect(bp).connect(bg).connect(g);
    }
    const peak = inhale ? 0.9 : 0.35;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak * (inhale ? 0.4 : 1), t + (inhale ? 0.05 : 0.02));
    if (inhale) g.gain.linearRampToValueAtTime(peak, t + dur * 0.85);
    g.gain.linearRampToValueAtTime(0, t + dur);
    // a little irregular grit, like a throat that doesn't work properly
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 28 + Math.random() * 20; lg.gain.value = peak * 0.35;
    lfo.connect(lg).connect(g.gain);
    g.connect(out);
    src.start(t, Math.random() * 3); src.stop(t + dur + 0.02); lfo.start(t); lfo.stop(t + dur + 0.02);
  }

  buildHeart() {
    this.heartRate = 0; // beats per second (0 = off)
    this.nextBeat = 0;
  }

  thump(t, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
  }

  // --- one shots -----------------------------------------------------------------------
  footstep(intensity = 1, surface = 0.5) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // soft, low scuff of a shoe on a dusty floor
    const s = this.noise(false);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 380 + surface * 220;
    lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4 * intensity, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16 + Math.random() * 0.05);
    s.connect(lp).connect(g);
    this.send(g, 0.8, 0.3);
    s.start(t, Math.random() * 3);
    s.stop(t + 0.25);
    // heel thud
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(95 + Math.random() * 15, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.18 * intensity, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.12);
  }

  click() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = this.noise(false);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    s.connect(hp).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + 0.05);
  }

  // one pull of the dynamo lamp's cord: a ratchet that speeds up and a gear whine that rises
  // and spins down. Loud and echoing on purpose.
  windPull() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.55;
    this.send(out, 0.9, 0.7);
    // ratchet: clicks accelerating through the pull, then a few slow ones as it coasts
    let at = 0;
    for (let i = 0; i < 16; i++) {
      at += i < 11 ? 0.045 - i * 0.0025 : 0.04 + (i - 11) * 0.03;
      const s = this.noise(false);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2200 + Math.random() * 900;
      bp.Q.value = 4;
      const g = ctx.createGain();
      const v = (i < 11 ? 0.35 : 0.22) * (0.8 + Math.random() * 0.4);
      g.gain.setValueAtTime(v, t + at);
      g.gain.exponentialRampToValueAtTime(0.001, t + at + 0.018);
      s.connect(bp).connect(g).connect(out);
      s.start(t + at, Math.random() * 3);
      s.stop(t + at + 0.03);
    }
    // the dynamo spinning up and down
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.38);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.68);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 1.2;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.06, t + 0.1);
    og.gain.linearRampToValueAtTime(0.0, t + 0.68);
    o.connect(bp).connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.72);
  }

  // the stair bulb's mains hum: quiet, close, follows the flicker
  buildHum(pos) {
    if (!this.ctx || this.hum) return;
    const ctx = this.ctx;
    const p = new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "exponential", refDistance: 1.5, rolloffFactor: 1.5, positionX: pos.x, positionY: pos.y, positionZ: pos.z });
    const g = ctx.createGain();
    g.gain.value = 0;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 360; bp.Q.value = 2;
    for (const [f, v] of [[100, 1], [200, 0.6], [300, 0.35]]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth"; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = v;
      o.connect(og).connect(bp);
      o.start();
    }
    bp.connect(g).connect(p);
    this.send(p, 1, 0.3);
    this.hum = g;
  }
  humLevel(v) { if (this.hum) this.hum.gain.setTargetAtTime(0.035 * v, this.ctx.currentTime, 0.02); }

  // spatial one-shot helper
  spatial(pos, listenerWet = 0.8) {
    const p = new PannerNode(this.ctx, {
      panningModel: "HRTF", distanceModel: "exponential", refDistance: 2, rolloffFactor: 1.1,
      positionX: pos.x, positionY: pos.y, positionZ: pos.z,
    });
    this.send(p, 1, listenerWet);
    return p;
  }

  // A single detuned piano note from the abandoned grand piano.
  piano(pos, midi = 40 + Math.floor(Math.random() * 30), vol = 0.25) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this.spatial(pos, 1.2);
    const f0 = 440 * Math.pow(2, (midi - 69) / 12) * (1 + (Math.random() - 0.5) * 0.02);
    for (let h = 1; h <= 7; h++) {
      const o = ctx.createOscillator();
      o.frequency.value = f0 * h * (1 + 0.0007 * h * h); // slight inharmonicity
      const g = ctx.createGain();
      const a = vol / (h * 1.3);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.005);
      g.gain.exponentialRampToValueAtTime(a * 0.3, t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5 / Math.sqrt(h));
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 4);
    }
  }

  knock(pos, count = 3) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const out = this.spatial(pos, 1.0);
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + i * (0.28 + Math.random() * 0.1);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.2);
      const s = this.noise(false);
      const bp = ctx.createBiquadFilter();
      bp.frequency.value = 600;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.3, t);
      sg.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      s.connect(bp).connect(sg).connect(out);
      s.start(t, Math.random() * 3);
      s.stop(t + 0.1);
    }
  }

  // long creak: resonant filter sweeping over a buzzy source
  creak(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this.spatial(pos, 1.0);
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(18, t);
    o.frequency.linearRampToValueAtTime(34 + Math.random() * 20, t + 1.6);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 12;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.linearRampToValueAtTime(900 + Math.random() * 600, t + 1.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.3);
    g.gain.linearRampToValueAtTime(0, t + 2);
    o.connect(bp).connect(g).connect(out);
    o.start(t);
    o.stop(t + 2.1);
  }

  pickup() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.value = 0.12;
    this.send(g, 1, 1.5);
    [0, 3, 7, 10, 14].forEach((st, i) => {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = 330 * Math.pow(2, st / 12);
      const og = ctx.createGain();
      const s = t + i * 0.09;
      og.gain.setValueAtTime(0, t);
      og.gain.setValueAtTime(0, s);
      og.gain.linearRampToValueAtTime(1, s + 0.02);
      og.gain.exponentialRampToValueAtTime(0.001, s + 2.5);
      o.connect(og).connect(g);
      o.start(t);
      o.stop(s + 2.6);
    });
  }

  // all six plates found: their six beacon notes, one after another like a music box, settle
  // into a warm chord; then a breath of outside air from the window that just opened
  allPlates(windowPos) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime + 1.4; // after the last plate's own chime
    const g = ctx.createGain();
    g.gain.value = 0.1;
    this.send(g, 1, 1.4);
    [523.3, 587.3, 659.3, 698.5, 784.0, 880.0].forEach((f, i) => {
      const s = t0 + i * 0.16;
      for (const [mul, v] of [[1, 1], [2, 0.25]]) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f * mul;
        const og = ctx.createGain();
        og.gain.setValueAtTime(0, s);
        og.gain.linearRampToValueAtTime(v, s + 0.008);
        og.gain.exponentialRampToValueAtTime(0.001, s + 2.2);
        o.connect(og).connect(g);
        o.start(s); o.stop(s + 2.3);
      }
    });
    // the resolving chord (C major, low and soft), swelling in under the last notes
    const c = t0 + 0.9;
    for (const f of [130.8, 196.0, 261.6, 329.6, 392.0]) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, c);
      og.gain.linearRampToValueAtTime(0.35, c + 1.2);
      og.gain.exponentialRampToValueAtTime(0.001, c + 6.5);
      o.connect(og).connect(g);
      o.start(c); o.stop(c + 6.6);
    }
    // outside air through the opened window: a soft swell of wind from that direction
    if (windowPos) {
      const w = t0 + 2.4;
      const s = this.noise(true);
      const lp = ctx.createBiquadFilter();
      lp.type = "bandpass"; lp.frequency.setValueAtTime(500, w); lp.frequency.linearRampToValueAtTime(900, w + 2); lp.Q.value = 0.6;
      const wg = ctx.createGain();
      wg.gain.setValueAtTime(0, w);
      wg.gain.linearRampToValueAtTime(0.5, w + 1.5);
      wg.gain.linearRampToValueAtTime(0, w + 4.5);
      s.connect(lp).connect(wg).connect(this.spatial(windowPos, 0.6));
      s.start(w, Math.random() * 2); s.stop(w + 4.6);
    }
  }

  stinger() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3);
    this.send(g, 1, 1.0);
    for (const f of [61, 65.4, 92.5, 138.6, 196, 277]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f * 1.03, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.97, t + 3);
      o.connect(g);
      o.start(t);
      o.stop(t + 3);
    }
  }

  // white-noise burst + falling tone: the "decoherence" when caught
  caught() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = this.noise(false);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
    const lp = ctx.createBiquadFilter();
    lp.frequency.setValueAtTime(12000, t);
    lp.frequency.exponentialRampToValueAtTime(80, t + 2.5);
    s.connect(lp).connect(g);
    this.send(g, 1, 0.8);
    s.start(t);
    s.stop(t + 2.6);
    this.stinger();
  }

  // --- per frame -----------------------------------------------------------------------
  update(dt, camera, s) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const L = ctx.listener;
    const p = camera.position;
    const f = camera.getWorldDirection(this._v || (this._v = camera.position.clone()));
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.02);
      L.positionY.setTargetAtTime(p.y, t, 0.02);
      L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(f.x, t, 0.02);
      L.forwardY.setTargetAtTime(f.y, t, 0.02);
      L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
    // entity voice
    const e = s.entityPos;
    if (e) {
      this.entPanner.positionX.setTargetAtTime(e.x, t, 0.05);
      this.entPanner.positionY.setTargetAtTime(e.y, t, 0.05);
      this.entPanner.positionZ.setTargetAtTime(e.z, t, 0.05);
    }
    this.entGain.gain.setTargetAtTime(s.entityVolume, t, 0.2);
    this.droneGain.gain.setTargetAtTime(0.18 + s.dread * 0.25, t, 1);

    // breathing: barely there when calm; faster, louder, less muffled when tired or afraid
    const effort = Math.max(s.exertion ?? 0, s.dread ?? 0, (s.seen ?? 0) * 0.8);
    this.breath.effort += (effort - this.breath.effort) * Math.min(1, dt * 1.2);
    const be = this.breath.effort;
    if (this.breathSrc) {
      this.breathSrc.playbackRate.setTargetAtTime(0.72 + be * 0.5, t, 0.4);
      this.breathGain.gain.setTargetAtTime(0.025 + be * be * 0.4, t, 0.4);
      this.breathLp.frequency.setTargetAtTime(700 + be * 4000, t, 0.4);
    }
    // exposures shimmer now and then (a little more often as you get close)
    for (const b of this.beacons) {
      if (!b.on) continue;
      b.next -= dt;
      if (b.next > 0) continue;
      const d = Math.hypot(b.p.x - p.x, b.p.z - p.z);
      if (d < 16) this.shimmer(b);
      b.next = (d < 6 ? 3 : 5) + Math.random() * 5;
    }

    // heartbeat
    this.heartRate = s.dread > 0.25 ? 0.9 + s.dread * 1.6 : 0;
    if (this.heartRate > 0 && t > this.nextBeat) {
      const v = 0.15 + s.dread * 0.5;
      this.thump(t + 0.01, v);
      this.thump(t + 0.24, v * 0.6);
      this.nextBeat = t + 1 / this.heartRate;
    }
  }
}
