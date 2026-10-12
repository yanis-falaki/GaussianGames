// How far each point in space is from the walkable building: 0 inside rooms (where you can
// stand), growing outside walls, ceilings and into the unscanned void. Splats use it in the
// vertex shader to ripple and dissolve into haze at the edge of the world.
import * as THREE from "three";

const CELL = 0.25;      // m
const AIR = 2.8;        // walkable air above each floor (m)
const MAX_D = 16;       // cells (4m) — beyond this it's simply "outside"

export function buildEdgeField(world) {
  const ox = world.ox, oy = world.oy, oz = world.oz;
  const nx = Math.ceil((world.nx * world.res) / CELL), ny = Math.ceil((world.ny * world.res) / CELL), nz = Math.ceil((world.nz * world.res) / CELL);
  const dist = new Uint8Array(nx * ny * nz).fill(255);
  const idx = (x, y, z) => (z * ny + y) * nx + x;
  const queue = [];
  // seeds: the air above every reachable floor node
  for (let i = 0; i < world.nav.length; i++) {
    if (!world.navMain[i]) continue;
    const n = world.nav[i];
    const cx = Math.floor((n.x - ox) / CELL), cz = Math.floor((n.z - oz) / CELL);
    const y0 = Math.floor((n.y - oy) / CELL), y1 = Math.floor((n.y + AIR - oy) / CELL);
    for (let y = Math.max(0, y0); y <= Math.min(ny - 1, y1); y++) {
      if (cx < 0 || cz < 0 || cx >= nx || cz >= nz) continue;
      const k = idx(cx, y, cz);
      if (dist[k] !== 0) { dist[k] = 0; queue.push(k); }
    }
  }
  // breadth-first distance transform (6-neighbour, in cells)
  for (let h = 0; h < queue.length; h++) {
    const k = queue[h], d = dist[k];
    if (d >= MAX_D) continue;
    const x = k % nx, y = Math.floor(k / nx) % ny, z = Math.floor(k / (nx * ny));
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
      const j = idx(X, Y, Z);
      if (dist[j] > d + 1) { dist[j] = d + 1; queue.push(j); }
    }
  }
  // store metres * 50 (0..255 => 0..5.1m)
  const data = new Uint8Array(dist.length);
  for (let i = 0; i < dist.length; i++) data[i] = Math.min(255, dist[i] === 255 ? 255 : Math.round(dist[i] * CELL * 50));
  const tex = new THREE.Data3DTexture(data, nx, ny, nz);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return {
    tex,
    origin: new THREE.Vector3(ox, oy, oz),
    size: new THREE.Vector3(nx * CELL, ny * CELL, nz * CELL),
  };
}
