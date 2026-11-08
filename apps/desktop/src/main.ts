import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  type WriteStream,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { splashHtml } from './splash';

const API_HOST = '127.0.0.1';

let apiProcess: ChildProcess | null = null;
let apiPid: number | null = null;
let apiBaseUrl: string | null = null;
let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;

const launchedAt = Date.now();
let startupLog: WriteStream | null = null;
let startupComplete = false;

function startupLogPath(): string {
  return join(app.getPath('userData'), 'startup.log');
}

function openStartupLog(): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    startupLog = createWriteStream(startupLogPath(), { flags: 'w' });
  } catch {
    startupLog = null;
  }
}

function log(message: string): void {
  const line = `[+${((Date.now() - launchedAt) / 1000).toFixed(2)}s] ${message}`;
  console.log(line);
  startupLog?.write(`${line}\n`);
}

function karaokeRoot(): string {
  return dirname(process.execPath);
}

function packagedAppRoot(): string {
  return join(process.resourcesPath, 'karaokej-server');
}

function resourceBin(name: string): string {
  return join(process.resourcesPath, 'bin', name);
}

function buildApiEnv(): NodeJS.ProcessEnv {
  const root = karaokeRoot();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    KARAOKEJ_ROOT: root,
    HOST: API_HOST,
    // Let the OS assign an ephemeral port; parsed from the API's listening log line.
    PORT: '0',
    FFMPEG_PATH: resourceBin('ffmpeg.exe'),
    FFPROBE_PATH: resourceBin('ffprobe.exe'),
    YTDLP_PATH: resourceBin('yt-dlp.exe'),
    YTDLP_NODE_PATH: process.execPath,
    YTDLP_SELF_UPDATE: '1',
    DEMUCS_EXTRA_ARGS: '--device cpu',
  };

  const demucsPython = join(root, 'demucs-runtime', 'python.exe');
  if (existsSync(demucsPython)) {
    env.DEMUCS_PATH = demucsPython;
    env.DEMUCS_PYTHON_MODULE = 'demucs';
  }

  return env;
}

function apiEntryPath(): string {
  return join(packagedAppRoot(), 'apps', 'api', 'dist', 'main.js');
}

function parseListeningPort(text: string): number | null {
  const match = text.match(/Karaokej listening on https?:\/\/[^/\s]+:(\d+)/i);
  if (!match) {
    return null;
  }
  const port = Number(match[1]);
  return Number.isFinite(port) && port > 0 ? port : null;
}

async function waitForApi(port: number, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://${API_HOST}:${port}/api/library/status`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`API did not start within ${timeoutMs / 1000}s`);
}

/** API output goes to the startup log until the window is shown, so a packaged app (no console) can be diagnosed. */
function logApiOutput(chunk: Buffer): void {
  if (startupComplete) {
    return;
  }
  for (const line of String(chunk).split(/\r?\n/)) {
    if (line.trim()) {
      log(`api: ${line}`);
    }
  }
}

/**
 * Start the API. `listening` resolves with the OS-assigned port when the process
 * reports that it accepts connections; `exited` rejects if it stops first.
 */
