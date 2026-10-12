// A bare bulb left burning in a ceiling corner by the stairs: the one working light in the
// building, so you notice the stairwell from down the hall. It buzzes and flickers like it is
// failing. The fixture (cord, socket, translucent glass, a soft halo) is made of splats, lit by
// the bulb's own light in the splat shader (SceneFX.setStairLight); the filament is one opaque,
// depth-writing point drawn before the splats, so walls in front hide it (Spark tests depth
// but doesn't write it).

import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";

function buildFixture(pos, ceilY) {
  let seed = 7;
  const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const q = new THREE.Quaternion();
  const out = [];
  const add = (x, y, z, sx, sy, sz, op, r, g, b) => out.push([new THREE.Vector3(pos.x + x, pos.y + y, pos.z + z), new THREE.Vector3(sx, sy, sz), op, new THREE.Color(r, g, b)]);
  // cord up to the ceiling, and a ceiling rose
  const top = ceilY - pos.y;
  for (let y = 0.07; y < top; y += 0.012) add((R() - 0.5) * 0.003, y, (R() - 0.5) * 0.003, 0.004, 0.009, 0.004, 0.95, 0.05, 0.045, 0.04);
  for (let i = 0; i < 40; i++) { const a = R() * 6.283, r = Math.sqrt(R()) * 0.05; add(Math.cos(a) * r, top - 0.01, Math.sin(a) * r, 0.012, 0.004, 0.012, 0.9, 0.3, 0.28, 0.25); }
  // socket: a dark bakelite cylinder
  for (let i = 0; i < 80; i++) { const a = R() * 6.283, y = 0.035 + R() * 0.04; add(Math.cos(a) * 0.02, y, Math.sin(a) * 0.02, 0.008, 0.01, 0.008, 0.95, 0.06, 0.05, 0.045); }
  // glass: a translucent pear-shaped shell
  for (let i = 0; i < 220; i++) {
    const u = R() * 2 - 1, a = R() * 6.283, sr = Math.sqrt(1 - u * u);
    const rad = 0.04 * (1 - 0.35 * Math.max(0, u));
    add(Math.cos(a) * sr * rad, u * 0.045, Math.sin(a) * sr * rad, 0.009, 0.009, 0.009, 0.22, 0.95, 0.88, 0.75);
  }
  // filament glow inside
  for (let i = 0; i < 40; i++) add((R() - 0.5) * 0.02, (R() - 0.5) * 0.02, (R() - 0.5) * 0.02, 0.006, 0.006, 0.006, 0.9, 1, 0.85, 0.6);
  // halo: big faint splats, like the glare of a bulb in dusty air
  for (let i = 0; i < 36; i++) {
    const d = new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize().multiplyScalar(R() * 0.1);
    const s = 0.06 + R() * 0.22;
    add(d.x, d.y - 0.02, d.z, s, s, s, 0.03 + R() * 0.04, 0.9, 0.7, 0.45);
  }
  return new SplatMesh({ constructSplats: (splats) => { for (const [c, sc, op, col] of out) splats.pushSplat(c, sc, q, op, col); } });
}

// What the bulb can see: a small 3D texture around it (1 = in line of sight), so its light
// stops at walls instead of shining through into the next room.
export function buildLightVis(world, pos, half = 5.6, cell = 0.25) {
  const n = Math.ceil((half * 2) / cell);
  const data = new Uint8Array(n * n * n);
  const o = new THREE.Vector3(pos.x - half, pos.y - half, pos.z - half);
  const a = new THREE.Vector3(pos.x, pos.y, pos.z), b = new THREE.Vector3();
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        b.set(o.x + (x + 0.5) * cell, o.y + (y + 0.5) * cell, o.z + (z + 0.5) * cell);
        if (b.distanceToSquared(a) > half * half) continue;
        if (world.lineOfSight(a, b)) data[(z * n + y) * n + x] = 255;
      }
  const tex = new THREE.Data3DTexture(data, n, n, n);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return { tex, origin: o, size: half * 2 };
}

export class Bulb {
  constructor(scene, pos) {
    this.fixture = buildFixture(pos, pos.ceil ?? pos.y + 0.14);
    scene.add(this.fixture);
    this.level = 1;
    this.dip = 0;
    this.next = 2;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([pos.x, pos.y, pos.z]), 3));
    this.mat = new THREE.ShaderMaterial({
      transparent: false, depthTest: true, depthWrite: true,
      uniforms: { uLevel: { value: 1 }, uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uLevel, uScale;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uScale * 30.0 / max(-mv.z, 0.5), 2.0, 30.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uLevel;
        float h12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          float r = dot(q, q);
          float core = exp(-r * 22.0), glow = exp(-r * 4.0) * 0.5;
          float a = (core + glow) * uLevel;
          // opaque + depth-writing, so the soft edge is a stable dither rather than a blend
          if (r > 1.0 || a < 0.06 + 0.5 * h12(floor(gl_FragCoord.xy))) discard;
          gl_FragColor = vec4(mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.93, 0.78), core) * (0.6 + 0.5 * uLevel), 1.0);
        }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = -10;
    scene.add(this.points);
  }

  // returns the light level (0..1) for this frame
  update(dt, pixelHeight) {
    // mostly steady with a mains shimmer; now and then it stutters or nearly dies
    this.next -= dt;
    if (this.next <= 0) {
      this.dip = 0.25 + Math.random() * 0.6;
      this.next = 1.5 + Math.random() * 6;
    }
    this.dip = Math.max(0, this.dip - dt);
    const stutter = this.dip > 0 ? (Math.random() < 0.5 ? 0.15 + Math.random() * 0.3 : 1) : 1;
    this.level = (0.92 + 0.08 * Math.sin(performance.now() * 0.05)) * stutter;
    this.mat.uniforms.uLevel.value = this.level;
    this.mat.uniforms.uScale.value = pixelHeight / 720;
    return this.level;
  }
}
