param(
 [string]$DeviceSerial,
 [switch]$Disconnect,
 [string]$AdbPath
)
$ErrorActionPreference='Stop'
if(!$AdbPath){
 $taskAdb=Get-Command adb -ErrorAction SilentlyContinue
 if($taskAdb){$AdbPath=$taskAdb.Source}
 else{$AdbPath=Join-Path $env:LOCALAPPDATA 'Android/Sdk/platform-tools/adb.exe'}
}
if(!(Test-Path -LiteralPath $AdbPath)){throw '未找到 Android platform-tools，请指定 -AdbPath。'}
$deviceLines=& $AdbPath devices
if($LASTEXITCODE -ne 0){throw 'Android 调试工具启动失败。'}
$deviceRows=@($deviceLines | Where-Object {$_ -match '^\S+\s+(device|unauthorized|offline)\b'})
if(!$DeviceSerial){
 if($deviceRows.Count -ne 1){Write-Host '请连接一台手机并允许 USB 调试。多台手机请使用 -DeviceSerial 指定。';$deviceLines | Write-Host;exit 2}
 $DeviceSerial=($deviceRows[0] -split '\s+')[0]
}
$deviceState=& $AdbPath -s $DeviceSerial get-state 2>$null
if($LASTEXITCODE -ne 0 -or $deviceState -ne 'device'){throw '手机尚未授权或离线，请在手机上允许 USB 调试。'}
if($Disconnect){
 & $AdbPath -s $DeviceSerial forward --remove tcp:9229
 if($LASTEXITCODE -ne 0){throw '移除调试转发失败。'}
 Write-Host '已移除这台手机的 9229 调试转发。';exit 0
}
$existing=& $AdbPath forward --list
if($LASTEXITCODE -ne 0){throw '读取已有调试转发失败。'}
$conflict=@($existing | Where-Object {$_ -match '^\S+\s+tcp:9229\s+' -and $_ -ne "$DeviceSerial tcp:9229 tcp:9229"})
if($conflict.Count){throw '9229 已有其他转发，保留原设置；请先检查现有调试会话。'}
if(!($existing -contains "$DeviceSerial tcp:9229 tcp:9229")){
 & $AdbPath -s $DeviceSerial forward --no-rebind tcp:9229 tcp:9229
 if($LASTEXITCODE -ne 0){throw '建立调试转发失败。'}
}
$after=& $AdbPath forward --list
if(!($after -contains "$DeviceSerial tcp:9229 tcp:9229")){throw '未确认调试转发生效。'}
Write-Host 'USB 调试转发已就绪。'
Write-Host '手机：打开341833自测包 → 右上角菜单 → 开发调试 → 打开调试 → 重新进入。'
Write-Host '电脑 Chrome：chrome://inspect/#devices → 找到游戏容器 → inspect。'
Write-Host '只检查广告调用与脱敏错误，不导出完整存储、登录凭证或设备标识。'
