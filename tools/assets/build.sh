#!/usr/bin/env bash
# Build the game assets from the downloaded scan zip (npm run assets -- <zip>): the cleaned full
# scan, the LoD tree, the lite streamed scene and the collision voxel grid, into public/assets.
#   tools/assets/build.sh "URBEX Sanatorium Inside - Part01.zip"
set -euo pipefail
ZIP="${1:-URBEX Sanatorium Inside - Part01.zip}"
cd "$(dirname "$0")/../.."
mkdir -p raw raw/lod public/assets
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -q numpy pillow; }
[ -f raw/scene.ply ] || unzip -o -q "$ZIP" -d raw
.venv/bin/python -I tools/assets/preprocess.py raw/scene.ply raw/clean.ply      # crop + drop floaters
.venv/bin/python -I tools/assets/voxelize.py raw/clean.ply public/assets       # collision grid
if [ ! -x ext/spark/rust/target/release/build-lod ]; then
  git clone -q --depth 1 --branch v2.2.0 https://github.com/sparkjsdev/spark.git ext/spark
  (cd ext/spark && git apply ../../tools/assets/build-lod-no-lod.patch)   # adds --no-lod (plain SPZ output)
  (cd ext/spark/rust/build-lod && cargo build --release)
fi
# all original splats, no LoD (the default scene)
ln -f raw/clean.ply raw/lod/sanatorium.ply
(cd raw/lod && ../../ext/spark/rust/target/release/build-lod --no-lod sanatorium.ply)
mv raw/lod/sanatorium.spz public/assets/
# budgeted LoD tree (?lod fallback for weaker GPUs)
(cd raw/lod && ../../ext/spark/rust/target/release/build-lod --quality --rad sanatorium.ply)
rm raw/lod/sanatorium.ply
mv raw/lod/sanatorium-lod* public/assets/
# lite scene for integrated GPUs (src/shared/quality.js): degree-1 colour, chunked LoD tree streamed by
# Spark's pager. Slimming the PLY first keeps build-lod's memory use down.
mkdir -p raw/lite public/assets/lite
.venv/bin/python -I tools/assets/slim_ply.py raw/clean.ply raw/lite/sanatorium-lite.ply
(cd raw/lite && ../../ext/spark/rust/target/release/build-lod --quality --rad-chunked --max-sh=1 sanatorium-lite.ply)
mv raw/lite/sanatorium-lite-lod* public/assets/lite/
rm raw/lite/sanatorium-lite.ply
echo "done: $(du -sh public/assets | cut -f1) in public/assets"
