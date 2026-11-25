param([ValidateSet('admin','check')][string]$Action='check')
$ErrorActionPreference='Stop'
$betaRoot=Split-Path -Parent $PSScriptRoot
$betaNode=Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if(-not(Test-Path -LiteralPath $betaNode)){$betaNode=(Get-Command node -ErrorAction Stop).Source}
Push-Location -LiteralPath $betaRoot
try{if($Action -eq 'admin'){$betaUsername=Read-Host 'Existing puzzle username'; & $betaNode (Join-Path $PSScriptRoot 'configure-local-admin.mjs') $betaUsername}else{& $betaNode (Join-Path $PSScriptRoot 'check-launch.mjs')}}finally{Pop-Location}
Read-Host 'Press Enter to close'
