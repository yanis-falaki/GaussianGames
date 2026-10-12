// Resident 31: a person who moved during the capture. Made of procedural Gaussians that
// smear along their motion like a photogrammetry floater, stutter in time, and come apart
// when the lamp holds them still for too long.
import * as THREE from "three";
import { SplatMesh, dyno } from "@sparkjsdev/spark";
import { buildFigure } from "./figure.js";

const EU = {
  time: dyno.dynoFloat(0),
  smear: dyno.dynoVec3(new THREE.Vector3()), // local-space trail vector (opposite to motion)
  burn: dyno.dynoFloat(0),
  alpha: dyno.dynoFloat(0),
  twitch: dyno.dynoFloat(0),  // spasm: limbs jolt out of place for a few frames
  reach: dyno.dynoFloat(0),   // 0 arms hanging .. 1 arms raised toward you
  flicker: dyno.dynoFloat(1), // whole-body opacity flicker
  gait: dyno.dynoVec4(new THREE.Vector4()), // phase, stride (thigh swing, rad), crouch (rad), lunge 0..1
  pose: dyno.dynoVec4(new THREE.Vector4()), // lean, hunch (rad), arms trailing 0..1, breath heave (m)
  head: dyno.dynoVec4(new THREE.Vector4()), // yaw, pitch, roll (rad, local), pushed forward 0..1
  shake: dyno.dynoFloat(0.2), // how violently the head shakes (it is only ever a smear)
};

