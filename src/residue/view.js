// RESIDUE's render pipeline: the renderer, Spark with the relighting shader patched in
// (lighting.js), the camcorder post pass, and renderFrame(), the one place a frame is drawn.
// Also the adaptive splat budget for the streamed lite scene.
import * as THREE from "three";
import { SparkRenderer } from "@sparkjsdev/spark";
import { RENDER } from "../shared/render-config.js";
import { chooseQuality, QUALITY } from "../shared/quality.js";
import { createRenderer } from "../shared/splat-scene.js";
import { installShading } from "./lighting.js";
import { Camcorder } from "./camcorder.js";

export function createView(params) {
  const renderer = createRenderer(document.getElementById("app"));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 80);
  scene.add(camera);
  // the handheld camcorder look (H toggles, remembered per browser; ?clean starts without it)
  const camcorder = new Camcorder(renderer, camera, 72);
  try { if (localStorage.getItem("residue.camcorder") === "off") camcorder.setOn(false); } catch {}
  if (params.has("clean")) camcorder.setOn(false);

  // full scan for dedicated GPUs, a streamed lighter one for integrated GPUs (see quality.js)
  const quality = chooseQuality(renderer, params);
  const tier = QUALITY[quality];

  const spark = new SparkRenderer({
    renderer,
    lodSplatScale: Number(params.get("detail")) || tier.lodSplatScale || 1.0,
    behindFoveate: RENDER.behindFoveate,
    coneFoveate: RENDER.coneFoveate,
    coneFov0: RENDER.coneFov0,
    coneFov: RENDER.coneFov,
    maxStdDev: RENDER.maxStdDev,
    minSortIntervalMs: RENDER.minSortIntervalMs,
    focalAdjustment: Number(params.get("focal")) || RENDER.focalAdjustment,
    // We decide when splats get regenerated (see renderFrame); lighting lives in the vertex shader.
    autoUpdate: false,
  });
  installShading(spark);
  // Into a render target (the camcorder pass) Spark would switch to linear output; the splats are
  // meant to blend in sRGB as on screen, so keep its output identical either way.
  Object.defineProperty(spark.material.uniforms.encodeLinear, "value", { get: () => false, set() {} });
  spark.material.uniforms.rsAlphaCut.value = params.has("alphacut") ? Number(params.get("alphacut")) : RENDER.alphaCut;
  // Without foveation detail depends only on where you stand, so pin the orientation the LoD
  // system sees: turning your head then never triggers a re-selection.
  if (!RENDER.foveate) spark.lodQuatOverride = new THREE.Quaternion();
  spark.lodStep = RENDER.lodStep;
  scene.add(spark);

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    camcorder.resize();
  });

  // ---------------------------------------------------------------------------- one frame
  // The game loop and the benchmark (?bench) both draw through renderFrame, so any change to the
  // render pipeline is exactly what the benchmark measures.
  // Spark only re-generates its splat buffer when we ask. Shading is in the vertex shader and the
  // depth sort is radial (rotation-invariant), so turning your head needs no regeneration at all.
  // We regenerate when: the camera has moved a few cm, a geometric effect is animating, the
  // entity is visible, new LoD results arrived, or as a slow keep-alive.
  const regen = { pos: new THREE.Vector3(1e9, 0, 0), quat: new THREE.Quaternion(), mapping: -1, frames: 0, warm: 120, entityTail: 0 };
  function needsRegen(scan, fx, entity) {
    if (!scan?.isInitialized) return true;
    if (regen.warm > 0) return regen.warm--, true; // just after loading, while the LoD settles
    if (scan.mappingVersion !== regen.mapping) return true;
    if (fx?.active) return true;
    // the entity, and a few frames after she vanishes, so her last frame doesn't linger in the buffer
    if (entity?.mesh.visible) regen.entityTail = 8;
    if (regen.entityTail > 0) return regen.entityTail--, true;
    const step = spark.regenStep ?? RENDER.regenStep;
    if (camera.position.distanceToSquared(regen.pos) > step * step) return true;
    if (!spark.lodQuatOverride && Math.abs(camera.quaternion.dot(regen.quat)) < 0.9995) return true; // foveated LoD
    return ++regen.frames > 30;
  }
  function renderFrame(scan, fx, entity) {
    camera.updateMatrixWorld();
    lodAnchor(spark, camera);
    if (needsRegen(scan, fx, entity)) {
      regen.pos.copy(camera.position);
      regen.quat.copy(camera.quaternion);
      regen.mapping = scan?.mappingVersion ?? -1;
      regen.frames = 0;
      spark.update({ scene, camera }); // generation runs synchronously; sorting continues async
    }
    camcorder.render(scene, camera);
  }

  // ---------------------------------------------------------------------------- adaptive detail
  // Step the LoD splat budget down while the frame rate is low (unless ?detail= was given).
  // Stricter for the first ~20s of play, then only if the frame rate collapses, so detail doesn't
  // visibly shift while you play. (It only changes anything on the streamed lite scene.)
  const adaptive = { on: !params.has("detail"), acc: 0, frames: 0, played: 0 };
  function adapt(rawDt, playing) {
    if (!adaptive.on || !playing) return;
    adaptive.played += rawDt;
    if (adaptive.played < 5) return; // ignore the first seconds: LoD is still settling after Enter
    adaptive.acc += rawDt;
    adaptive.frames++;
    if (adaptive.acc < 1.5) return;
    const fps = adaptive.frames / adaptive.acc;
    adaptive.acc = 0;
    adaptive.frames = 0;
    const calibrating = adaptive.played < 25;
    if (fps < (calibrating ? 50 : 38)) spark.lodSplatScale = Math.max(0.3, spark.lodSplatScale * 0.85);
  }

  return { renderer, scene, camera, camcorder, spark, quality, tier, renderFrame, adapt };
}

// Re-anchor the LoD selection only after the camera has moved `spark.lodStep` metres, so
// walking doesn't trigger a traversal + full re-sort every frame.
function lodAnchor(spark, camera) {
  if (!spark.lodStep) return;
  const p = camera.position;
  if (!spark.lodPosOverride || spark.lodPosOverride.distanceTo(p) > spark.lodStep) {
    spark.lodPosOverride = p.clone();
  }
}
