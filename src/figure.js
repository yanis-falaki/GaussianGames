// Procedural "Resident 31": a tall, thin figure in a hospital gown, made of Gaussians.
// Returns splat descriptors in local space (feet at the origin, facing -Z).
// Each splat also carries a "bone" id for the animation shader. It is hidden in the two
// lowest bits of each 8-bit colour channel (6 bits, invisible) so it survives packing.
import * as THREE from "three";

export const BONE = { GOWN: 0, YOKE: 1, SLEEVE: 2, ARM: 3, HAND: 4, SHIN: 5, FOOT: 6, NECK: 7, HEAD: 8, HAIR: 9, HOLLOW: 10 };

function encodeBone(col, bone) {
  const ch = (v, bits) => (((Math.max(0, Math.min(255, Math.round(v * 255))) & ~3) | bits) / 255);
  col.r = ch(col.r, bone & 3); col.g = ch(col.g, (bone >> 2) & 3); col.b = ch(col.b, (bone >> 4) & 3);
  return col;
}

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UP = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

export function buildFigure(count = 16000, seed = 31) {
  const R = rand(seed);
  const out = [];
  const q = new THREE.Quaternion(), m = new THREE.Matrix4();
  // splat lying on a surface with normal n, stretched along direction t
  const push = (c, n, t, sAlong, sAcross, op, col, part, bone) => {
    const b = new THREE.Vector3().crossVectors(t, n).normalize();
    const tt = new THREE.Vector3().crossVectors(n, b).normalize();
    m.makeBasis(b, tt, n);
    out.push({
      center: c.clone(), scales: new THREE.Vector3(sAcross, sAlong, Math.min(sAcross, sAlong) * 0.2),
      quaternion: new THREE.Quaternion().setFromRotationMatrix(m), opacity: op, color: encodeBone(col, bone), part, bone,
    });
  };
  const shade = (base, v) => new THREE.Color(base[0] * v, base[1] * v, base[2] * v);
  const GOWN = [0.55, 0.53, 0.48], GOWN_DIRT = [0.38, 0.35, 0.3], SKIN = [0.36, 0.37, 0.4], HAIR = [0.035, 0.032, 0.03];

  // --- gown: a slightly flared tube from the shoulders to below the knee, with vertical folds
  const nGown = count * 0.42;
  for (let i = 0; i < nGown; i++) {
    const y = 0.42 + R() * (1.5 - 0.42);
    const a = R() * Math.PI * 2;
    // narrow shoulders, a thin waist, a hem that hangs and flares a little
    const w = y > 1.1 ? 0.13 + (1.5 - y) * -0.02 : 0.12 + (1.1 - y) * 0.14;
    const r = w * (1 + 0.07 * Math.sin(a * 9 + y * 2));
    const n = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const c = new THREE.Vector3(Math.sin(a) * r * 1.1, y, Math.cos(a) * r * 0.8);
    const dirty = R() < 0.25 + (1.5 - y) * 0.3;
    // darker toward the sides so the body reads as round, and in the fold valleys
    const side = 0.55 + 0.45 * Math.abs(Math.cos(a)) * (0.85 + 0.15 * Math.sin(a * 9 + y * 2));
    push(c, n, UP, 0.03 + R() * 0.04, 0.007 + R() * 0.008, 0.8 + R() * 0.2, shade(dirty ? GOWN_DIRT : GOWN, side * (0.8 + R() * 0.3)), 0, BONE.GOWN);
  }
  // shoulders: a yoke across the top
  for (let i = 0; i < count * 0.04; i++) {
    const x = (R() - 0.5) * 0.42, z = (R() - 0.5) * 0.18;
    const c = new THREE.Vector3(x, 1.5 + 0.03 * Math.cos(x * 6), z);
    push(c, UP, new THREE.Vector3(1, 0, 0), 0.02, 0.012, 0.85, shade(GOWN, 0.85 + R() * 0.2), 0, BONE.YOKE);
  }
  // --- limbs as thin capsules: [a, b, radius, colour, bone]
  const limbs = [
    [[-0.19, 1.48, 0], [-0.26, 1.12, 0.02], 0.034, GOWN, BONE.SLEEVE], [[0.19, 1.48, 0], [0.26, 1.12, 0.02], 0.034, GOWN, BONE.SLEEVE], // short sleeves
    [[-0.26, 1.12, 0.02], [-0.3, 0.55, 0.05], 0.022, SKIN, BONE.ARM], [[0.26, 1.12, 0.02], [0.3, 0.55, 0.05], 0.022, SKIN, BONE.ARM], // bare arms, far too long
    [[-0.3, 0.55, 0.05], [-0.31, 0.36, 0.06], 0.013, SKIN, BONE.HAND], [[0.3, 0.55, 0.05], [0.31, 0.36, 0.06], 0.013, SKIN, BONE.HAND], // hands, long fingers
    [[-0.08, 0.04, 0], [-0.08, 0.5, 0], 0.03, SKIN, BONE.SHIN], [[0.08, 0.04, 0], [0.08, 0.5, 0], 0.03, SKIN, BONE.SHIN], // shins
    [[0, 1.48, 0], [0, 1.68, 0.01], 0.035, SKIN, BONE.NECK], // neck
  ];
  for (const [A, B, rad, col, bone] of limbs) {
    const a = new THREE.Vector3(...A), b = new THREE.Vector3(...B), ax = b.clone().sub(a);
    const len = ax.length(); ax.normalize();
    const nn = Math.round(count * 0.012 * len / 0.5 * (rad / 0.03 + 0.5));
    const side = new THREE.Vector3().crossVectors(ax, Z).normalize(), side2 = new THREE.Vector3().crossVectors(ax, side);
    for (let i = 0; i < nn; i++) {
      const t = R(), ang = R() * Math.PI * 2;
      const n = side.clone().multiplyScalar(Math.cos(ang)).addScaledVector(side2, Math.sin(ang));
      const c = a.clone().addScaledVector(ax, t * len).addScaledVector(n, rad);
      push(c, n, ax, 0.012 + R() * 0.012, 0.006, 0.8 + R() * 0.2, shade(col, 0.75 + R() * 0.3), col === SKIN ? 1 : 0, bone);
    }
  }
  // feet: flat, bare
  for (const fx of [-0.09, 0.09]) for (let i = 0; i < 120; i++) {
    const c = new THREE.Vector3(fx + (R() - 0.5) * 0.07, 0.02, -0.03 - R() * 0.17);
    push(c, UP, Z, 0.012, 0.01, 0.9, shade(SKIN, 0.7 + R() * 0.3), 1, BONE.FOOT);
  }
  // --- head: a pale, slightly elongated skull, tilted
  const head = new THREE.Vector3(0.015, 1.8, 0.01);
  for (let i = 0; i < count * 0.06; i++) {
    let d; do d = new THREE.Vector3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1); while (d.lengthSq() > 1 || d.lengthSq() < 0.05);
    d.normalize();
    const c = head.clone().add(new THREE.Vector3(d.x * 0.095, d.y * 0.125, d.z * 0.105));
    push(c, d, UP, 0.012, 0.01, 0.95, shade(SKIN, 0.85 + R() * 0.2), 1, BONE.HEAD);
  }
  // --- hair: long, dark, wet strands from the crown, hanging in front of the face to the chest
  const nHair = count * 0.1;
  for (let i = 0; i < nHair; i++) {
    const a = (R() - 0.5) * Math.PI * 1.9; // around the head (a=0 is the face)
    const rr = 0.1 + R() * 0.015;
    const front = Math.abs(a) < 0.6;
    const len = front ? 0.18 + R() * 0.14 : 0.1 + R() * 0.12; // a veil over the face, shoulder length elsewhere
    const t = R();
    const y = 1.93 - t * (0.13 + len);
    const spread = t * 0.03;
    const c = new THREE.Vector3(Math.sin(a) * (rr + spread), y, -Math.cos(a) * (rr + spread) + 0.01);
    const n = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
    push(c, n, UP, 0.03 + R() * 0.04, 0.004 + R() * 0.004, 0.85 + R() * 0.15, shade(HAIR, 0.7 + R() * 0.6), 2, BONE.HAIR);
  }
  // the veil: a dense curtain of wet hair hanging straight down over the whole face to the
  // chest. You never see her face, only something pale moving behind it.
  for (let i = 0; i < count * 0.055; i++) {
    const a = (R() - 0.5) * 1.9;                // across the front of the head
    const t = Math.pow(R(), 0.8);
    const y = 1.94 - t * 0.5;
    const rr = 0.112 + t * 0.02 + R() * 0.008;   // in front of the face, falling slightly away
    const c = new THREE.Vector3(Math.sin(a) * rr * (1 + t * 0.15), y, -Math.cos(a) * rr + 0.01);
    const n = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
    push(c, n, UP, 0.04 + R() * 0.05, 0.003 + R() * 0.005, 0.7 + R() * 0.25, shade(HAIR, 0.6 + R() * 0.6), 2, BONE.HAIR);
  }
  return out;
}
