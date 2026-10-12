// Footprints in the dust: the trails people left through the building that Saturday, laid leg
// by leg from clue to clue (case-file.js TRAILS). Mara's small shoe prints (walking, and later
// running), a man's heavy boots, and a dog's paws. Each leg is a SplatMesh of pale, disturbed
// dust laid on the floor along a nav route (World.navAstar), so prints follow the real floor and
// the real steps.
//
// A leg is hidden until the story reaches it, then its prints appear one after another from its
// start, as if being walked. Once what it leads to has been documented it fades to a faint
// trace. Prints close to you catch the light a little, and pulse() brightens the open legs for
// a few seconds (the lost-player cue in main.js). Opacity, the reveal and the glow live in a
// small dyno modifier per leg (generation pass): changing them only needs a regeneration while
// something animates, throttled to ~10 Hz; walking regenerates anyway.
import * as THREE from "three";
import { SplatMesh, dyno } from "@sparkjsdev/spark";

// how each walker leaves prints. stride: metres between successive prints; gait: half the
// distance between the feet; wander: sideways drift (m) a dog's path takes
export const WALKERS = {
  mara: { stride: 0.36, gait: 0.085 },
  run: { stride: 0.62, gait: 0.075 },  // Mara running: longer steps, toes dug in, scuffed
  man: { stride: 0.5, gait: 0.12 },    // heavy boots, a man's size
  dog: { stride: 0.3, gait: 0.06, wander: 0.22 },
};

const FADED = 0.22;     // opacity of a leg whose lead has been followed
const REVEAL_MPS = 9;   // how fast a new leg "walks" itself out (metres of trail per second)
const REVEAL_MAX = 3.2; // ... but never longer than this (s)

// walk the polyline and drop a point every `step` metres
function resample(pts, step) {
  const out = [];
  let carry = 0, along = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = a.distanceTo(b);
    if (seg < 1e-4) continue;
    const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    let t = carry;
    while (t <= seg) {
      out.push({ p: a.clone().lerp(b, t / seg), dir, along: along + t });
      t += step;
    }
    carry = t - seg;
    along += seg;
  }
  return out;
}

const polyLength = (pts) => pts.reduce((s, p, i) => (i ? s + p.distanceTo(pts[i - 1]) : 0), 0);

// cut `d` metres off the start (or the end) of a polyline
function trim(pts, d, fromEnd) {
  const p = fromEnd ? [...pts].reverse() : [...pts];
  let left = d;
  while (p.length > 1) {
    const seg = p[0].distanceTo(p[1]);
    if (seg > left) { p[0] = p[0].clone().lerp(p[1], left / seg); break; }
    left -= seg;
    p.shift();
  }
  return fromEnd ? p.reverse() : p;
}

// the walking route between two points on the nav graph, a little short of both ends (prints
// stop before the object instead of running under it)
export function legRoute(world, from, to, { start = 0.5, end = 0.7 } = {}) {
  const path = world.navAstar(world.nearestNode(from), world.nearestNode(to));
  if (!path) return null;
  let pts = world.navSmooth(path, 40, Infinity).map((n) => new THREE.Vector3(n.x, n.y, n.z));
  const len = polyLength(pts);
  if (len < start + end + 0.6) return pts;
  pts = trim(pts, start, false);
  return trim(pts, end, true);
}

// splats for one print, around c (on the floor), heading `ang`, in local foot coordinates:
// u along the foot (toe +), v across (mirrored for the left foot)
function stamp(kind, c, ang, left, fresh, R, out) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const put = (u, v, s, op) => {
    const vv = left ? -v : v;
    out.push([c.x + sa * u + ca * vv, c.y, c.z + ca * u - sa * vv, s, op * fresh]);
  };
  if (kind === "dog") {
    // a paw: a broad pad and four toes in an arc ahead of it
    for (let k = 0; k < 9; k++) put((R() - 0.5) * 0.026, (R() - 0.5) * 0.034, 0.007 + R() * 0.003, 0.5 + R() * 0.2);
    for (const [tu, tv] of [[0.032, -0.022], [0.04, -0.008], [0.04, 0.008], [0.032, 0.022]])
      for (let k = 0; k < 3; k++) put(tu + (R() - 0.5) * 0.01, tv + (R() - 0.5) * 0.008, 0.005 + R() * 0.002, 0.5 + R() * 0.2);
    return;
  }
  const boot = kind === "man", run = kind === "run";
  const L = boot ? 1.32 : 1;           // size relative to Mara's shoe
  const groove = boot ? 48 : 70;        // tread spacing
  const n = boot ? 110 : 70;
  for (let k = 0; k < n; k++) {
    const heel = k < n * 0.31;
    if (run && heel && R() < 0.75) continue; // running: weight on the toes, the heel barely lands
    let u = heel ? -0.085 + (R() - 0.5) * 0.07 : 0.045 + (R() - 0.5) * 0.13;
    const w = heel ? 0.032 : 0.042 * Math.sqrt(Math.max(0, 1 - ((u - 0.045) / 0.075) ** 2)) + 0.006;
    const v = (R() * 2 - 1) * w * (boot ? 1.1 : 1) + (heel ? 0 : 0.006);
    if (Math.abs((u * groove) % 1) < 0.28) continue; // tread grooves
    if (run && !heel && R() < 0.35) u += 0.03 + R() * 0.06;  // pushed off: the toe smears forward
    put(u * L, v * L, (0.007 + R() * 0.004) * (boot ? 1.15 : 1), 0.45 + R() * 0.25);
  }
}

