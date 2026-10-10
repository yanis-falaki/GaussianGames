#!/usr/bin/env bash
# Rebuild game assets from the downloaded scan zip.
#   tools/build_assets.sh "URBEX Sanatorium Inside - Part01.zip"
set -euo pipefail
ZIP="${1:-URBEX Sanatorium Inside - Part01.zip}"
cd "$(dirname "$0")/.."
mkdir -p raw raw/lod public/assets
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -q numpy pillow; }
[ -f raw/scene.ply ] || unzip -o -q "$ZIP" -d raw
.venv/bin/python -I tools/preprocess.py raw/scene.ply raw/clean.ply      # crop + drop floaters
.venv/bin/python -I tools/voxelize.py raw/clean.ply public/assets       # collision grid
if [ ! -x ext/spark/rust/target/release/build-lod ]; then
  git clone -q --depth 1 --branch v2.2.0 https://github.com/sparkjsdev/spark.git ext/spark
  (cd ext/spark && git apply ../../tools/build-lod-no-lod.patch)   # adds --no-lod (plain SPZ output)
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
echo "done: $(du -sh public/assets | cut -f1) in public/assets"
