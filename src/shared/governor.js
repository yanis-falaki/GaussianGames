// Adaptive quality, so frames stay steady on any machine: a ladder of levels that trade render
// resolution and the LoD splat budget against measured frame cost. Both games draw through it.
//
// What it measures: GPU time per frame (EXT_disjoint_timer_query_webgl2) where the browser has it,
// which shows headroom as well as overload, so it can step up as well as down. Elsewhere it
// watches frame intervals: it steps down when frames are missed, and only now and then probes a
// level up, backing off for longer each time a probe fails.
// Changes are rare and spaced out: a level holds for a while, and the steps are small, so detail
// doesn't visibly pump. The chosen level is remembered per quality tier for the next visit.
//
// Developer switches: ?res=0.7 fixes the render scale, ?detail=1.2 fixes the splat budget,
// ?fixed turns the adaptation off (top level). ?debug logs every change.

// best first. res: fraction of the (DPR-capped) canvas resolution; splats: fraction of the tier's
// splat budget. Resolution goes first (cheapest to lose), then both together.
export const LADDER = [
  { res: 1.0, splats: 1.0 },
  { res: 0.9, splats: 1.0 },
  { res: 0.8, splats: 0.85 },
  { res: 0.72, splats: 0.7 },
  { res: 0.66, splats: 0.56 },
  { res: 0.6, splats: 0.45 },
  { res: 0.55, splats: 0.36 },
  { res: 0.5, splats: 0.28 },
];

const KEY = "gaussian-games.level.";
const TARGET_MS = 1000 / 60;
const WINDOW = 30;          // frames per decision window (~0.5 s)
const HOLD_MS = 900;        // minimum time between changes
const SETTLE_FRAMES = 12;   // frames ignored after a change (resize, LoD re-selection)

export class Governor {
  // renderer, spark: the WebGL renderer and SparkRenderer. tier: "full" | "lite" (where the level
  // is remembered). baseSplatScale: the tier's lodSplatScale at the top level. lod: whether a splat
  // budget applies at all. onResize(): called after the render resolution changed.
  constructor({ renderer, spark, tier, baseSplatScale = 1, lod = true, params, integrated = false, onResize }) {
    this.renderer = renderer;
    this.spark = spark;
    this.tier = tier;
    this.lod = lod;
    this.baseSplatScale = baseSplatScale;
    this.onResize = onResize;
    this.debug = params.has("debug");
    this.fixedRes = params.has("res") ? Math.min(1, Math.max(0.25, Number(params.get("res")) || 1)) : null;
    this.fixedDetail = params.has("detail") ? Number(params.get("detail")) || null : null;
    this.enabled = !params.has("fixed") && !(this.fixedRes && (this.fixedDetail || !lod));
    let start = integrated ? 2 : 0;
    try {
      const saved = localStorage.getItem(KEY + tier);
      if (saved !== null) start = Math.max(0, Number(saved) - 1); // try one better than last time
    } catch {}
    this.level = this.enabled ? Math.min(LADDER.length - 1, start) : 0;
    this.cooldown = new Float64Array(LADDER.length); // time before which a level may not be retried
    this.failures = new Uint8Array(LADDER.length);
    this.lastChange = 0;
    this.lastProbe = null; // { level, at }
    this.settle = SETTLE_FRAMES;
    this.samples = [];   // GPU ms (or frame intervals without a GPU timer) in the current window
    this.intervals = [];
    this.goodWindows = 0;
    this.lastEnd = 0;
    this.active = false; // decisions start with activate(), once the scan has loaded and settled
    this.streamedAt = 0; // when Spark last had chunks in flight (their uploads can stall a frame)
    this.listeners = new Set();
    const gl = renderer.getContext();
    this.gl = gl;
    this.timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    this.query = null;
    this.pending = [];
    this.timing = true; // false while something else (the old benchmark) times frames itself
    this.apply();
  }

  get res() { return this.fixedRes ?? LADDER[this.level].res; }

  // the canvas pixel ratio at this level: never above 1 (as World Labs' viewer does: on high-DPI
  // screens the splats look the same at CSS resolution, at a quarter of the cost)
  pixelRatio() { return Math.min(devicePixelRatio, 1) * this.res; }

  apply() {
    const r = this.renderer;
    const pr = this.pixelRatio();
    if (Math.abs(r.getPixelRatio() - pr) > 1e-3) {
      r.setPixelRatio(pr);
      r.setSize(innerWidth, innerHeight);
      this.onResize?.();
    }
    if (this.lod) this.spark.lodSplatScale = this.fixedDetail ?? this.baseSplatScale * LADDER[this.level].splats;
  }

  // start adapting (call once loading has settled: the stalls while Spark builds its structures
  // say nothing about the steady frame cost)
  activate() {
    if (this.active) return;
    this.active = true;
    this.settle = SETTLE_FRAMES;
    this.intervals.length = this.samples.length = 0;
  }

  // a window resize: keep the level, re-apply the pixel ratio
  resize() {
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(innerWidth, innerHeight);
    this.onResize?.();
  }

