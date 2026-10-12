$ErrorActionPreference = 'Stop'
$adminUrl = 'http://127.0.0.1:3214'
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$adminRoot = (& $nodeExe -p 'require("node:fs").realpathSync(process.argv[1])' $PSScriptRoot).Trim()
$adminWork = Join-Path $adminRoot 'work'
New-Item -ItemType Directory -Path $adminWork -Force | Out-Null
$running = $false
try {
    $state = Invoke-RestMethod -Uri ($adminUrl + '/api/session') -TimeoutSec 2
    $running = $null -ne $state.setupRequired
} catch { }
if (-not $running) {
    $entryFile = Join-Path $adminRoot 'server.mjs'
    $process = Start-Process -FilePath $nodeExe -ArgumentList @('"' + $entryFile + '"') -WorkingDirectory $adminRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $adminWork 'server.log') -RedirectStandardError (Join-Path $adminWork 'server-error.log')
    Set-Content -LiteralPath (Join-Path $adminWork 'server.pid') -Value $process.Id -Encoding ascii
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try { Invoke-RestMethod -Uri ($adminUrl + '/api/session') -TimeoutSec 1 | Out-Null; $ready = $true; break } catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $ready) { throw '后台未能启动，请查看 work/server-error.log。可能是 3214 端口已被占用。' }
}
Write-Output ('拼图内容后台已运行：' + $adminUrl)
