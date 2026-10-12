// RESIDUE's benchmark (residue.html?bench), used by tools/bench/ to tune the render settings.
// installBenchApi() exposes window.bench: fly a fixed camera path under a render config and
// report frame time + GPU time, capture fixed viewpoints, and score them (SSIM / PSNR) against
// reference captures. Renders at a fixed 1920x1080 regardless of the window so results reflect
// fullscreen play. Loaded only with ?bench (see main.js).
import * as THREE from "three";
import { U } from "./lighting.js";

const $ = (id) => document.getElementById(id);

// ctx: { state, renderer, spark, camera, mesh, player, fx, entity, renderFrame }
export function installBenchApi(ctx) {
  const { state, renderer, spark, camera, mesh, player, fx, entity } = ctx;
  state.benching = true;
  for (const id of ["title", "hud", "rec", "dot", "grain", "vignette", "fscorner", "pause"]) $(id).style.display = "none";
  entity.active = false;
  const cctx = { renderer, spark, camera, mesh };
  const pose = (x, y, z, yaw, pitch = -0.1) => {
    player.pos.set(x, y, z);
    player.targetY = y;
    player.yaw = yaw;
    player.pitch = pitch;
    player.update(0, {});
    fx.update({ time: 10, camera, lampOn: 1, dt: 0 }); // fixed time: deterministic frames
  };
  window.__benchRender = ctx.renderFrame;
  window.bench = {
    apply: (cfg) => applyConfig(cctx, cfg),
    perf: (cfg, seconds = 10) => runBench({ ...cctx, configs: [cfg], seconds, onFrame: (x, y, z, yaw) => pose(x, y, z, yaw) }),
    // capture the fixed views; unlit = raw captured colour (judges detail), lit = the game look
    capture: async (cfg, settleMs, unlit = true, indices = null) => {
      applyConfig(cctx, cfg);
      U.unlit.value = unlit ? 1 : 0;
      const shots = await captureViews({ renderer, settleMs, indices, place: (v) => pose(...v) });
      U.unlit.value = 0;
      return shots;
    },
    compare,
    views: VIEWS,
    // render one view in the game's lighting (lamp on) and keep it on screen for a screenshot
    async show(cfg, i, settleMs = 5000, unlit = false) {
      applyConfig(cctx, cfg);
      U.unlit.value = unlit ? 1 : 0;
      pose(...(Array.isArray(i) ? i : VIEWS[i]));
      const t0 = performance.now();
      while (performance.now() - t0 < settleMs) { await new Promise(requestAnimationFrame); window.__benchRender(); }
    },
    // shots <-> base64 (8-bit luminance) for storing references on disk
    encode(shots) {
      const u8 = new Uint8Array(shots.length * shots[0].length);
      shots.forEach((sh, k) => { for (let i = 0; i < sh.length; i++) u8[k * sh.length + i] = Math.round(sh[i] * 255); });
      let bin = "";
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    async loadRef(kind) {
      const buf = new Uint8Array(await (await fetch(`assets/bench/ref-${kind}.bin`, { cache: "no-store" })).arrayBuffer());
      const n = buf.length / VIEWS.length;
      return VIEWS.map((_, k) => Float32Array.from(buf.subarray(k * n, (k + 1) * n), (v) => v / 255));
    },
    // full evaluation of a config against the on-disk references.
    // quick: fewer views + shorter settles, for fast iteration (final checks use the full run)
    async evaluate(cfg, seconds = 6, quick = false) {
      const refU = await this.loadRef("unlit"), refL = await this.loadRef("lit");
      const [p] = await this.perf(cfg, quick ? 4 : seconds);
      const views = quick ? [1, 2, 4, 6] : null, turnViews = quick ? [2, 4] : TURN_VIEWS;
      const settle = cfg.settleMs ?? (quick ? 3000 : 5000);
      const avg = (q, f) => q.reduce((a, b) => a + f(b), 0) / q.length;
      const cmp = (shots, ref) => shots.map((s, i) => s && compare(s, ref[i])).filter(Boolean);
      const qU = cmp(await this.capture(cfg, settle, true, views), refU);
      U.unlit.value = 1;
      const turns = await captureTurns({ renderer, indices: turnViews, settleMs: quick ? 2000 : 3000, place: (v) => pose(...v) });
      U.unlit.value = 0;
      const turnSsim = avg(turns.map((t, k) => compare(t, refU[turnViews[k]])), (x) => x.ssim);
      const qL = cmp(await this.capture(cfg, settle, false, views), refL);
      const r = {
        ...p,
        ssim: +avg(qU, (x) => x.ssim).toFixed(4), minSsim: +Math.min(...qU.map((x) => x.ssim)).toFixed(4),
        turnSsim: +turnSsim.toFixed(4),
        litSsim: +avg(qL, (x) => x.ssim).toFixed(4), minLitSsim: +Math.min(...qL.map((x) => x.ssim)).toFixed(4),
      };
      console.log("[eval]", JSON.stringify(r));
      return r;
    },
  };
  console.log("[bench] ready");
}

// [x, y(feet), z, yaw]: kitchen -> hall -> east windows -> lounge, turning as it goes
const PATH = [
  [-2.6, -1.5, -2.4, 2.8], [-0.5, -1.5, 2.5, 3.6], [4.5, -1.5, 7.0, 2.4], [8.2, -1.5, 9.0, 3.4],
  [11.0, -1.5, 14.0, 2.2], [12.5, -1.5, 19.5, 4.4], [9.0, -1.5, 22.0, 3.0], [6.0, -1.5, 26.5, 1.2],
];

const SEG = PATH.slice(1).map((b, i) => Math.hypot(b[0] - PATH[i][0], b[2] - PATH[i][2]));

async function runBench({ renderer, spark, camera, mesh, configs, seconds = 10, onFrame }) {
  const gl = renderer.getContext();
  const tq = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  renderer.setPixelRatio(1);
  const out = [];
  const status = document.createElement("pre");
  status.style.cssText = "position:fixed;left:10px;top:10px;z-index:99;color:#9f9;font:12px monospace;background:rgba(0,0,0,.7);padding:8px;margin:0";
  document.body.appendChild(status);

  for (const cfg of configs) {
    applyConfig({ renderer, spark, camera, mesh }, cfg);
    // settle (LoD re-traversal, shader compile)
    await runPath(2.5, null);
    const r = await runPath(seconds, { gl, tq });
    const row = { name: cfg.name, ...r };
    out.push(row);
    status.textContent = fmt(out);
    console.log("[bench]", JSON.stringify(row));
  }
  status.textContent = fmt(out) + "\n\ndone - results in window.benchResults";
  window.benchResults = out;
  return out;

  async function runPath(sec, measure) {
    const frames = [];
    const gpu = [];
    const pending = [];
    const t0 = performance.now();
    let last = t0;
    while (performance.now() - t0 < sec * 1000) {
      const now = await new Promise(requestAnimationFrame);
      // realistic play: walk the path at 2 m/s while looking around (+-50 degrees)
      const tt = Math.max(0, (now - t0) / 1000);
      let dist = tt * 2.0, i = 0;
      while (i < SEG.length - 1 && dist > SEG[i]) { dist -= SEG[i]; i++; }
      const a = PATH[i], b = PATH[i + 1], f = Math.min(1, dist / SEG[i]);
      const look = Math.sin(tt * 1.7) * 0.87;
      onFrame(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f + look);
      if (measure) {
        frames.push(now - last);
        // poll finished GPU queries
        for (let k = pending.length - 1; k >= 0; k--) {
          const q = pending[k];
          if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
            if (!gl.getParameter(measure.tq.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(q);
            pending.splice(k, 1);
          }
        }
      }
      last = now;
      if (measure?.tq && pending.length < 8) {
        const q = gl.createQuery();
        gl.beginQuery(measure.tq.TIME_ELAPSED_EXT, q);
        window.__benchRender();
        gl.endQuery(measure.tq.TIME_ELAPSED_EXT);
        pending.push(q);
      } else window.__benchRender();
    }
    if (!measure) return null;
    const sorted = [...frames].sort((x, y) => x - y);
    const g = [...gpu].sort((x, y) => x - y);
    const avg = (arr) => arr.reduce((x, y) => x + y, 0) / Math.max(1, arr.length);
    return {
      fps: +(1000 / avg(frames)).toFixed(1),
      frameMs: +avg(frames).toFixed(2),
      p95: +sorted[Math.floor(sorted.length * 0.95)]?.toFixed(2),
      p99: +sorted[Math.floor(sorted.length * 0.99)]?.toFixed(2),
      maxMs: +sorted[sorted.length - 1]?.toFixed(1),
      // jank: share of frames that took noticeably longer than a 60Hz frame
      jank: +(frames.filter((f) => f > 25).length / Math.max(1, frames.length)).toFixed(3),
      gpuMs: +avg(g).toFixed(2),
      gpuP95: +(g[Math.floor(g.length * 0.95)] ?? 0).toFixed(2),
    };
  }
}

function fmt(rows) {
  return ["config                          fps   frame  p95    gpu   gpuP95"]
    .concat(rows.map((r) => `${r.name.padEnd(30)} ${String(r.fps).padStart(5)} ${String(r.frameMs).padStart(6)} ${String(r.p95).padStart(6)} ${String(r.gpuMs).padStart(6)} ${String(r.gpuP95).padStart(6)}`))
    .join("\n");
}

function applyConfig({ renderer, spark, camera, mesh }, cfg) {
  const pr = cfg.pixelScale ?? 1;
  renderer.setSize(Math.round(1920 * pr), Math.round(1080 * pr), false);
  renderer.domElement.style.width = "100vw";
  renderer.domElement.style.height = "100vh";
  camera.aspect = 1920 / 1080;
  camera.updateProjectionMatrix();
  spark.lodSplatScale = cfg.lodSplatScale ?? 1;
  spark.lodRenderScale = cfg.lodRenderScale ?? 1;
  spark.maxStdDev = cfg.maxStdDev ?? Math.sqrt(8);
  spark.minSortIntervalMs = cfg.minSortIntervalMs ?? 0;
  spark.focalAdjustment = cfg.focalAdjustment ?? 2.0;
  spark.regenStep = cfg.regenStep;
  if (spark.material.uniforms.rsAlphaCut) spark.material.uniforms.rsAlphaCut.value = cfg.alphaCut ?? 0.01;
  if (cfg.blurAmount !== undefined) spark.blurAmount = cfg.blurAmount;
  if (cfg.enableLod !== undefined) spark.enableLod = cfg.enableLod;
  spark.behindFoveate = cfg.behindFoveate ?? 1;
  spark.coneFoveate = cfg.coneFoveate ?? 1;
  spark.coneFov0 = cfg.coneFov0 ?? 0;
  spark.coneFov = cfg.coneFov ?? 0;
  spark.lodQuatOverride = cfg.foveate ? undefined : new THREE.Quaternion();
  spark.lodStep = cfg.lodStep ?? 0; // >0: only re-anchor LoD after moving this far (see lodAnchor)
  spark.lodPosOverride = undefined;
  if (cfg.lodTraverseMode) spark.lodTraverseMode = cfg.lodTraverseMode;
  if (mesh.maxSh !== (cfg.maxSh ?? 3)) {
    mesh.maxSh = cfg.maxSh ?? 3;
    mesh.updateGenerator();
  }
}

// ---------------------------------------------------------------------------- quality
// Fixed viewpoints [x, y(feet), z, yaw, pitch]
const VIEWS = [
  [-2.0, -1.5, -1.5, 3.0, -0.1], [0.5, -1.5, 1.0, 2.4, -0.2], [8.15, -1.5, 8.6, 3.14, -0.25],
  [10.5, -1.5, 12.0, 0.6, 0.0], [12.0, -1.5, 20.0, 1.9, -0.1], [6.0, -1.5, 26.0, 0.3, -0.15],
  [0.2, 2.2, 25.6, 0.0, -0.2], [13.3, -1.6, 24.5, -1.57, 0.0],
];
const QW = 960, QH = 540;

// render each view after letting LoD settle; return downsampled luminance arrays
async function captureViews({ renderer, place, settleMs = 1800, indices = null }) {
  const gl = renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const px = new Uint8Array(W * H * 4);
  const shots = [];
  for (const [vi, v] of VIEWS.entries()) {
    if (indices && !indices.includes(vi)) { shots.push(null); continue; }
    place(v);
    const t0 = performance.now();
    while (performance.now() - t0 < settleMs) {
      await new Promise(requestAnimationFrame);
      window.__benchRender();
    }
    window.__benchRender();
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    shots.push(downsample(px, W, H));
  }
  return shots;
}

// mean SSIM (8x8 windows) and PSNR between two luminance images
function compare(a, b) {
  let mse = 0;
  for (let i = 0; i < a.length; i++) mse += (a[i] - b[i]) ** 2;
  mse /= a.length;
  const psnr = 10 * Math.log10(1 / Math.max(mse, 1e-10));
  const C1 = 0.01 ** 2, C2 = 0.03 ** 2, S = 8;
  let ssim = 0, n = 0;
  for (let y = 0; y + S <= QH; y += 4)
    for (let x = 0; x + S <= QW; x += 4) {
      let ma = 0, mb = 0;
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const k = (y + j) * QW + x + i; ma += a[k]; mb += b[k]; }
      ma /= S * S; mb /= S * S;
      let va = 0, vb = 0, cov = 0;
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        const k = (y + j) * QW + x + i;
        va += (a[k] - ma) ** 2; vb += (b[k] - mb) ** 2; cov += (a[k] - ma) * (b[k] - mb);
      }
      va /= S * S - 1; vb /= S * S - 1; cov /= S * S - 1;
      ssim += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      n++;
    }
  return { ssim: ssim / n, psnr };
}

