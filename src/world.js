// Collision + navigation derived directly from the splat cloud.
// The voxel grid stores opacity-weighted splat density per 10cm cell (see tools/voxelize.py).
import * as THREE from "three";

const SOLID = 6; // density threshold (sum of opacity >= 0.6)

export class World {
  constructor(meta, density, upper) {
    this.upper = upper;
    this.res = meta.res;
    [this.ox, this.oy, this.oz] = meta.origin;
    [this.nx, this.ny, this.nz] = meta.dims;
    this.solid = new Uint8Array(density.length);
    for (let i = 0; i < density.length; i++) this.solid[i] = density[i] >= SOLID ? 1 : 0;
    this.buildFloors();
  }

  static async load(base, upper) {
    const [meta, buf] = await Promise.all([
      fetch(`${base}/vox.json`).then((r) => r.json()),
      fetch(`${base}/vox.bin`).then((r) => r.arrayBuffer()),
    ]);
    return new World(meta, new Uint8Array(buf), upper);
  }

  idx(ix, iy, iz) {
    return (iy * this.nz + iz) * this.nx + ix;
  }

  cell(ix, iy, iz) {
    if (ix < 0 || iy < 0 || iz < 0 || ix >= this.nx || iy >= this.ny || iz >= this.nz) return 0;
    return this.solid[this.idx(ix, iy, iz)];
  }

  toCell(x, y, z) {
    return [
      Math.floor((x - this.ox) / this.res),
      Math.floor((y - this.oy) / this.res),
      Math.floor((z - this.oz) / this.res),
    ];
  }

  solidAt(x, y, z) {
    const [ix, iy, iz] = this.toCell(x, y, z);
    return this.cell(ix, iy, iz);
  }

