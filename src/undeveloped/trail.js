// Mara's footprints: small, fresh shoe prints in the dust of the ground-floor hall, leading
// to the stairwell and up the stairs. The stairs are easy to walk past; the prints are the
// building's own hint. They're made of splats (pale, faintly luminous disturbed dust) laid
// on the floor along a nav route, so they follow the real floor and the real steps.
import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";

const STRIDE = 0.36; // one print every 36cm, alternating feet
const GAIT = 0.085;  // half the distance between the feet

// walk the polyline and drop a point every `step` metres
function resample(pts, step) {
  const out = [];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = a.distanceTo(b);
    let t = carry;
    while (t <= seg) {
      const p = a.clone().lerp(b, t / seg);
      const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
      out.push({ p, dir });
      t += step;
    }
    carry = t - seg;
  }
  return out;
}

// the route from `from` to `to`, keeping only its last `length` metres
export function trailRoute(world, from, to, length) {
  const path = world.navAstar(world.nearestNode(from), world.nearestNode(to));
  if (!path) return null;
  const legs = world.navSmooth(path);
  const pts = legs.map((n) => new THREE.Vector3(n.x, n.y, n.z));
  // trim from the start so only the end of the walk is marked
  let total = 0;
  for (let i = pts.length - 1; i > 0; i--) {
    const d = pts[i].distanceTo(pts[i - 1]);
    if (total + d >= length) { pts.splice(0, i, pts[i].clone().lerp(pts[i - 1], (length - total) / d)); break; }
    total += d;
  }
  return pts;
}

export function buildTrail(world, route) {
  let seed = 31;
  const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const steps = resample(route, STRIDE);
  const splats = [];
  const prints = [];
  const q = new THREE.Quaternion(); // prints are flat discs: no rotation needed
  steps.forEach(({ p, dir }, i) => {
    const left = i % 2 === 0;
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(left ? -GAIT : GAIT);
    const c = p.clone().add(side);
    const g = world.groundNear(c.x, c.z, p.y, 0.35, 0.6);
    if (g === null || g === undefined) return;
    c.y = g + 0.012;
    prints.push(c.clone());
    // a little wander in the angle, and some prints fainter (scuffed, half on the edge of a step)
    const ang = Math.atan2(dir.x, dir.z) + (R() - 0.5) * 0.25 + (left ? 0.06 : -0.06);
    const fresh = 0.55 + 0.45 * R();
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const put = (u, v, s, op) => {
      // u along the foot (toe = +), v across; mirrored for the left foot
      const vv = left ? -v : v;
      splats.push([new THREE.Vector3(c.x + sa * u + ca * vv, c.y, c.z + ca * u - sa * vv), s, op * fresh]);
    };
    // a small shoe: forefoot pad and heel, with tread bars across them
    for (let k = 0; k < 70; k++) {
      const heel = k < 22;
      const u = heel ? -0.085 + (R() - 0.5) * 0.07 : 0.045 + (R() - 0.5) * 0.13;
      const w = heel ? 0.032 : 0.042 * Math.sqrt(Math.max(0, 1 - ((u - 0.045) / 0.075) ** 2)) + 0.006;
      const v = (R() * 2 - 1) * w + (heel ? 0 : 0.006);
      if (Math.abs(((u * 70) % 1)) < 0.28) continue; // tread grooves
      put(u, v, 0.007 + R() * 0.004, 0.45 + R() * 0.25);
    }
  });
  const color = new THREE.Color(0.93, 0.91, 0.86);
  const mesh = new SplatMesh({
    constructSplats: (out) => {
      for (const [c, s, op] of splats) out.pushSplat(c, new THREE.Vector3(s, 0.0015, s), q, op, color);
    },
  });
  return { mesh, prints };
}