// the prints along a route. Returns splats [x, y, z, size, opacity] in walking order and the
// print centres
export function layPrints(world, route, walkerKind, seed = 31) {
  const W = WALKERS[walkerKind];
  let s = seed;
  const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const splats = [], prints = [];
  const steps = resample(route, W.stride);
  steps.forEach(({ p, dir, along }, i) => {
    const left = i % 2 === 0;
    let side = left ? -W.gait : W.gait;
    if (W.wander) side += Math.sin(along * 1.9 + seed) * W.wander * Math.min(1, along / 1.5);
    const c = p.clone().add(new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(side));
    const g = world.groundNear(c.x, c.z, p.y, 0.35, 0.6);
    if (g === null || g === undefined) return;
    c.y = g + 0.012;
    prints.push(c.clone());
    // a little wander in the angle, and some prints fainter (scuffed, half on the edge of a step)
    const ang = Math.atan2(dir.x, dir.z) + (R() - 0.5) * (walkerKind === "dog" ? 0.5 : 0.25) + (left ? 0.06 : -0.06);
    const fresh = 0.55 + 0.45 * R();
    stamp(walkerKind, c, ang, left, fresh, R, splats);
    if (walkerKind === "dog") {
      // a trotting dog: the hind paw lands just behind the front one
      const h = c.clone().addScaledVector(dir, -0.07 - R() * 0.03);
      stamp("dog", h, ang, !left, fresh * 0.85, R, splats);
    }
  });
  return { splats, prints };
}

// per leg: opacity, how many splats are revealed so far, and a glow; plus the player's position
const uPlayer = dyno.dynoVec3(new THREE.Vector3(0, -100, 0));
const uPulse = dyno.dynoFloat(0);
function legModifier(uOpacity, uReveal) {
  return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const fx = new dyno.Dyno({
      inTypes: { gsplat: dyno.Gsplat, opacity: "float", reveal: "float", player: "vec3", pulse: "float" },
      outTypes: { gsplat: dyno.Gsplat },
      globals: () => [dyno.defineGsplat],
      statements: ({ inputs: I, outputs: O }) => dyno.unindentLines(/* glsl */ `
        ${O.gsplat} = ${I.gsplat};
        if (float(${I.gsplat}.index) >= ${I.reveal} || ${I.opacity} <= 0.0) {
          ${O.gsplat}.flags = 0u;
        } else {
          // prints close to you catch the light; the pulse lifts the whole leg for a moment
          vec3 d = ${I.gsplat}.center - ${I.player};
          float near = (1.0 - smoothstep(1.2, 4.5, length(d))) * (1.0 - smoothstep(0.8, 1.6, abs(d.y)));
          float lift = max(near * 0.6, ${I.pulse}) * step(0.5, ${I.opacity});
          ${O.gsplat}.rgba.rgb = mix(${I.gsplat}.rgba.rgb, vec3(1.0, 0.97, 0.9), lift * 0.6);
          ${O.gsplat}.rgba.a = min(1.0, ${I.gsplat}.rgba.a * ${I.opacity} * (1.0 + 0.55 * lift));
        }
      `),
    });
    return { gsplat: fx.apply({ gsplat, opacity: uOpacity, reveal: uReveal, player: uPlayer, pulse: uPulse }).gsplat };
  });
}

const COLOR = new THREE.Color(0.93, 0.91, 0.86); // pale dust
const FLAT = new THREE.Quaternion();             // prints are flat discs: no rotation needed