  // Floor cells: solid with ~1.5m of (mostly) free space above. A column may have several
  // (ground floor + upstairs). floorMap[iz*nx+ix] = list of floor heights (in cells).
  buildFloors() {
    const H = 15;
    this.floors = new Array(this.nx * this.nz);
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        let list = null;
        for (let iy = 0; iy < this.ny - H - 1; iy++) {
          if (!this.cell(ix, iy, iz)) continue;
          let blocked = 0;
          for (let k = 1; k <= H && blocked < 2; k++) blocked += this.cell(ix, iy + k, iz);
          if (blocked >= 2) continue;
          const u = this.upper;
          if (u && this.oy + (iy + 1) * this.res > u.minY) {
            const x = this.ox + (ix + 0.5) * this.res, z = this.oz + (iz + 0.5) * this.res;
            if (x < u.x0 || x > u.x1 || z < u.z0 || z > u.z1) continue; // ceiling top, not a floor
          }
          (list ||= []).push(iy);
        }
        this.floors[iz * this.nx + ix] = list;
      }
    }
  }

  // Find a ground height (world y of the floor surface) under (x,z) near footY.
  groundNear(x, z, footY, up = 0.45, down = 0.6) {
    const ix = Math.floor((x - this.ox) / this.res);
    const iz = Math.floor((z - this.oz) / this.res);
    let best = null, bestD = Infinity;
    // sample a small 3x3 neighborhood to bridge holes in the scan
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (ix + dx < 0 || iz + dz < 0 || ix + dx >= this.nx || iz + dz >= this.nz) continue;
        const list = this.floors[(iz + dz) * this.nx + ix + dx];
        if (!list) continue;
        for (const iy of list) {
          const y = this.oy + (iy + 1) * this.res;
          const d = y - footY;
          if (d > up || d < -down) continue;
          const w = Math.abs(d) + (dx || dz ? 0.05 : 0);
          if (w < bestD) { bestD = w; best = y; }
        }
      }
    return best;
  }

  // All distinct ground heights under (x,z) within [footY-down, footY+up], nearest first.
  groundCandidates(x, z, footY, up = 0.45, down = 0.6) {
    const ix = Math.floor((x - this.ox) / this.res);
    const iz = Math.floor((z - this.oz) / this.res);
    const ys = new Set();
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (ix + dx < 0 || iz + dz < 0 || ix + dx >= this.nx || iz + dz >= this.nz) continue;
        const list = this.floors[(iz + dz) * this.nx + ix + dx];
        if (!list) continue;
        for (const iy of list) {
          const y = this.oy + (iy + 1) * this.res;
          if (y - footY <= up && y - footY >= -down) ys.add(+y.toFixed(3));
        }
      }
    return [...ys].sort((a, b) => Math.abs(a - footY) - Math.abs(b - footY));
  }

  // Is a vertical body (radius r) at (x, z) between y0 and y1 free of solid cells?
  bodyFree(x, z, y0, y1, r = 0.22) {
    const [ix0, iy0, iz0] = this.toCell(x - r, y0, z - r);
    const [ix1, iy1, iz1] = this.toCell(x + r, y1, z + r);
    let hits = 0;
    for (let iy = iy0; iy <= iy1; iy++)
      for (let iz = iz0; iz <= iz1; iz++)
        for (let ix = ix0; ix <= ix1; ix++) {
          const cx = this.ox + (ix + 0.5) * this.res - x;
          const cz = this.oz + (iz + 0.5) * this.res - z;
          if (cx * cx + cz * cz > (r + 0.05) * (r + 0.05)) continue;
          hits += this.cell(ix, iy, iz);
          if (hits > 1) return false; // tolerate a single stray voxel
        }
    return true;
  }

  // March a ray through the voxel grid; returns distance to first solid or maxDist.
  raycast(origin, dir, maxDist = 30, step = 0.05) {
    for (let t = 0.1; t < maxDist; t += step) {
      if (this.solidAt(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t)) return t;
    }
    return maxDist;
  }

  lineOfSight(a, b) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    d.divideScalar(len);
    return this.raycast(a, d, len, 0.08) >= len - 0.15;
  }

  // Open a passage: clear solid voxels in a box and lay a floor through it at floorY.
  carve(b) {
    const [ix0, iy0, iz0] = this.toCell(b.x - b.hx, b.y + 0.05, b.z - b.hz);
    const [ix1, iy1, iz1] = this.toCell(b.x + b.hx, b.y + b.h, b.z + b.hz);
    const fy = Math.floor((b.y - this.oy) / this.res) - 1;
    for (let iz = iz0; iz <= iz1; iz++)
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iy = Math.max(iy0, fy + 1); iy <= iy1; iy++) this.solid[this.idx(ix, iy, iz)] = 0;
        const list = (this.floors[iz * this.nx + ix] ||= []);
        if (!list.includes(fy)) list.push(fy);
      }
  }

  // Make a box impassable (boundary zones): fill its voxels from just above the floor up.
  block(b) {
    const [ix0, iy0, iz0] = this.toCell(b.min[0], b.min[1] + 0.3, b.min[2]);
    const [ix1, iy1, iz1] = this.toCell(b.max[0], b.max[1], b.max[2]);
    for (let iy = Math.max(0, iy0); iy <= Math.min(this.ny - 1, iy1); iy++)
      for (let iz = Math.max(0, iz0); iz <= Math.min(this.nz - 1, iz1); iz++)
        for (let ix = Math.max(0, ix0); ix <= Math.min(this.nx - 1, ix1); ix++) this.solid[this.idx(ix, iy, iz)] = 1;
  }

  // ---- navigation grid (2.5D) for the entity -----------------------------------------
  // Nodes are walkable (column, floor) pairs. Built lazily from floors + body clearance.
  buildNav() {
    const nodes = [];
    const key = new Map();
    for (let iz = 0; iz < this.nz; iz += 2)
      for (let ix = 0; ix < this.nx; ix += 2) {
        const list = this.floors[iz * this.nx + ix];
        if (!list) continue;
        for (const iy of list) {
          const x = this.ox + (ix + 0.5) * this.res, z = this.oz + (iz + 0.5) * this.res;
          const y = this.oy + (iy + 1) * this.res;
          if (!this.bodyFree(x, z, y + 0.45, y + 1.6, 0.18)) continue;
          key.set(`${ix},${iz},${iy}`, nodes.length);
          nodes.push({ x, y, z, ix, iz, iy, n: [] });
        }
      }
    // connect neighbours whose floors differ by <= 0.4m
    nodes.forEach((a, i) => {
      for (const [dx, dz] of [[2, 0], [0, 2], [2, 2], [2, -2]]) {
        for (let dy = -4; dy <= 4; dy++) {
          const j = key.get(`${a.ix + dx},${a.iz + dz},${a.iy + dy}`);
          if (j === undefined) continue;
          const b = nodes[j];
          a.n.push(j);
          b.n.push(i);
        }
      }
    });
    this.nav = nodes;
    this.navKey = key;
    // label connected components; the largest one is "the building"
    const comp = new Int32Array(nodes.length).fill(-1);
    let best = -1, bestSize = 0;
    for (let i = 0, c = 0; i < nodes.length; i++) {
      if (comp[i] >= 0) continue;
      const q = [i];
      comp[i] = c;
      for (let h = 0; h < q.length; h++)
        for (const n of nodes[q[h]].n) if (comp[n] < 0) { comp[n] = c; q.push(n); }
      if (q.length > bestSize) { bestSize = q.length; best = c; }
      c++;
    }
    this.navMain = comp.map((c) => (c === best ? 1 : 0));
    return nodes;
  }

  // "the building" = everything walkable from the spawn point
  setMainFrom(p) {
    const s = this.nearestNode(p, false, 10);
    const d = this.flood(s);
    this.navMain = Uint8Array.from(d, (v) => (v >= 0 ? 1 : 0));
  }

  nearestNode(p, mainOnly = true, reach = 6) {
    let best = -1, bd = Infinity;
    const [ix, , iz] = this.toCell(p.x, p.y, p.z);
    const bx = ix & ~1, bz = iz & ~1;
    for (let dz = -reach; dz <= reach; dz += 2)
      for (let dx = -reach; dx <= reach; dx += 2) {
        const cx = bx + dx, cz = bz + dz;
        if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) continue;
        const list = this.floors[cz * this.nx + cx];
        if (!list) continue;
        for (const iy of list) {
          const j = this.navKey.get(`${cx},${cz},${iy}`);
          if (j === undefined || (mainOnly && !this.navMain[j])) continue;
          const n = this.nav[j];
          const d = (n.x - p.x) ** 2 + (n.z - p.z) ** 2 + 4 * (n.y - (p.y)) ** 2;
          if (d < bd) { bd = d; best = j; }
        }
      }
    if (best < 0 && mainOnly && reach < 20) return this.nearestNode(p, true, reach + 8);
    return best;
  }

  // BFS path between nav nodes (grid is uniform so BFS ~ shortest)
  path(fromIdx, toIdx, maxNodes = 40000) {
    if (fromIdx < 0 || toIdx < 0) return null;
    const prev = new Map([[fromIdx, -1]]);
    const q = [fromIdx];
    for (let h = 0; h < q.length && q.length < maxNodes; h++) {
      const c = q[h];
      if (c === toIdx) break;
      for (const n of this.nav[c].n) if (!prev.has(n)) { prev.set(n, c); q.push(n); }
    }
    if (!prev.has(toIdx)) return null;
    const out = [];
    for (let c = toIdx; c !== -1; c = prev.get(c)) out.push(this.nav[c]);
    return out.reverse();
  }

  // ---- smarter queries for the entity: clearance-aware A*, floor-level walkability, smoothing
  // clearance of a node: 0 tight (~0.18m), 1 roomy (0.3m free), 2 open (0.45m free). Cached.
  navClear(i) {
    this._clear ||= new Int8Array(this.nav.length).fill(-1);
    if (this._clear[i] < 0) {
      const n = this.nav[i];
      this._clear[i] = !this.bodyFree(n.x, n.z, n.y + 0.45, n.y + 1.6, 0.3) ? 0 : !this.bodyFree(n.x, n.z, n.y + 0.45, n.y + 1.6, 0.45) ? 1 : 2;
    }
    return this._clear[i];
  }

  // A* over the nav graph with euclidean steps, costlier close to walls so routes keep off them
  navAstar(from, to, maxExpand = 60000) {
    if (from < 0 || to < 0) return null;
    const nav = this.nav, T = nav[to];
    const g = new Map([[from, 0]]), prev = new Map([[from, -1]]), closed = new Set();
    const h = (n) => Math.hypot(n.x - T.x, (n.y - T.y) * 1.5, n.z - T.z);
    const heap = [[h(nav[from]), from]];
    const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const COST = [1.8, 1.15, 1];
    let found = false;
    while (heap.length && closed.size < maxExpand) {
      const [, c] = pop();
      if (closed.has(c)) continue;
      if (c === to) { found = true; break; }
      closed.add(c);
      const A = nav[c], gc = g.get(c);
      for (const j of A.n) {
        if (closed.has(j)) continue;
        const B = nav[j];
        const ng = gc + Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z) * COST[this.navClear(j)];
        if (ng < (g.get(j) ?? Infinity)) { g.set(j, ng); prev.set(j, c); push([ng + h(B), j]); }
      }
    }
    if (!found) return null;
    const out = [];
    for (let c = to; c !== -1; c = prev.get(c)) out.push(nav[c]);
    return out.reverse();
  }

  // can a body walk straight from a to b on the floor (not over tables, through rails or walls)?
  // Every 10cm the column must hold a nav node near the expected floor height, at least as
  // roomy as `minClear`.
  navWalkable(a, b, minClear = 1) {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / 0.1));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, x = a.x + dx * t, z = a.z + dz * t, y = a.y + (b.y - a.y) * t;
      const ix = Math.round((x - this.ox) / this.res / 2 - 0.25) * 2, iz = Math.round((z - this.oz) / this.res / 2 - 0.25) * 2;
      const list = this.floors[iz * this.nx + ix];
      if (!list) return false;
      let ok = false;
      for (const iy of list) {
        if (Math.abs(this.oy + (iy + 1) * this.res - y) > 0.35) continue;
        const j = this.navKey.get(`${ix},${iz},${iy}`);
        if (j !== undefined && this.navClear(j) >= minClear) { ok = true; break; }
      }
      if (!ok) return false;
    }
    return true;
  }

  // string-pull a node path into a few straight, walkable legs
  // (only the first `upTo` nodes: the rest is replanned long before she gets there)
  navSmooth(path, maxLook = 40, upTo = 90) {
    if (!path || path.length < 3) return path;
    const out = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      if (i >= upTo) { out.push(...path.slice(i + 1)); break; }
      const ci = Math.min(1, this.navClear(this.navKey.get(`${path[i].ix},${path[i].iz},${path[i].iy}`)));
      let j = Math.min(path.length - 1, i + maxLook);
      while (j > i + 1 && !this.navWalkable(path[i], path[j], Math.min(ci, this.navClear(this.navKey.get(`${path[j].ix},${path[j].iz},${path[j].iy}`))))) j--;
      out.push(path[j]);
      i = j;
    }
    return out;
  }

  // Distances (in node hops) from a source over the whole nav graph.
  flood(fromIdx) {
    const dist = new Int32Array(this.nav.length).fill(-1);
    if (fromIdx < 0) return dist;
    dist[fromIdx] = 0;
    const q = [fromIdx];
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      for (const n of this.nav[c].n) if (dist[n] < 0) { dist[n] = dist[c] + 1; q.push(n); }
    }
    return dist;
  }
}