// A skeleton driven entirely in the shader. Bone ids come from figure.js (colour low bits).
// Conventions (local space, she faces -Z): rotX(+a) swings a hanging limb forward,
// rotY(+a) turns her toward -X... i.e. the same sense as `facing`, rotZ(+a) lifts +X.
function makeFigureModifier() {
  return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const fx = new dyno.Dyno({
      inTypes: { gsplat: dyno.Gsplat, t: "float", smear: "vec3", burn: "float", alpha: "float", twitch: "float", reach: "float", flicker: "float", gait: "vec4", pose: "vec4", head: "vec4", shake: "float" },
      outTypes: { gsplat: dyno.Gsplat },
      globals: () => [dyno.defineGsplat, dyno.unindent(/* glsl */ `
        float r31Hash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
        vec3 r31Hash3(vec3 p) {
          p = fract(p * vec3(0.1031, 0.1030, 0.0973));
          p += dot(p, p.yxz + 33.33);
          return fract((p.xxy + p.yxx) * p.zyx);
        }
        vec3 r31RotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
        vec3 r31RotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
        vec3 r31RotZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
        // one leg at phase lp: thigh and shin angles (swing forward +) and the foot's pitch (toes up +).
        // Her left leg is broken: it barely bends, locks backwards under her weight, and its
        // foot hangs so the toes scrape along the floor.
        void r31Leg(float lp, float bad, float amp, float crouch, out float th, out float sh, out float ft) {
          float swingK = max(0.0, cos(lp + 0.25));
          float stance = max(0.0, -cos(lp));
          th = amp * sin(lp) * (1.0 - 0.3 * bad) + crouch;
          float flex = amp * 2.1 * swingK * swingK * (1.0 - 0.8 * bad) - 0.24 * bad * stance * min(1.0, amp * 4.0 + 0.4);
          sh = th - flex - 2.0 * crouch;
          float goodFoot = amp * (1.2 * max(0.0, sin(lp)) * swingK - 0.25 * stance);
          ft = mix(goodFoot, -0.3 - 1.2 * amp * swingK, bad);
        }
      `)],
      statements: ({ inputs: I, outputs: O }) => dyno.unindentLines(/* glsl */ `
        ${O.gsplat} = ${I.gsplat};
        vec3 c0 = ${I.gsplat}.center;   // rest pose
        vec3 c = c0;
        float h = r31Hash(c0 * 97.0);
        float h2 = r31Hash(c0 * 31.0 + 7.0);
        // dithered (de)materialisation; nothing at all survives alpha 0
        if (h >= ${I.alpha} || ${I.alpha} <= 0.0) { ${O.gsplat}.flags = 0u; }
        float T = ${I.t};
        vec3 col0 = ${I.gsplat}.rgba.rgb;
        ivec3 cb = ivec3(col0 * 255.0 + 0.5);
        int bone = (cb.r & 3) | ((cb.g & 3) << 2) | ((cb.b & 3) << 4);
        float side = c0.x < 0.0 ? -1.0 : 1.0;
        float bad = c0.x < 0.0 ? 1.0 : 0.0;
        float ph = ${I.gait}.x, amp = ${I.gait}.y, crouch = ${I.gait}.z, lunge = ${I.gait}.w;
        float lean = ${I.pose}.x, hunch = ${I.pose}.y, trailA = ${I.pose}.z, heave = ${I.pose}.w;
        vec4 hd = ${I.head};
        float reach = ${I.reach};
        const float HIP = 0.95;
        vec3 HIPP = vec3(0.0, HIP, 0.0);
        bool isArm = bone >= 2 && bone <= 4;
        bool isLeg = bone == 5 || bone == 6;
        bool isHead = bone >= 7;
        bool rides = isArm || isHead; // hangs off the shoulders: follows the whole spine
        float spasm = (r31Hash(vec3(floor(T * 13.0), float(bone), side)) - 0.5) * ${I.twitch};

        // --- arms: fingers curl, elbows hang loose, shoulders swing against the stride
        if (isArm) {
          float armPh = ph + (side > 0.0 ? 3.14159 : 0.0);
          vec3 S = vec3(side * 0.19, 1.46, 0.0);
          vec3 E = vec3(side * 0.28, 0.84, 0.035);
          vec3 W = vec3(side * 0.30, 0.55, 0.05);
          if (bone == 4) {
            float fw = smoothstep(0.53, 0.42, c0.y);
            float curl = 0.15 + 0.4 * (0.5 + 0.5 * sin(T * 1.1 + side * 2.0 + c0.y * 9.0)) + reach * 0.7 + spasm * 2.0;
            c = W + r31RotX(c - W, curl * (0.35 + 0.65 * fw));
            c += (r31Hash3(vec3(floor(T * 7.0), side, floor(c0.y * 30.0))) - 0.5) * 0.02 * fw;
          }
          // the elbow hangs loose, and locks the wrong way when she reaches for you
          float ew = bone == 4 ? 1.0 : (bone == 3 ? smoothstep(0.9, 0.8, c0.y) : 0.0);
          float elbow = 0.12 + 0.1 * sin(T * 0.7 + side) + trailA * 0.3 * (0.5 + 0.5 * sin(armPh * 2.0)) - reach * 0.35 + spasm
            + lunge * 0.45 * (0.5 + 0.5 * sin(armPh + side));
          c = E + r31RotX(c - E, elbow * ew);
          float sw = 1.0 - smoothstep(1.38, 1.47, c0.y);
          float swing = -(lean + hunch)                        // hang with gravity when she bends over
            + amp * 1.0 * sin(armPh) * (1.0 - trailA * 0.6)     // counter-swing to the legs
            + sin(T * 0.9 + side * 1.7) * 0.07 * (1.0 - min(1.0, amp * 3.0))
            - trailA * (0.5 + 0.2 * sin(armPh * 2.0 + side))   // dragged behind when she runs
            + reach * (1.4 + 0.08 * sin(T * 1.7 + side))
            + lunge * (0.65 * sin(armPh + side * 0.9) + 0.25 * sin(T * 9.0 + side * 2.0))  // flailing, out of step
            + spasm * 0.8;
          float abd = (0.05 + 0.04 * sin(T * 0.6 + side * 2.0) + trailA * 0.14 + reach * 0.03 + lunge * (0.16 + 0.12 * sin(armPh * 2.0 + side))) * side;
          c = S + r31RotZ(r31RotX(c - S, swing * sw), abd * sw);
        }
        // --- head: turns to find you in snaps, tilts too far, pushed out ahead of the body
        if (isHead) {
          vec3 N = vec3(0.0, 1.6, 0.0);
          float hw = bone == 7 ? smoothstep(1.5, 1.68, c0.y) : 1.0;
          if (bone == 9) hw = 1.0 - 0.45 * clamp((1.93 - c0.y) / 0.45, 0.0, 1.0);
          vec3 q = c - N;
          // long exposure: every head splat shows the shaking head at a slightly different
          // instant, so it smears into ghosted copies; the hair roots go with it a little
          float shk = ${I.shake};
          float sw = bone == 8 ? 1.0 : bone == 9 ? 0.95 - 0.45 * clamp((1.93 - c0.y) / 0.5, 0.0, 1.0) : 0.4 * hw;
          float ts = T - (bone >= 8 ? h * 0.11 : 0.0);
          float sy = sin(ts * 29.0) * 0.6 + sin(ts * 47.0 + 1.3) * 0.4;
          float sr = sin(ts * 23.0 + 2.0) * 0.5 + sin(ts * 41.0) * 0.5;
          float sp = sin(ts * 37.0 + 0.7);
          q = r31RotX(r31RotZ(r31RotY(q, sy * 0.55 * shk * sw), sr * 0.4 * shk * sw), sp * 0.2 * shk * sw);
          q.x += sy * 0.05 * shk * sw;
          if (bone == 8) {
            ${O.gsplat}.scales *= 1.0 + 0.9 * shk;
            ${O.gsplat}.rgba.a *= 0.8 - 0.2 * min(1.0, shk);
          }
          if (bone == 9) ${O.gsplat}.rgba.a *= 1.0 - 0.25 * min(1.0, shk); // ghosted with the shake
          q = r31RotZ(q, (hd.z + spasm * 0.5) * hw);
          q = r31RotX(q, (hd.y + spasm * 0.3) * hw);
          q = r31RotY(q, hd.x * hw);
          c = N + q + vec3(0.0, -0.05, -0.13) * hd.w * (bone == 7 ? hw : 1.0);
        }
        // --- hair: drifts slowly, as if underwater; more at the tips, whipped about when she runs
        if (bone == 9) {
          float tip = clamp((1.93 - c0.y) / 0.45, 0.0, 1.0);
          c += vec3(sin(T * 0.7 + c0.y * 7.0 + h * 5.0), 0.3 * sin(T * 0.5 + h * 9.0), cos(T * 0.6 + c0.y * 5.0 + h * 4.0)) * 0.035 * tip * (1.0 + lunge + ${I.shake} * 0.6);
        }
        // --- breathing: the ribs swell and the shoulders heave (arms and head ride along)
        float chest = smoothstep(1.05, 1.35, c0.y) * (1.0 - smoothstep(1.45, 1.55, c0.y));
        if (bone == 0) c.xz += normalize(c0.xz + 1e-4) * heave * 0.6 * chest;
        c.y += heave * (rides ? 1.0 : smoothstep(1.25, 1.5, c0.y));
        // --- gown: the hem ripples like cloth, and the skirt is carried by the thighs beneath it
        if (bone == 0 && c0.y < 1.15) {
          float hem = (1.15 - c0.y) / 0.75;
          vec2 rd = normalize(c0.xz + 1e-4);
          float ang = atan(c0.z, c0.x);
          c.xz += rd * sin(ang * 5.0 + T * 1.3 + c0.y * 4.0) * 0.025 * hem;
          c.x += sin(T * 0.55) * 0.035 * hem * hem;
        }
        if (bone == 0 && c0.y < HIP + 0.05) {
          float thR, shR, ftR, thL, shL, ftL;
          r31Leg(ph - 0.35, 0.0, amp, crouch, thR, shR, ftR);            // the cloth lags a little
          r31Leg(ph + 3.14159 - 0.35, 1.0, amp, crouch, thL, shL, ftL);
          vec3 HR = vec3(0.08, HIP, 0.0), HL = vec3(-0.08, HIP, 0.0);
          vec3 pR = HR + r31RotX(c - HR, thR), pL = HL + r31RotX(c - HL, thL);
          float f = 0.8 * smoothstep(HIP + 0.05, 0.55, c0.y);
          c = mix(c, mix(pL, pR, smoothstep(-0.09, 0.09, c0.x)), f);
        }
        // --- legs: hip -> knee -> ankle -> foot
        if (isLeg) {
          float th, sh, ft;
          r31Leg(ph + bad * 3.14159, bad, amp, crouch, th, sh, ft);
          vec3 H = vec3(side * 0.08, HIP, 0.0), K = vec3(side * 0.08, 0.5, 0.0), An = vec3(side * 0.08, 0.04, 0.0);
          vec3 K2 = H + r31RotX(K - H, th);
          if (bone == 5) c = K2 + r31RotX(c - K, sh);
          else c = K2 + r31RotX(An - K, sh) + r31RotX(c - An, ft);
        }
        // --- pelvis and spine: weight lurches onto the broken leg, the hips swing and the
        // shoulders counter-twist, she bends over at the waist and hunches at the chest
        float gaitK = min(1.0, amp * 4.0);
        float badStance = max(0.0, cos(ph));
        float roll = (0.08 * badStance - 0.03 * max(0.0, -cos(ph))) * (0.4 + 0.6 * gaitK);
        float hipYaw = 0.45 * amp * sin(ph);
        if (!isLeg) {
          float shW = rides ? 1.0 : smoothstep(HIP, 1.45, c0.y);
          float lowW = rides ? 1.0 : smoothstep(0.5, HIP, c0.y);
          c = r31RotY(c, -hipYaw * 1.7 * shW);
          c = HIPP + r31RotZ(c - HIPP, roll * (1.0 - 1.7 * shW) * lowW);
          float w1 = rides ? 1.0 : smoothstep(HIP - 0.15, HIP + 0.25, c0.y);
          c = HIPP + r31RotX(c - HIPP, -lean * w1);
          vec3 P2 = HIPP + r31RotX(vec3(0.0, 1.2 - HIP, 0.0), -lean);
          float w2 = rides ? 1.0 : smoothstep(1.12, 1.42, c0.y);
          c = P2 + r31RotX(c - P2, -hunch * w2);
        }
        float drop = 0.91 * (1.0 - cos(amp * abs(sin(ph)))) + 0.91 * (1.0 - cos(crouch)) + 0.03 * badStance * (0.4 + 0.6 * gaitK);
        float sway = (-0.03 * cos(ph) - 0.02 * badStance) * (0.6 + gaitK);
        c = r31RotY(c, hipYaw);
        c += vec3(sway, -drop, 0.0);
        if (isLeg) c.y = max(c.y, 0.004); // the dragged toes scrape the floor, never sink into it
        // motion smear: a quarter of the splats lag behind like a long exposure
        float lag = step(h2, 0.25) * h;
        c += ${I.smear} * lag * 1.2;
        ${O.gsplat}.rgba.a *= 1.0 - lag * 0.7;
        // burned by the lamp: it bleaches like overexposed film, then burns away from the head
        // down in a clean sweep, the pieces drifting up and shrinking. The sweep runs on the
        // rest-pose height so no pose (crouched, lunging, limbs below the floor) escapes it,
        // and the last stretch of the burn is fully transparent before she is removed.
        float b = ${I.burn};
        float bleach = smoothstep(0.0, 0.35, b);
        ${O.gsplat}.rgba.rgb = mix(col0, vec3(0.96, 0.95, 0.92), bleach * 0.9);
        float front = b * 1.5 - (1.0 - clamp(c0.y, 0.0, 2.0) / 2.0) - 0.15 + (h - 0.5) * 0.08;
        float gone = max(clamp(front * 5.0, 0.0, 1.0), smoothstep(0.86, 0.97, b));
        vec3 drift = normalize(r31Hash3(c0 * 61.0) - 0.5);
        c += vec3(0.0, gone * gone * 0.5, 0.0) + drift * gone * 0.12;
        ${O.gsplat}.scales *= 1.0 - 0.8 * gone;
        ${O.gsplat}.rgba.a *= 1.0 - gone;
        if (gone >= 1.0) { ${O.gsplat}.flags = 0u; }
        // translucent and never quite stable: a slow shimmer through the body, the odd flicker
        ${O.gsplat}.rgba.a *= (0.72 + 0.2 * sin(T * 2.1 + h * 25.0 + c0.y * 3.0)) * ${I.flicker};
        ${O.gsplat}.center = c;
      `),
    });
    return {
      gsplat: fx.apply({ gsplat, t: EU.time, smear: EU.smear, burn: EU.burn, alpha: EU.alpha, twitch: EU.twitch, reach: EU.reach, flicker: EU.flicker, gait: EU.gait, pose: EU.pose, head: EU.head, shake: EU.shake }).gsplat,
    };
  });
}

