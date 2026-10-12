"""Crop + clean the raw scan. Keeps the original (y-down) frame; the game flips it at runtime."""
import sys, numpy as np
sys.path.insert(0, 'tools/assets')
from plyio import load_ply

src, dst = sys.argv[1], sys.argv[2]
v = load_ply(src)
BOX = dict(x=(-6.5, 19.5), y=(-5.0, 2.0), z=(-33.0, 5.5))
keep = np.zeros(len(v), bool)
CH = 2_000_000
for s in range(0, len(v), CH):
    c = v[s:s + CH]
    m = np.ones(len(c), bool)
    for a, (lo, hi) in BOX.items():
        m &= (c[a] > lo) & (c[a] < hi)
    m &= c['opacity'] > np.log(0.02 / 0.98)           # opacity > 2%
    smax = np.maximum(np.maximum(c['scale_0'], c['scale_1']), c['scale_2'])
    m &= smax < np.log(0.8)                            # drop giant floaters
    keep[s:s + CH] = m
idx = np.nonzero(keep)[0]
print(f'keeping {len(idx)} / {len(v)}')
names = v.dtype.names
hdr = 'ply\nformat binary_little_endian 1.0\nelement vertex %d\n' % len(idx)
hdr += ''.join(f'property float {n}\n' for n in names) + 'end_header\n'
with open(dst, 'wb') as f:
    f.write(hdr.encode())
    for s in range(0, len(idx), CH):
        f.write(np.asarray(v[idx[s:s + CH]]).tobytes())
