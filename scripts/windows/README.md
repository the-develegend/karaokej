# Karaokej on Windows

This folder is a production package: the built web UI, the NestJS API, a portable Node.js 22 runtime, and (when packed from a machine that already had one) the SQLite catalogue.

YT Saver is **not** installed or configured here. Use yt-dlp for YouTube download.

## 1. Copy this folder

Copy the entire `deploy-windows` folder to the Windows PC (USB, network share, zip). Do not copy a WSL/Linux `node_modules` from the development machine.

Suggested location: `C:\karaokej`

## 2. Map the music share (manual)

The catalogue stores paths relative to three folders. The drive letter can be anything; the folder names must stay `Music`, `Stephanie`, and `Unsorted`.

```powershell
net use Z: \\SERVER\Audio /persistent:yes
```

Replace `\\SERVER\Audio` with your share. The drive must be **read-write** if you want ratings, lyrics, or tag edits written back to files.

Confirm these exist:

- `Z:\Music`
- `Z:\Stephanie`
- `Z:\Unsorted`

## 3. Run setup

In PowerShell, from this folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

Setup will:

- Use the bundled Node 22 (no system Node required)
- Ask for library folders (default `Z:/Music,Z:/Stephanie,Z:/Unsorted`)
- Write `.env`
- Run `npm ci --omit=dev`
- Try to install **ffmpeg** and **yt-dlp** with winget
- Add a Windows Firewall rule for TCP 3000 if you ran the script as Administrator

Unattended:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -NonInteractive -LibraryPath "Z:/Music,Z:/Stephanie,Z:/Unsorted"
```

Skip winget:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -SkipWinget
```

## 4. Start the app

```powershell
.\start.ps1
```

Then open:

- This PC: http://localhost:3000
- Phones / TV: `http://<windows-lan-ip>:3000`
- Singer display: `http://<windows-lan-ip>:3000/karaoke`

If the catalogue was packed with this folder, **do not scan on first open**. Search and play. Scan later only to pick up new files.

## Manual steps the script cannot do

1. **Map the network share** (needs the UNC path and credentials). See section 2.
2. **ffmpeg** — required for cover thumbnails and yt-dlp post-processing. Setup tries winget (`Gyan.FFmpeg`). If that fails, install ffmpeg and re-run `setup.ps1`.
3. **yt-dlp** — optional, for YouTube search/download. Setup tries winget (`yt-dlp.yt-dlp`). Re-run setup after installing so `.env` picks up the path.
4. **Demucs** — optional AI vocal removal. Install Python 3.11+, then `pipx install demucs` or `pip install demucs`. Set `DEMUCS_PATH` to the full `demucs.exe` path (Windows PATH lookup needs a full path). First stem job on this PC regenerates; old Linux cache paths are ignored.
5. **Execution policy** — if scripts are blocked, use `-ExecutionPolicy Bypass` as shown above.
6. **Firewall** — if setup was not elevated, add inbound TCP 3000 on the Private profile:

```powershell
netsh advfirewall firewall add rule name="Karaokej HTTP 3000" dir=in action=allow protocol=TCP localport=3000 profile=private
```

The PC’s network profile must be **Private** or other LAN devices will not connect.

## After setup

On Settings, configure library folders (with Apply / Rebase when paths change) and verify whether ffmpeg, yt-dlp, and Demucs were found.

Supported audio: `.mp3`, `.flac`, `.opus`.
