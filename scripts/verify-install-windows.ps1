# Phase 8.8 Task E1 - Windows install-chain verification for the CI-built NSIS installer.
#
# Every assertion exits non-zero on failure. The only SilentlyContinue probe is
# the registry search (one of its three roots legitimately may not exist); the
# assertion on the result is what decides pass or fail.
#
# NOT automatable on a runner (printed as NOT_RUN at the end): the SmartScreen
# Mark-of-the-Web prompt and real Authenticode signing.
$ErrorActionPreference = 'Stop'

function Fail($message) { Write-Host "[FAIL] $message"; exit 1 }
function Pass($message) { Write-Host "[PASS] $message" }
function Skip($message) { Write-Host "[SKIPPED] $message" }
function NotRun($message) { Write-Host "[NOT_RUN] $message" }
function Step($title) { Write-Host ""; Write-Host "=== $title ===" }

function Wait-Until([scriptblock]$condition, [int]$timeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while (-not (& $condition) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
  return (& $condition)
}

Step 'locate NSIS installer'
$bundleDir = Join-Path (Get-Location) 'src-tauri\target\release\bundle\nsis'
if (-not (Test-Path $bundleDir)) { Fail "bundle directory missing: $bundleDir (the bundle step produced nothing)" }
$installer = Get-ChildItem -Path $bundleDir -Filter '*setup.exe' | Select-Object -First 1
if (-not $installer) { Fail "no NSIS installer (*setup.exe) inside $bundleDir" }
$conf = Get-Content -Raw 'src-tauri\tauri.conf.json' | ConvertFrom-Json
$productName = $conf.productName
$identifier = $conf.identifier
Pass "installer=$($installer.Name) bytes=$($installer.Length) productName=$productName identifier=$identifier"
if ($installer.Length -lt 1MB) { Fail "installer is suspiciously small: $($installer.Length) bytes" }

$installDir = Join-Path $env:LOCALAPPDATA $productName

Step 'silent install (/S)'
Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait
# The installed binary is named after the Cargo package, not after productName:
# mainBinaryName is unset, so the exe is terminal.exe while productName is
# Termius. Guessing "$productName.exe" failed on the Windows runner while the
# install itself had succeeded, and the message blamed the install directory.
if (-not (Wait-Until { Test-Path $installDir } 120)) { Fail "install directory missing after silent install: $installDir" }
$appExe = $null
for ($i = 0; $i -lt 120 -and -not $appExe; $i++) {
  $appExe = Get-ChildItem -Path $installDir -Filter '*.exe' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne 'uninstall.exe' } |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $appExe) { Start-Sleep -Seconds 1 }
}
if (-not $appExe) { Fail "no application binary (other than uninstall.exe) appeared inside $installDir" }
Pass "installed=$installDir"
Pass "app binary=$appExe"

Step 'registry uninstall entry'
$regRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$uninstallEntry = Get-ItemProperty -Path $regRoots -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -like "*$productName*" } | Select-Object -First 1
if (-not $uninstallEntry) { Fail "no uninstall registry entry whose DisplayName contains '$productName'" }
Pass "uninstall entry DisplayName='$($uninstallEntry.DisplayName)' DisplayVersion='$($uninstallEntry.DisplayVersion)'"
Pass "uninstall entry key=$($uninstallEntry.PSPath)"

$dataDir = Join-Path $env:APPDATA $identifier
$dataBefore = Test-Path $dataDir

Step 'launch the installed app for 5s'
$proc = Start-Process -FilePath $appExe -PassThru
Start-Sleep -Seconds 5
$proc.Refresh()
if ($proc.HasExited) { Fail "app exited within 5s of launch (exit code $($proc.ExitCode))" }
Pass "first launch: process alive after 5s (pid $($proc.Id))"
Stop-Process -Id $proc.Id -Force   # cleanup only, the assertion already holds
Start-Sleep -Seconds 2

$haveData = Test-Path $dataDir
if ($dataBefore) {
  Skip 'app data dir creation - %APPDATA%\<identifier> already existed before this run, so its creation was not observed'
} elseif ($haveData) {
  Pass 'app data dir created by the first launch: %APPDATA%\<identifier>'
} else {
  Skip 'app data dir creation - no %APPDATA%\<identifier> within 5s of the first launch'
}

Step 'overwrite install (reinstall over the existing install)'
Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait
if (-not (Wait-Until { Test-Path $appExe } 120)) { Fail "overwrite install removed the app binary: $appExe" }
Pass 'overwrite install kept the install directory and the binary'
$proc2 = Start-Process -FilePath $appExe -PassThru
Start-Sleep -Seconds 5
$proc2.Refresh()
if ($proc2.HasExited) { Fail "app exited within 5s after the overwrite install (exit code $($proc2.ExitCode))" }
Pass "launch after overwrite install: process alive after 5s (pid $($proc2.Id))"
Stop-Process -Id $proc2.Id -Force   # cleanup only
Start-Sleep -Seconds 2
if ($haveData) {
  if (-not (Test-Path $dataDir)) { Fail 'app data dir vanished after the overwrite install: %APPDATA%\<identifier>' }
  Pass 'data retention: app data dir survived the overwrite install'
} else {
  Skip 'overwrite-install data retention - the app wrote nothing to %APPDATA%\<identifier> within 5s, so there was nothing to preserve'
}

Step 'silent uninstall (/S)'
$uninstaller = Join-Path $installDir 'uninstall.exe'
if (-not (Test-Path $uninstaller)) { Fail "uninstaller missing: $uninstaller" }
Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait
if (Wait-Until { -not (Test-Path $installDir) } 180) {
  Pass 'silent uninstall removed the install directory'
} else {
  Fail "install directory still present 180s after the silent uninstall: $installDir"
}

Step 'not automatable'
NotRun 'SmartScreen / Mark-of-the-Web block - a GUI security decision made by a human after downloading a file; CI cannot trigger or observe the prompt'
NotRun 'Authenticode signature verification - no code-signing certificate is available in CI, the dev build is unsigned'

Write-Host ''
Pass 'Windows install chain (automated portion) completed'
