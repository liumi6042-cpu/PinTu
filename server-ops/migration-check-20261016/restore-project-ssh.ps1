$ErrorActionPreference = 'Stop'
$bundleRoot = 'D:\pingtu\拼图\拼图\server-ops\migration-20261016'
$keyName = 'webhosting_186_241_106_176_ed25519'
$sourceRoot = Join-Path $bundleRoot 'private-deployment\ssh'
$targetRoot = Join-Path $env:USERPROFILE '.ssh'
$manifest = Get-Content -LiteralPath (Join-Path $bundleRoot 'private-deployment\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($entry in $manifest.files) {
    $source = Join-Path $bundleRoot $entry.file
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'Migration SSH material checksum mismatch.' }
}
New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
foreach ($name in @($keyName, ($keyName + '.pub'))) {
    $source = Join-Path $sourceRoot $name
    $target = Join-Path $targetRoot $name
    if (Test-Path -LiteralPath $target) {
        if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash) { throw 'A different SSH identity already exists; no overwrite permitted.' }
    } else { Copy-Item -LiteralPath $source -Destination $target -ErrorAction Stop }
}
$privateKey = Join-Path $targetRoot $keyName
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$acl = New-Object Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true,$false)
$acl.SetOwner([Security.Principal.NTAccount]::new($currentIdentity))
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($currentIdentity,'FullControl','Allow'))
Set-Acl -LiteralPath $privateKey -AclObject $acl
# A separate pinned host file avoids modifying other SSH connections.
$hostSource = Join-Path $sourceRoot 'known_hosts.project'
$hostTarget = Join-Path $targetRoot 'known_hosts.jigsaw-migration'
if (Test-Path -LiteralPath $hostTarget) {
    if ((Get-FileHash -LiteralPath $hostSource -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $hostTarget -Algorithm SHA256).Hash) { throw 'Project host fingerprint file differs; refused to overwrite.' }
} else { Copy-Item -LiteralPath $hostSource -Destination $hostTarget -ErrorAction Stop }
Write-Output 'Project SSH identity restored; existing different keys and the general known_hosts were not overwritten.'
