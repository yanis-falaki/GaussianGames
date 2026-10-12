// Relighting of the captured scene. The capture has its daylight baked in; we treat that colour
// as albedo and re-light it with a hand lamp and a faint moonlight that only survives in the
// brightest (window) splats.
//
// Performance structure:
//  - All *colour* shading runs in Spark's final splat vertex shader (patched in installShading).
//    It uses the live camera every frame, so lighting changes (turning the lamp, flicker) never
//    require Spark to regenerate its splat buffer, and turning your head is nearly free.
//  - Only *geometric* effects that need exact per-splat positions live in the dyno worldModifier
//    (generation pass): decoherence near the entity, exposures lifting/bursting, the exit window
//    dissolving, the ending. SceneFX.active tells the renderer when those need regenerating.
import * as THREE from "three";
import { dyno } from "@sparkjsdev/spark";

// generation-pass (dyno) uniforms
export const U = {
  time: dyno.dynoFloat(0),
  entityPos: dyno.dynoVec3(new THREE.Vector3(0, -100, 0)),
  entityPower: dyno.dynoFloat(0),
  glitch: dyno.dynoFloat(0),
  death: dyno.dynoFloat(0),
  ending: dyno.dynoFloat(0),
  exitPos: dyno.dynoVec4(new THREE.Vector4(0, -100, 0, 0)),
  ex: [0, 1, 2, 3, 4, 5].map(() => dyno.dynoVec4(new THREE.Vector4(0, -100, 0, 2))),
  // benchmark: show raw captured colour (vertex-shader side, see VSU.rsUnlit)
  unlit: { value: 0 },
};

// vertex-shader uniforms (merged into Spark's material)
export const VSU = {
  rsLampPos: { value: new THREE.Vector3() },
  rsLampDir: { value: new THREE.Vector3(0, 0, -1) },
  rsLamp: { value: 1 },
  rsTime: { value: 0 },
  rsDeath: { value: 0 },
  rsEnding: { value: 0 },
  rsUnlit: U.unlit,
  rsExit: { value: new THREE.Vector4(0, -100, 0, 0) },
  rsEnt: { value: new THREE.Vector4(0, -100, 0, 0) },   // the entity's feet (xyz) and visibility (w)
  rsStair: { value: new THREE.Vector4(0, -100, 0, 0) }, // the bulb over the stairs (xyz, level)
  rsStairVis: { value: new THREE.Data3DTexture(new Uint8Array([0]), 1, 1, 1) }, // what it can see (bulb.js)
  rsStairVisO: { value: new THREE.Vector4(0, 0, 0, 1) }, // texture origin (xyz) and size (w)
  rsEx: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector4(0, -100, 0, 3)) },
  // Opacity-aware splat extent: each splat's quad stops where its falloff drops below this
  // alpha. Opaque splats keep the full maxStdDev (no visible edge on smooth walls); faint ones
  // shrink, saving fill. 0 disables.
  rsAlphaCut: { value: 0.01 },
  // edge of the world (shared with Undeveloped: src/shared/edge-field.js + BOUNDARIES)
  rsEdgeTex: { value: new THREE.Data3DTexture(new Uint8Array([0]), 1, 1, 1) },
  rsEdgeOrigin: { value: new THREE.Vector3() },
  rsEdgeSize: { value: new THREE.Vector3(1, 1, 1) },
  rsEdgeOn: { value: 0 },
  rsPlayer: { value: new THREE.Vector3(0, -100, 0) },
  rsBoxMin: { value: Array.from({ length: 8 }, () => new THREE.Vector3(1e5, 1e5, 1e5)) },
  rsBoxMax: { value: Array.from({ length: 8 }, () => new THREE.Vector3(-1e5, -1e5, -1e5)) },
};

