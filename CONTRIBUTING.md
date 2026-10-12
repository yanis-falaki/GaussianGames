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

`npm run deploy` (`tools/deploy.sh`) builds with `VITE_SCAN_URL=scan/sanatorium.spz`, uploads the scan to the R2 bucket only when it has changed, and publishes `dist/` to the `gaussiangames` Cloudflare Pages project. `functions/scan/[name].js` streams the scan from R2. Run `npx wrangler login` once first.

## Developer switches

These are URL parameters, never shown in the menus:

- `?debug`: exposes the game on `window` (`game`, `tp()`, `go()` in RESIDUE; `dev` in Undeveloped) and turns on `P` for a freeze frame (and `G` for a visible entity in RESIDUE).
- `?bench`: RESIDUE's benchmark API (`window.bench`, `src/residue/bench.js`).
- `?full` / `?lite`: force a quality tier. `?lod` loads the budgeted LoD tree. `?scene=<url>` loads another scene file.
- `?detail=`, `?alphacut=`, `?focal=`: override the splat budget, the alpha cut and Spark's focal adjustment. `?ext` uses the 32-byte splat encoding (RESIDUE).
- `?clean`: start RESIDUE without the camcorder filter.

## Tools

| Script | What it does |
| --- | --- |
| `tools/bench/server.sh` | isolated Vite server for headless runs (port 5182, or `PORT=5183`), no HMR |
| `tools/bench/fitness.mjs` | scores the current render settings: frame time, plus SSIM against reference captures (`--make-ref`) |
| `tools/bench/search.mjs` | evolutionary search over render settings with the same scoring |
| `tools/bench/shots.mjs` | screenshots RESIDUE's fixed benchmark views under given configs |
| `tools/author.mjs` | Undeveloped authoring: screenshot poses with a grid, turn picked pixels into 3D clue positions |
| `tools/deploy.sh` | the deploy above |

Headless runs load the full 225 MB scan. Run one at a time, under `flock /tmp/residue-gpu.lock` (`fitness.mjs` takes the lock itself). The scripts abort if RAM or GPU memory runs low.
