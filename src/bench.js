// ?bench : fly a fixed camera path through the building under several render configurations
// and report frame time + GPU time for each. Renders at a fixed 1920x1080 regardless of the
// window so results reflect fullscreen play.
import * as THREE from "three";

// [x, y(feet), z, yaw]: kitchen -> hall -> east windows -> lounge, turning as it goes
const PATH = [
  [-2.6, -1.5, -2.4, 2.8], [-0.5, -1.5, 2.5, 3.6], [4.5, -1.5, 7.0, 2.4], [8.2, -1.5, 9.0, 3.4],
  [11.0, -1.5, 14.0, 2.2], [12.5, -1.5, 19.5, 4.4], [9.0, -1.5, 22.0, 3.0], [6.0, -1.5, 26.5, 1.2],
];

const SEG = PATH.slice(1).map((b, i) => Math.hypot(b[0] - PATH[i][0], b[2] - PATH[i][2]));

export async function runBench({ renderer, spark, camera, mesh, configs, seconds = 10, onFrame }) {
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


// Re-anchor the LoD selection only after the camera has moved `spark.lodStep` metres, so
// walking doesn't trigger a traversal + full re-sort every frame.
export function lodAnchor(spark, camera) {
  if (!spark.lodStep) return;
  const p = camera.position;
  if (!spark.lodPosOverride || spark.lodPosOverride.distanceTo(p) > spark.lodStep) {
    spark.lodPosOverride = p.clone();
  }
}

export function applyConfig({ renderer, spark, camera, mesh }, cfg) {
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
export const VIEWS = [
  [-2.0, -1.5, -1.5, 3.0, -0.1], [0.5, -1.5, 1.0, 2.4, -0.2], [8.15, -1.5, 8.6, 3.14, -0.25],
  [10.5, -1.5, 12.0, 0.6, 0.0], [12.0, -1.5, 20.0, 1.9, -0.1], [6.0, -1.5, 26.0, 0.3, -0.15],
  [0.2, 2.2, 25.6, 0.0, -0.2], [13.3, -1.6, 24.5, -1.57, 0.0],
];
const QW = 960, QH = 540;

// render each view after letting LoD settle; return downsampled luminance arrays
export async function captureViews({ renderer, place, settleMs = 1800, indices = null }) {
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
    // box-downsample to QWxQH luminance (gamma-encoded, as displayed)
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
    shots.push(lum);
  }
  return shots;
}

// mean SSIM (8x8 windows) and PSNR between two luminance images
export function compare(a, b) {
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
export const TURN_VIEWS = [2, 4, 5];
export async function captureTurns({ renderer, place, delayMs = 150, settleMs = 3000, indices = TURN_VIEWS }) {
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