const SHADE_GLSL = /* glsl */ `
uniform vec3 rsLampPos;
uniform vec3 rsLampDir;
uniform float rsLamp;
uniform float rsTime;
uniform float rsDeath;
uniform float rsEnding;
uniform float rsUnlit;
uniform vec4 rsExit;
uniform vec4 rsStair;
uniform vec4 rsEnt;
uniform highp sampler3D rsStairVis;
uniform vec4 rsStairVisO;
uniform vec4 rsEx[6];
uniform float rsAlphaCut;
precision highp sampler3D;
uniform sampler3D rsEdgeTex;
uniform vec3 rsEdgeOrigin, rsEdgeSize, rsPlayer;
uniform float rsEdgeOn;
uniform vec3 rsBoxMin[8], rsBoxMax[8];
vec3 rsHash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
// how far past the edge of the walkable world a point is (0 inside .. 1 beyond)
float rsEdgeAt(vec3 c) {
  float e = 0.0;
  if (rsEdgeOn > 0.5) e = smoothstep(0.9, 2.6, texture(rsEdgeTex, (c - rsEdgeOrigin) / rsEdgeSize).r * 5.1);
  for (int i = 0; i < 8; i++) {
    vec3 lo = c - rsBoxMin[i], hi = rsBoxMax[i] - c;
    e = max(e, smoothstep(-0.7, 0.8, min(min(min(lo.x, hi.x), min(lo.y, hi.y)), min(lo.z, hi.z))));
  }
  return e;
}
float rsHash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float rsNoise2(vec2 x) {
  vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  float a = rsHash13(vec3(i, 7.0)), b = rsHash13(vec3(i + vec2(1.0, 0.0), 7.0));
  float c = rsHash13(vec3(i + vec2(0.0, 1.0), 7.0)), d = rsHash13(vec3(i + vec2(1.0, 1.0), 7.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// --- the plates: each is a glass plate lying on the floor (rsEx[i].xyz on the floor; .w state:
// 0 undeveloped, 0..1 developing, 2..3 just collected, 3 done)
const vec2 RS_PLATE = vec2(0.64, 0.46); // half size (m)
// plate-local floor coordinates (each plate lies at its own angle)
vec2 rsPlateUV(vec3 c, vec4 e, int i) {
  float a = float(i) * 2.39996 + 0.6;
  vec2 d = c.xz - e.xz;
  return vec2(cos(a) * d.x + sin(a) * d.y, -sin(a) * d.x + cos(a) * d.y);
}
// rounded-rectangle distance (m): negative inside
float rsPlateSD(vec2 uv) {
  vec2 q = abs(uv) - RS_PLATE + 0.06;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.06;
}
// only the floor: splats in a thin slab at the plate's height
float rsPlateSlab(vec3 c, vec4 e) { return 1.0 - smoothstep(0.1, 0.3, abs(c.y - e.y + 0.05)); }
// what the plate shows: a figure lying along it, smeared sideways like someone who moved
// during a long exposure (0..1 darkness)
float rsPlateSmear(vec2 uv, float t) {
  float s = 0.0;
  for (int k = 0; k < 5; k++) {
    float fk = float(k);
    vec2 q = uv - vec2(0.0, -0.13 + fk * 0.07 + 0.008 * sin(t * 0.9 + fk * 1.7));
    float body = smoothstep(1.0, 0.45, length((q - vec2(-0.08, 0.0)) / vec2(0.34, 0.1)));
    float head = smoothstep(1.0, 0.5, length((q - vec2(0.36, 0.015)) / vec2(0.09, 0.08)));
    float arm = smoothstep(1.0, 0.4, length((q - vec2(0.03, 0.125 - fk * 0.016)) / vec2(0.27, 0.035)));
    s = max(s, max(max(body, head), arm * 0.8) * (1.0 - fk * 0.17));
  }
  return s;
}

// alpha multiplier set by rsExposureDisp (embers fading as they rise)
float rsExA = 1.0;
// plate animation as a displacement, so it needs no regeneration of the splat buffer
vec3 rsExposureDisp(vec3 c) {
  vec3 d = vec3(0.0);
  rsExA = 1.0;
  for (int i = 0; i < 6; i++) {
    vec4 e = rsEx[i];
    if (e.w < 2.0 || e.w >= 3.0) continue;
    if (abs(c.x - e.x) > 0.9 || abs(c.z - e.z) > 0.9) continue;
    vec2 uv = rsPlateUV(c, e, i);
    float inside = (1.0 - smoothstep(-0.02, 0.03, rsPlateSD(uv))) * rsPlateSlab(c, e);
    if (inside <= 0.0) continue;
    // collected: a few specks lift off the plate like embers, fade out, and quietly return
    vec3 h = rsHash33(floor(c * 20.0));
    if (h.x > 0.14) continue;
    float t = 3.0 - e.w; t = 1.0 - t;                       // 0 at the flash .. 1
    float rise = clamp(t / 0.8, 0.0, 1.0);
    if (t < 0.8) {
      d += vec3((h.y - 0.5) * 0.25 * rise + 0.04 * sin(t * 9.0 + h.z * 20.0), pow(rise, 1.4) * (0.5 + 0.9 * h.z), (h.z - 0.5) * 0.25 * rise) * inside;
      rsExA = 1.0 - smoothstep(0.35, 0.8, t) * inside;
    } else rsExA = mix(1.0, smoothstep(0.8, 1.0, t), inside);
  }
  return d;
}

// light arriving at world point c (base = captured colour, used to find window splats)
vec3 rsLight(vec3 c, vec3 base) {
  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  vec3 toP = c - rsLampPos;
  float d = length(toP);
  float cosA = dot(toP / max(d, 1e-4), rsLampDir);
  // hot core + soft ring + wide faint spill, like a cheap torch
  float core = smoothstep(0.955, 0.99, cosA);
  float ring = smoothstep(0.9, 0.955, cosA) * (0.82 + 0.18 * sin(acos(clamp(cosA, -1.0, 1.0)) * 90.0));
  float spill = smoothstep(0.6, 0.92, cosA) * 0.07;
  float atten = 1.0 / (1.0 + 0.1 * d * d);         // a weak hand lamp: good to ~5m, little past 8m
  float near = 0.05 * exp(-d * 1.1);                 // bounce light around the player
  // a running-down filament goes dim and orange
  vec3 L = mix(vec3(1.0, 0.6, 0.35), vec3(1.0, 0.93, 0.8), clamp(rsLamp * 1.4 - 0.2, 0.0, 1.0)) * rsLamp * ((core * 1.1 + ring * 0.6 + spill) * atten * 1.1 + near);
  // moonlight: only the brightest captured splats (sky, windows) keep a cold glow
  float win = smoothstep(0.72, 0.97, lum);
  // the bare bulb over the stairs: warm, falls off within a few metres
  vec3 sl = rsStair.xyz - c;
  float sd2 = dot(sl, sl);
  if (rsStair.w > 0.0 && sd2 < 30.0) {
    // only where it has line of sight (sampled a little toward the bulb, so lit faces count)
    float vis = texture(rsStairVis, (c + sl * (0.15 / sqrt(sd2 + 1e-4)) - rsStairVisO.xyz) / rsStairVisO.w).r;
    L += vec3(1.0, 0.7, 0.4) * rsStair.w * vis * (2.4 / (1.0 + sd2 * 0.6)) * (1.0 - smoothstep(12.0, 30.0, sd2));
  }
  return L + vec3(0.55, 0.65, 0.85) * (0.075 + win * 0.5);
}

vec3 rsShade(vec3 c, vec3 base) {
  if (rsUnlit > 0.5) return base;
  vec3 col = base;
  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  vec3 light = rsLight(c, base);
  // plates: a cold negative on the floor; developing turns it into a warm positive from the
  // centre out, and the smear of a figure comes up in it; collecting fires a flash
  for (int i = 0; i < 6; i++) {
    vec4 e = rsEx[i];
    if (e.w >= 3.0) continue;
    float dist = distance(c, e.xyz);
    bool flashing = e.w >= 2.0;
    if (dist > (flashing ? 4.5 : 1.5)) continue;
    vec2 uv = rsPlateUV(c, e, i);
    float sd = rsPlateSD(uv);
    float slab = rsPlateSlab(c, e);
    float inside = (1.0 - smoothstep(-0.02, 0.02, sd)) * slab;
    float border = (1.0 - smoothstep(0.0, 0.022, abs(sd + 0.01))) * slab;
    float halo = (1.0 - smoothstep(0.0, 0.7, max(sd, 0.0))) * step(0.0, sd) * slab;
    float pulse = 0.5 + 0.5 * sin(rsTime * 1.7 + float(i));
    float hc = rsHash13(floor(c * 24.0));
    vec3 neg = (1.0 - base) * vec3(0.62, 0.8, 1.0) * 0.75;
    vec3 sepia = vec3(lum * 1.12 + 0.05, lum * 0.92 + 0.03, lum * 0.66) * 1.1;
    float smear = rsPlateSmear(uv, rsTime);
    if (!flashing) {
      float w = e.w;
      // the developing front: ragged, spreading out from the middle
      float r = length(uv / RS_PLATE) * 0.5 + (rsNoise2(uv * 9.0 + float(i) * 3.1) - 0.5) * 0.12;
      float R = w * 0.72;
      float dev = w > 0.0 ? smoothstep(R, R - 0.07, r) : 0.0;
      float front = w > 0.0 ? exp(-abs(r - R) * 45.0) * (1.0 - smoothstep(0.85, 1.0, w)) : 0.0;
      vec3 pos = sepia * (1.0 - smear * 0.9 * smoothstep(0.1, 0.8, w));
      neg += vec3(0.75, 0.85, 1.0) * smear * 0.45;   // in the negative she shows pale
      // the latent image is a faint luminescence: lamp light falling on it washes it out (as much
      // as the beam lights that spot), so plates glow best in the dark. Only the cold negative
      // fades; the warm developing image is unaffected
      float lampHere = max(0.0, dot(light, vec3(0.333)) - 0.12);
      float latent = 1.0 - 0.9 * smoothstep(0.04, 0.45, lampHere);
      float negK = inside * (1.0 - dev) * latent;
      col = mix(col, neg, negK * 0.92);
      col = mix(col, pos, inside * dev * 0.92);
      float sparkle = step(0.965, fract(hc * 17.0 + rsTime * 0.3));
      light += vec3(0.5, 0.66, 0.95) * (negK * (0.34 + 0.26 * pulse + sparkle * 2.0) + (border * (0.8 + 0.9 * pulse) * (1.0 - w) + halo * 0.12) * latent);
      light += vec3(1.0, 0.9, 0.72) * (inside * dev * (0.7 + 0.5 * w) + inside * front * (2.5 + 2.0 * hc) + border * w * 1.6);
    } else {
      float t = 1.0 - (3.0 - e.w);               // 0 at the flash .. 1
      float fl = exp(-t * 12.0);                  // magnesium flash: the whole room, for an instant
      light += vec3(1.0, 0.97, 0.9) * fl * 5.0 * (1.0 - smoothstep(0.0, 4.5, dist));
      float img = 1.0 - smoothstep(0.15, 0.7, t), ghost = 1.0 - smoothstep(0.45, 1.0, t);
      vec3 pos = mix(col, sepia, img) * (1.0 - smear * 0.8 * ghost);  // her smear is the last to go
      col = mix(col, pos, inside * 0.92);
      float ember = step(rsHash33(floor(c * 20.0)).x, 0.14) * (1.0 - smoothstep(0.5, 0.8, t));
      light += vec3(1.0, 0.86, 0.6) * (inside * (img * 0.9 + ember * 3.0) + border * img * 2.0);
    }
  }
  // the entity carries a faint cold light of her own (like the plates' glow), so she can be
  // seen coming across a dark hall: a pale shape, not a lit one
  if (rsEnt.w > 0.0) {
    vec3 q = c - rsEnt.xyz;
    float body = (1.0 - smoothstep(0.35, 0.6, length(q.xz))) * step(-0.1, q.y) * (1.0 - smoothstep(1.9, 2.2, q.y));
    light = max(light, vec3(0.5, 0.55, 0.64) * body * rsEnt.w);
  }
  // the way out: daylight leaking through the dissolved lounge window
  if (rsExit.w > 0.0) {
    float g = (1.0 - smoothstep(0.0, 4.5, distance(c, rsExit.xyz + vec3(0.0, 1.2, 0.0)))) * rsExit.w;
    light += vec3(1.0, 0.94, 0.82) * g * (0.9 + 0.1 * sin(rsTime * 0.7));
  }
  // caught: the world turns to red-black grain
  col = mix(col, vec3(lum * 1.4, lum * 0.15, lum * 0.1), clamp(rsDeath * 1.5, 0.0, 1.0));
  vec3 rgb = col * light;
  rgb = rgb / (1.0 + max(rgb - 0.85, 0.0) * 0.4);   // gentle shoulder: keeps tile/grout contrast
  if (rsEnding > 0.0) rgb = mix(rgb, vec3(1.0, 0.97, 0.9), clamp(rsEnding * 1.3 - 0.15, 0.0, 1.0));
  return clamp(rgb, 0.0, 1.0);
}
`;

