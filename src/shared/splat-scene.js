// Spark setup shared by both games: the WebGL renderer, the SparkRenderer with the settings both
// games use, the scan as a streamed level-of-detail SplatMesh (or a developer override), the
// adaptive quality governor, and the wait for Spark to settle after loading. Each game then
// patches Spark's shader and decides when to regenerate splats itself (residue/view.js,
// undeveloped/view.js), through the helpers at the end of this file.
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { RENDER } from "./render-config.js";
import { Governor } from "./governor.js";
import { isIntegrated } from "./quality.js";

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1)); // the governor sets the real ratio
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x000000, 1);
  container.appendChild(renderer.domElement);
  return renderer;
}

// The SparkRenderer both games use. We decide when splats get regenerated (autoUpdate off): see
// needsRegen in each game's view. tier: QUALITY[...] from quality.js.
export function createSpark(renderer, params, tier, options = {}) {
  const fov = tier.foveate;
  const spark = new SparkRenderer({
    renderer,
    autoUpdate: false,
    lodSplatScale: tier.lodSplatScale ?? 1,
    lodRenderScale: tier.lodRenderScale ?? 1,
    maxStdDev: RENDER.maxStdDev,
    minSortIntervalMs: RENDER.minSortIntervalMs,
    focalAdjustment: Number(params.get("focal")) || RENDER.focalAdjustment,
    // foveated LoD (as World Labs' Marble viewer: full detail in a 100-degree cone, fading to 0.4
    // at 140 degrees and 0.2 behind) or, without it, detail that depends only on where you stand
    coneFov0: fov ? fov.cone0 : 0,
    coneFov: fov ? fov.cone : 0,
    coneFoveate: fov ? fov.coneScale : 1,
    behindFoveate: fov ? fov.behind : 1,
    // GPU pool for streamed chunks, in 64K-splat pages (?pages= to experiment)
    ...(params.has("pages") || tier.pages ? { maxPagedSplats: 65536 * (Number(params.get("pages")) || tier.pages) } : {}),
    ...options,
  });
  // Without foveation, pin the orientation the LoD system sees: turning your head then never
  // triggers a re-selection.
  if (!fov) spark.lodQuatOverride = new THREE.Quaternion();
  spark.lodStep = RENDER.lodStep;
  return spark;
}

// The adaptive quality governor (governor.js) for this view.
export function createGovernor({ renderer, spark, quality, tier, params, onResize }) {
  return new Governor({
    renderer, spark, params, onResize,
    tier: quality,
    baseSplatScale: tier.lodSplatScale ?? 1,
    lod: !params.has("spz"),
    integrated: isIntegrated(renderer),
  });
}

// The scan for this quality tier (see quality.js): a chunked level-of-detail tree that Spark
// streams as needed. Developer switches: ?scene=<url> loads another file, ?spz every original
// splat with no LoD (the old full mode), ?lod the single-file LoD tree.
export function createScanMesh({ params, tier, onProgress, extSplats }) {
  const url = params.get("scene") ?? (params.has("spz") ? RENDER.allSplats : params.has("lod") ? RENDER.lodScene : tier.scene);
  const paged = !params.has("scene") && !params.has("spz") && !params.has("lod");
  const mesh = new SplatMesh({ url, paged: paged || undefined, extSplats, onProgress });
  mesh.quaternion.set(1, 0, 0, 0); // the capture is y-down: flip 180deg about X
  return mesh;
}

// Spark builds its LoD structures right after loading, which stalls rendering for a few seconds.
// Resolves once `frames` quick frames (<40ms) came in a row, or after `timeoutMs`.
export function waitForSteadyFrames(frames, timeoutMs) {
  return new Promise((resolve) => {
    let good = 0, last = performance.now();
    const t0 = last;
    (function check() {
      const now = performance.now();
      good = now - last < 40 ? good + 1 : 0;
      last = now;
      if (good > frames || now - t0 > timeoutMs) resolve();
      else requestAnimationFrame(check);
    })();
  });
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

// On frames that don't regenerate, keep Spark's LoD system going: integrate streamed chunks and
// re-select detail in its worker (what autoUpdate does each frame, minus regenerating and
// re-sorting every splat). A new selection bumps the mesh's mappingVersion, which the games
// take as their cue to regenerate.
export function driveLod(spark, scene, camera, mesh) {
  if (spark.enableLod && mesh?.isInitialized) spark.driveLod({ visibleGenerators: [mesh], camera, scene });
}

// Developer switch ?gpux=k: draw the scene k times per frame, a stand-in for a GPU k times slower
// (to test the governor and frame pacing on weak hardware from a fast machine).
export function gpuSlowdown(params) {
  return Math.max(1, Math.min(16, Math.round(Number(params.get("gpux")) || 1)));
}

// How much of the detail Spark has picked for the current view is already resident (0..1), or
// null before its level-of-detail system has run. The rest is still streaming in.
export function streamedFraction(spark) {
  const pager = spark.pager;
  const want = pager?.fetchPriority?.slice(0, pager.maxPages ?? Infinity);
  if (!want?.length) return null;
  let have = 0;
  for (const { splats, chunk } of want) if (pager.getSplatsChunk(splats, chunk)) have++;
  return have / want.length;
}

// On the title screen: show how much of the building has streamed in (`el`, e.g. #progress),
// until the view's detail is all there. The game can be entered at any time meanwhile.
export function showStreaming(spark, el, label = "streaming the building") {
  const timer = setInterval(() => {
    const f = streamedFraction(spark);
    if (f === null) return;
    if (f >= 0.99) { el.textContent = ""; clearInterval(timer); }
    else el.textContent = `${label}  ${Math.floor(f * 100)}%`;
  }, 250);
}
