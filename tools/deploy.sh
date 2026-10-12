#!/usr/bin/env bash
# One-step deploy to Cloudflare:  npm run deploy
#   The site goes to Cloudflare Pages, with the streamed scan (assets/lite/, chunks of a few MB
#   each, which both quality tiers draw) as plain static files. The single-file scan for the ?spz developer
#   switch (too big for a Pages file) goes to an R2 bucket when it exists, streamed back on the
#   same domain by functions/scan/[name].js.
#   First time only: `npx wrangler login` (opens a browser). Needs the built scans (npm run assets).
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=gaussiangames
BUCKET=gaussiangames-scans
SCAN=public/assets/sanatorium.spz
W="npx --no-install wrangler"

for d in public/assets/lite; do
  ls "$d"/*.rad >/dev/null 2>&1 || { echo "Missing $d. Build the assets first: npm run assets -- <scan.zip>"; exit 1; }
done
$W whoami 2>/dev/null | grep -qi "logged in" || { echo "Not logged in to Cloudflare. Run once: npx wrangler login"; exit 1; }

echo "== build"
VITE_SCAN_URL=scan/sanatorium.spz npx vite build --logLevel warn
# Pages can't hold files over 25MB: the single-file scan is served from R2; the single-file LoD tree
# and bench data aren't hosted
rm -f dist/assets/sanatorium.spz dist/assets/sanatorium-lod*
rm -rf dist/assets/bench dist/assets/full   # full/: an unused SH3 LoD build, not shipped
big=$(find dist -type f -size +25M)
[ -z "$big" ] || { echo "Files too big for Pages:"; echo "$big"; exit 1; }

echo "== single-file scan (?spz)"
mkdir -p .deploy
if [ ! -f "$SCAN" ]; then
  echo "no $SCAN, skipping"
elif [ "$(cat .deploy/scan.sha256 2>/dev/null)" = "$(sha256sum "$SCAN" | cut -d' ' -f1)" ]; then
  echo "unchanged, skipping upload"
else
  $W r2 bucket create "$BUCKET" >/dev/null 2>&1 || true
  $W r2 object put "$BUCKET/sanatorium.spz" --file "$SCAN" --content-type application/octet-stream --remote
  sha256sum "$SCAN" | cut -d' ' -f1 > .deploy/scan.sha256
fi

echo "== site"
$W pages project create "$PROJECT" --production-branch main >/dev/null 2>&1 || true
$W pages deploy dist --project-name "$PROJECT" --branch main --commit-dirty=true
