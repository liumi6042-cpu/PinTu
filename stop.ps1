$ErrorActionPreference = 'Stop'
$pidPath = Join-Path $PSScriptRoot 'work/server.pid'
if (-not (Test-Path -LiteralPath $pidPath)) { Write-Output '没有本工具启动的后台记录。'; exit }
$adminProcessId = [int](Get-Content -LiteralPath $pidPath -Raw)
$adminProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $adminProcessId)
if ($null -eq $adminProcess) { Remove-Item -LiteralPath $pidPath; Write-Output '后台已停止。'; exit }
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$resolvedAdminRoot = 'console.log(require("node:fs").realpathSync(process.argv[2]))' | & $nodeExe - $PSScriptRoot
if ($LASTEXITCODE -ne 0) { throw 'Unable to resolve the admin project directory.' }
$physicalAdminRoot = ([string]$resolvedAdminRoot).Trim()
$expectedEntry = Join-Path $physicalAdminRoot 'server.mjs'
$compatibilityEntry = Join-Path $PSScriptRoot 'server.mjs'
if ($adminProcess.Name -ne 'node.exe' -or (-not $adminProcess.CommandLine.Contains($expectedEntry) -and -not $adminProcess.CommandLine.Contains($compatibilityEntry))) { throw '进程记录与此后台不匹配，为避免误停其他程序，未执行停止。' }
try {
    Stop-Process -Id $adminProcessId -ErrorAction Stop
} catch {
    # Some managed PowerShell hosts cannot stop a process through this cmdlet.
    # The command line was verified above; the fallback targets that exact PID.
    & (Join-Path $env:SystemRoot 'System32/taskkill.exe') /PID $adminProcessId /F
    if ($LASTEXITCODE -ne 0) { throw '后台进程未能停止，已保留进程记录和数据。' }
}
Remove-Item -LiteralPath $pidPath
Write-Output '拼图内容后台已停止。草稿、版本与管理员数据已保留。'