// Patch Spark's splat vertex shader so every splat is shaded with the live lamp/camera.
export function installShading(spark) {
  Object.assign(spark.material.uniforms, VSU);
  let vs = spark.material.vertexShader;
  const patch = (from, to) => {
    if (!vs.includes(from)) throw new Error(`Spark vertex shader anchor not found: ${from}`);
    vs = vs.replace(from, to);
  };
  patch("void main() {", `${SHADE_GLSL}\nvoid main() {`);
  // after the frustum culls, so off-screen splats skip the shading entirely
  patch("    vRgba = rgba;", `    {
      // reconstruct the world-space centre from the camera-relative accumulator encoding
      vec3 rsWorld = center + cameraPosition + transpose(mat3(viewMatrix)) * renderToViewPos;
      float rsE = rsUnlit > 0.5 ? 0.0 : rsEdgeAt(rsWorld);
      float rsNear = 1.0 - smoothstep(1.0, 6.0, distance(rsWorld, rsPlayer));
      // the edge of the world sways like something breathing; exposures lift / burst
      float rsPh = dot(rsWorld, vec3(2.1, 1.3, 1.7));
      vec3 rsDisp = vec3(sin(rsTime * 1.3 + rsPh), 0.6 * sin(rsTime * 1.7 + rsPh * 1.3), cos(rsTime * 1.1 + rsPh * 0.8)) * rsE * (0.04 + 0.1 * rsNear);
      rsDisp += rsExposureDisp(rsWorld);
      if (dot(rsDisp, rsDisp) > 0.0) {
        viewCenter += quatVec(renderToViewQuat, rsDisp);
        clipCenter = projectionMatrix * vec4(viewCenter, 1.0);
      }
      rgba.rgb = rsShade(rsWorld, rgba.rgb);
      // past the edge: a black fog that only shows where the lamp falls on it (only evaluated
      // there: most splats are inside, and the lamp is the costliest part of the shading)
      if (rsE > 0.0) {
        vec3 rsFog = rsLight(rsWorld, vec3(0.35)) * vec3(0.42, 0.44, 0.48);
        float rsPulse = 0.5 + 0.5 * sin(rsTime * 1.6 - length(viewCenter) * 0.7);
        rgba.rgb = mix(rgba.rgb, rsFog * (0.8 + 0.4 * rsPulse * rsNear), rsE);
      }
      rgba.a *= (1.0 - 0.45 * rsE) * rsExA;
      // huge splats right in front of the camera (poorly captured spots) melt into the dark
      float rsAng = max(max(scales.x, scales.y), scales.z) / max(length(viewCenter), 0.05);
      float rsBig = smoothstep(0.07, 0.25, rsAng) * (1.0 - smoothstep(1.5, 4.0, length(viewCenter)));
      rgba.a *= 1.0 - 0.9 * rsBig;
    }
    vRgba = rgba;`);
  patch("    vRgba.a = rgba.a;", `    vRgba.a = rgba.a;
    if (rsAlphaCut > 0.0 && rgba.a <= 1.0) {
      // radius where alpha * exp(-r^2/2) falls to rsAlphaCut
      float rsR = sqrt(max(0.0, 2.0 * log(rgba.a / rsAlphaCut)));
      adjustedStdDev = min(adjustedStdDev, max(rsR, 1.0));
      vSplatUv = position.xy * adjustedStdDev;
    }`);
  spark.material.vertexShader = vs;
  spark.material.needsUpdate = true;
}

