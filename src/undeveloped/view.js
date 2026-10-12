// Undeveloped's render pipeline: the capture in its original daylight, with Spark's shader
// patched for the haze at the edge of the world, the adaptive quality governor, and render(),
// which regenerates the splat buffer only when needed (as in residue/view.js).
import * as THREE from "three";
import { RENDER } from "../shared/render-config.js";
import { chooseQuality, QUALITY } from "../shared/quality.js";
import { createRenderer, createScanMesh, createSpark, createGovernor, lodAnchor, driveLod, gpuSlowdown } from "../shared/splat-scene.js";
import { HAZE_COLOR } from "./haze.js";

// Patch Spark's vertex shader: opacity-aware splat extent (quad ends where the splat's falloff
// drops below ALPHA_CUT): opaque splats keep the full footprint, faint ones shrink -> less fill.
// Also: distance haze, distant splats fade toward the haze colour (see haze.js) so the edges
// of the capture dissolve into light rather than ending abruptly.
function installExtent(spark, alphaCut, haze) {
  spark.material.uniforms.cfAlphaCut = { value: alphaCut };
  spark.material.uniforms.cfHaze = { value: haze.color };
  spark.material.uniforms.cfFog = { value: haze.fog }; // start, end, max amount
  // living boundary (see shared/edge-field.js): splats beyond walkable space ripple and dissolve
  const u = spark.material.uniforms;
  u.cfEdgeTex = { value: new THREE.Data3DTexture(new Uint8Array([0]), 1, 1, 1) };
  u.cfEdgeOrigin = { value: new THREE.Vector3() };
  u.cfEdgeSize = { value: new THREE.Vector3(1, 1, 1) };
  u.cfEdgeOn = { value: 0 };
  u.cfTime = { value: 0 };
  u.cfPlayer = { value: new THREE.Vector3(0, -100, 0) };
  // boundary zones: splats inside dissolve into the haze (a wall of light where the scan fails)
  u.cfBoxMin = { value: Array.from({ length: 8 }, () => new THREE.Vector3(1e5, 1e5, 1e5)) };
  u.cfBoxMax = { value: Array.from({ length: 8 }, () => new THREE.Vector3(-1e5, -1e5, -1e5)) };
  let vs = spark.material.vertexShader;
  const patch = (from, to) => {
    if (!vs.includes(from)) throw new Error(`Spark vertex shader anchor not found: ${from}`);
    vs = vs.replace(from, to);
  };
  patch("void main() {", `uniform float cfAlphaCut;
uniform vec3 cfHaze;
uniform vec3 cfFog;
precision highp sampler3D;
uniform sampler3D cfEdgeTex;
uniform vec3 cfEdgeOrigin, cfEdgeSize, cfPlayer;
uniform float cfEdgeOn, cfTime;
uniform vec3 cfBoxMin[8], cfBoxMax[8];
void main() {
    float cfEdge = 0.0, cfNear = 0.0;`);
  // after the frustum culls (so only visible splats pay for it): splats past the edge of
  // walkable space sway like a membrane, more so the closer you are. Smooth functions only:
  // positions are re-quantized on each regeneration.
  patch("    vRgba = rgba;", `    if (cfEdgeOn > 0.5) {
      vec3 cfWorld = center + cameraPosition + transpose(mat3(viewMatrix)) * renderToViewPos;
      float cfD = texture(cfEdgeTex, (cfWorld - cfEdgeOrigin) / cfEdgeSize).r * 5.1;
      cfEdge = smoothstep(0.9, 2.6, cfD);
      for (int i = 0; i < 8; i++) {
        // signed depth inside box i (negative outside): full dissolve 0.8m in, a glow just outside
        vec3 lo = cfWorld - cfBoxMin[i], hi = cfBoxMax[i] - cfWorld;
        float depth = min(min(min(lo.x, hi.x), min(lo.y, hi.y)), min(lo.z, hi.z));
        cfEdge = max(cfEdge, smoothstep(-0.7, 0.8, depth));
      }
      cfNear = 1.0 - smoothstep(1.0, 6.0, distance(cfWorld, cfPlayer));
      float cfAmp = cfEdge * (0.04 + 0.1 * cfNear);
      float cfPh = dot(cfWorld, vec3(2.1, 1.3, 1.7));
      vec3 cfDisp = vec3(sin(cfTime * 1.3 + cfPh), 0.6 * sin(cfTime * 1.7 + cfPh * 1.3), cos(cfTime * 1.1 + cfPh * 0.8)) * cfAmp;
      viewCenter += quatVec(renderToViewQuat, cfDisp);
      clipCenter = projectionMatrix * vec4(viewCenter, 1.0);
    }
    {
      float cfDist = length(viewCenter);
      rgba.rgb = mix(rgba.rgb, cfHaze, smoothstep(cfFog.x, cfFog.y, cfDist) * cfFog.z);
      // the edge of the world: a slow pulse of light, stronger as you approach
      float cfPulse = 0.5 + 0.5 * sin(cfTime * 1.8 - cfDist * 0.6);
      float cfH = cfEdge * (0.7 + 0.3 * cfPulse * (0.3 + 0.7 * cfNear));
      // huge splats right in front of the camera are capture artifacts: melt them into light
      float cfMaxS = max(max(scales.x, scales.y), scales.z);
      // judged by apparent (angular) size: a splat filling a big part of the view from up close
      float cfAng = cfMaxS / max(cfDist, 0.05);
      float cfBig = smoothstep(0.07, 0.25, cfAng) * (1.0 - smoothstep(1.5, 4.0, cfDist));
      rgba.rgb = mix(rgba.rgb, min(cfHaze * (1.0 + 0.1 * cfPulse * cfEdge), vec3(1.0)), max(cfH, cfBig * 0.6));
      rgba.a *= max(0.0, 1.0 - 0.55 * cfEdge - 0.9 * cfBig);
    }
    vRgba = rgba;`);
  patch("    vRgba.a = rgba.a;", `    vRgba.a = rgba.a;
    if (cfAlphaCut > 0.0 && rgba.a <= 1.0) {
      float cfR = sqrt(max(0.0, 2.0 * log(rgba.a / cfAlphaCut)));
      adjustedStdDev = min(adjustedStdDev, max(cfR, 1.0));
      vSplatUv = position.xy * adjustedStdDev;
    }`);
  spark.material.vertexShader = vs;
  spark.material.needsUpdate = true;
}

