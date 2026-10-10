"""Write a copy of a 3DGS PLY with spherical harmonics cut to degree 1, streaming in slices so it
needs little memory. The input for the light (paged LoD) scene: build-lod then has far less to
hold in memory, and degree-1 colour is all the light scene keeps anyway.
    python tools/slim_ply.py raw/clean.ply raw/lite/sanatorium-lite.ply
"""
import sys
import numpy as np
sys.path.insert(0, 'tools')
from plyio import load_ply

src, dst = sys.argv[1], sys.argv[2]
v = load_ply(src)
n = len(v)
base = ['x', 'y', 'z', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'scale_0', 'scale_1', 'scale_2', 'opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2']
# f_rest is channel-major (15 coefficients per channel at degree 3); degree 1 is the first 3 of each
rest = [f'f_rest_{c * 15 + k}' for c in range(3) for k in range(3)]
names = base + [f'f_rest_{i}' for i in range(9)]
out_dt = np.dtype([(p, '<f4') for p in names])
header = 'ply\nformat binary_little_endian 1.0\nelement vertex %d\n' % n + ''.join(f'property float {p}\n' for p in names) + 'end_header\n'
with open(dst, 'wb') as f:
    f.write(header.encode())
    step = 500_000
    for i in range(0, n, step):
        s = v[i:i + step]
        o = np.empty(len(s), dtype=out_dt)
        for p in base:
            o[p] = s[p]
        for j, p in enumerate(rest):
            o[f'f_rest_{j}'] = s[p]
        f.write(o.tobytes())
print(f'wrote {n} splats with SH degree 1 to {dst}')
