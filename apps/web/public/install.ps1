# CCWarriors CLI installer (Windows PowerShell)
#   irm https://api.ccwarriors.xyz/install.ps1 | iex
$ErrorActionPreference = "Stop"

$Base = if ($env:CCWARRIORS_BASE) { $env:CCWARRIORS_BASE } else { "https://api.ccwarriors.xyz" }
$Fallback = if ($env:CCWARRIORS_FALLBACK) { $env:CCWARRIORS_FALLBACK } else { "https://get.ccwarriors.xyz" }

# Anonymous install telemetry (random id, OS, failing step). Opt out: CCWARRIORS_TELEMETRY=0.
$Tid = [guid]::NewGuid().ToString("N")
$script:Step = "start"
function Send-Beacon($Evt) {
  if ($env:CCWARRIORS_TELEMETRY -eq "0") { return }
  try {
    $payload = @{ event = $Evt; distinctId = $Tid; props = @{ os = "Windows"; step = $script:Step } } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri "$Base/telemetry" -ContentType "application/json" -Body $payload -TimeoutSec 4 | Out-Null
  } catch {}
}
Send-Beacon "install_started"
trap { Send-Beacon "install_failed"; break }

# 1) Node.js 20+ is required (the CLI is a single-file Node script)
$script:Step = "node_check"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Host "x Node.js 20+ is required. Install it from https://nodejs.org and re-run." -ForegroundColor Red
  Send-Beacon "install_failed"
  exit 1
}
$nodeMajor = [int]((node -v).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 20) {
  Write-Host "x Node.js 20+ required (found $(node -v))." -ForegroundColor Red
  Send-Beacon "install_failed"
  exit 1
}

# 2) Download the CLI bundle
$script:Step = "download"
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
$script:Step = "shim"
$ShimDir = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps"
if (-not (Test-Path $ShimDir)) { $ShimDir = $CcwHome }
$Shim = Join-Path $ShimDir "ccwarriors.cmd"
"@echo off`r`nnode `"%USERPROFILE%\.ccwarriors\cli.js`" %*" | Set-Content -Path $Shim -Encoding ASCII
Write-Host "Installed: $Shim" -ForegroundColor Green
if ($ShimDir -eq $CcwHome) {
  Write-Host "-> Add to PATH: $CcwHome"
}
Send-Beacon "install_completed"

# 4) Enlist now (skippable with CCWARRIORS_NO_RUN=1)
$script:Step = "enlist"
if (-not $env:CCWARRIORS_NO_RUN) {
  Write-Host ""
  Write-Host "Hey there - installed! Starting your enlistment..."
  node (Join-Path $CcwHome "cli.js")
  Write-Host ""
  Write-Host "Tip: run 'ccwarriors watch' to keep your rank fresh while you work."
}
