// RESIDUE's render pipeline: the renderer, Spark with the relighting shader patched in
// (lighting.js), the camcorder post pass, the adaptive quality governor, and renderFrame(), the
// one place a frame is drawn.
import * as THREE from "three";
import { RENDER } from "../shared/render-config.js";
import { chooseQuality, QUALITY } from "../shared/quality.js";
import { createRenderer, createSpark, createGovernor, lodAnchor, driveLod, gpuSlowdown } from "../shared/splat-scene.js";
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

  // full colour for dedicated GPUs, a lighter version for integrated GPUs (see quality.js)
  const quality = chooseQuality(renderer, params);
  const tier = QUALITY[quality];

  const spark = createSpark(renderer, params, tier);
  installShading(spark);
  // Into a render target (the camcorder pass) Spark would switch to linear output; the splats are
  // meant to blend in sRGB as on screen, so keep its output identical either way.
  Object.defineProperty(spark.material.uniforms.encodeLinear, "value", { get: () => false, set() {} });
  spark.material.uniforms.rsAlphaCut.value = params.has("alphacut") ? Number(params.get("alphacut")) : RENDER.alphaCut;
  scene.add(spark);

  // resolution and splat budget follow the measured frame cost (governor.js)
  const governor = createGovernor({ renderer, spark, quality, tier, params, onResize: () => camcorder.resize() });

  const slow = gpuSlowdown(params);
  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    governor.resize();
  });

  // ---------------------------------------------------------------------------- one frame
  // The game loop and the benchmark (?bench) both draw through renderFrame, so any change to the
  // render pipeline is exactly what the benchmark measures.
  // Spark only re-generates its splat buffer when we ask. Shading is in the vertex shader and the
  // depth sort is radial (rotation-invariant), so turning your head needs no regeneration at all.
  // We regenerate when: the camera has moved a few cm, a geometric effect is animating, the
  // entity is visible, or Spark's LoD picked new splats (streamed chunks arrived, or a new
  // selection after moving). In between, driveLod keeps the LoD system and streaming going.
  const regen = { pos: new THREE.Vector3(1e9, 0, 0), quat: new THREE.Quaternion(), mapping: -1, warm: 120, entityTail: 0 };
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
    // foveated LoD: re-select after turning
    return !spark.lodQuatOverride && Math.abs(camera.quaternion.dot(regen.quat)) < 0.995;
  }
  function renderFrame(scan, fx, entity) {
    governor.begin();
    camera.updateMatrixWorld();
    lodAnchor(spark, camera);
    const regenerate = needsRegen(scan, fx, entity);
    if (regenerate) {
      regen.pos.copy(camera.position);
      regen.quat.copy(camera.quaternion);
      regen.mapping = scan?.mappingVersion ?? -1;
      spark.update({ scene, camera }); // generation runs synchronously; sorting continues async
    } else driveLod(spark, scene, camera, scan);
    for (let i = 1; i < slow; i++) renderer.render(scene, camera); // ?gpux
    camcorder.render(scene, camera);
    governor.end(regenerate);
  }

  return { renderer, scene, camera, camcorder, spark, quality, tier, governor, renderFrame, stats: () => governor.stats() };
}
