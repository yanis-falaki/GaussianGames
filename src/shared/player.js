// First-person controller for both games: walks on the floors extracted from the splat cloud
// (World), with head bob, footsteps, stamina, and an optional handheld-camera sway (RESIDUE).
import * as THREE from "three";

const EYE = 1.62;

export class Player {
  constructor(camera, world, audio, dom, tuning = {}) {
    this.camera = camera;
    this.world = world;
    this.audio = audio;
    this.dom = dom;
    this.pos = new THREE.Vector3(); // feet position
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.keys = {};
    this.bob = 0;
    this.stepPhase = 0;
    this.crouch = 0;
    this.enabled = false;
    this.lookSensitivity = 0.0022;
    this.noise = 0; // how loud the player is (for the entity)
    this.stamina = 1;
    this.handheld = 0; // 0..1: how much the view moves like a camera held in the hand
    this.swayT = Math.random() * 100;
    this.kick = 0; this.kickV = 0; this.kickF = 0; this.kickA = 0; // footfall dip (m): a damped spring, so it dips and recovers smoothly
    this.lastStep = 0;
    this.gait = 0;  // smoothed bob amplitude
    this.speedS = 0; // smoothed ground speed
    // body radius: slim enough for the scan's tight doorways and stairwell (the nav graph uses 0.18)
    this.radius = 0.17;
    // movement feel (RESIDUE keeps the defaults; Undeveloped passes its own)
    this.t = { stamina: true, walk: 1.7, run: 3.6, crouch: 0.9, accel: 10, decel: 12, bob: 1, roll: 0.15, ...tuning };

    addEventListener("keydown", (e) => { this.keys[e.code] = true; });
    addEventListener("keyup", (e) => { this.keys[e.code] = false; });
    addEventListener("blur", () => { this.keys = {}; });
    addEventListener("mousemove", (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * this.lookSensitivity;
      this.pitch -= e.movementY * this.lookSensitivity;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
  }

  spawn(x, y, z, yaw = 0) {
    const g = this.world.groundNear(x, z, y, 0.5, 1.0);
    this.pos.set(x, g ?? y, z);
    this.targetY = this.pos.y;
    this.yaw = yaw;
    this.pitch = 0;
    this.vel.set(0, 0, 0);
  }

  // try to move feet to (x,z); returns true if allowed
  tryMove(x, z) {
    // nearest ground level (within a step up/down) where the body fits: on stairs the floor
    // under the flight and the step itself are both candidates
    const head = 1.75 - this.crouch * 0.7;
    for (const g of this.world.groundCandidates(x, z, this.pos.y, 0.42, 0.55)) {
      if (!this.world.bodyFree(x, z, g + 0.45, g + head, this.radius)) continue;
      this.pos.x = x;
      this.pos.z = z;
      this.targetY = g;
      return true;
    }
    return false;
  }

  update(dt, effects) {
    const k = this.keys;
    let fx = 0, fz = 0;
    if (this.enabled) {
      if (k.KeyW || k.ArrowUp) fz += 1;
      if (k.KeyS || k.ArrowDown) fz -= 1;
      if (k.KeyA || k.ArrowLeft) fx -= 1;
      if (k.KeyD || k.ArrowRight) fx += 1;
    }
    const crouching = this.enabled && k.KeyC;
    this.crouch += ((crouching ? 1 : 0) - this.crouch) * Math.min(1, dt * 8);
    const moving = fx || fz;
    const t = this.t;
    if (t.stamina) {
      if (this.stamina <= 0.02) this.winded = true;
      else if (this.stamina > 0.3) this.winded = false;
    }
    const sprint = moving && (k.ShiftLeft || k.ShiftRight) && !(t.stamina && this.winded) && !crouching;
    if (t.stamina) this.stamina = Math.max(0, Math.min(1, this.stamina + (sprint ? -dt / 6 : dt / 9)));
    const speed = (crouching ? t.crouch : sprint ? t.run : t.walk) * (effects.slow ?? 1);

    const len = Math.hypot(fx, fz) || 1;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward is -Z in camera space
    const wx = (fx * cos - fz * sin) / len;
    const wz = (-fx * sin - fz * cos) / len;
    const accel = moving ? t.accel : t.decel;
    this.vel.x += (wx * speed * (moving ? 1 : 0) - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (wz * speed * (moving ? 1 : 0) - this.vel.z) * Math.min(1, dt * accel);

    // substeps so we never tunnel through thin walls
    const dist = Math.hypot(this.vel.x, this.vel.z) * dt;
    const n = Math.max(1, Math.ceil(dist / 0.05));
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const sx = (this.vel.x * dt) / n, sz = (this.vel.z * dt) / n;
      const ox = this.pos.x, oz = this.pos.z;
      if (!this.tryMove(ox + sx, oz + sz)) {
        // slide along walls
        if (!this.tryMove(ox + sx, oz)) {
          if (!this.tryMove(ox, oz + sz)) { this.vel.x *= 0.5; this.vel.z *= 0.5; }
        }
      }
      moved += Math.hypot(this.pos.x - ox, this.pos.z - oz);
    }
    if (this.targetY !== undefined) {
      // smooth stairs: ease toward ground height
      this.pos.y += (this.targetY - this.pos.y) * Math.min(1, dt * 12);
    }

    // footsteps + head bob. The phase runs continuously (a footfall every PI), so the side sway
    // (one cycle per two steps) and the bob (one per step) are smooth curves with no reset.
    this.speedS += (moved / Math.max(dt, 1e-4) - this.speedS) * Math.min(1, dt * 8);
    const v = this.speedS;
    this.stepPhase += moved * (sprint ? 1.25 : 1.6);
    const step = Math.floor(this.stepPhase / Math.PI);
    if (step !== this.lastStep) {
      this.lastStep = step;
      this.audio.footstep(crouching ? 0.25 : sprint ? 1.3 : 0.75, Math.random());
      this.kickF += 30 * (crouching ? 0.05 : sprint ? 0.4 : 0.14) * Math.min(1, v / 2); // each footfall settles the body ~1cm
    }
    this.noise = crouching ? v * 0.1 : sprint ? v * 0.6 : v * 0.3;
    const gaitTarget = Math.min(1, v / 2) * (sprint ? 0.045 : 0.026) * t.bob;
    this.gait += (gaitTarget - this.gait) * Math.min(1, dt * 5);
    const bobY = (0.5 - 0.5 * Math.cos(2 * this.stepPhase)) * this.gait; // lowest at each footfall
    const bobX = Math.sin(this.stepPhase) * this.gait * 0.5;
    // the footfall spring (critically-ish damped, ~0.15s)
    // pushed by a short decaying force rather than an instant kick, so even the dip eases in
    this.kickA += (this.kickF - this.kickA) * Math.min(1, dt * 45);
    this.kickV += (this.kickA - 260 * this.kick - 26 * this.kickV) * dt;
    this.kickF *= Math.exp(-dt * 30);
    this.kick += this.kickV * dt;

    // camera
    const shake = effects.shake ?? 0;
    const eye = EYE - this.crouch * 0.6;
    this.camera.position.set(
      this.pos.x + bobX * cos + (Math.random() - 0.5) * shake,
      this.pos.y + eye + bobY - this.kick + (Math.random() - 0.5) * shake,
      this.pos.z - bobX * sin + (Math.random() - 0.5) * shake,
    );
    // handheld: slow drift of the arms, faster wobble when running or afraid, heaving when out
    // of breath, and a jolt with every step
    let sy = 0, sp = 0, sr = 0;
    if (this.handheld > 0) {
      const fear = effects.fear ?? 0, run = Math.min(1, v / 3.6), tired = 1 - this.stamina;
      const T = (this.swayT += dt * (1 + run * 0.8 + fear));
      const a = this.handheld * (0.006 + run * 0.012 + fear * 0.01 + tired * 0.006);
      sy = a * (0.6 * Math.sin(T * 0.83) + 0.3 * Math.sin(T * 2.17 + 1.3) + 0.15 * Math.sin(T * 5.3 + 2.1));
      sp = a * (0.5 * Math.sin(T * 0.71 + 0.4) + 0.3 * Math.sin(T * 1.93 + 2.7) + 0.15 * Math.sin(T * 4.7));
      sr = a * 1.4 * (0.6 * Math.sin(T * 0.53 + 1.1) + 0.4 * Math.sin(T * 1.61));
      sp += this.handheld * tired * 0.012 * Math.sin(this.swayT * 2.6); // heavy breathing
      sp -= this.kick * 0.6 * this.handheld;
      if (fear > 0.4) { sy += (Math.random() - 0.5) * 0.004 * fear; sp += (Math.random() - 0.5) * 0.004 * fear; }
    }
    this.camera.rotation.set(this.pitch + sp, this.yaw + sy, (effects.roll ?? 0) + bobX * t.roll * (1 + this.handheld) + sr, "YXZ");
  }
}
