# ytdown: one-command start for Windows (PowerShell).
# First run: creates engine\.venv, installs the engine, builds the web app if Node is present.
# Then: starts the engine on http://127.0.0.1:8787 and opens it in your browser.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$engine = Join-Path $root "engine"
$web = Join-Path $root "web"
$py = Join-Path $engine ".venv\Scripts\python.exe"

function Find-Python {
  foreach ($c in @(@("py", "-3.13"), @("py", "-3.12"), @("py", "-3"), @("python"))) {
    try {
      $exe = $c[0]; $rest = @($c | Select-Object -Skip 1)
      $v = & $exe @rest -c "import sys; print(sys.version_info >= (3, 12))" 2>$null
      if ($v -eq "True") { return ,$c }
    } catch {}
  }
  return $null
}

if (-not (Test-Path $py)) {
  $sys = Find-Python
  if (-not $sys) { Write-Host "ytdown needs Python 3.12 or newer: https://www.python.org/downloads/" -ForegroundColor Yellow; exit 1 }
  Write-Host "Setting up the engine (first run)..."
  $exe = $sys[0]; $rest = @($sys | Select-Object -Skip 1)
  & $exe @rest -m venv (Join-Path $engine ".venv")
  & $py -m pip install --disable-pip-version-check -q --upgrade pip
  & $py -m pip install --disable-pip-version-check -q -r (Join-Path $engine "requirements.txt")
}

if (-not (Test-Path (Join-Path $web "dist\index.html"))) {
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    Write-Host "Building the app (first run)..."
    Push-Location $web; npm ci --silent; npm run build --silent; Pop-Location
  } else {
    Write-Host "Node.js isn't installed, so the app can't be built. Install Node 22+: https://nodejs.org" -ForegroundColor Yellow
  }
}

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Host "Tip: ffmpeg isn't on PATH. Install it with:  winget install Gyan.FFmpeg" -ForegroundColor Yellow
}

Push-Location $engine
try { & $py -m ytdown_engine --open @args } finally { Pop-Location }