  setLevel(level, why) {
    level = Math.max(0, Math.min(LADDER.length - 1, level));
    if (level === this.level) return;
    if (this.debug) console.log(`[governor] level ${this.level} -> ${level} (${why}) res ${LADDER[level].res} splats ${LADDER[level].splats}`);
    this.level = level;
    this.lastChange = performance.now();
    this.settle = SETTLE_FRAMES;
    this.samples.length = this.intervals.length = 0;
    this.goodWindows = 0;
    // Not now: decisions are made at the end of a frame, after it was drawn, and resizing the
    // canvas clears it, so the browser would show that frame black. The next begin() applies it,
    // before anything is drawn into the new buffer.
    this.pendingApply = true;
    try { localStorage.setItem(KEY + this.tier, String(level)); } catch {}
  }

  // wrap the frame's GPU work: begin() before the first draw, end() after the last
  begin() {
    if (this.pendingApply) { this.pendingApply = false; this.apply(); }
    if (!this.timer || !this.timing || this.query || this.pending.length >= 4) return;
    this.query = this.gl.createQuery();
    this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT, this.query);
  }

  end(regen = false) {
    const gl = this.gl;
    if (this.query) {
      gl.endQuery(this.timer.TIME_ELAPSED_EXT);
      this.pending.push({ q: this.query, regen });
      this.query = null;
    }
    // finished GPU timings (they arrive a frame or two late)
    while (this.pending.length && gl.getQueryParameter(this.pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
      const { q, regen: rg } = this.pending.shift();
      const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT);
      const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(q);
      if (disjoint) continue;
      for (const f of this.listeners) f(ms, rg);
      if (this.settle <= 0) this.samples.push(ms);
    }
    const now = performance.now();
    const dt = this.lastEnd ? now - this.lastEnd : 0;
    this.lastEnd = now;
    if (dt > 250 || dt <= 0) { this.intervals.length = 0; return; } // tab hidden, a stall, or the first frame
    if (this.settle > 0) { this.settle--; return; }
    this.intervals.push(dt);
    const pager = this.spark.pager;
    if (pager && (pager.fetchers?.length || pager.fetched?.length || pager.readyUploads?.length)) this.streamedAt = now;
    if (this.enabled && this.active) this.decide(now);
  }

  // Frame intervals are the ground truth: a level is too high when frames are missed (shown for
  // longer than ~1.5 refreshes at 60 Hz). The GPU timer, where there is one, adds two things: it
  // shows clear headroom (so a step up needn't be a blind probe), and it tells a CPU-bound stall
  // (which fewer pixels wouldn't fix) from a GPU-bound one. (It can't be the trigger itself: it
  // counts GPU idle bubbles inside the frame too, so it overestimates under load.)
  decide(now) {
    if (this.intervals.length < WINDOW) return;
    const iv = this.intervals.splice(0);
    const missed = iv.filter((x) => x > 24).length / iv.length;
    const meanIv = iv.reduce((a, b) => a + b, 0) / iv.length;
    let gpuP90 = null;
    if (this.timer && this.samples.length >= WINDOW / 2) {
      const g = this.samples.splice(0).sort((a, b) => a - b);
      gpuP90 = g[Math.floor(g.length * 0.9)];
    } else this.samples.length = 0;
    if (this.debug) this.why = `frames ${meanIv.toFixed(1)}ms missed ${(missed * 100).toFixed(0)}%` + (gpuP90 !== null ? ` gpu p90 ${gpuP90.toFixed(1)}ms` : "");
    const over = missed > 0.06; // (not the mean: one long stall, a GC or an upload, is not a GPU budget problem)
    // stalls that fewer pixels or splats wouldn't fix: a CPU-bound frame (the GPU was mostly idle),
    // or streamed chunks being uploaded (without a GPU timer, a few missed frames then don't count)
    const streaming = now - this.streamedAt < 1000;
    const cpuBound = gpuP90 !== null ? gpuP90 < TARGET_MS * 0.4 : streaming && missed < 0.3;
    const calm = missed < 0.02 && meanIv < 17.6;
    const headroom = calm && gpuP90 !== null && gpuP90 < TARGET_MS * 0.5;
    if (now - this.lastChange < HOLD_MS) return;
    if (over && !cpuBound) {
      // a failed probe: don't try that level again for a while (longer each time)
      if (this.lastProbe && this.lastProbe.level === this.level && now - this.lastProbe.at < 4000) {
        const f = Math.min(6, ++this.failures[this.level]);
        this.cooldown[this.level] = now + 15000 * 2 ** f;
      }
      this.lastProbe = null;
      this.goodWindows = 0;
      this.setLevel(this.level + (missed > 0.4 ? 2 : 1), this.why ?? "over budget");
    } else if (calm && this.level > 0) {
      // clear GPU headroom: step up after a moment. Otherwise probe after a few calm seconds.
      if (++this.goodWindows >= (headroom ? 3 : 8) && now >= this.cooldown[this.level - 1]) {
        this.lastProbe = { level: this.level - 1, at: now };
        this.setLevel(this.level - 1, `headroom: ${this.why ?? ""}`);
      }
    } else this.goodWindows = 0;
  }

  stats() {
    return { level: this.level, res: this.res, lodSplatScale: +this.spark.lodSplatScale.toFixed(3), gpuTimer: !!this.timer };
  }
}
