// Spark setup shared by both games: the WebGL renderer, the scan as a SplatMesh (the full scan,
// the streamed lite version, or a developer override), and the wait for Spark to settle after
// loading. Each game then patches Spark's shader and decides when to regenerate splats itself
// (residue/view.js, undeveloped/view.js).
import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";
import { RENDER } from "./render-config.js";

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1) * RENDER.pixelScale);
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x000000, 1);
  container.appendChild(renderer.domElement);
  return renderer;
}

// The scan for this quality tier (see quality.js). Developer switches: ?scene=<url> loads another
// file, ?lod the budgeted LoD tree.
export function createScanMesh({ params, tier, onProgress, extSplats }) {
  const mesh = new SplatMesh({
    url: params.get("scene") ?? (tier.paged ? RENDER.liteScene : params.has("lod") ? RENDER.lodScene : RENDER.scene),
    paged: tier.paged || undefined, // the lite scene streams its level-of-detail chunks as needed
    extSplats,
    onProgress,
  });
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
