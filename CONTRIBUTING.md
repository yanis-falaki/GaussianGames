# Contributing

## Run it locally

```bash
npm install
npm run assets -- "URBEX Sanatorium Inside - Part01.zip"   # once: builds public/assets from the scan
npm run dev                                               # menu at /, games at /residue.html, /undeveloped.html
```

`npm run build` writes the static site to `dist/`.

## Build the assets

`npm run assets` runs `tools/assets/build.sh`. It needs Python 3, Rust/cargo and about 10 GB of scratch disk. The steps:

| Script | What it does |
| --- | --- |
| `preprocess.py` | crops the raw scan to the building and drops floaters |
| `voxelize.py` | bins the splats into the 10 cm collision grid (`vox.bin`, `vox.json`) |
| `slim_ply.py` | cuts colour to SH degree 1, as input for the lite scene |
| `plyio.py` | memory-maps a PLY for the scripts above |
| `build-lod-no-lod.patch` | adds `--no-lod` (plain SPZ output) to Spark's `build-lod` |

The heavy outputs (`sanatorium.spz`, the `.rad` LoD files, `lite/`, `vox.bin`) are not in git.

## Deploy

`npm run deploy` (`tools/deploy.sh`) builds with `VITE_SCAN_URL=scan/sanatorium.spz`, uploads the single-file scan (for `?spz`) to the R2 bucket only when it has changed, and publishes `dist/` to the `gaussiangames` Cloudflare Pages project. The streamed scene both games draw (`public/assets/lite/`) ships as static files; `functions/scan/[name].js` streams the single-file scan from R2. Run `npx wrangler login` once first.

The site's public address, used by the link-preview tags (Open Graph, Twitter cards) in the three pages, is `VITE_SITE_URL` in `.env`.

## Developer switches

These are URL parameters, never shown in the menus:

- `?debug`: exposes the game on `window` (`game`, `tp()`, `go()` in RESIDUE; `dev` in Undeveloped, where `dev.photograph(id)` walks up to a clue and documents it and `dev.trails` holds the footprint legs) and turns on `P` for a freeze frame (and `G` for a visible entity in RESIDUE).
- `?bench`: the benchmark API (`window.bench`): `walk()` in both games (`src/shared/walk-bench.js`), plus RESIDUE's render-settings tools (`src/residue/bench.js`).
- `?full` / `?lite`: force a quality tier. `?spz` draws every original splat with no LoD (the old full mode), `?lod` the single-file LoD tree, `?scene=<url>` another scene file.
- `?detail=`, `?res=`, `?alphacut=`, `?focal=`: fix the splat budget or the render scale, override the alpha cut or Spark's focal adjustment. `?fixed` turns adaptive quality off. `?pages=` sets Spark's GPU page pool for streamed chunks. `?ext` uses the 32-byte splat encoding (RESIDUE).
- `?gpux=6`: draws the scene 6 times a frame, a stand-in for a GPU 6 times slower.
- `?clean`: start RESIDUE without the camcorder filter.

## Tools

| Script | What it does |
| --- | --- |
| `tools/bench/server.sh` | isolated Vite server for headless runs (port 5182, or `PORT=5183`), no HMR |
| `tools/bench/walk.mjs` | frame pacing of either game on a fixed walk through the building (`--params lite`, `--size`, `--dpr`, `--cpu` throttling, `--cfgs`) |
| `tools/bench/fitness.mjs` | scores the current render settings: frame time, plus SSIM against reference captures (`--make-ref`) |
| `tools/bench/search.mjs` | evolutionary search over render settings with the same scoring |
| `tools/bench/shots.mjs` | screenshots RESIDUE's fixed benchmark views under given configs |
| `tools/author.mjs` | Undeveloped authoring: screenshot poses with a grid, turn picked pixels into 3D clue positions |
| `tools/deploy.sh` | the deploy above |

Run headless benchmarks one at a time, at low priority (`nice -n 19 ionice -c3`), under `flock /tmp/residue-gpu.lock` (`fitness.mjs` takes the lock itself). The scripts abort if RAM or GPU memory runs low.
