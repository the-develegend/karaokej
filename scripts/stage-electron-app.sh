#!/usr/bin/env bash
# Stage production NestJS bundle (packed under resources/karaokej-server).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$ROOT/dist/electron-app"

log() {
  printf '==> %s\n' "$*"
}

cd "$ROOT"
log "Building workspaces"
npm run build

log "Preparing $STAGE"
rm -rf "$STAGE"
mkdir -p "$STAGE/apps/web"
cp -a "$ROOT/apps/web/dist" "$STAGE/apps/web/"

# The API and its dependencies ship as two bundled files instead of node_modules.
log "Bundling API"
node scripts/bundle-api.mjs "$STAGE"

log "Stage ready at dist/electron-app"
