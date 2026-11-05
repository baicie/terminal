<#
.SYNOPSIS
  Read-only Windows profile isolation preflight for the upgrade harness.

.DESCRIPTION
  GitHub's Windows runner uses a shared runner profile. Redirecting APPDATA is
  not enough: Tauri resolves the data directory through SHGetKnownFolderPath,
  which ignores the environment variable. Installing the app on that profile
  would touch (and the old verify-install script would delete) real user data.

  This script never installs, deletes, or writes below the profile. It reports
  whether the target data directory is safely under an explicit one-time test
  root. Exit 0 only when isolated; exit 1 otherwise (fail closed).

.PARAMETER OutFile
  Optional JSON report path.
#>
param(
  [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$userProfile = [Environment]::GetFolderPath("UserProfile")
$roaming = [Environment]::GetFolderPath("ApplicationData")
$local = [Environment]::GetFolderPath("LocalApplicationData")
$envRoaming = $env:APPDATA
$envLocal = $env:LOCALAPPDATA
$testRoot = $env:UPGRADE_TEST_ROOT
$identifier = "com.baicie.termius"
$targetData = Join-Path $roaming $identifier

$targetFull = [System.IO.Path]::GetFullPath($targetData)
$roamingFull = [System.IO.Path]::GetFullPath($roaming)
$testRootFull = if ([string]::IsNullOrWhiteSpace($testRoot)) { $null } else { [System.IO.Path]::GetFullPath($testRoot) }

$underTestRoot = $false
if ($null -ne $testRootFull) {
  $prefix = $testRootFull.TrimEnd('\') + '\'
  $underTestRoot = $targetFull.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}
$isRealRoaming = $targetFull.Equals($roamingFull, [System.StringComparison]::OrdinalIgnoreCase)
$wouldTouchRealProfile = -not $underTestRoot -or $isRealRoaming

$uninstallEntries = @()
$uninstallRoot = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
if (Test-Path $uninstallRoot) {
  Get-ChildItem $uninstallRoot | ForEach-Object {
    $item = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($null -ne $item.DisplayName -and ($item.DisplayName -like "*Termius*" -or $item.DisplayName -like "*Terminal*")) {
      $uninstallEntries += [ordered]@{
        displayName = [string]$item.DisplayName
        displayVersion = [string]$item.DisplayVersion
        key = [string]$_.PSChildName
      }
    }
  }
}

$report = [ordered]@{
  provider = "windows-isolation-check"
  user = [string]$identity.Name
  sid = [string]$identity.User.Value
  userProfile = [string]$userProfile
  knownFolderRoaming = [string]$roaming
  knownFolderLocal = [string]$local
  envAppData = [string]$envRoaming
  envLocalAppData = [string]$envLocal
  testRoot = if ($null -eq $testRootFull) { $null } else { [string]$testRootFull }
  targetDataDirectory = [string]$targetFull
  targetIsRealRoaming = [bool]$isRealRoaming
  targetUnderTestRoot = [bool]$underTestRoot
  wouldTouchRealProfile = [bool]$wouldTouchRealProfile
  isolated = (-not $wouldTouchRealProfile)
  existingUninstallEntries = $uninstallEntries
  action = "read-only preflight; no install, delete, or profile write"
}

$json = $report | ConvertTo-Json -Depth 5
if (-not [string]::IsNullOrWhiteSpace($OutFile)) {
  $json | Set-Content -LiteralPath $OutFile -Encoding UTF8
}
Write-Output $json

if ($wouldTouchRealProfile) {
  Write-Error "Windows profile is not isolated: target $targetFull is on the runner profile; refusing to install."
  exit 1
}
exit 0
