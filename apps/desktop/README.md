# Electron Windows installer

Karaokej ships as a Windows desktop app with an NSIS installer. The Electron window loads the same web UI from the Nest API on **127.0.0.1** with an **ephemeral port** (OS-assigned). The resolved base URL is exposed to the renderer over IPC.

## Build from WSL

Requirements:

- Node.js 22+
- `unzip`, `zip`, `curl`
- On Linux/WSL, `npm run dist:win` applies a small electron-builder patch so the NSIS uninstaller is extracted without Wine (Debian’s default Wine often lacks `wine32`, which breaks the stock flow).

```bash
npm install
npm run dist:win
```

Each `dist:win` run bumps the patch segment in `apps/desktop/package.json` (and the repo root `package.json`) so the installer version increases (`0.1.0` → `0.1.1`, …).

Output: `release/Karaokej-Setup-<version>.exe`

The setup exe cannot be run under WSL. Verify the build finished, then test install, firewall, yt-dlp update, and Demucs on a Windows PC.

### What the installer includes

| Component | Required | Notes |
|-----------|----------|--------|
| Electron 44 + Nest API + web UI | Yes | `resources/app/` |
| ffmpeg + ffprobe | Yes | `resources/bin/` |
| yt-dlp | Yes | Self-updates daily via `yt-dlp -U` |
| Demucs (CPU, offline) | Optional | Wizard prompt at install; ~2 GB inside the setup exe |

Portable data lives next to `Karaokej.exe`: `data/karaokej.sqlite`, `data/covers/`, `data/karaoke-stems/`. Music library folders are stored in settings inside the database (legacy `data/config.json` or `MUSIC_LIBRARY_PATH` may seed them once on first start).

**Node.js:** not required on the PC. The app ships Electron (Chromium + Node). The API runs via `ELECTRON_RUN_AS_NODE` on `Karaokej.exe`.

### Startup

The API ships as two bundled files (`resources/karaokej-server/apps/api/dist/main.js` and `scan.worker.js`, built by `scripts/bundle-api.mjs`) instead of `node_modules`, because Windows scans every newly installed file on its first read. A startup screen shows while the API starts. Each launch writes step timings and the API's startup output to `%APPDATA%\Karaokej\startup.log`.

### NSIS install logs (Windows)

To capture what the installer did (including Demucs extract):

```powershell
& ".\Karaokej-Setup-0.1.0.exe" /LOG="$env:TEMP\karaokej-install.log"
```

Open `%TEMP%\karaokej-install.log` after the wizard finishes. Demucs failures usually show in the PowerShell step inside `DetailPrint` lines.

Upgrades from a broken older build: the custom NSIS scripts only treat **Karaokej.exe** as a blocking process (not every file under the install folder), clear stale uninstall registry when the uninstaller exe is missing, and if the old silent uninstall fails they remove the old program files while keeping `data/` when possible.

### Faster / partial builds

```bash
# Binaries only (skips ffmpeg/yt-dlp when already in vendor/win/bin; ffmpeg zips cached under vendor/win/cache)
bash scripts/fetch-vendor-win.sh

# Force re-download
FORCE_VENDOR=1 bash scripts/fetch-vendor-win.sh

# Skip Demucs wheel download (placeholder zip; optional install will fail until rebuilt)
SKIP_DEMUCS=1 bash scripts/build-demucs-runtime.sh

# Stage app without packaging
bash scripts/stage-electron-app.sh
```

### Upgrades

Run a newer `Karaokej-Setup-*.exe`. NSIS upgrades in place using the same app id. The custom uninstall step moves `data/` aside before old program files are removed, then restores it before new files are laid down (sqlite, covers, stems, and `config.json` stay put). A full uninstall from Settings still removes the install folder including `data/`.

### App icon

The Windows app and installer use `build/icon.ico` (stylized **"OK"** in theme gold `#ffe08a` / `#e2b84a` on a dark panel). Source: `build/icon.svg`. Regenerate PNG/ICO after editing:

```bash
npm run icons -w karaokej-desktop
```

### Signing

Installers are unsigned by default (SmartScreen warning). Add a code-signing step to the electron-builder config when you have a certificate.

## Development

Day-to-day work stays on `npm run dev` (browser + Vite). Electron is only the packaged product.

The legacy portable folder flow remains: `npm run pack:windows` → `deploy-windows/`.