// Generation-pass modifier: geometry only (needs exact float32 positions for its hashes).
function makeSceneModifier() {
  return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const fx = new dyno.Dyno({
      inTypes: {
        gsplat: dyno.Gsplat, t: "float", entPos: "vec3", entPow: "float", glitch: "float", death: "float",
        ending: "float", exitPos: "vec4", e0: "vec4", e1: "vec4", e2: "vec4", e3: "vec4", e4: "vec4", e5: "vec4",
      },
      outTypes: { gsplat: dyno.Gsplat },
      globals: () => [dyno.defineGsplat, dyno.unindent(/* glsl */ `
        float rgHash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
        vec3 rgHash33(vec3 p) {
          p = fract(p * vec3(0.1031, 0.1030, 0.0973));
          p += dot(p, p.yxz + 33.33);
          return fract((p.xxy + p.yxx) * p.zyx);
        }
      `)],
      statements: ({ inputs: I, outputs: O }) => dyno.unindentLines(/* glsl */ `
        ${O.gsplat} = ${I.gsplat};
        if (isGsplatActive(${I.gsplat}.flags)) {
          vec3 c = ${I.gsplat}.center;
          vec3 col = ${I.gsplat}.rgba.rgb;
          vec3 scl = ${I.gsplat}.scales;
          float alpha = ${I.gsplat}.rgba.a;
          float h = rgHash13(c * 53.0);

          // decoherence: near the entity, during glitches, and when caught
          float de = ${I.entPow} * (1.0 - smoothstep(0.6, 5.0, distance(c, ${I.entPos})));
          de += ${I.glitch} * 0.35 * step(0.6, rgHash13(floor(c * 2.0) + floor(${I.t} * 9.0)));
          de += ${I.death} * ${I.death} * 2.5;
          if (de > 0.001) {
            float tq = floor(${I.t} * 14.0);                // stuttering, frame-dropped motion
            c += (rgHash33(c * 41.0 + tq) - 0.5) * de * 0.22;
            scl *= 1.0 + de * 1.6 * h;
            float lum = dot(col, vec3(0.299, 0.587, 0.114));
            col = mix(col, vec3(lum) * vec3(0.9, 0.85, 0.85), clamp(de, 0.0, 1.0));
            alpha *= 1.0 - clamp(de * 0.4, 0.0, 0.8) * step(0.5, h);
          }

          // the lounge window comes apart, splat by splat
          if (${I.exitPos}.w > 0.0) {
            vec3 q = abs(c - (${I.exitPos}.xyz + vec3(0.0, 1.2, 0.0)));
            if (q.x < 0.5 && q.z < 0.8 && q.y < 1.3) {
              float gone = ${I.exitPos}.w * 1.6 - h * 0.6;
              if (gone > 0.4) { ${O.gsplat}.flags = 0u; }
              c += vec3(0.0, gone * gone * 0.6, 0.0) + (rgHash33(c * 23.0) - 0.5) * gone * 0.3;
            }
          }

          // ending: everything drifts upward and comes apart
          if (${I.ending} > 0.0) {
            float e = clamp(${I.ending} * 1.3 - h * 0.3, 0.0, 1.0);
            c += vec3(0.0, e * e * (1.0 + h * 3.0), 0.0) + (rgHash33(c * 13.0) - 0.5) * e * 0.8;
            scl *= 1.0 - 0.7 * e;
          }

          ${O.gsplat}.center = c;
          ${O.gsplat}.scales = scl;
          ${O.gsplat}.rgba = vec4(col, alpha);
        }
      `),
    });
    return {
      gsplat: fx.apply({
        gsplat, t: U.time, entPos: U.entityPos, entPow: U.entityPower, glitch: U.glitch, death: U.death,
        ending: U.ending, exitPos: U.exitPos, e0: U.ex[0], e1: U.ex[1], e2: U.ex[2], e3: U.ex[3], e4: U.ex[4], e5: U.ex[5],
      }).gsplat,
    };
  });
}

