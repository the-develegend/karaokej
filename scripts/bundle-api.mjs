// Bundle the built Nest API into single files for the Electron package.
// On a fresh install Windows scans every file the first time it is read, so
// shipping thousands of node_modules files makes the first launch very slow.
// Usage: node scripts/bundle-api.mjs <stage-dir>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = process.argv[2];
if (!stage) {
  throw new Error('Usage: node scripts/bundle-api.mjs <stage-dir>');
}
const apiDist = path.join(root, 'apps/api/dist');

await build({
  // scan-worker-host.ts loads scan.worker.js from its own directory, which is the
  // bundle's directory after bundling.
  entryPoints: {
    main: path.join(apiDist, 'main.js'),
    'scan.worker': path.join(apiDist, 'library/scan.worker.js'),
  },
  outdir: path.join(stage, 'apps/api/dist'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  // music-metadata is ESM-only; Node's require() resolves it through module-sync.
  conditions: ['module-sync'],
  minify: true,
  keepNames: true,
  legalComments: 'none',
  logLevel: 'warning',
  // Optional packages that Nest and ws load in try/catch; the app uses none of them.
  external: [
    '@nestjs/microservices',
    '@nestjs/platform-socket.io',
    '@fastify/*',
    'class-validator',
    'class-transformer',
    'bufferutil',
    'utf-8-validate',
  ],
});