const STATE = { DORMANT: 0, GONE: 1, STALK: 2, HUNT: 3, GLIMPSE: 4, SCARE: 5 };

export class Entity {
  constructor(scene, world) {
    this.world = world;
    const pts = buildFigure(16000);
    this.mesh = new SplatMesh({
      constructSplats: (splats) => {
        for (const p of pts) splats.pushSplat(p.center, p.scales, p.quaternion, p.opacity, p.color);
      },
      objectModifier: makeFigureModifier(),
    });
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.pos = new THREE.Vector3(0, -100, 0);
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.state = STATE.DORMANT;
    this.active = false;
    this.alpha = 0;
    this.burn = 0;
    this.timer = 0;
    this.aggression = 0;
    this.path = null;
    this.pathT = 0;
    this.lastKnown = null;
    this.watched = 0;
    this.time = 0;
    this.smear = new THREE.Vector3();
    this._chest = new THREE.Vector3();
    this._tEye = new THREE.Vector3();
    this.shownPos = new THREE.Vector3(0, -100, 0);
    this.frameT = 0;
    this.wasVisible = false;
    // animation state (see animate())
    this.gPh = 0; this.gAmp = 0; this.gCrouch = 0; this.gLunge = 0;
    this.pLean = 0; this.pHunch = 0; this.pTrail = 0; this.heave = 0; this.reach = 0;
    this.hYaw = 0; this.hPitch = 0; this.hRoll = 0; this.hPush = 0;
    this.spasmT = 0; this.spasmAmt = 0; this.lungeT = 0; this.lungeCd = 0; this.pauseT = 0;
  }

  chest() {
    return this._chest.set(this.pos.x, this.pos.y + 1.3, this.pos.z);
  }

  reset() {
    this.chargePh = 0; this.chargeCd = 25;
    this.alpha = 0;
    this.burn = 0;
    this.path = null;
    if (this.active) this.goGone(6);
  }

  awaken() {
    this.active = true;
    this.chargeCd = 25;
    this.goGone(4);
  }

  // an early, harmless sighting: it stands somewhere you can see it, then isn't there
  glimpse(player, eye, camDir) {
    const w = this.world;
    const dist = w.flood(w.nearestNode(player));
    const cands = [];
    for (let i = 0; i < dist.length; i++) if (dist[i] >= 30 && dist[i] <= 90) cands.push(i);
    for (let k = 0; k < 300 && cands.length; k++) {
      const n = w.nav[cands[(Math.random() * cands.length) | 0]];
      const p = new THREE.Vector3(n.x, n.y + 1.3, n.z);
      const d = p.clone().sub(eye);
      const len = d.length();
      if (len < 6 || len > 15 || d.divideScalar(len).dot(camDir) < 0.55) continue;
      if (!w.lineOfSight(eye, p)) continue;
      this.pos.set(n.x, n.y, n.z); this.shownPos.copy(this.pos);
      this.active = true;
      this.state = STATE.GLIMPSE;
      this.timer = 9;
      this.alpha = 0;
      this.vel.set(0, 0, 0);
      return true;
    }
    return false;
  }