export class SceneFX {
  constructor(mesh) {
    this.mesh = mesh;
    mesh.worldModifier = makeSceneModifier();
    mesh.updateGenerator();
    this.exposureState = [0, 0, 0, 0, 0, 0];
    this.exitActive = false;
    this.exitGlow = 0;
    this.active = false; // true while a geometric effect needs the splats regenerated
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
  }

  setExposures(list) {
    list.forEach((p, i) => {
      U.ex[i].value.set(p.x, p.y, p.z, 0);
      VSU.rsEx.value[i].set(p.x, p.y, p.z, 0);
    });
    this.exposureState = list.map(() => 0);
  }

  setEdge(field, boxes) {
    VSU.rsEdgeTex.value = field.tex;
    VSU.rsEdgeOrigin.value.copy(field.origin);
    VSU.rsEdgeSize.value.copy(field.size);
    VSU.rsEdgeOn.value = 1;
    boxes.slice(0, 8).forEach((b, i) => { VSU.rsBoxMin.value[i].fromArray(b.min); VSU.rsBoxMax.value[i].fromArray(b.max); });
  }

  setStairLight(p, vis) {
    VSU.rsStair.value.set(p.x, p.y, p.z, 1);
    VSU.rsStairVis.value = vis.tex;
    VSU.rsStairVisO.value.set(vis.origin.x, vis.origin.y, vis.origin.z, vis.size);
  }
  set stairLevel(v) { VSU.rsStair.value.w = v; }

