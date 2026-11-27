$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$VenvPy = Join-Path $Root "backend\.venv\Scripts\python.exe"
if (Test-Path $VenvPy) {
  & $VenvPy (Join-Path $Root "run.py") @args
} else {
  python (Join-Path $Root "run.py") @args
}
