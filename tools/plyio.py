import numpy as np
def load_ply(path):
    with open(path,'rb') as f:
        hdr=b''
        while not hdr.endswith(b'end_header\n'):
            hdr+=f.readline()
        off=len(hdr)
    lines=hdr.decode().split('\n')
    n=int([l for l in lines if l.startswith('element vertex')][0].split()[-1])
    props=[l.split()[-1] for l in lines if l.startswith('property')]
    dt=np.dtype([(p,'<f4') for p in props])
    return np.memmap(path,dtype=dt,mode='r',offset=off,shape=(n,))
