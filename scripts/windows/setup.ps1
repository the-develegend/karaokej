#Requires -Version 5.1
<#
.SYNOPSIS
  Prepare a packed Karaokej folder on Windows (env, npm deps, optional tools).
#>
[CmdletBinding()]
param(
  [string] $LibraryPath = '',
  [switch] $SkipWinget,
  [switch] $NonInteractive
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$DefaultLibraryPath = 'Z:/Music,Z:/Stephanie,Z:/Unsorted'

function Write-Step {
  param([string] $Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function ConvertTo-EnvPath {
  param([string] $Path)
  if ([string]::IsNullOrWhiteSpace($Path)) {
    return ''
  }
  return ($Path -replace '\\', '/').Trim()
}

function Get-NodeTools {
  $bundledNode = Join-Path $Root 'node\node.exe'
  $bundledNpm = Join-Path $Root 'node\npm.cmd'
  if ((Test-Path -LiteralPath $bundledNode) -and (Test-Path -LiteralPath $bundledNpm)) {
    return [pscustomobject]@{
      Node = $bundledNode
      Npm  = $bundledNpm
      Source = 'bundled'
    }
  }

  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($nodeCmd -and $npmCmd) {
    return [pscustomobject]@{
      Node = $nodeCmd.Source
      Npm  = $npmCmd.Source
      Source = 'path'
    }
  }

  throw "Node.js 22+ was not found. Re-pack with npm run pack:windows, or install Node 22 LTS."
}

function Test-NodeMajor {
  param([string] $NodeExe)
  $version = & $NodeExe -p "process.versions.node"
  $major = [int]($version.Split('.')[0])
  if ($major -lt 22) {
    throw "Karaokej requires Node.js 22 or newer (found $version)."
  }
  Write-Host "Using Node $version ($($script:NodeTools.Source))"
}

function Read-LibraryPath {
  if (-not [string]::IsNullOrWhiteSpace($LibraryPath)) {
    return $LibraryPath.Trim()
  }
  if ($NonInteractive) {
    return $DefaultLibraryPath
  }

  $prompt = "Music library folders, comma-separated [$DefaultLibraryPath]"
  $value = Read-Host $prompt
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $DefaultLibraryPath
  }
  return $value.Trim()
}

function Test-LibraryFolders {
  param([string] $Csv)
  $missing = @()
  foreach ($entry in $Csv.Split(',')) {
    $folder = $entry.Trim()
    if (-not $folder) { continue }
    $winPath = $folder -replace '/', '\'
    if (-not (Test-Path -LiteralPath $winPath)) {
      $missing += $folder
    }
  }
  if ($missing.Count -gt 0) {
    Write-Host "These library folders are not visible yet:" -ForegroundColor Yellow
    foreach ($folder in $missing) {
      Write-Host "  - $folder" -ForegroundColor Yellow
    }
    Write-Host "Map the music share first (see README.md), then re-run setup if needed."
  }
}

function Find-OnPath {
  param([string[]] $Names)
  foreach ($name in $Names) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
      return $cmd.Source
    }
  }
  return $null
}

function Find-FirstExisting {
  param([string[]] $Candidates)
  foreach ($candidate in $Candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }
  return $null
}

function Find-Ffmpeg {
  $fromPath = Find-OnPath @('ffmpeg.exe', 'ffmpeg')
  if ($fromPath) { return $fromPath }
  return Find-FirstExisting @(
    'C:\Program Files\ffmpeg\bin\ffmpeg.exe',
    'C:\ffmpeg\bin\ffmpeg.exe'
  )
}

function Find-Ffprobe {
  param([string] $FfmpegPath)
  $fromPath = Find-OnPath @('ffprobe.exe', 'ffprobe')
  if ($fromPath) { return $fromPath }
  if ($FfmpegPath) {
    $sibling = $FfmpegPath -replace 'ffmpeg(\.exe)?$', 'ffprobe$1'
    if (Test-Path -LiteralPath $sibling) {
      return $sibling
    }
  }
  return Find-FirstExisting @(
    'C:\Program Files\ffmpeg\bin\ffprobe.exe',
    'C:\ffmpeg\bin\ffprobe.exe'
  )
}

