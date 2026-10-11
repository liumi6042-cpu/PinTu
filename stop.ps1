$ErrorActionPreference = 'Stop'
$pidPath = Join-Path $PSScriptRoot 'work/server.pid'
if (-not (Test-Path -LiteralPath $pidPath)) { Write-Output '没有本工具启动的后台记录。'; exit }
$adminProcessId = [int](Get-Content -LiteralPath $pidPath -Raw)
$adminProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $adminProcessId)
if ($null -eq $adminProcess) { Remove-Item -LiteralPath $pidPath; Write-Output '后台已停止。'; exit }
$expectedEntry = Join-Path $PSScriptRoot 'server.mjs'
if ($adminProcess.Name -ne 'node.exe' -or -not $adminProcess.CommandLine.Contains($expectedEntry)) { throw '进程记录与此后台不匹配，为避免误停其他程序，未执行停止。' }
Stop-Process -Id $adminProcessId
Remove-Item -LiteralPath $pidPath
Write-Output '拼图内容后台已停止。草稿、版本与管理员数据已保留。'
