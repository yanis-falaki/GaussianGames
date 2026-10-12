// Dust motes glinting in the sunlight above places worth a closer look: an in-world cue that
// something was disturbed here recently. Fades out once the clue is photographed / read.
// Drawn as opaque points that write depth: splats in front hide them, splats behind are
// rejected by the depth test (Spark tests depth but doesn't write it).
import * as THREE from "three";

const PER_CLUE = 70;

export class Motes {
  // clues: [{ id, v, r }]. per: motes per clue; strength: where they start (0 hidden .. 1)
  constructor(scene, clues, { per = PER_CLUE, strength = 1 } = {}) {
    this.clues = clues;
    const PER_CLUE = per;
    const n = clues.length * PER_CLUE;
    const base = new Float32Array(n * 3), seed = new Float32Array(n * 4), clueIdx = new Float32Array(n);
    clues.forEach((c, ci) => {
      for (let k = 0; k < PER_CLUE; k++) {
        const i = ci * PER_CLUE + k;
        // a loose cloud around the object, mostly in the air just above it
        const rad = c.r + 0.25;
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * rad;
        base[i * 3] = c.v.x + Math.cos(a) * rr;
        base[i * 3 + 1] = c.v.y + (Math.random() * 0.9 - 0.15) * (0.4 + rad * 0.6);
        base[i * 3 + 2] = c.v.z + Math.sin(a) * rr;
        seed[i * 4] = Math.random(); seed[i * 4 + 1] = Math.random();
        seed[i * 4 + 2] = Math.random(); seed[i * 4 + 3] = 0.6 + Math.random() * 0.8;
        clueIdx[i] = ci;
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(base, 3));
    geo.setAttribute("seed", new THREE.BufferAttribute(seed, 4));
    geo.setAttribute("clue", new THREE.BufferAttribute(clueIdx, 1));
    this.strength = new Float32Array(clues.length).fill(strength);
    this.tex = new THREE.DataTexture(new Uint8Array(clues.length * 4).fill(Math.round(strength * 255)), clues.length, 1, THREE.RGBAFormat);
    this.tex.needsUpdate = true;
    this.mat = new THREE.ShaderMaterial({
      transparent: false, depthTest: true, depthWrite: true,
      uniforms: {
        uTime: { value: 0 }, uStrength: { value: this.tex }, uCount: { value: clues.length },
        uScale: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 seed; attribute float clue;
        uniform float uTime, uCount, uScale; uniform sampler2D uStrength;
        varying float vAlpha;
        varying float vGlint;
        void main() {
          float s = texture2D(uStrength, vec2((clue + 0.5) / uCount, 0.5)).r;
          float t = uTime * 0.12 * seed.w;
          // slow drift in a small loop, like dust in still air
          vec3 p = position + vec3(sin(t + seed.x * 6.28) * 0.12, sin(t * 0.7 + seed.y * 6.28) * 0.09, cos(t * 0.9 + seed.z * 6.28) * 0.12);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          gl_Position = projectionMatrix * mv;
          // glint: each mote catches the light now and then
          float tw = pow(0.5 + 0.5 * sin(uTime * (0.9 + seed.w) + seed.x * 40.0), 3.0);
          float near = smoothstep(0.5, 1.2, d) * (1.0 - smoothstep(10.0, 14.0, d));
          vAlpha = s * near * (0.35 + 0.65 * tw);
          vGlint = tw;
          gl_PointSize = clamp(uScale * (12.0 + 22.0 * tw) / max(d, 0.6), 2.5, 18.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying float vGlint;
        float h12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          float r = dot(q, q);
          // soft core + a little four-point flare when the mote catches the light
          float core = exp(-r * 9.0);
          float flare = vGlint * vGlint * (exp(-abs(q.x) * 14.0) + exp(-abs(q.y) * 14.0)) * (1.0 - r);
          float a = vAlpha * max(core, flare * 0.9);
          // opaque + depth-writing, so fade with a stable dither instead of blending
          if (r > 1.0 || a < 0.08 + 0.45 * h12(floor(gl_FragCoord.xy))) discard;
          gl_FragColor = vec4(vec3(1.0, 0.86, 0.5) * (0.9 + 0.3 * a), 1.0);
        }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = -10; // before the splats, so they cover the motes where solid
    scene.add(this.points);
    this.target = new Float32Array(clues.length).fill(strength);
  }

  // settle the dust over a clue that has been documented
  settle(id) { this.set(id, 0); }

  // fade the motes of every entry whose id is `id` (or matches it, for a function) toward v
  set(id, v) {
    this.clues.forEach((c, i) => { if (typeof id === "function" ? id(c) : c.id === id) this.target[i] = v; });
  }

  update(dt, time, pixelHeight) {
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uScale.value = pixelHeight / 720;
    let dirty = false;
    for (let i = 0; i < this.strength.length; i++) {
      if (this.strength[i] === this.target[i]) continue;
      this.strength[i] = this.target[i] < this.strength[i]
        ? Math.max(this.target[i], this.strength[i] - dt * 0.5)
        : Math.min(this.target[i], this.strength[i] + dt * 0.8);
      this.tex.image.data[i * 4] = Math.round(this.strength[i] * 255);
      dirty = true;
    }
    if (dirty) this.tex.needsUpdate = true;
  }
}
