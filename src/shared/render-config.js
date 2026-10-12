// Render settings shared by both games, tuned with the benchmarks in tools/bench/ at 1920x1080 on
// an RTX 2070. Colour detail (SH degree), the splat budget and foveation per quality tier are in
// quality.js; resolution and budget then adapt at runtime (governor.js).
export const RENDER = {
  // the benchmark's candidate defaults (tools/bench/fitness.mjs)
  lodSplatScale: 2.0,
  maxSh: 1,
  foveate: false,
  behindFoveate: 1,
  coneFoveate: 1,
  coneFov0: 0,
  coneFov: 0,
  regenStep: 0.25, // regenerate (re-sort) the splats after moving this far (m)
  lodStep: 0.4, // re-anchor the LoD selection only after moving this far (m)
  // Gaussian footprint per splat (std devs). A flat 2.0 cut was faster but left visible edges on
  // big smooth-surface splats; instead keep the default for opaque splats and trim faint ones
  // (see rsAlphaCut in residue/lighting.js).
  maxStdDev: Math.sqrt(8),
  alphaCut: 0.02, // ?alphacut= to tune; 0 = Spark default (no trim)
  pixelScale: 1,
  minSortIntervalMs: 0,
  // 2.0 matches PlayCanvas/SuperSplat: less anti-alias blur per splat. Measured +60% edge detail
  // on the kitchen with no visible aliasing.
  focalAdjustment: 2.0,
  // The streamed level-of-detail tree both tiers draw (tools/assets/build.sh): every original
  // splat plus merged parents, degree-1 colour, in chunks of 64K splats that Spark fetches as needed.
  liteScene: "assets/lite/sanatorium-lite-lod.rad",
  // ?spz: every original splat (12.5M) in one file, drawn without LoD (the old full mode)
  // (a hosted build serves it from elsewhere: VITE_SCAN_URL, see tools/deploy.sh)
  allSplats: import.meta.env?.VITE_SCAN_URL || "assets/sanatorium.spz",
  lodScene: "assets/sanatorium-lod.rad", // ?lod : the single-file LoD tree, loaded whole
};
