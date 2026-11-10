import { shell } from 'electron';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { posix, win32 } from 'node:path';

function isWindowsStylePath(filePath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\');
}

function parentDirectory(filePath: string): string {
  return isWindowsStylePath(filePath)
    ? win32.dirname(filePath)
    : posix.dirname(filePath);
}

function isWsl(): boolean {
  if (process.platform !== 'linux') {
    return false;
  }
  if (process.env.WSL_DISTRO_NAME) {
    return true;
  }
  try {
    const version = readFileSync('/proc/version', 'utf8');
    return /microsoft|wsl/i.test(version);
  } catch {
    return false;
  }
}

function toWindowsPathForExplorer(folder: string): string | null {
  if (isWindowsStylePath(folder)) {
    return folder;
  }
  const result = spawnSync('wslpath', ['-w', folder], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout).trim();
    return detail || 'wslpath failed';
  }
  const winPath = String(result.stdout).trim();
  return winPath || null;
}

function openWithWindowsExplorer(windowsPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('explorer.exe', [windowsPath], {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', (err) => {
      resolve(err.message);
    });
    child.on('spawn', () => {
      resolve(null);
    });
  });
}

/**
 * Opens the parent folder of `filePath` in the OS file manager (file not selected).
 * Returns an error message, or null on success.
 */
export async function openContainingFolder(
  filePath: string,
): Promise<string | null> {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return 'File path is empty';
  }

  const folder = parentDirectory(trimmed);
  if (!folder || folder === '.' || folder === trimmed) {
    return 'Could not determine folder path';
  }

  let stat: ReturnType<typeof statSync>;
  try {
    if (!existsSync(folder)) {
      return `Folder not found: ${folder}`;
    }
    stat = statSync(folder);
  } catch {
    return `Folder not found: ${folder}`;
  }
  if (!stat.isDirectory()) {
    return `Folder not found: ${folder}`;
  }

  if (isWsl()) {
    const windowsPath = toWindowsPathForExplorer(folder);
    if (!windowsPath) {
      return 'Could not convert folder path for Windows Explorer';
    }
    if (windowsPath.includes('\n') || !isWindowsStylePath(windowsPath)) {
      return windowsPath;
    }
    return openWithWindowsExplorer(windowsPath);
  }

  const err = await shell.openPath(folder);
  return err || null;
}
