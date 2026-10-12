// Undeveloped's render pipeline: the capture in its original daylight, with Spark's shader
// patched for the haze at the edge of the world and the photo highlight, the adaptive quality
// governor, and render(), which regenerates the splat buffer only when needed (as in
// residue/view.js).
import * as THREE from "three";
import { RENDER } from "../shared/render-config.js";
import { chooseQuality, QUALITY } from "../shared/quality.js";
import { createRenderer, createScanMesh, createSpark, createGovernor, lodAnchor, driveLod, gpuSlowdown } from "../shared/splat-scene.js";
import { HAZE_COLOR } from "./haze.js";

// Patch Spark's vertex shader: opacity-aware splat extent (quad ends where the splat's falloff
// drops below ALPHA_CUT): opaque splats keep the full footprint, faint ones shrink -> less fill.
// Also: distance haze, distant splats fade toward the haze colour (see haze.js) so the edges
// of the capture dissolve into light rather than ending abruptly. And the photo highlight: up to
// four clue regions (ellipsoids) whose own splats glow, strongest on the splats seen edge-on,
// which trace the object's contour: faintly while it's framed, brightly when it's photographed.
// All in the vertex shader, so it animates without regenerating the splat buffer.
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
  // highlights: A = centre (xyz), strength (w, 0 = off); B = half extents (xyz), phase (w: < 0
  // aiming, 0..1 through the shutter's flash)
  u.cfHiA = { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, -100, 0, 0)) };
  u.cfHiB = { value: Array.from({ length: 4 }, () => new THREE.Vector4(1, 1, 1, -1)) };
  // C = colour key: type (0 none, 1 saturation, 2 luminance, 3 warmth), threshold
  u.cfHiC = { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, 0)) };
  u.cfFocus = { value: 0 }; // right after the shutter: everything but what was photographed dims a little
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
uniform vec4 cfHiA[4], cfHiB[4], cfHiC[4];
uniform float cfFocus;
void main() {
    float cfEdge = 0.0, cfNear = 0.0;
    vec3 cfBase;`);
  // after the frustum culls (so only visible splats pay for it): splats past the edge of
  // walkable space sway like a membrane, more so the closer you are. Smooth functions only:
  // positions are re-quantized on each regeneration.
  patch("    vRgba = rgba;", `    cfBase = rgba.rgb;
    vec3 cfWorld = center + cameraPosition + transpose(mat3(viewMatrix)) * renderToViewPos;
    if (cfEdgeOn > 0.5) {
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
    {
      float cfGlow = 0.0, cfSel = 0.0;
      for (int i = 0; i < 4; i++) {
        vec4 hA = cfHiA[i];
        if (hA.w <= 0.0) continue;
        vec4 hB = cfHiB[i];
        vec3 q = (cfWorld - hA.xyz) / hB.xyz;
        float r = length(q);
        if (r >= 1.0) continue;
        float inside = 1.0 - smoothstep(0.55, 1.0, r);
        // only the splats that stand out by colour (paint, white paper, wood on a cool floor)
        vec4 hC = cfHiC[i];
        if (hC.x > 0.5) {
          float mx = max(max(cfBase.r, cfBase.g), cfBase.b), mn = min(min(cfBase.r, cfBase.g), cfBase.b);
          float v = hC.x < 1.5 ? (mx - mn) / max(mx, 1e-3) : hC.x < 2.5 ? dot(cfBase, vec3(0.299, 0.587, 0.114)) : cfBase.r - cfBase.b;
          inside *= smoothstep(hC.y, hC.y + (hC.x > 2.5 ? 0.08 : 0.15), v);
        }
        // a flat splat's thinnest axis is its surface normal: seen edge-on, it lies on a contour
        vec3 ax = scales.x < scales.y ? (scales.x < scales.z ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0))
                                      : (scales.y < scales.z ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));
        vec3 n = quatVec(renderToViewQuat, quatVec(quaternion, ax));
        float flatness = 1.0 - min(min(scales.x, scales.y), scales.z) / max(max(scales.x, scales.y), max(scales.z, 1e-6));
        float rim = smoothstep(0.55, 0.97, 1.0 - abs(dot(n, normalize(viewCenter)))) * flatness;
        float g;
        if (hB.w < 0.0) {
          // framed: a faint contour that breathes
          g = inside * (0.28 + 0.45 * rim) * (0.75 + 0.25 * sin(cfTime * 4.0));
        } else {
          // photographed: the object floods with light, then a band of it sweeps up and away
          float p = hB.w;
          cfSel = max(cfSel, inside);
          float env = smoothstep(0.0, 0.04, p) * pow(1.0 - p, 1.5);
          float band = exp(-pow((q.y - (p * 3.0 - 1.1)) * 2.6, 2.0)) * (1.0 - p);
          g = inside * (env * (0.65 + 0.35 * rim) + band * 0.5);
        }
        cfGlow = max(cfGlow, g * hA.w);
      }
      cfGlow = min(cfGlow, 1.0);
      if (cfFocus > 0.0) {
        float dim = cfFocus * (1.0 - cfSel);
        rgba.rgb = mix(rgba.rgb, vec3(dot(rgba.rgb, vec3(0.299, 0.587, 0.114))) * 0.72, dim * 0.45);
      }
      // warm light, and the lit splats swell a little so a soft halo spills past the object's edges
      if (cfGlow > 0.001) {
        rgba.rgb = mix(rgba.rgb, vec3(1.0, 0.8, 0.42), cfGlow * 0.55) + vec3(1.0, 0.75, 0.35) * cfGlow * 0.25;
        scales *= 1.0 + 0.7 * cfGlow;
        if (rgba.a < 1.0) rgba.a = min(1.0, rgba.a * (1.0 + cfGlow)); // (LoD splats above 1 stay as they are)
      }
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
  // highlight slot i (0..3) on a region: centre and half extents (Vector3s), strength 0..1 (0 = off),
  // phase < 0 while aiming, 0..1 through the shutter's flash
  // key: [type, threshold] (see cfHiC)
  const setHighlight = (i, center, ext, strength, phase = -1, key = null) => {
    const u = spark.material.uniforms;
    if (strength <= 0 || !center) { u.cfHiA.value[i].w = 0; return; }
    u.cfHiA.value[i].set(center.x, center.y, center.z, strength);
    u.cfHiB.value[i].set(ext.x, ext.y, ext.z, phase);
    u.cfHiC.value[i].set(key?.[0] ?? 0, key?.[1] ?? 0, 0, 0);
  };
  const setFocus = (k) => (spark.material.uniforms.cfFocus.value = k);
  return { renderer, scene, camera, spark, mesh, quality, governor, render, touch, setEdgeField, setBoundaries, setHighlight, setFocus, stats: () => governor.stats() };
}
