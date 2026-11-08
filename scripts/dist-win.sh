#!/usr/bin/env bash
# Build Karaokej Windows NSIS installer from WSL (requires wine for electron-builder).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bash scripts/bump-release-version.sh

bash scripts/patch-electron-builder-linux-nsis.sh

bash scripts/fetch-vendor-win.sh
bash scripts/build-demucs-runtime.sh
if [[ -f vendor/win/demucs-runtime.zip ]]; then
  demucs_bytes="$(wc -c <vendor/win/demucs-runtime.zip | tr -d ' ')"
  if [[ "$demucs_bytes" -lt 1000000 ]]; then
    echo "Warning: vendor/win/demucs-runtime.zip is only ${demucs_bytes} bytes (placeholder)." >&2
    echo "Demucs will fail if chosen at install. Build the full runtime (do not set SKIP_DEMUCS) before dist:win." >&2
  fi
fi
bash scripts/stage-electron-app.sh

npm install -w karaokej-desktop
npm run build -w karaokej-desktop
npm run pack -w karaokej-desktop

echo ""
echo "Installer output: release/Karaokej-Setup-*.exe"
echo "Test the full installer on a Windows PC (not under WSL)."
