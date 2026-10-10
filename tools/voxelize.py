"""Build a collision voxel grid from the splats themselves.

Output (world frame, y-up: X=x, Y=-y, Z=-z):
  public/assets/vox.bin  - uint8 occupancy, index = (iy*NZ + iz)*NX + ix
  public/assets/vox.json - grid metadata
"""
import sys, json, numpy as np
sys.path.insert(0, 'tools')
from plyio import load_ply

src, outdir = sys.argv[1], sys.argv[2]
RES = 0.1
v = load_ply(src)
X0, Y0, Z0 = -6.5, -2.0, -5.5          # world-space min corner
NX, NY, NZ = int(26 / RES), int(7 / RES), int(38.5 / RES)
count = np.zeros(NX * NY * NZ, np.float32)
CH = 2_000_000
for s in range(0, len(v), CH):
    c = v[s:s + CH]
    op = 1 / (1 + np.exp(-c['opacity']))
    smax = np.exp(np.maximum(np.maximum(c['scale_0'], c['scale_1']), c['scale_2']))
    m = (op > 0.05) & (smax < 0.8)
    wx, wy, wz = c['x'][m], -c['y'][m], -c['z'][m]
    ix = ((wx - X0) / RES).astype(np.int32)
    iy = ((wy - Y0) / RES).astype(np.int32)
    iz = ((wz - Z0) / RES).astype(np.int32)
    ok = (ix >= 0) & (ix < NX) & (iy >= 0) & (iy < NY) & (iz >= 0) & (iz < NZ)
    lin = (iy[ok] * NZ + iz[ok]) * NX + ix[ok]
    count += np.bincount(lin, weights=op[m][ok], minlength=count.size).astype(np.float32)
# store opacity-weighted density (x10), capped, so the runtime can pick a threshold
dens = np.minimum(count * 10, 255).astype(np.uint8)
dens.tofile(f'{outdir}/vox.bin')
json.dump(dict(res=RES, origin=[X0, Y0, Z0], dims=[NX, NY, NZ]), open(f'{outdir}/vox.json', 'w'))
print('occupied (sum op>=0.5):', (count >= 0.5).sum(), 'of', count.size)
