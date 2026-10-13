$ErrorActionPreference = 'Stop'
$gameRoot = $PSScriptRoot
$gameWork = Join-Path $gameRoot 'work'
$gameUrl = 'http://127.0.0.1:3211/healthz'
$gameRunning = $false
try { $gameState = Invoke-RestMethod -Uri $gameUrl -TimeoutSec 2; $gameRunning = $gameState.ok -eq $true } catch { }
if (-not $gameRunning) {
    New-Item -ItemType Directory -Path $gameWork -Force | Out-Null
    $nodeExe = (Get-Command node -ErrorAction Stop).Source
    $entryFile = Join-Path $gameRoot 'scripts\start-mobile.mjs'
    $process = Start-Process -FilePath $nodeExe -ArgumentList @('"' + $entryFile + '"') -WorkingDirectory $gameRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $gameWork 'daily-preview.log') -RedirectStandardError (Join-Path $gameWork 'daily-preview-error.log')
    Set-Content -LiteralPath (Join-Path $gameWork 'daily-preview.pid') -Value $process.Id -Encoding ascii
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try { $gameState = Invoke-RestMethod -Uri $gameUrl -TimeoutSec 1; if ($gameState.ok -eq $true) { $ready = $true; break } } catch { }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw '本地游戏未能启动，请查看 work/daily-preview-error.log。' }
}
Write-Output '本地游戏已运行：http://127.0.0.1:3211'
