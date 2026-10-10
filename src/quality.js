// Which version of the scan this machine gets. "full" draws every one of the 12.5M splats with
// full colour detail, which wants a dedicated desktop GPU. "lite" streams a level-of-detail
// version (degree-1 colour, a splat budget that adapts to the frame rate), for integrated GPUs
// such as Apple silicon and Intel, where "full" can drop below 1 fps.
// ?full / ?lite override the guess; a machine that turns out too slow for "full" is remembered.
const KEY = "gaussian-games.quality";

export function gpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
  } catch { return ""; }
}

const INTEGRATED = /apple|intel|iris|uhd graphics|hd graphics|mali|adreno|powervr|radeon\(tm\) graphics|radeon graphics|swiftshader|llvmpipe|software|microsoft basic/i;

export function chooseQuality(renderer, params) {
  if (params.has("full")) return "full";
  if (params.has("lite")) return "lite";
  try { if (localStorage.getItem(KEY) === "lite") return "lite"; } catch {}
  const mobile = /iphone|ipad|android/i.test(navigator.userAgent);
  return mobile || INTEGRATED.test(gpuName(renderer)) ? "lite" : "full";
}

// After the scan has loaded, watch the frame rate for a few seconds (skipping the first moments,
// when Spark is still busy). If "full" is a slideshow on this machine, switch to "lite" for good.
export function watchForSlowFrames(quality, { delayMs = 5000, windowMs = 4000, minFps = 8 } = {}) {
  if (quality !== "full") return;
  setTimeout(() => {
    let frames = 0;
    const t0 = performance.now();
    (function count() {
      frames++;
      const dt = performance.now() - t0;
      if (dt < windowMs) return requestAnimationFrame(count);
      if ((frames / dt) * 1000 < minFps) {
        try { localStorage.setItem(KEY, "lite"); } catch {}
        location.reload();
      }
    })();
  }, delayMs);
}

// settings for each version
export const QUALITY = {
  full: { paged: false, maxSh: 3 },
  // ~1.25M splats to start (Spark's desktop budget is 2.5M); RESIDUE adapts it to the frame rate
  lite: { paged: true, maxSh: 1, lodSplatScale: 0.5, lodCap: 0.9 },
};
