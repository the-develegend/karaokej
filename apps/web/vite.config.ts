import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const devOrigin = env.VITE_DEV_ORIGIN?.trim();
  const devHmrDisabled = env.VITE_DEV_HMR === 'false';

  const lanHmr =
    devOrigin && !devHmrDisabled
      ? {
          host: new URL(devOrigin).hostname,
          port: 5173,
          clientPort: 5173,
        }
      : devOrigin && devHmrDisabled
        ? false
        : undefined;

  return {
    envDir: repoRoot,
    plugins: [react()],
    resolve: {
      alias: {
        '@karaokej/shared': fileURLToPath(
          new URL('../../packages/shared/src/index.ts', import.meta.url),
        ),
      },
    },
    server: {
      port: 5173,
      host: true,
      cors: true,
      forwardConsole: true,
      ...(devOrigin ? { origin: devOrigin } : {}),
      ...(lanHmr !== undefined ? { hmr: lanHmr } : {}),
      proxy: {
        // Dev API is fixed at 3002 so the proxy has a stable target (Electron uses an ephemeral port).
        '/api': 'http://127.0.0.1:3002',
        '/ws': {
          target: 'ws://127.0.0.1:3002',
          ws: true,
        },
      },
    },
    preview: {
      port: 5173,
    },
  };
});
