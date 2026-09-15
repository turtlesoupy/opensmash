$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    throw 'Create .venv with Python 3.12 and install desktop/requirements.txt first.'
}
# Python 3.12 otherwise defaults to the Windows ANSI code page for text files.
$env:PYTHONUTF8 = '1'
& $python (Join-Path $PSScriptRoot 'dev_desktop.py')
exit $LASTEXITCODE
