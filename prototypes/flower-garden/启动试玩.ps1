$ErrorActionPreference = 'Stop'
$gardenRoot = $PSScriptRoot
$gardenPort = Get-NetTCPConnection -LocalPort 3218 -State Listen -ErrorAction SilentlyContinue
if (-not $gardenPort) {
  $gardenNode = (Get-Command node).Source
  Start-Process -FilePath $gardenNode -ArgumentList 'server.mjs' -WorkingDirectory $gardenRoot -WindowStyle Hidden
}
Start-Process 'http://127.0.0.1:3218/'
