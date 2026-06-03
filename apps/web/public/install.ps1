# CCWarriors CLI installer (Windows PowerShell)
#   irm https://api.ccwarriors.xyz/install.ps1 | iex
$ErrorActionPreference = "Stop"

$Base = if ($env:CCWARRIORS_BASE) { $env:CCWARRIORS_BASE } else { "https://api.ccwarriors.xyz" }
$Fallback = if ($env:CCWARRIORS_FALLBACK) { $env:CCWARRIORS_FALLBACK } else { "https://get.ccwarriors.xyz" }

# 1) Node.js 20+ is required (the CLI is a single-file Node script)
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Host "x Node.js 20+ is required. Install it from https://nodejs.org and re-run." -ForegroundColor Red
  exit 1
}
$nodeMajor = [int]((node -v).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 20) {
  Write-Host "x Node.js 20+ required (found $(node -v))." -ForegroundColor Red
  exit 1
}

# 2) Download the CLI bundle
$CcwHome = Join-Path $env:USERPROFILE ".ccwarriors"
New-Item -ItemType Directory -Force -Path $CcwHome | Out-Null
Write-Host "Downloading the CCWarriors CLI..."
try {
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/cli.js" -OutFile (Join-Path $CcwHome "cli.js")
} catch {
  Write-Host "... primary host unavailable, using fallback"
  Invoke-WebRequest -UseBasicParsing -Uri "$Fallback/cli.js" -OutFile (Join-Path $CcwHome "cli.js")
}

# 3) Command shim. WindowsApps is on PATH for the current user by default.
$ShimDir = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps"
if (-not (Test-Path $ShimDir)) { $ShimDir = $CcwHome }
$Shim = Join-Path $ShimDir "ccwarriors.cmd"
"@echo off`r`nnode `"%USERPROFILE%\.ccwarriors\cli.js`" %*" | Set-Content -Path $Shim -Encoding ASCII
Write-Host "Installed: $Shim" -ForegroundColor Green
if ($ShimDir -eq $CcwHome) {
  Write-Host "-> Add to PATH: $CcwHome"
}

# 4) Enlist now (skippable with CCWARRIORS_NO_RUN=1)
if (-not $env:CCWARRIORS_NO_RUN) {
  Write-Host ""
  Write-Host "Hey there - installed! Starting your enlistment..."
  node (Join-Path $CcwHome "cli.js")
  Write-Host ""
  Write-Host "Tip: run 'ccwarriors watch' to keep your rank fresh while you work."
}