  setExit(p) {
    U.exitPos.value.set(p.x, p.y, p.z, 0);
    VSU.rsExit.value.set(p.x, p.y, p.z, 0);
  }

  collect(i) {
    this.exposureState[i] = 2;
  }

  update(s) {
    const { camera, dt } = s;
    camera.updateMatrixWorld();
    U.time.value = s.time;
    VSU.rsTime.value = s.time;
    // lamp held slightly to the right and below the eye
    camera.getWorldDirection(VSU.rsLampDir.value);
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    this.up.setFromMatrixColumn(camera.matrixWorld, 1);
    VSU.rsLampPos.value.copy(camera.position).addScaledVector(this.right, 0.18).addScaledVector(this.up, -0.12);
    VSU.rsLamp.value = s.lampOn ?? 1;
    if (s.player) VSU.rsPlayer.value.copy(s.player);
    if (s.entityPos) U.entityPos.value.copy(s.entityPos);
    if (s.entityBody) VSU.rsEnt.value.set(s.entityBody.x, s.entityBody.y, s.entityBody.z, s.entityGlow ?? 1);
    else VSU.rsEnt.value.w = 0;
    U.entityPower.value = s.entityPos ? s.entityPower ?? 0 : 0;
    U.glitch.value = s.glitch ?? 0;
    U.death.value = VSU.rsDeath.value = s.death ?? 0;
    U.ending.value = VSU.rsEnding.value = s.ending ?? 0;

    let animating = false;
    this.exposureState.forEach((st, i) => {
      let w = st;
      if (st >= 2) {
        w = Math.min(3, st + dt / 2.5); // burst fades over 2.5s (animated in the vertex shader)
        this.exposureState[i] = w;
      } else {
        w = s.developing === i ? Math.min(0.99, s.develop) : 0;
      }
      U.ex[i].value.w = w;
      VSU.rsEx.value[i].w = w;
    });
    const target = this.exitActive ? 1 : 0;
    this.exitGlow += (target - this.exitGlow) * Math.min(1, dt * 0.5);
    if (Math.abs(target - this.exitGlow) > 0.002) animating = true;
    U.exitPos.value.w = VSU.rsExit.value.w = this.exitGlow;

    this.active = animating || U.entityPower.value > 0.003 || U.glitch.value > 0 || U.death.value > 0 || U.ending.value > 0;
  }
}