  // caught: it is suddenly right in front of you, face to face
  scare(eye, yaw) {
    this.active = true;
    this.state = STATE.SCARE;
    this.timer = 0.75;
    this.alpha = 1;
    this.burn = 0;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.pos.set(eye.x + fwd.x * 0.62, eye.y - 1.78, eye.z + fwd.z * 0.62);
    this.shownPos.copy(this.pos);
    this.facing = Math.atan2(fwd.x, fwd.z);
    this.vel.set(0, 0, 0);
  }

  goGone(t) {
    this.state = STATE.GONE;
    this.timer = t;
    this.chargePh = 0;
  }

  // --- the charge: at random she decides to strike and runs at you flat out from across the
  // room. A split-second wind-up (head snaps to you, she drops, a sharp intake of breath), the
  // run (5-6 m/s, faster than you can sprint), then she stumbles to a stop. The lamp stops it.
  startCharge(sawYou) {
    this.chargePh = 1;
    this.chargeT = 0.12 + Math.random() * 0.1; // barely a beat: too quick to catch in the beam
    this.chargeSaw = sawYou;
    this.chargeLost = 0;
    this.vel.set(0, 0, 0);
    this.lungeT = 0; this.pauseT = 0;
    this.stepped = true; this.stepKind = 4; // the intake of breath before she runs
    this.headHold = 0;
  }

  endCharge(recoil) {
    this.chargePh = 3;
    this.chargeRecoil = recoil;
    this.chargeT = recoil ? 0.9 : 0.7 + Math.random() * 0.4;
    this.recoverV = recoil ? 0 : Math.max(2.5, this.spd ?? 0);
    this.chargeCd = 15 + Math.random() * 15;
    if (recoil) { this.spasmT = 0.45; this.spasmAmt = 1.3; this.rollT = 0; }
  }

  charge(dt, c, dist, sees, lit, out) {
    this.alpha = Math.min(1, this.alpha + dt);
    this.chargeT -= dt;
    if (this.chargePh === 1) {
      this.vel.set(0, 0, 0);
      if (lit) this.endCharge(true);
      else if (this.chargeT <= 0) { this.chargePh = 2; this.chargeT = Math.min(10, dist / 3.5 + 3); this.path = null; }
    } else if (this.chargePh === 2) {
      if (lit) { this.vel.set(0, 0, 0); this.endCharge(true); }
      else {
        if (sees) { this.chargeSaw = true; this.chargeLost = 0; } else this.chargeLost += dt;
        this.moveToward(c.player, 5.3 + this.aggression * 0.7, dt);
        (this.lastKnown ||= new THREE.Vector3()).copy(c.player); this.trackT = 4;
        // out of breath, or you broke her line of sight and she lost you round a corner
        if (this.chargeT <= 0 || (this.chargeSaw && this.chargeLost > 1.3)) this.endCharge(false);
      }
    } else {
      // stumbling to a stop (or recoiling from the light), then back to the hunt, or gone
      this.recoverV = Math.max(0, (this.recoverV ?? 0) - dt * 7);
      if (!lit && this.recoverV > 0.3) this.moveToward(c.player, this.recoverV, dt);
      else this.vel.set(0, 0, 0);
      if (this.chargeT <= 0) {
        this.chargePh = 0;
        if (!this.chargeRecoil && !sees && Math.random() < 0.35) this.goGone(4 + Math.random() * 5);
        else { this.state = STATE.HUNT; this.timer = Math.max(this.timer, 10); this.searchT = 0; this.staggerT = 0.4; }
      }
    }
    if (dist < 0.85 && !c.paused) { out.caught = true; this.goGone(10); this.alpha = 0; }
  }

  // pick a nav node some walking distance away that the player can't currently see
  relocate(player, eye, minHops, maxHops) {
    const w = this.world;
    const dist = w.flood(w.nearestNode(player));
    const cands = [];
    for (let i = 0; i < dist.length; i++) if (dist[i] >= minHops && dist[i] <= maxHops) cands.push(i);
    for (let k = 0; k < 40 && cands.length; k++) {
      const n = w.nav[cands[(Math.random() * cands.length) | 0]];
      const p = new THREE.Vector3(n.x, n.y + 1.3, n.z);
      if (!w.lineOfSight(eye, p)) {
        this.pos.set(n.x, n.y, n.z); this.shownPos.copy(this.pos);
        return true;
      }
    }
    if (cands.length) {
      const n = w.nav[cands[(Math.random() * cands.length) | 0]];
      this.pos.set(n.x, n.y, n.z); this.shownPos.copy(this.pos);
      return true;
    }
    return false;
  }

  // Plan a route: clearance-aware A* over the nav graph, string-pulled into straight legs.
  // Replanned often and whenever the target moves, so she follows you round corners.
  plan(target) {
    const w = this.world;
    const raw = w.navAstar(w.nearestNode(this.pos), w.nearestNode(target));
    this.path = raw ? w.navSmooth(raw) : null;
    this.pathIdx = 1;
    this.pathT = 0.45 + Math.random() * 0.25;
    (this.planTarget ||= new THREE.Vector3()).copy(target);
    this.noPath = raw ? 0 : (this.noPath ?? 0) + 1;
    // start from where she actually is: skip waypoints she can already walk past
    const P = this.path;
    while (P && this.pathIdx < P.length - 1 && this.pathIdx < 4 && w.navWalkable(this.pos, P[this.pathIdx + 1], 0)) this.pathIdx++;
  }

