// Render settings, tuned with the benchmark/search loop (tools/search.mjs) at 1920x1080 on an
// RTX 2070 for the best image quality within a ~12.5ms GPU frame budget.
// Colour modes (V in game, or the button on the title/pause screens):
//  fast: SH degree 1, more splats. Under the lamp you mostly see detail, not view-dependent colour.
//  full: SH degree 3 (glossy steel, reflections, subtle colour shifts as you move).
// lodSplatScale only applies to the ?lod fallback scene (full at 1.4x ~38fps, 1.0x ~58fps there).
// On the default all-splats scene, full costs ~2fps over fast.
export const COLOUR_MODES = {
  fast: { maxSh: 1, lodSplatScale: 2.0, label: "Colour: fast" },
  full: { maxSh: 3, lodSplatScale: 1.0, label: "Colour: full" },
};

export const RENDER = {
  lodSplatScale: 2.0,
  maxSh: 1, // the lamp relighting swamps view-dependent colour; SH3 cost ~9ms/frame for ~nothing
  foveate: false,
  behindFoveate: 1,
  coneFoveate: 1,
  coneFov0: 0,
  coneFov: 0,
  regenStep: 0.25, // regenerate (re-sort) the splats after moving this far (m)
  lodStep: 0.4, // re-anchor the LoD selection only after moving this far (m)
  // Gaussian footprint per splat (std devs). A flat 2.0 cut was faster but left visible edges on
  // big smooth-surface splats; instead keep the default for opaque splats and trim faint ones
  // (see rsAlphaCut in lighting.js).
  maxStdDev: Math.sqrt(8),
  alphaCut: 0.02, // ?alphacut= to tune; 0 = Spark default (no trim)
  pixelScale: 1,
  minSortIntervalMs: 0,
  // 2.0 matches PlayCanvas/SuperSplat: less anti-alias blur per splat. Measured +60% edge detail
  // on the kitchen with no visible aliasing.
  focalAdjustment: 2.0,
  // Every original splat (12.5M, no LoD), like SuperSplat draws it. The LoD tree's merged splats were
  // visibly blurrier; with on-demand regeneration the full set holds ~51-53fps at 1080p on an RTX 2070.
  // (a hosted build serves it from elsewhere: VITE_SCAN_URL, see tools/deploy.sh)
  scene: import.meta.env?.VITE_SCAN_URL || "assets/sanatorium.spz",
  lodScene: "assets/sanatorium-lod.rad", // ?lod : budgeted level-of-detail fallback for weaker GPUs
};
