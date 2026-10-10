// The handheld camcorder: everything you see is footage from the camera you carry in.
// The scene renders into a target, a little wider than the view, and one fullscreen pass turns
// it into cheap wide-angle video: barrel (fisheye) distortion, colour fringing toward the edges,
// lens vignette, over-sharpening, sensor noise that grows as the auto-gain pushes up in the
// dark, auto-exposure that lags behind the lamp, autofocus that hunts after fast moves, and
// interference when she is close.
import * as THREE from "three";

const K = 0.24; // barrel strength: the centre is magnified 1 / (1 - K)

export class Camcorder {
  constructor(renderer, camera, baseFov) {
    this.renderer = renderer;
    this.camera = camera;
    this.baseFov = baseFov;
    this.on = true;
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, samples: 0 });
    this.target.texture.minFilter = this.target.texture.magFilter = THREE.LinearFilter;
    this.gain = 1; this.gainVel = 0; // auto-exposure, a lagging spring so it over- and undershoots
    this.focus = 0;                 // 0 sharp, 1 hunting (blurred)
    this.focusT = 0;
    this.lastQuat = new THREE.Quaternion();
    this.mat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: {
        tScene: { value: this.target.texture },
        uRes: { value: new THREE.Vector2(1, 1) },
        uAspect: { value: 1 },
        uK: { value: K },
        uTime: { value: 0 },
        uGain: { value: 1 },
        uFocus: { value: 0 },
        uFear: { value: 0 },
        uGlitch: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform vec2 uRes;
        uniform float uAspect, uK, uTime, uGain, uFocus, uFear, uGlitch;
        varying vec2 vUv;
        float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        // output pixel -> source pixel: the centre is magnified, the corners map to the corners
        vec2 lens(vec2 p, float k) {
          float rc2 = 0.25 * (uAspect * uAspect + 1.0);
          float f = (1.0 - k) + k * dot(p, p) / rc2;
          return (p * f) / vec2(uAspect, 1.0) + 0.5;
        }
        vec3 tap(vec2 p, vec2 off) {
          // colour fringing: red and blue land at slightly different radii toward the edges
          return vec3(texture2D(tScene, lens(p, uK * 1.035) + off).r,
                      texture2D(tScene, lens(p, uK) + off).g,
                      texture2D(tScene, lens(p, uK * 0.965) + off).b);
        }
        void main() {
          vec2 uv = vUv;
          float frame = floor(uTime * 24.0);
          // interference: torn scanline bands, more of them the closer she is
          float tear = clamp(uFear * 0.6 + uGlitch, 0.0, 1.0);
          float band = floor(uv.y * 90.0);
          float bh = h(vec2(band, frame));
          if (bh < tear * 0.22) uv.x += (h(vec2(frame, band)) - 0.5) * 0.06 * tear;
          // a slow rolling bar of lost signal
          float roll = fract(uv.y * 0.7 - uTime * 0.35);
          vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);

          // sharpening (camcorders over-sharpen) or blur while the autofocus hunts
          vec2 px = (1.0 + uFocus * 3.0) / uRes;
          vec3 c = tap(p, vec2(0.0));
          vec3 b = (tap(p, vec2(px.x, 0.0)) + tap(p, vec2(-px.x, 0.0)) + tap(p, vec2(0.0, px.y)) + tap(p, vec2(0.0, -px.y))) * 0.25;
          c = max(c + (c - b) * mix(0.55, -1.0, uFocus), 0.0);

          // auto-gain: brightens the dark and lifts the noise floor with it
          float g = uGain;
          c *= g;
          float lum = dot(c, vec3(0.299, 0.587, 0.114));
          // cheap video look: a little desaturated, greenish shadows, warm soft highlights
          c = mix(vec3(lum), c, 0.78);
          c += vec3(-0.004, 0.006, 0.002) * (1.0 - smoothstep(0.0, 0.25, lum));
          c = c / (1.0 + c * 0.18) * 1.12;
          // sensor noise: luminance grain strongest in the darks, a little chroma speckle
          vec2 q = floor(gl_FragCoord.xy);
          float n = h(q + frame * 17.31) - 0.5;
          vec3 cn = vec3(h(q * 1.3 + frame), h(q * 0.7 - frame), h(q + frame * 3.1)) - 0.5;
          float amt = (0.035 + 0.22 * max(0.0, g - 1.04)) * (1.0 - 0.65 * smoothstep(0.0, 0.6, lum));
          c += n * amt + cn * amt * 0.35;
          c += 0.01; // black level: nothing is truly black on tape
          c *= 1.0 - (smoothstep(0.0, 0.04, roll) - smoothstep(0.04, 0.12, roll)) * 0.08 * (0.3 + tear);
          if (bh < tear * 0.06) c = mix(c, vec3(lum + n * 0.4), 0.7); // dropout: colour lost on a band

          // lens vignette: dark, soft corners
          float r = length(p) / sqrt(0.25 * (uAspect * uAspect + 1.0));
          c *= mix(1.0, 0.35, smoothstep(0.62, 1.1, r) * smoothstep(0.62, 1.1, r) * 0.6 + smoothstep(0.85, 1.1, r) * 0.4);
          gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }`,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(geo, this.mat);
    this.quad.frustumCulled = false;
    this.postScene = new THREE.Scene();
    this.postScene.add(this.quad);
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.setOn(true);
  }

  setOn(on) {
    this.on = on;
    document.body.classList.toggle("camcorder", on);
    this.resize();
  }

  // the render field of view: wide enough that, after the barrel squeezes the edges, the centre
  // of the frame shows about what the plain camera would
  resize() {
    const c = this.camera;
    const t = Math.tan(THREE.MathUtils.degToRad(this.baseFov / 2));
    c.fov = this.on ? THREE.MathUtils.radToDeg(2 * Math.atan(t / (1 - K))) : this.baseFov;
    c.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(size.x, size.y);
    this.mat.uniforms.uRes.value.copy(size);
    this.mat.uniforms.uAspect.value = size.x / size.y;
  }

  // light: how much the lamp lights the scene (0..1); fear: how close she is (0..1)
  update(dt, time, { light = 1, fear = 0, glitch = 0 } = {}) {
    // auto-exposure: a damped spring toward more gain in the dark; it lags, so switching the
    // lamp on blows the frame out for a moment, and switching it off drops to black first
    const want = 1.04 + (1 - light) * 0.2;
    this.gainVel += ((want - this.gain) * 6 - this.gainVel * 3.2) * dt;
    this.gain = Math.max(0.6, this.gain + this.gainVel * dt);
    // autofocus hunts after a fast turn, and now and then on its own
    const turn = 1 - Math.abs(this.camera.quaternion.dot(this.lastQuat));
    this.lastQuat.copy(this.camera.quaternion);
    if (turn / Math.max(dt, 1e-3) > 0.04 || Math.random() < dt * 0.025) this.focusT = Math.max(this.focusT, 0.45 + Math.random() * 0.3);
    this.focusT = Math.max(0, this.focusT - dt);
    const hunting = this.focusT > 0 ? 0.35 + 0.25 * Math.sin(this.focusT * 18) : 0;
    this.focus += (hunting - this.focus) * Math.min(1, dt * 10);
    const u = this.mat.uniforms;
    u.uTime.value = time;
    u.uGain.value = this.gain;
    u.uFocus.value = this.focus;
    u.uFear.value = fear;
    u.uGlitch.value = glitch;
  }

  // draw the scene through the camera
  render(scene, camera) {
    if (!this.on) return this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }
}