  moveToward(target, speed, dt) {
    const w = this.world;
    this.pathT -= dt;
    const retarget = !this.planTarget || Math.hypot(target.x - this.planTarget.x, target.z - this.planTarget.z) > 0.8 || Math.abs(target.y - this.planTarget.y) > 1;
    if (!this.path || this.pathT <= 0 || retarget || this.pathIdx >= this.path.length) this.plan(target);
    const prev = this.pos.clone();
    const td = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
    // last few metres: straight at the target, but only if the floor between is walkable
    // (a sightline at chest height would take her through tables and over banisters)
    this.directT = (this.directT ?? 0) - dt;
    if (this.directT <= 0) {
      this.direct = td < 4 && Math.abs(target.y - this.pos.y) < 0.5 && w.navWalkable(this.pos, target, 0);
      // the route ends short of you (you're pressed against furniture or a wall, off the nav
      // grid): the last stretch she just reaches across, if nothing solid is in between
      if (!this.direct && td < 2.2 && Math.abs(target.y - this.pos.y) < 0.6 && (!this.path || this.pathIdx >= this.path.length - 1)) {
        this.direct = w.lineOfSight(this._tEye.set(this.pos.x, this.pos.y + 1.0, this.pos.z), new THREE.Vector3(target.x, target.y + 1.0, target.z));
      }
      this.directT = 0.2;
    }
    let budget = speed * dt;
    const step = (gx, gy, gz) => {
      const dx = gx - this.pos.x, dz = gz - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 1e-4) return 0;
      const s = Math.min(d, budget);
      this.pos.x += (dx / d) * s; this.pos.z += (dz / d) * s;
      this.pos.y += (gy - this.pos.y) * (s / d);   // climb with the ground along the leg (stairs)
      budget -= s;
      return d - s;
    };
    if (this.direct) step(target.x, target.y, target.z);
    else if (this.path) {
      for (let k = 0; k < 4 && budget > 1e-5 && this.pathIdx < this.path.length; k++) {
        const n = this.path[this.pathIdx];
        if (step(n.x, n.y, n.z) < 0.12) this.pathIdx++;
      }
    }
    // keep the feet on the scanned floor
    const gy = w.groundNear(this.pos.x, this.pos.z, this.pos.y, 0.35, 0.45);
    if (gy !== null) this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 10);
    this.vel.subVectors(this.pos, prev).divideScalar(Math.max(dt, 1e-4));
    // stuck: barely moving although she means to. Replan; if it keeps happening, or there is
    // no route at all, give up (the state machine makes her vanish and come back elsewhere)
    const want = speed * dt;
    if (want > 1e-4 && prev.distanceTo(this.pos) < want * 0.3) this.stuckT = (this.stuckT ?? 0) + dt;
    else this.stuckT = Math.max(0, (this.stuckT ?? 0) - dt * 0.5);
    if (this.stuckT > 0.7 && this.pathT > 0.1) { this.pathT = 0; this.path = null; }
    if (this.stuckT > 2.5 || this.noPath > 2) { this.navFail = true; this.stuckT = 0; this.noPath = 0; }
  }

  // somewhere to look: a reachable spot a few metres around `center`, not right where she stands
  pickSearch(center) {
    const w = this.world;
    let best = null;
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 4.5;
      const j = w.nearestNode(this._tEye.set(center.x + Math.cos(a) * r, center.y, center.z + Math.sin(a) * r));
      if (j < 0) continue;
      const n = w.nav[j];
      if (Math.abs(n.y - center.y) > 1.5 || Math.hypot(n.x - this.pos.x, n.z - this.pos.z) < 2) continue;
      best = new THREE.Vector3(n.x, n.y, n.z);
      break;
    }
    return best;
  }

  // jump ahead along the way to `target`, as if frames went missing while you weren't looking
  skipToward(target, metres) {
    const stuck = this.stuckT;
    for (let i = 0; i < 6 && metres > 0; i++) {
      const before = this.pos.clone();
      this.moveToward(target, metres / 0.1, 0.1);
      const moved = before.distanceTo(this.pos);
      if (moved < 1e-3) break;
      metres -= moved;
    }
    this.stuckT = stuck;
    this.vel.set(0, 0, 0);
  }

  update(dt, c) {
    this.time += dt;
    const out = { caught: false, dread: 0, volume: 0, power: 0 };
    if (!this.active) {
      if (this.mesh.visible) { this.mesh.visible = false; this.mesh.updateVersion(); }
      return out;
    }

    const toP = new THREE.Vector3().subVectors(c.player, this.pos);
    const dist = Math.hypot(toP.x, toP.z) + Math.abs(toP.y) * 0.5;
    const sees = dist < 22 && this.world.lineOfSight(this.chest(), c.eye);
    // is it near the centre of the player's view?
    const toE = this.chest().clone().sub(c.eye).normalize();
    const onScreen = sees && c.camDir && toE.dot(c.camDir) > 0.85;
    const lit = c.lit && this.alpha > 0.3;
    const lampOff = this.lampWas && !c.lampOn; // the lamp just went out (or ran down)
    this.lampWas = c.lampOn;
    const unlit = this.litWas && !lit;         // the beam just left her
    this.litWas = lit;
    if (c.paused) { this.vel.set(0, 0, 0); }
    const wasLunging = this.lungeT > 0;
    this.lungeT = Math.max(0, (this.lungeT ?? 0) - dt);
    if (wasLunging && !this.lungeT) this.staggerT = 0.35 + Math.random() * 0.35; // a stagger after each lunge
    this.staggerT = Math.max(0, (this.staggerT ?? 0) - dt);
    this.lungeCd = Math.max(0, (this.lungeCd ?? 0) - dt);
    this.pauseT = Math.max(0, (this.pauseT ?? 0) - dt);
    this.chargeCd = Math.max(0, (this.chargeCd ?? 25) - dt);
    // the urge to strike: rare, random, likelier as the plates are taken; mostly when she can
    // see you across a room, sometimes from out of sight (you hear her coming first)
    if (!this.chargePh && (this.state === STATE.STALK || this.state === STATE.HUNT) && !lit && !c.paused &&
        this.alpha > 0.8 && this.chargeCd <= 0 && dist > 9 && dist < 26) {
      const rate = (0.006 + 0.03 * this.aggression) * (sees ? 1 : 0.35);
      if (this.forceCharge || Math.random() < dt * rate) { this.forceCharge = false; this.startCharge(sees); }
    }

    if (this.chargePh) this.charge(dt, c, dist, sees, lit, out);
    else switch (this.state) {
      case STATE.GONE:
        this.alpha = Math.max(0, this.alpha - dt * 1.5);
        this.timer -= dt;
        if (this.timer <= 0 && !c.paused) {
          const minH = Math.round(55 - this.aggression * 20), maxH = Math.round(95 - this.aggression * 25);
          if (this.relocate(c.player, c.eye, minH, maxH)) {
            this.state = Math.random() < 0.35 + this.aggression * 0.5 ? STATE.HUNT : STATE.STALK;
            this.timer = 14 + Math.random() * 14;
            this.path = null;
            this.burn = 0;
            this.lungeT = 0;
            // a fresh hunt starts out prowling toward where you are
            this.lastKnown = null; this.trackT = 0; this.searchGoal = null; this.searchT = this.timer;
            this.stuckT = 0; this.noPath = 0; this.navFail = false;
          } else this.timer = 2;
        }
        break;

      case STATE.GLIMPSE:
        this.timer -= dt;
        this.vel.set(0, 0, 0);
        if (onScreen && this.alpha > 0.5) this.watched += lit ? dt * 3 : dt;
        if (this.watched > 1.6 || this.timer <= 0) {
          this.alpha = Math.max(0, this.alpha - dt * 3);
          if (this.alpha <= 0) { this.active = false; this.watched = 0; this.state = STATE.DORMANT; }
        } else this.alpha = Math.min(1, this.alpha + dt * 0.8);
        break;

      case STATE.STALK: {
        this.alpha = Math.min(1, this.alpha + dt * 0.6);
        this.timer -= dt;
        // creep closer with small, deliberate steps; keep some distance; freeze mid-step while watched
        if (onScreen && c.lampOn) {
          this.watched += dt;
          this.vel.set(0, 0, 0);
          if (this.watched > 2.8) { this.watched = 0; this.goGone(6 + Math.random() * 8); }
        } else if (dist > 6 - this.aggression * 3) {
          this.watched = Math.max(0, this.watched - dt);
          // when the lamp goes out she is suddenly a little closer
          if (lampOff && dist > 7) this.skipToward(c.player, 1.2 + Math.random());
          else this.moveToward(c.player, 0.95 + this.aggression * 0.35, dt);
        } else { this.watched = Math.max(0, this.watched - dt); this.vel.set(0, 0, 0); }
        if (this.timer <= 0) { this.state = STATE.HUNT; this.timer = 25; this.path = null; (this.lastKnown ||= new THREE.Vector3()).copy(c.player); this.trackT = 4; }
        break;
      }

      case STATE.SCARE:
        this.timer -= dt;
        if (this.timer <= 0) { this.goGone(10); this.alpha = 0; }
        break;

      case STATE.HUNT: {
        this.alpha = Math.min(1, this.alpha + dt * 0.9);
        this.timer -= dt;
        // she finds you by sight, by being close, or by what she hears; the lamp doesn't draw her
        // (it's what burns her)
        const aware = (sees && dist < 14) || dist < 4 || c.noise * 12 > dist;
        if (aware) { (this.lastKnown ||= new THREE.Vector3()).copy(c.player); this.trackT = 4; }
        else if (this.lastKnown && this.trackT > 0) { this.trackT -= dt; this.lastKnown.copy(c.player); } // she keeps your trail for a few seconds after losing you
        if (lit) {
          this.vel.set(0, 0, 0); // light holds it still, frozen mid-stride
        } else if (this.lastKnown) {
          // the moment the beam slips off her, or the lamp dies, she comes at you
          // (going dark only provokes her when she is already close and watching you)
          if ((unlit || (lampOff && sees && dist < 6)) && dist < 11 && dist > 1.5) { this.lungeT = 0.7 + Math.random() * 0.3; this.lungeCd = 2.5; }
          if (lampOff && !sees && dist > 5 && dist < 10) this.skipToward(this.lastKnown, 0.6 + Math.random() * 0.8);
          // close and in sight: sudden lunges, faster than you can run, then a stagger
          if (!this.lungeT && !this.lungeCd && sees && dist > 2 && dist < 8.5 && Math.random() < dt * 1.3) {
            this.lungeT = 0.5 + Math.random() * 0.35;
            this.lungeCd = 2.4 + Math.random() * 2.2 - this.aggression * 0.8;
          }
          // far off and only hearing you: she prowls, stopping dead now and then to listen
          if (!aware && !sees && !this.pauseT && dist > 7 && Math.random() < dt * 0.25) this.pauseT = 0.4 + Math.random() * 0.7;
          let speed = 2.0 + this.aggression * 0.9 + (dist < 5 ? 0.3 : 0);
          if (this.lungeT > 0) speed = 4.4 + this.aggression * 0.5;
          else if (this.staggerT > 0) speed *= 0.5;
          if (this.pauseT > 0) this.vel.set(0, 0, 0);
          else this.moveToward(this.lastKnown, speed, dt);
          if (!aware && this.trackT <= 0 && this.pos.distanceTo(this.lastKnown) < 0.8) {
            this.lastKnown = null; this.searchT = 7 + Math.random() * 5; this.searchGoal = null;
          }
        } else if (this.searchT > 0) {
          // lost you: she casts about near where you must be, stopping to listen; then gives up
          this.searchT -= dt;
          if (!this.searchGoal || Math.hypot(this.pos.x - this.searchGoal.x, this.pos.z - this.searchGoal.z) < 0.7) {
            this.searchGoal = this.pickSearch(c.player);
            this.pauseT = 0.3 + Math.random() * 0.9;
          }
          if (this.pauseT > 0 || !this.searchGoal) this.vel.set(0, 0, 0);
          else this.moveToward(this.searchGoal, 1.5 + this.aggression * 0.5, dt);
          if (this.searchT <= 0 && !sees) this.goGone(5 + Math.random() * 6);
        } else {
          this.vel.set(0, 0, 0);
          if (!sees) this.goGone(5 + Math.random() * 6);
        }
        if (this.timer <= 0 && !sees) this.goGone(8 + Math.random() * 10);
        if (dist < 0.85 && !c.paused) {
          out.caught = true;
          this.goGone(10);
          this.alpha = 0;
        }
        break;
      }
    }
    if (this.state !== STATE.HUNT) this.lungeT = 0;
    // nowhere to go (no route, or wedged): she doesn't press against the wall, she just isn't there
    if (this.navFail) {
      this.navFail = false;
      if (this.state === STATE.HUNT || this.state === STATE.STALK) this.goGone(3 + Math.random() * 4);
    }

    // the lamp burns it: hold the light on it long enough and it comes apart
    if (lit && this.state !== STATE.GONE && this.state !== STATE.GLIMPSE && this.state !== STATE.SCARE && !this.noBurn) {
      this.burn = Math.min(1, this.burn + dt / 1.6);
      if (this.burn >= 1) { this.goGone(7 + Math.random() * 8 - this.aggression * 4); this.alpha = 0; this.burn = 0; }
    } else this.burn = Math.max(0, this.burn - dt * 0.5);

    this.animate(dt, c, toP, dist, lit);

    this.mesh.visible = this.alpha > 0.01 || this.debugGhost;
    // stop-motion: it doesn't glide, it is suddenly somewhere else, like missing frames. The
    // pose is held with the position, so each frame is a coherent snapshot of her stride; now
    // and then frames drop out and she jumps further. Breathing, hair and fingers stay smooth.
    const moving = this.vel.lengthSq() > 0.01;
    this.frameT -= dt;
    let frame = false;
    if (!moving || this.state === STATE.SCARE) { this.shownPos.lerp(this.pos, Math.min(1, dt * 20)); this.frameT = 0; frame = true; }
    else if (this.frameT <= 0) {
      this.shownPos.copy(this.pos);
      frame = true;
      const lunging = this.lungeT > 0, running = this.chargePh === 2;
      this.frameT = running ? (Math.random() < 0.14 ? 0.16 + Math.random() * 0.12 : 0.05 + Math.random() * 0.04)
        : Math.random() < (lunging ? 0.3 : 0.1) ? 0.2 + Math.random() * 0.18
        : lunging ? 0.08 + Math.random() * 0.08 : 0.05 + Math.random() * 0.07;
    }
    if (frame) {
      EU.gait.value.set(this.gPh, this.gAmp, this.gCrouch, this.gLunge);
      // footfalls when the shown stride passes a heel strike: right foot lands at ph = pi/2,
      // the broken left foot is dragged forward from there and lands at 3pi/2
      const k = Math.floor((this.gPh - Math.PI / 2) / Math.PI);
      if (this.stepK !== undefined && k !== this.stepK && this.gAmp > 0.06 && moving) {
        this.stepped = true;
        // 0 right foot thud, 1 the dragged foot; 2/3 the same flat out: loud bare-foot slaps
        this.stepKind = ((k % 2) + 2) % 2 + (this.chargePh === 2 || this.spd > 3.4 ? 2 : 0);
      }
      this.stepK = k;
    }
    this.mesh.position.copy(this.shownPos);
    this.mesh.rotation.set(0, this.facing, 0);
    const local = this.smear.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.facing);
    EU.smear.value.copy(local);
    EU.time.value = this.time;
    EU.burn.value = this.burn;
    EU.alpha.value = this.debugGhost ? 1 : this.alpha;
    EU.reach.value = this.reach;
    EU.pose.value.set(this.pLean, this.pHunch, this.pTrail, this.heave);
    EU.head.value.set(this.hYaw, this.hPitch, this.hRoll, this.hPush);
    EU.shake.value = this.shake ?? 0.2;
    EU.twitch.value = this.spasmT > 0 ? this.spasmAmt : 0;
    // now and then it almost isn't there
    this.flickT = (this.flickT ?? 2) - dt;
    if (this.flickT < 0) { this.flickOn = 0.12 + Math.random() * 0.2; this.flickT = 2 + Math.random() * 5; }
    if (this.flickOn > 0) { this.flickOn -= dt; EU.flicker.value = 0.25 + Math.random() * 0.3; } else EU.flicker.value = 1;
    // only force a regeneration while the figure is (or just stopped being) visible
    if (this.mesh.visible || this.wasVisible) this.mesh.updateVersion();
    this.wasVisible = this.mesh.visible;

    const near = 1 - THREE.MathUtils.smoothstep(dist, 2.5, 16);
    const hunting = this.state === STATE.HUNT ? 1 : 0.55;
    out.dread = this.state === STATE.GONE ? 0 : near * hunting * this.alpha;
    out.volume = this.state === STATE.GONE ? 0 : this.alpha * (0.5 + 0.5 * hunting) * (1 - THREE.MathUtils.smoothstep(dist, 5, 10));
    out.power = this.alpha * (0.55 + 0.45 * hunting) + this.burn * 0.5 + (this.lungeT > 0 ? 0.25 : 0);
    if (this.chargePh && this.state !== STATE.GONE) {
      // a charge: the camera panics and her breath carries across the room
      const ch = this.chargePh === 2 ? 1 : this.chargePh === 1 ? 0.8 : 0.6;
      out.dread = Math.max(out.dread, this.alpha * ch);
      out.power += 0.6 * ch;
      out.volume = Math.max(out.volume, this.alpha * ch * (1 - THREE.MathUtils.smoothstep(dist, 14, 30)));
    }
    out.charging = this.chargePh === 2;
    out.state = this.state;
    out.stepped = this.stepped && this.alpha > 0.3; this.stepped = false;
    out.stepKind = this.stepKind ?? 0;
    out.lunging = this.lungeT > 0;
    out.dist = dist;
    return out;
  }

  // body language: gait, posture, head and hands, all eased toward per-state targets
  animate(dt, c, toP, dist, lit) {
    const ease = (cur, tgt, k) => cur + (tgt - cur) * Math.min(1, dt * k);
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const st = this.forceState ?? this.state;
    const hunt = st === STATE.HUNT, stalk = st === STATE.STALK, scare = st === STATE.SCARE;
    const frozen = lit && (hunt || stalk); // held by the beam: everything stops but her head
    const spd = Math.hypot(this.vel.x, this.vel.z);
    this.spd = ease(this.spd ?? 0, spd, 10);
    const lunging = this.lungeT > 0;
    const windup = this.chargePh === 1, running = this.chargePh === 2, recov = this.chargePh === 3;

    // --- gait: cadence follows real speed, so the feet roughly stay put on the floor. Stalking
    // she takes small quick steps, almost a glide; hunting, long scrambling strides.
    if (!frozen) {
      const v = this.spd;
      const cycle = stalk && !this.chargePh ? THREE.MathUtils.clamp(0.25 + 0.4 * v, 0.4, 0.9) : THREE.MathUtils.clamp(0.4 + 0.45 * v, 0.6, running ? 2.7 : 2.3);
      const ampT = v > 0.08 ? Math.asin(Math.min(0.8, cycle / (4 * 0.91))) : 0;
      this.gAmp = ease(this.gAmp ?? 0, ampT, v > 0.08 ? 8 : 3);
      // idle: the phase creeps on slowly, so her weight rolls from foot to foot
      this.gPh = (this.gPh ?? 0) + (v > 0.08 ? (2 * Math.PI * v) / cycle : 0.9) * dt;
      if (this.gPh > 1e4) this.gPh -= 2 * Math.PI * 1000;
    }
    // --- posture
    let lean = 0.03, hunch = 0.1, crouch = 0.02, trail = 0, push = 0.15, breathAmp = 0.005, breathRate = 0.35;
    if (stalk) { lean = 0.06; hunch = 0.16; crouch = 0.05; push = 0.35; breathAmp = 0.006; }
    if (hunt) {
      const run = THREE.MathUtils.clamp(this.spd / 3, 0, 1);
      lean = 0.22 + 0.25 * run + (lunging ? 0.18 : 0);
      hunch = 0.32 + (lunging ? 0.1 : 0);
      crouch = 0.12 + 0.12 * run + (lunging ? 0.08 : 0);
      trail = lunging ? 0.2 : 0.75 * run;
      push = 1;
      breathAmp = lunging || this.staggerT > 0 || this.lungeCd > 1.5 ? 0.022 : 0.013;
      breathRate = 1.0 + 0.5 * run;
    }
    if (scare) { lean = 0.05; hunch = 0.12; crouch = 0; trail = 0; push = 0.15; breathAmp = 0; }
    // the charge: sinks down coiled with the arms drawn back, then runs bent low, flat out,
    // arms flailing; afterwards hangs there panting
    if (windup) { lean = 0.22; hunch = 0.34; crouch = 0.42; trail = 1; push = 1; breathAmp = 0.03; breathRate = 2.6; }
    if (running) { lean = 0.62; hunch = 0.26; crouch = 0.2; trail = 0.5; push = 1; breathAmp = 0.022; breathRate = 3.2; }
    if (recov) { lean = 0.12; hunch = 0.4; crouch = 0.16; trail = 0.25; push = 0.8; breathAmp = 0.032; breathRate = 2.2; }
    if (!frozen) {
      const k = windup ? 22 : this.chargePh ? 10 : hunt ? 6 : 2.5;
      this.pLean = ease(this.pLean ?? 0, lean, k);
      this.pHunch = ease(this.pHunch ?? 0, hunch, k);
      this.gCrouch = ease(this.gCrouch ?? 0, crouch, k);
      this.pTrail = ease(this.pTrail ?? 0, trail, 4);
      this.gLunge = ease(this.gLunge ?? 0, lunging || running ? 1 : 0, 8);
      this.breathPh = (this.breathPh ?? 0) + dt * 2 * Math.PI * breathRate;
      this.breathA = ease(this.breathA ?? 0, breathAmp, 2);
    }
    // a held breath while the light is on her
    this.heave = frozen ? ease(this.heave ?? 0, 0.004, 4) : this.breathA * (0.5 - 0.5 * Math.cos(this.breathPh));

    // --- arms rise toward you when she's hunting and close (slowly), drop back otherwise
    const reachTarget = this.forceReach ?? (running ? (dist < 3.5 ? 1 : 0.15) : windup ? 0 : (hunt && dist < 4.5) || scare ? 1 : lunging ? 0.6 : 0);
    if (!frozen) this.reach = ease(this.reach ?? 0, reachTarget, reachTarget > (this.reach ?? 0) ? (lunging || running ? 3 : 0.8) : windup ? 6 : 1.5);

    // --- facing: the body turns where she walks; standing, it slowly squares up to you
    const want = Math.atan2(-toP.x, -toP.z);
    const moveDir = Math.atan2(-this.vel.x, -this.vel.z);
    if (!frozen && st !== STATE.SCARE) {
      const tgt = this.spd > 0.3 ? moveDir : want;
      this.facing += wrap(tgt - this.facing) * Math.min(1, dt * (this.chargePh ? 10 : hunt ? 7 : this.spd > 0.3 ? 4 : 1.2));
    }

    // --- head: finds you in sudden snaps and holds there (hunting, caught in the light, face to
    // face); otherwise turns slowly, unnervingly, to keep watching you
    const eyeD = Math.hypot(c.eye.x - this.shownPos.x, c.eye.z - this.shownPos.z);
    const torso = (this.pLean ?? 0) + (this.pHunch ?? 0);
    const yawT = THREE.MathUtils.clamp(wrap(want - this.facing), -1.9, 1.9);
    // her head is never still enough to be photographed: a fast, ghosted shake behind the hair,
    // worst when she is close, lunging, held in the light, or right in your face
    const shakeT = scare ? 1.1 : windup ? 1.05 : frozen ? 0.8 : running ? 0.9 : lunging ? 0.85 : recov ? 0.6 : hunt ? (dist < 4 ? 0.65 : 0.4) : stalk ? 0.3 : 0.2;
    this.shake = ease(this.shake ?? 0.2, shakeT, 4);
    const pitchT = scare ? -0.05 : THREE.MathUtils.clamp(Math.atan2(c.eye.y - (this.shownPos.y + 1.7 - torso * 0.4), Math.max(0.3, eyeD)) + torso * 0.9, -0.6, 1.2);
    const snappy = hunt || scare || frozen || this.chargePh > 0;
    this.hYaw ??= 0; this.hPitch ??= 0; this.hRoll ??= 0;
    this.headHold = (this.headHold ?? 0) - dt;
    this.headSnap = (this.headSnap ?? 0) - dt;
    if (snappy && this.headHold <= 0 && Math.abs(wrap(yawT - this.hYaw)) + Math.abs(pitchT - this.hPitch) > 0.18) {
      this.headSnap = 0.1; this.headHold = 0.35 + Math.random() * 1.1;
    }
    if (this.headSnap > 0) {
      this.hYaw += wrap(yawT - this.hYaw) * Math.min(1, dt * 25);
      this.hPitch += (pitchT - this.hPitch) * Math.min(1, dt * 25);
    } else if (!snappy) {
      this.hYaw += wrap(yawT - this.hYaw) * Math.min(1, dt * 1.6);
      this.hPitch += (pitchT - this.hPitch) * Math.min(1, dt * 1.6);
    }
    this.hPush = ease(this.hPush ?? 0, push, 3);
    // tilt: held for a while, then snapped to a new angle; sometimes far too far
    this.rollT = (this.rollT ?? 0) - dt;
    if (this.rollT <= 0) {
      const big = Math.random() < (scare ? 0.8 : hunt ? 0.22 : 0.12);
      this.rollTgt = big ? (Math.random() < 0.5 ? -1 : 1) * (1.0 + Math.random() * 0.45) : (Math.random() - 0.5) * 0.5;
      this.rollT = big ? 1 + Math.random() * 1.6 : 0.6 + Math.random() * 2;
      if (scare) this.rollT = 0.25;
    }
    this.hRoll = ease(this.hRoll, this.rollTgt ?? 0, 14);
    // spasms: for a few frames the limbs jolt out of place
    this.spasmT = (this.spasmT ?? 0) - dt;
    const spasmRate = windup ? 3 : running ? 1.5 : recov ? 2 : scare ? 4 : lunging ? 3 : hunt ? 0.5 : 0.08;
    if (this.spasmT <= 0 && Math.random() < dt * spasmRate) { this.spasmT = 0.12 + Math.random() * 0.2; this.spasmAmt = 0.5 + Math.random() * 0.6; }

    // smear trail: lags behind the motion, in local space
    this.smear.lerp(this.vel.clone().multiplyScalar(-0.35), Math.min(1, dt * 3));
  }
}