export function createView({ container, params, onProgress }) {
  const renderer = createRenderer(container);
  // full scan for dedicated GPUs, a streamed lighter one for integrated GPUs (see quality.js)
  const quality = chooseQuality(renderer, params);
  const Q = QUALITY[quality];

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 80);
  scene.add(camera);

  const spark = createSpark(renderer, params, Q);
  installExtent(spark, params.has("alphacut") ? Number(params.get("alphacut")) : RENDER.alphaCut, {
    color: HAZE_COLOR, fog: new THREE.Vector3(9, 30, 0.55),
  });
  scene.add(spark);

  const mesh = createScanMesh({ params, tier: Q, onProgress });
  mesh.maxSh = Q.maxSh;
  scene.add(mesh);

  // resolution and splat budget follow the measured frame cost (governor.js)
  const governor = createGovernor({ renderer, spark, quality, tier: Q, params });
  const slow = gpuSlowdown(params);
  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    governor.resize();
  });

  // regenerate the splat buffer only when needed (rotation is free: radial sort + SH depend
  // only on position); in between, driveLod keeps the LoD system and streaming going
  const regen = { pos: new THREE.Vector3(1e9, 0, 0), quat: new THREE.Quaternion(), mapping: -1, warm: 60, force: 0 };
  function needsRegen() {
    if (!mesh.isInitialized) return true;
    if (regen.warm > 0) return regen.warm--, true;
    if (regen.force > 0) return regen.force--, true;
    if (mesh.mappingVersion !== regen.mapping) return true;
    if (camera.position.distanceToSquared(regen.pos) > RENDER.regenStep ** 2) return true;
    return !spark.lodQuatOverride && Math.abs(camera.quaternion.dot(regen.quat)) < 0.995; // foveated LoD
  }
  function render() {
    governor.begin();
    camera.updateMatrixWorld();
    lodAnchor(spark, camera);
    const regenerate = needsRegen();
    if (regenerate) {
      regen.pos.copy(camera.position);
      regen.quat.copy(camera.quaternion);
      regen.mapping = mesh.mappingVersion;
      spark.update({ scene, camera });
    } else driveLod(spark, scene, camera, mesh);
    for (let i = 0; i < slow; i++) renderer.render(scene, camera); // (?gpux: more than once)
    governor.end(regenerate);
  }
  const touch = (frames = 2) => (regen.force = Math.max(regen.force, frames));

  const setBoundaries = (boxes) => {
    const u = spark.material.uniforms;
    boxes.slice(0, 8).forEach((b, i) => { u.cfBoxMin.value[i].fromArray(b.min); u.cfBoxMax.value[i].fromArray(b.max); });
  };
  const setEdgeField = (f) => {
    const u = spark.material.uniforms;
    u.cfEdgeTex.value = f.tex; u.cfEdgeOrigin.value.copy(f.origin); u.cfEdgeSize.value.copy(f.size); u.cfEdgeOn.value = 1;
  };
  return { renderer, scene, camera, spark, mesh, quality, governor, render, touch, setEdgeField, setBoundaries, stats: () => governor.stats() };
}
