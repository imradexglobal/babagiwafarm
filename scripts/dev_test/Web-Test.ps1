param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $projectRoot

Write-Host '=========================================='
Write-Host ' Babagiwa Farm - WEB TEST'
Write-Host '=========================================='
Write-Host "Project: $projectRoot"

if (-not (Test-Path (Join-Path $projectRoot 'package.json'))) {
  throw 'Could not find package.json at the project root.'
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  throw 'Node.js was not found. Install Node.js LTS and retry.'
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw 'npm.cmd was not found. Repair or reinstall Node.js.'
}

$viteCommand = Join-Path $projectRoot 'node_modules\.bin\vite.cmd'
if (-not (Test-Path $viteCommand)) {
  Write-Host '[INFO] Installing dependencies. This may take several minutes.'
  & npm.cmd install --no-package-lock --legacy-peer-deps --fetch-retries=3 --fetch-timeout=60000
  if ($LASTEXITCODE -ne 0) {
    throw "Dependency installation failed with exit code $LASTEXITCODE. Review npm output above."
  }
}

Write-Host '[1/2] Building current source...'
& npm.cmd run build
if ($LASTEXITCODE -ne 0) {
  throw "Build failed with exit code $LASTEXITCODE. The development server was not started."
}
if (-not (Test-Path (Join-Path $projectRoot 'dist\index.html'))) {
  throw 'Build completed without producing dist\index.html.'
}

$port = 3001
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
try {
  $listener.Start()
  $listener.Stop()
} catch {
  try { $listener.Stop() } catch { }
  throw 'Port 3001 is already in use. Stop the other process using port 3001, then run Web-Test.bat again.'
}

$uri = "http://127.0.0.1:$port/"
Write-Host "[2/2] Starting Vite at $uri"
Write-Host 'The browser will open after the server responds. Press Ctrl+C to stop Vite.'

if (-not $NoBrowser) {
$watcher = @"
`$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt `$deadline) {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri '$uri' -TimeoutSec 2 | Out-Null
    Start-Process '$uri'
    exit 0
  } catch {
    Start-Sleep -Milliseconds 500
  }
}
Write-Output 'Vite did not respond within 60 seconds; check the visible server output.'
"@
$watcherBytes = [System.Text.Encoding]::Unicode.GetBytes($watcher)
$watcherEncoded = [Convert]::ToBase64String($watcherBytes)
Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $watcherEncoded
) | Out-Null
}

& npm.cmd run dev -- --host 127.0.0.1 --port $port --strictPort
if ($LASTEXITCODE -ne 0) {
  throw "Vite exited with code $LASTEXITCODE. See the server output above."
}
