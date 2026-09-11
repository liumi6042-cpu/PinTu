param(
  [ValidateSet('backup','verify','restore','status')][string]$Action='status',
  [string]$Snapshot,
  [switch]$ConfirmRestore
)
$ErrorActionPreference='Stop'
$puzzleRoot=Split-Path -Parent $PSScriptRoot
$puzzleNode=Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if(-not(Test-Path -LiteralPath $puzzleNode)){$puzzleNode=(Get-Command node -ErrorAction Stop).Source}
Set-Location -LiteralPath $puzzleRoot
if($Action -eq 'status'){& $puzzleNode 'scripts/local-health.mjs'}
else{
  $puzzleArguments=@('scripts/database-backup.mjs',$Action)
  if($Snapshot){$puzzleArguments+=$Snapshot}
  if($ConfirmRestore){$puzzleArguments+='--confirm-restore'}
  & $puzzleNode @puzzleArguments
}
exit $LASTEXITCODE