// All the legs in the case. defs: case-file TRAILS; point(from | to): the world position (a
// Vector3) of a clue id or [x, y, z]. onRegen(frames): ask the view to regenerate splats.
export class Trails {
  constructor({ world, scene, defs, point, onRegen }) {
    this.onRegen = onRegen;
    this.legs = [];
    defs.forEach((def, i) => {
      const route = legRoute(world, point(def.from), point(def.to));
      if (!route) { console.warn(`[trail] no route for leg ${def.id}`); return; }
      const { splats, prints } = layPrints(world, route, def.walker, 31 + i * 97);
      const uOpacity = dyno.dynoFloat(0), uReveal = dyno.dynoFloat(0);
      const mesh = new SplatMesh({
        constructSplats: (out) => {
          const v = new THREE.Vector3(), sc = new THREE.Vector3();
          for (const [x, y, z, s, op] of splats) out.pushSplat(v.set(x, y, z), sc.set(s, 0.0015, s), FLAT, op, COLOR);
        },
        worldModifier: legModifier(uOpacity, uReveal),
      });
      mesh.visible = false;
      scene.add(mesh);
      this.legs.push({
        def, mesh, route, prints, count: splats.length, length: polyLength(route), uOpacity, uReveal,
        state: "hidden", opacity: 0, target: 0, reveal: 0, revealT: 0,
      });
    });
    this.pulseT = 0;
    this.quant = 0;
  }

  get(id) { return this.legs.find((l) => l.def.id === id); }

  // "hidden" | "active" (being followed) | "faded" (followed, or a closed chapter)
  set(id, state) {
    const leg = this.get(id);
    if (!leg || leg.state === state) return false;
    const was = leg.state;
    leg.state = state;
    leg.target = state === "active" ? 1 : state === "faded" ? FADED : 0;
    if (was === "hidden" && state !== "hidden") {
      leg.mesh.visible = true;
      leg.revealT = 0;
      leg.revealDur = Math.min(REVEAL_MAX, Math.max(1, leg.length / REVEAL_MPS));
      if (state === "faded") leg.opacity = FADED, leg.revealT = leg.revealDur; // no show for an old lead
    }
    return true;
  }

  // print centres of the legs being followed
  activePrints() { return this.legs.filter((l) => l.state === "active").flatMap((l) => l.prints); }

  // nearest print of an open leg to p: { print, leg, dist } or null
  nearestActive(p) {
    let best = null;
    for (const leg of this.legs) {
      if (leg.state !== "active") continue;
      for (const q of leg.prints) {
        const d = Math.hypot(q.x - p.x, (q.y - p.y) * 2, q.z - p.z);
        if (!best || d < best.dist) best = { print: q, leg, dist: d };
      }
    }
    return best;
  }

  pulse(seconds = 4) { this.pulseT = seconds; this.pulseDur = seconds; }

  // per frame. Asks for a regeneration (throttled) while something is changing.
  update(dt, playerPos) {
    uPlayer.value.copy(playerPos);
    let changing = false;
    for (const leg of this.legs) {
      if (leg.state === "hidden" && leg.opacity === 0) continue;
      if (leg.revealT < leg.revealDur) { leg.revealT = Math.min(leg.revealDur, leg.revealT + dt); changing = true; }
      const k = leg.revealDur ? leg.revealT / leg.revealDur : 1;
      // reveal along the walk: the splats are in walking order
      leg.reveal = k >= 1 ? leg.count + 1 : Math.floor(leg.count * k * (2 - k));
      if (leg.opacity !== leg.target) {
        const step = dt * (leg.target > leg.opacity ? 1.2 : 0.4); // fade in quickly, out slowly
        leg.opacity = leg.target > leg.opacity ? Math.min(leg.target, leg.opacity + step) : Math.max(leg.target, leg.opacity - step);
        changing = true;
        if (leg.opacity === 0) leg.mesh.visible = false;
      }
    }
    let pulse = 0;
    if (this.pulseT > 0) {
      this.pulseT = Math.max(0, this.pulseT - dt);
      const t = 1 - this.pulseT / this.pulseDur;      // 0..1
      pulse = Math.sin(Math.PI * Math.min(1, t * 1.6)) * (1 - t * 0.5) * (0.75 + 0.25 * Math.sin(t * 14));
      changing = true;
    }
    // regenerate at ~10 Hz while animating (and once more when it stops)
    this.quant -= dt;
    if ((changing && this.quant <= 0) || (!changing && this.wasChanging)) {
      this.quant = 0.1;
      for (const leg of this.legs) {
        if (!leg.mesh.visible) continue;
        leg.uOpacity.value = leg.opacity;
        leg.uReveal.value = leg.reveal;
      }
      uPulse.value = Math.max(0, pulse);
      this.onRegen?.(changing ? 1 : 3);
    }
    this.wasChanging = changing;
  }
}
