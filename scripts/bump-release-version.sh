#!/usr/bin/env bash
# Bump release version (last numeric segment) before packaging.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

new_version="$(ROOT="$ROOT" node <<'NODE'
const fs = require('fs');
const root = process.env.ROOT;
const paths = [
  `${root}/apps/desktop/package.json`,
  `${root}/package.json`,
];
const desktop = JSON.parse(fs.readFileSync(paths[0], 'utf8'));
const v = String(desktop.version);
const m = v.match(/^(.+\.)(\d+)$/);
if (!m) {
  console.error(`Cannot bump version format: ${v}`);
  process.exit(1);
}
const next = `${m[1]}${Number(m[2]) + 1}`;
for (const file of paths) {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.version = next;
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}
console.log(next);
NODE
)"

echo "Release version bumped to ${new_version}"