function startApi(): { listening: Promise<number>; exited: Promise<never> } {
  const entry = apiEntryPath();
  if (!existsSync(entry)) {
    throw new Error(`API entry missing: ${entry}`);
  }
  const child = spawn(process.execPath, [entry], {
    cwd: packagedAppRoot(),
    env: buildApiEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  apiProcess = child;
  apiPid = child.pid ?? null;
  // Windows takes about a second to refuse a connection to a closed local port,
  // so polling notices the API late; its "listening" line is immediate and
  // includes the ephemeral port assigned for PORT=0.
  let stdoutTail = '';
  let resolved = false;
  const listening = new Promise<number>((resolve, reject) => {
    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(`[api] ${chunk}`);
      logApiOutput(chunk);
      stdoutTail = (stdoutTail + String(chunk)).slice(-500);
      if (resolved) {
        return;
      }
      const port = parseListeningPort(stdoutTail);
      if (port != null) {
        resolved = true;
        resolve(port);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[api] ${chunk}`);
      logApiOutput(chunk);
      // Nest may log listen failures on stderr before exiting.
      if (!resolved && /EADDRINUSE|EACCES|listen/i.test(String(chunk))) {
        log(`api stderr hint: ${String(chunk).trim()}`);
      }
    });
    // If the process closes stdout without a listening line, fail clearly.
    child.stdout?.on('end', () => {
      if (!resolved) {
        reject(new Error('API process ended before reporting a listening port.'));
      }
    });
  });
  const exited = new Promise<never>((_, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`API exited with code ${code} signal ${signal ?? ''}`);
      }
      apiProcess = null;
      apiPid = null;
      apiBaseUrl = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('karaokej:api-exited', { code, signal });
      }
      reject(new Error(`The Karaokej server stopped during startup (exit code ${code ?? signal}).`));
    });
  });
  return { listening, exited };
}

function killProcessTree(pid: number, force: boolean): void {
  if (process.platform === 'win32') {
    const args = force
      ? ['/PID', String(pid), '/T', '/F']
      : ['/PID', String(pid), '/T'];
    spawnSync('taskkill', args, { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    /* already gone */
  }
}

function stopApi(force = false): void {
  const proc = apiProcess;
  const pid = proc?.pid ?? apiPid;
  apiProcess = null;
  apiBaseUrl = null;
  if (pid == null) {
    apiPid = null;
    return;
  }

  try {
    // Prefer SIGTERM so Nest enableShutdownHooks can close SQLite cleanly.
    proc?.kill(force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    /* already gone */
  }

  killProcessTree(pid, force);
  if (!force) {
    const termPid = pid;
    setTimeout(() => {
      killProcessTree(termPid, true);
    }, 2_000);
  }
  apiPid = null;
}

function windowIconPath(): string | undefined {
  const candidates = [
    join(__dirname, '..', 'build', 'icon.png'),
    join(process.resourcesPath, 'icon.png'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }
  return undefined;
}

let splashLoaded = false;
const pendingSplashCalls: string[] = [];

function runSplashCall(call: string): void {
  if (!splashWindow || splashWindow.isDestroyed()) {
    return;
  }
  splashWindow.webContents.executeJavaScript(call).catch(() => {});
}

/** Call a method on the splash page's window.karaokejSplash object, queued until the page has loaded. */
function splash(method: string, ...args: unknown[]): void {
  const call = `window.karaokejSplash?.${method}(...${JSON.stringify(args)})`;
  if (splashLoaded) {
    runSplashCall(call);
  } else {
    pendingSplashCalls.push(call);
  }
}

async function createSplash(): Promise<void> {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 300,
    resizable: false,
    maximizable: false,
    frame: false,
    center: true,
    backgroundColor: '#14121c',
    icon: windowIconPath(),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
  try {
    await splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`);
    log('splash shown');
    splashLoaded = true;
    for (const call of pendingSplashCalls.splice(0)) {
      runSplashCall(call);
    }
  } catch (err) {
    log(`splash failed: ${String(err)}`);
  }
}

async function step<T>(id: string, label: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  log(`${label}…`);
  splash('start', id, startedAt);
  const result = await fn();
  splash('done', id, Date.now());
  log(`${label} done in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
  return result;
}

/** Resolves once the main window has rendered and is shown. */
function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    icon: windowIconPath(),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const shown = new Promise<void>((resolve) => {
    mainWindow?.once('ready-to-show', () => {
      mainWindow?.show();
      splashWindow?.close();
      resolve();
    });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (!apiBaseUrl) {
    throw new Error('API base URL is not ready');
  }
  void mainWindow.loadURL(`${apiBaseUrl}/`);
  return shown;
}

function isFirstStartOfThisInstall(): { firstRun: boolean; markInstallStarted: () => void } {
  const marker = join(app.getPath('userData'), 'last-started-install.txt');
  const installId = `${app.getVersion()} ${statSync(process.execPath).mtimeMs}`;
  let firstRun = true;
  try {
    firstRun = readFileSync(marker, 'utf8') !== installId;
  } catch {
    /* first start */
  }
  return {
    firstRun,
    markInstallStarted: () => {
      try {
        writeFileSync(marker, installId);
      } catch {
        /* not critical */
      }
    },
  };
}

async function boot(): Promise<void> {
  openStartupLog();
  log(`Karaokej ${app.getVersion()} starting`);
  splash('setSteps', [
    { id: 'api', label: 'Starting server' },
    { id: 'ui', label: 'Loading interface' },
  ]);
  const install = isFirstStartOfThisInstall();
  if (install.firstRun) {
    splash(
      'note',
      'The first start after installing or updating takes longer while Windows checks the new files.',
    );
  }

  // Start the API before creating the splash; it is by far the slowest step.
  const apiReady = step('api', 'Starting server', async () => {
    const { listening, exited } = startApi();
    const port = await Promise.race([listening, exited]);
    apiBaseUrl = `http://${API_HOST}:${port}`;
    log(`API listening on ${apiBaseUrl}`);
    await Promise.race([waitForApi(port), exited]);
    return port;
  });
  apiReady.catch(() => {});

  await createSplash();
  await apiReady;
  await step('ui', 'Loading interface', createWindow);

  startupComplete = true;
  log('startup complete');
  startupLog?.end();
  startupLog = null;
  install.markInstallStarted();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = mainWindow ?? splashWindow;
    if (win) {
      if (win.isMinimized()) {
        win.restore();
      }
      win.focus();
    }
  });

  app.whenReady().then(() => {
    ipcMain.handle('karaokej:pick-library-folders', async () => {
      const result =
        mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory', 'multiSelections'],
            })
          : await dialog.showOpenDialog({
              properties: ['openDirectory', 'multiSelections'],
            });
      if (result.canceled) {
        return [] as string[];
      }
      return result.filePaths;
    });

    ipcMain.handle('karaokej:get-api-base-url', () => {
      if (!apiBaseUrl) {
        throw new Error('API is not ready');
      }
      return apiBaseUrl;
    });

    void boot().catch((err) => {
      log(`startup failed: ${err instanceof Error ? err.stack : String(err)}`);
      stopApi(true);
      splashWindow?.destroy();
      dialog.showErrorBox(
        'Karaokej failed to start',
        `${err instanceof Error ? err.message : String(err)}\n\nDetails: ${startupLogPath()}`,
      );
      app.quit();
    });
  });

  app.on('window-all-closed', () => {
    stopApi(false);
    app.quit();
  });

  app.on('before-quit', () => {
    stopApi(false);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      stopApi(false);
      app.quit();
    });
  }

  process.on('exit', () => {
    if (apiPid != null) {
      killProcessTree(apiPid, true);
    }
  });
}