// Transient quality right after a fast 180-degree turn: settle facing away, snap around, wait
// `delayMs`, capture. Penalises foveated LoD (which needs a re-traversal + sort after turning).
const TURN_VIEWS = [2, 4, 5];
async function captureTurns({ renderer, place, delayMs = 150, settleMs = 3000, indices = TURN_VIEWS }) {
  const gl = renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const px = new Uint8Array(W * H * 4);
  const shots = [];
  for (const vi of indices) {
    const v = VIEWS[vi];
    place([v[0], v[1], v[2], v[3] + Math.PI, v[4]]);
    let t0 = performance.now();
    while (performance.now() - t0 < settleMs) { await new Promise(requestAnimationFrame); window.__benchRender(); }
    place(v);
    t0 = performance.now();
    while (performance.now() - t0 < delayMs) { await new Promise(requestAnimationFrame); window.__benchRender(); }
    window.__benchRender();
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    shots.push(downsample(px, W, H));
  }
  return shots;
}

// box-downsample to QWxQH luminance (gamma-encoded, as displayed)
function downsample(px, W, H) {
  const lum = new Float32Array(QW * QH);
  const cnt = new Float32Array(QW * QH);
  for (let y = 0; y < H; y++) {
    const qy = Math.min(QH - 1, Math.floor((y * QH) / H));
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const q = qy * QW + Math.min(QW - 1, Math.floor((x * QW) / W));
      lum[q] += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      cnt[q]++;
    }
  }
  for (let i = 0; i < lum.length; i++) lum[i] /= cnt[i] * 255;
  return lum;
}
