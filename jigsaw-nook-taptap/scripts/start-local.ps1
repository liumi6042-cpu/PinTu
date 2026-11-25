$ErrorActionPreference = 'Stop'
$puzzleRoot = Split-Path -Parent $PSScriptRoot
$puzzleNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path -LiteralPath $puzzleNode)) {
    $puzzleNode = (Get-Command node -ErrorAction Stop).Source
}
Set-Location -LiteralPath $puzzleRoot
& $puzzleNode 'scripts/start-local.mjs'
exit $LASTEXITCODE
