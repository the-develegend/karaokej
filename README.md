# Karaokej

Self-hosted karaoke for your local network. A NestJS API indexes a music folder; a React app plays audio in the browser and shows synchronized lyrics.

## Features

- Scan one or more music libraries into a local SQLite catalogue
- Search, queue, and play tracks from any device on the LAN
- Fetch missing `.lrc` lyrics from LRCLIB and keep them next to the audio files
- Large-type karaoke display at `/karaoke`
- Karaoke modes: normal playback, realtime vocal reduction, and optional AI vocal removal (Demucs)
- Playlists, ratings, and metadata edits written back to the files

## Install and run

Requires **Node.js 22+**.

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`, add your music folders on **Settings**, apply **Apply / Rebase** when you change them, then scan the library.

Optionally fetch lyrics, search and queue tracks, and open `/karaoke` for the singer display.

On first start, paths from legacy `MUSIC_LIBRARY_PATH` in `.env` (or desktop `data/config.json`) are copied into settings once if none are saved yet.

Production:

```bash
npm run build
npm start
```

Then open `http://<host>:3000`.

## Windows desktop installer (Electron)

From WSL, build an NSIS installer (bundled ffmpeg and yt-dlp; optional Demucs at install time):

```bash
npm run dist:win
```

See [apps/desktop/README.md](apps/desktop/README.md) for build requirements (bundled Wine on first run), upgrade behavior, and what to verify on a real Windows PC.

## Windows portable folder (legacy)

Copy-ready folder with portable Node (no Electron):

```bash
npm run pack:windows
```

Copy `deploy-windows/` to the Windows PC, then run `setup.ps1` and `start.ps1`. See `scripts/windows/README.md`.

## Dependencies

- **Node.js 22+** — runtime; the API uses the built-in `node:sqlite` driver
- **NestJS** — API, library scan, and WebSocket session
- **React** and **Vite** — web player and karaoke UI
- **LRCLIB** — optional lyric downloads
- **Demucs** — optional AI vocal removal (`pipx install demucs`)
