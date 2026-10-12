// Which version of the scan this machine gets. Both are chunked level-of-detail trees that Spark
// streams as needed, drawing a budget of splats chosen by on-screen size (the budget and the
// resolution then adapt to the frame rate, see governor.js):
//   "full": a large budget (5M splats on desktop), for dedicated GPUs;
//   "lite": a smaller one (1.25M), for integrated GPUs (Apple silicon, Intel) and phones.
// The title screens have a "Graphics: quality / performance" button (a remembered choice);
// ?full / ?lite override; a machine that turns out too slow for "full" is remembered.
import { RENDER } from "./render-config.js";

const KEY = "gaussian-games.quality"; // "full" | "lite" (chosen), "auto-lite" (fell back), unset

export function gpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
  } catch { return ""; }
}

export const INTEGRATED = /apple|intel|iris|uhd graphics|hd graphics|mali|adreno|powervr|radeon\(tm\) graphics|radeon graphics|swiftshader|llvmpipe|software|microsoft basic/i;

function savedChoice() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function isIntegrated(renderer) {
  return /iphone|ipad|android/i.test(navigator.userAgent) || INTEGRATED.test(gpuName(renderer));
}

export function chooseQuality(renderer, params) {
  if (params.has("full")) return "full";
  if (params.has("lite")) return "lite";
  const stored = savedChoice();
  if (stored === "full") return "full";
  if (stored === "lite" || stored === "auto-lite") return "lite";
  return isIntegrated(renderer) ? "lite" : "full";
}

// After the scan has loaded, watch the frame rate for a few seconds (skipping the first moments,
// when Spark is still busy). If "full" is a slideshow on this machine, switch to "lite" for good.
export function watchForSlowFrames(quality, { delayMs = 5000, windowMs = 4000, minFps = 8 } = {}) {
  if (quality !== "full" || savedChoice() === "full") return; // not when "quality" was chosen by hand
  setTimeout(() => {
    let frames = 0;
    const t0 = performance.now();
    (function count() {
      frames++;
      const dt = performance.now() - t0;
      if (dt < windowMs) return requestAnimationFrame(count);
      if ((frames / dt) * 1000 < minFps) {
        try { localStorage.setItem(KEY, "auto-lite"); } catch {}
        location.reload();
      }
    })();
  }, delayMs);
}

// World Labs' Marble viewer: full detail in a 100-degree cone, 0.4 at 140 degrees, 0.2 behind
export const MARBLE_FOVEATION = { cone0: 100, cone: 140, coneScale: 0.4, behind: 0.2 };

// settings for each version. Both stream the same level-of-detail tree (degree-1 colour: in
// Spark 2.2, generating paged splats with degree-3 colour cost ~45 ms a regeneration at a 5M
// budget, a stutter every few steps), with Marble's foveation. lodSplatScale multiplies Spark's
// per-device splat budget (2.5M on desktop, 1.5M on iOS, 1M on Android); the governor scales it
// down from there when needed.
export const QUALITY = {
  full: { scene: RENDER.liteScene, maxSh: 1, lodSplatScale: 2.0, foveate: MARBLE_FOVEATION },
  lite: { scene: RENDER.liteScene, maxSh: 1, lodSplatScale: 0.5, foveate: MARBLE_FOVEATION },
};

// the title-screen button: shows the version in use; choosing the other reloads into it
export function bindQualityButtons(quality, selector = ".qbtn") {
  for (const b of document.querySelectorAll(selector)) {
    b.textContent = quality === "lite" ? "Graphics: performance" : "Graphics: quality";
    b.title = quality === "lite"
      ? "Lighter streamed scene for laptops and integrated GPUs. Click for full quality (needs a strong GPU)."
      : "Every splat at full colour detail (needs a strong GPU). Click for the lighter, faster scene.";
    b.addEventListener("click", () => {
      try { localStorage.setItem(KEY, quality === "lite" ? "full" : "lite"); } catch {}
      const u = new URL(location.href);
      u.searchParams.delete("full");
      u.searchParams.delete("lite");
      location.replace(u);
    });
  }
}