function Find-YtDlp {
  $fromPath = Find-OnPath @('yt-dlp.exe', 'yt-dlp')
  if ($fromPath) { return $fromPath }
  return Find-FirstExisting @(
    'C:\Program Files\yt-dlp\yt-dlp.exe',
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\yt-dlp.exe')
  )
}

function Find-Demucs {
  $fromPath = Find-OnPath @('demucs.exe', 'demucs')
  if ($fromPath) { return $fromPath }
  $candidates = @(
    (Join-Path $env:USERPROFILE 'pipx\venvs\demucs\Scripts\demucs.exe'),
    (Join-Path $env:USERPROFILE '.local\bin\demucs.exe')
  )
  Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Programs\Python') -Filter 'demucs.exe' -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1 |
    ForEach-Object { $candidates += $_.FullName }
  return Find-FirstExisting $candidates
}

function Install-OptionalTools {
  if ($SkipWinget) {
    Write-Host "Skipping winget installs (-SkipWinget)."
    return
  }
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    Write-Host "winget not found; install ffmpeg and yt-dlp yourself if you want covers / YouTube download."
    return
  }

  Write-Step "Installing optional tools via winget (ffmpeg, yt-dlp)"
  $packages = @(
    @{ Id = 'Gyan.FFmpeg'; Label = 'ffmpeg' },
    @{ Id = 'yt-dlp.yt-dlp'; Label = 'yt-dlp' }
  )
  foreach ($package in $packages) {
    Write-Host "Installing $($package.Label)..."
    & winget install --id $package.Id -e --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) {
      Write-Host "winget could not install $($package.Label) (exit $LASTEXITCODE). Install it manually if you need it." -ForegroundColor Yellow
    }
  }
}

function Write-DotEnvFile {
  param(
    [string] $MusicLibraryPath,
    [string] $NodeExe,
    [string] $FfmpegPath,
    [string] $FfprobePath,
    [string] $YtdlpPath,
    [string] $DemucsPath
  )

  $lines = @(
    "# One-time seed for Settings library paths on first API start (optional):",
    "MUSIC_LIBRARY_PATH=$MusicLibraryPath",
    'DATABASE_PATH=./data/karaokej.sqlite',
    'PORT=3000',
    'HOST=0.0.0.0',
    '',
    'LIBRARY_SCAN_METADATA_CONCURRENCY=4',
    'LIBRARY_SCAN_WALK_CONCURRENCY=4',
    'LIBRARY_SCAN_SKIP_LRC_ON_UNCHANGED=1',
    'LIBRARY_SCAN_SKIP_UNCHANGED_DIRS=0',
    ''
  )

  if ($YtdlpPath) {
    $lines += "YTDLP_PATH=$(ConvertTo-EnvPath $YtdlpPath)"
  } else {
    $lines += '# YTDLP_PATH=C:/Program Files/yt-dlp/yt-dlp.exe'
  }
  if ($FfmpegPath) {
    $lines += "FFMPEG_PATH=$(ConvertTo-EnvPath $FfmpegPath)"
  } else {
    $lines += '# FFMPEG_PATH=C:/ffmpeg/bin/ffmpeg.exe'
  }
  if ($FfprobePath) {
    $lines += "FFPROBE_PATH=$(ConvertTo-EnvPath $FfprobePath)"
  } else {
    $lines += '# FFPROBE_PATH=C:/ffmpeg/bin/ffprobe.exe'
  }
  $lines += "YTDLP_NODE_PATH=$(ConvertTo-EnvPath $NodeExe)"
  $lines += ''

  if ($DemucsPath) {
    $lines += "DEMUCS_PATH=$(ConvertTo-EnvPath $DemucsPath)"
  } else {
    $lines += '# DEMUCS_PATH=C:/Users/YOU/pipx/venvs/demucs/Scripts/demucs.exe'
  }
  $lines += 'DEMUCS_EXTRA_ARGS=--device cpu'

  $envFile = Join-Path $Root '.env'
  Set-Content -LiteralPath $envFile -Value $lines -Encoding UTF8
  Write-Host "Wrote $envFile"
}

