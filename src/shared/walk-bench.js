// Frame-pacing benchmark shared by both games (loaded only with ?bench): walk a fixed path
// through the ground floor at 2 m/s while looking around, draw every frame through the game's
// own frame function, and report what a player feels: frame rate, p95/p99 frame time, hitches,
// GPU time (EXT_disjoint_timer_query_webgl2 where available) and main-thread time per frame.
// tools/bench/walk.mjs drives it headless.

// [x, y(feet), z, yaw]: kitchen -> hall -> east windows -> lounge, turning as it goes
export const PATH = [
  [-2.6, -1.5, -2.4, 2.8], [-0.5, -1.5, 2.5, 3.6], [4.5, -1.5, 7.0, 2.4], [8.2, -1.5, 9.0, 3.4],
  [11.0, -1.5, 14.0, 2.2], [12.5, -1.5, 19.5, 4.4], [9.0, -1.5, 22.0, 3.0], [6.0, -1.5, 26.5, 1.2],
];
const SEG = PATH.slice(1).map((b, i) => Math.hypot(b[0] - PATH[i][0], b[2] - PATH[i][2]));

// the pose at time t (s) along the path: walking at `speed` m/s, looking +-50 degrees
export function poseAt(t, speed = 2.0) {
  let dist = t * speed, i = 0;
  while (i < SEG.length - 1 && dist > SEG[i]) { dist -= SEG[i]; i++; }
  const a = PATH[i], b = PATH[i + 1], f = Math.min(1, dist / SEG[i]);
  const look = Math.sin(t * 1.7) * 0.87;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f + look];
}

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

// Walk the path for `seconds` (after `warmup` seconds on the same path, not measured).
// pose(x, y, z, yaw) places the player; frame() draws one frame exactly as the game does.
// probe() (optional) returns per-frame counters to average, e.g. { splats, pixels }.
// regens() (optional) counts splat regenerations, to split GPU time by frames with and without one.
// governor (optional): the view's governor, which already times every frame on the GPU (two
// timer queries can't nest, so the walk then takes its timings instead of making its own).
export async function walk({ renderer, pose, frame, seconds = 20, warmup = 3, speed = 2.0, probe, regens, governor }) {
  const gl = renderer.getContext();
  const tq = governor?.timer ? null : gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const frames = [], cpu = [], gpu = [], gpuRegen = [], gpuPlain = [], pending = [], counters = {};
  let longTasks = 0;
  const lt = typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("longtask")
    ? new PerformanceObserver((l) => (longTasks += l.getEntries().length)) : null;
  let measuring = false;
  const feed = (ms, regen) => { if (!measuring) return; gpu.push(ms); (regen ? gpuRegen : gpuPlain).push(ms); };
  governor?.listeners.add(feed);
  const t0 = performance.now();
  let last = t0;
  for (;;) {
    const now = await new Promise(requestAnimationFrame);
    const t = (now - t0) / 1000;
    if (t > warmup + seconds) break;
    if (!measuring && t > warmup) { measuring = true; lt?.observe({ entryTypes: ["longtask"] }); }
    pose(...poseAt(t, speed));
    if (measuring) {
      frames.push(now - last);
      for (let k = pending.length - 1; k >= 0; k--) {
        const { q, regen } = pending[k];
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) {
            const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
            gpu.push(ms);
            (regen ? gpuRegen : gpuPlain).push(ms);
          }
          gl.deleteQuery(q);
          pending.splice(k, 1);
        }
      }
      if (probe) for (const [k, v] of Object.entries(probe())) (counters[k] ??= []).push(v);
    }
    last = now;
    const c0 = performance.now();
    if (measuring && tq && pending.length < 8) {
      const q = gl.createQuery(), r0 = regens?.();
      gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
      frame();
      gl.endQuery(tq.TIME_ELAPSED_EXT);
      pending.push({ q, regen: regens?.() !== r0 });
    } else frame();
    if (measuring) cpu.push(performance.now() - c0);
  }
  lt?.disconnect();
  governor?.listeners.delete(feed);
  const f = [...frames].sort((a, b) => a - b), g = [...gpu].sort((a, b) => a - b), c = [...cpu].sort((a, b) => a - b);
  const med = pct(f, 0.5);
  const out = {
    frames: f.length,
    fps: +(1000 / avg(frames)).toFixed(1),
    frameMs: +avg(frames).toFixed(2),
    p50: +med.toFixed(2),
    p95: +pct(f, 0.95).toFixed(2),
    p99: +pct(f, 0.99).toFixed(2),
    maxMs: +f[f.length - 1]?.toFixed(1),
    // hitches: frames that took noticeably longer than a 60 Hz frame (>25 ms), and outright
    // stutters (>50 ms, three or more refreshes)
    hitch25: frames.filter((x) => x > 25).length,
    hitch50: frames.filter((x) => x > 50).length,
    gpuMs: +avg(g).toFixed(2),
    gpuP95: +pct(g, 0.95).toFixed(2),
    gpuRegenMs: +avg(gpuRegen).toFixed(2), // frames that regenerated the splats
    gpuDrawMs: +avg(gpuPlain).toFixed(2),  // frames that only drew
    cpuMs: +avg(cpu).toFixed(2),
    cpuP99: +pct(c, 0.99).toFixed(2),
    cpuMax: +(c[c.length - 1] ?? 0).toFixed(1),
    longTasks,
  };
  for (const [k, v] of Object.entries(counters)) out[k] = Math.round(avg(v));
  return out;
}

// count the streamed pages Spark uploads to the GPU from now on (returns a getter)
export function countPageUploads(spark) {
  const pager = spark.pager;
  if (!pager) return () => 0;
  if (!pager.__counted) {
    const upload = pager.uploadPage.bind(pager);
    pager.uploadPage = (...a) => { pager.__uploads = (pager.__uploads ?? 0) + 1; return upload(...a); };
    pager.__counted = true;
  }
  const start = pager.__uploads ?? 0;
  return () => (pager.__uploads ?? 0) - start;
}
