// Which version of the scan this machine gets. "full" draws every one of the 12.5M splats with
// full colour detail, which wants a dedicated desktop GPU. "lite" streams a level-of-detail
// version (degree-1 colour, a splat budget that adapts to the frame rate), for integrated GPUs
// such as Apple silicon and Intel, where "full" can drop below 1 fps.
// The title screens have a "Graphics: quality / performance" button (a remembered choice);
// ?full / ?lite override; a machine that turns out too slow for "full" is remembered.
const KEY = "gaussian-games.quality"; // "full" | "lite" (chosen), "auto-lite" (fell back), unset

export function gpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
  } catch { return ""; }
}

const INTEGRATED = /apple|intel|iris|uhd graphics|hd graphics|mali|adreno|powervr|radeon\(tm\) graphics|radeon graphics|swiftshader|llvmpipe|software|microsoft basic/i;

function savedChoice() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function chooseQuality(renderer, params) {
  if (params.has("full")) return "full";
  if (params.has("lite")) return "lite";
  const stored = savedChoice();
  if (stored === "full") return "full";
  if (stored === "lite" || stored === "auto-lite") return "lite";
  const mobile = /iphone|ipad|android/i.test(navigator.userAgent);
  return mobile || INTEGRATED.test(gpuName(renderer)) ? "lite" : "full";
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

// settings for each version
export const QUALITY = {
  full: { paged: false, maxSh: 3 },
  // ~1.25M splats to start (Spark's desktop budget is 2.5M); RESIDUE adapts it to the frame rate
  lite: { paged: true, maxSh: 1, lodSplatScale: 0.5, lodCap: 0.9 },
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