function Install-NpmDependencies {
  param([string] $NpmCmd)
  Write-Step "Installing npm production dependencies"
  Push-Location $Root
  try {
    if (Test-Path -LiteralPath (Join-Path $Root 'package-lock.json')) {
      & $NpmCmd ci --omit=dev
    } else {
      & $NpmCmd install --omit=dev
    }
    if ($LASTEXITCODE -ne 0) {
      throw "npm exited with code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Try-AddFirewallRule {
  Write-Step "Windows Firewall (TCP 3000)"
  $ruleName = 'Karaokej HTTP 3000'
  $identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  $isAdmin = $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $command = 'netsh advfirewall firewall add rule name="Karaokej HTTP 3000" dir=in action=allow protocol=TCP localport=3000 profile=private'
  if (-not $isAdmin) {
    Write-Host "Setup is not elevated. Add this inbound rule yourself if other devices will connect:"
    Write-Host "  $command"
    return
  }
  $existing = netsh advfirewall firewall show rule name="$ruleName" 2>$null
  if ($LASTEXITCODE -eq 0 -and $existing -match $ruleName) {
    Write-Host "Firewall rule already exists."
    return
  }
  netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow protocol=TCP localport=3000 profile=private | Out-Host
}

function Show-ManualSteps {
  param(
    [string] $FfmpegPath,
    [string] $YtdlpPath,
    [string] $DemucsPath
  )
  Write-Step "Manual steps this script cannot finish"
  Write-Host "1. Map the music share so Music, Stephanie, and Unsorted exist on the drive letter you chose."
  Write-Host "   Example: net use Z: \\SERVER\Audio /persistent:yes"
  if (-not $FfmpegPath) {
    Write-Host "2. Install ffmpeg (covers + YouTube post-processing), then re-run setup.ps1."
  }
  if (-not $YtdlpPath) {
    Write-Host "3. Install yt-dlp if you want YouTube search/download, then re-run setup.ps1."
  }
  if (-not $DemucsPath) {
    Write-Host "4. Optional AI stems: install Python 3.11+ and 'pipx install demucs' (or pip install demucs)."
    Write-Host "   Then set DEMUCS_PATH to the full demucs.exe path and re-run setup.ps1."
  }
  Write-Host "Do not scan the library on first open if data\karaokej.sqlite was packed with this folder."
  Write-Host "When setup looks good, run:  .\start.ps1"
}

Write-Step "Karaokej Windows setup"
$script:NodeTools = Get-NodeTools
Test-NodeMajor -NodeExe $script:NodeTools.Node

$rawLibraryPath = Read-LibraryPath
$musicPath = ($rawLibraryPath -split ',' | ForEach-Object { ConvertTo-EnvPath $_.Trim() } | Where-Object { $_ }) -join ','
Test-LibraryFolders -Csv $musicPath

Install-OptionalTools

# Refresh PATH after winget so newly installed tools are visible in this session.
$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($machinePath -or $userPath) {
  $env:Path = @($machinePath, $userPath) -join ';'
}

$ffmpeg = Find-Ffmpeg
$ffprobe = Find-Ffprobe -FfmpegPath $ffmpeg
$ytdlp = Find-YtDlp
$demucs = Find-Demucs

Write-DotEnvFile -MusicLibraryPath $musicPath -NodeExe $script:NodeTools.Node `
  -FfmpegPath $ffmpeg -FfprobePath $ffprobe -YtdlpPath $ytdlp -DemucsPath $demucs

Install-NpmDependencies -NpmCmd $script:NodeTools.Npm
Try-AddFirewallRule
Show-ManualSteps -FfmpegPath $ffmpeg -YtdlpPath $ytdlp -DemucsPath $demucs

Write-Host ""
Write-Host "Setup finished." -ForegroundColor Green
