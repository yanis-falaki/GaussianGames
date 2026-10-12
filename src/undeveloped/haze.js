// The edge of the world: wherever the capture runs out, the view fades into a soft, overexposed
// haze instead of black, like a memory or photograph washing out at its borders. It's a
// world-anchored background (stable as you turn) with slowly drifting light, drawn behind
// everything; splats blend over it, and distant splats fade toward the same colour.
import * as THREE from "three";

export const HAZE_COLOR = new THREE.Color(0.93, 0.91, 0.86);

export class Haze {
  constructor(scene, camera) {
    this.camera = camera;
    this.mat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uInvProjView: { value: new THREE.Matrix4() },
        uColor: { value: HAZE_COLOR.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec2 vNdc;
        void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform mat4 uInvProjView; uniform vec3 uColor;
        varying vec2 vNdc;
        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float noise(vec3 x) {
          vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
        void main() {
          // world-space view direction for this pixel, so the haze stays put as you turn
          vec4 far = uInvProjView * vec4(vNdc, 1.0, 1.0);
          vec4 near = uInvProjView * vec4(vNdc, -1.0, 1.0);
          vec3 dir = normalize(far.xyz / far.w - near.xyz / near.w);
          float t = uTime * 0.025;
          float n = fbm(dir * 2.2 + vec3(t, t * 0.6, -t * 0.8));
          float n2 = fbm(dir * 5.0 - vec3(t * 1.3, 0.0, t));
          vec3 col = uColor;
          col += (n - 0.5) * vec3(0.10, 0.09, 0.07);           // slow drifting brightness
          col += smoothstep(0.55, 0.85, n2) * vec3(0.05, 0.04, 0.02); // soft light leaks
          col = mix(col, col * vec3(0.94, 0.96, 1.02), smoothstep(0.2, 0.9, dir.y)); // cooler above
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }`,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100; // first: everything else draws over it
    scene.add(this.mesh);
  }

  update(time) {
    const c = this.camera;
    c.updateMatrixWorld();
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uInvProjView.value.multiplyMatrices(c.matrixWorld, c.projectionMatrixInverse);
  }
}
