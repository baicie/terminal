<#
.SYNOPSIS
  Read-only Windows profile isolation preflight for the upgrade harness.

.DESCRIPTION
  Path containment alone cannot distinguish the shared runner profile from a
  one-time user: the app always writes to the current user's Known Folders.
  This script collects identity, profile, Known Folder, reparse-point,
  ownership, existing-install/data and cleanup evidence, then delegates the
  decision to windows-isolation-classify.mjs so the state machine is testable
  on every platform.

  It never installs, deletes or writes below the profile. The only write is the
  evidence/report under RUNNER_TEMP (or an explicitly safe OutFile).

  Exit 0 only for ISOLATED_DEDICATED_USER or ISOLATED_DISPOSABLE_VM.
  Exit 1 for any refusal; exit 2 for unsafe OutFile or malformed invocation.

.PARAMETER ExpectedSid
  SID of the one-time user (or VM user). Required for a positive result.

.PARAMETER RunnerSid
  SID of the shared runner identity captured before any user switch. When the
  current token equals this SID the result is REFUSED_SHARED_RUNNER_PROFILE.

.PARAMETER Mode
  dedicated-user (default) or disposable-vm.

.PARAMETER TestRoot
  Must equal the one-time user's profile for dedicated-user mode.

.PARAMETER Phase
  pre-install (default; existing app data is refused) or post-install.

.PARAMETER VerifyCleanup
  Run a confined create/delete probe under TestRoot.

.PARAMETER Identifier
  Tauri identifier; defaults to com.baicie.termius.
#>
param(
  [string]$OutFile = "",
  [string]$ExpectedSid = "",
  [string]$RunnerSid = "",
  [ValidateSet("dedicated-user", "disposable-vm")]
  [string]$Mode = "dedicated-user",
  [string]$TestRoot = "",
  [ValidateSet("pre-install", "post-install")]
  [string]$Phase = "pre-install",
  [switch]$VerifyCleanup,
  [string]$Identifier = "com.baicie.termius"
)

$ErrorActionPreference = "Stop"

function Under-Path {
  param([string]$Child, [string]$Parent)
  if ([string]::IsNullOrWhiteSpace($Child) -or [string]::IsNullOrWhiteSpace($Parent)) {
    return $false
  }
  $c = [System.IO.Path]::GetFullPath($Child).TrimEnd('\').ToLowerInvariant()
  $p = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\').ToLowerInvariant()
  return $c -eq $p -or $c.StartsWith($p + '\')
}

function Get-ReparsePoints {
  param([string[]]$Paths)
  $found = @()
  foreach ($path in $Paths) {
    if ([string]::IsNullOrWhiteSpace($path)) { continue }
    $current = [System.IO.Path]::GetFullPath($path)
    while (-not [string]::IsNullOrWhiteSpace($current)) {
      $item = Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue
      if ($null -ne $item -and (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
        $found += $current
      }
      $parent = Split-Path -Parent $current
      if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) { break }
      $current = $parent
    }
  }
  return @($found | Select-Object -Unique)
}

function Get-UninstallEntries {
  $roots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
  )
  $entries = @()
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
      $item = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
      if ($null -ne $item.DisplayName -and [string]$item.DisplayName -eq "Termius") {
        $entries += [ordered]@{
          hive = $root
          key = [string]$_.PSChildName
          displayName = [string]$item.DisplayName
          displayVersion = [string]$item.DisplayVersion
          publisher = [string]$item.Publisher
          installLocation = [string]$item.InstallLocation
        }
      }
    }
  }
  return @($entries)
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentSid = $identity.User.Value.ToString()
$userProfile = [Environment]::GetFolderPath("UserProfile")
$roaming = [Environment]::GetFolderPath("ApplicationData")
$local = [Environment]::GetFolderPath("LocalApplicationData")
$envRoaming = $env:APPDATA
$envLocal = $env:LOCALAPPDATA

if ([string]::IsNullOrWhiteSpace($TestRoot)) {
  $TestRoot = if ([string]::IsNullOrWhiteSpace($ExpectedSid)) { [string]$env:UPGRADE_TEST_ROOT } else { $userProfile }
}
$targetData = Join-Path $roaming $Identifier
$targetVault = Join-Path $roaming "terminal"
$targetLocal = Join-Path $local $Identifier
$targetInstall = Join-Path $local "Termius"

# -OutFile must never land inside the profile it is meant to protect.
$outFileSafe = $true
if (-not [string]::IsNullOrWhiteSpace($OutFile)) {
  $outFull = [System.IO.Path]::GetFullPath($OutFile)
  foreach ($protected in @($userProfile, $roaming, $local, $targetData, $targetVault, $targetLocal, $targetInstall, $TestRoot)) {
    if (-not [string]::IsNullOrWhiteSpace($protected) -and (Under-Path $outFull $protected)) {
      $outFileSafe = $false
    }
  }
}
if (-not $outFileSafe) {
  Write-Host "REFUSED_UNSAFE_OUTFILE: OutFile is inside the protected profile boundary."
  exit 2
}

$evidenceComplete = $true
$evidenceError = ""
$ownerSid = ""
$reparsePoints = @()
$existingInstall = @()
$existingData = @()
$cleanupProbe = "NOT_RUN"
$profileRegistered = $false
$profileImagePath = ""

try {
  if ([string]::IsNullOrWhiteSpace($userProfile) -or [string]::IsNullOrWhiteSpace($roaming) -or [string]::IsNullOrWhiteSpace($local)) {
    $evidenceComplete = $false
    $evidenceError = "Known Folder or UserProfile is empty"
  }
  $acl = Get-Acl -LiteralPath $TestRoot -ErrorAction SilentlyContinue
  if ($null -ne $acl -and -not [string]::IsNullOrWhiteSpace($acl.Owner)) {
    try {
      $ownerSid = (New-Object System.Security.Principal.NTAccount($acl.Owner)).Translate(
        [System.Security.Principal.SecurityIdentifier]).Value
    } catch {
      $ownerSid = [string]$acl.Owner
    }
  }
  $reparsePoints = Get-ReparsePoints -Paths @($userProfile, $roaming, $local, $TestRoot, $targetData, $targetVault, $targetLocal, $targetInstall)
  $existingInstall = Get-UninstallEntries
  foreach ($candidate in @($targetData, $targetVault, $targetLocal, $targetInstall)) {
    if (Test-Path -LiteralPath $candidate) {
      $children = @(Get-ChildItem -LiteralPath $candidate -Force -ErrorAction SilentlyContinue)
      if ($children.Count -gt 0) { $existingData += $candidate }
    }
  }
  $profiles = @(Get-CimInstance Win32_UserProfile -ErrorAction SilentlyContinue |
    Where-Object { [string]$_.SID -eq $currentSid })
  if ($profiles.Count -gt 0) {
    $profileRegistered = $true
    $profileImagePath = [string]$profiles[0].LocalPath
  }
  if ($VerifyCleanup) {
    try {
      $probe = Join-Path $TestRoot ("isolation-probe-" + [Guid]::NewGuid().ToString("N"))
      Set-Content -LiteralPath $probe -Value "probe" -Encoding ASCII
      Remove-Item -LiteralPath $probe -Force
      $cleanupProbe = "PASS"
    } catch {
      $cleanupProbe = "FAIL"
    }
  }
} catch {
  $evidenceComplete = $false
  $evidenceError = $_.Exception.Message
}

$evidence = [ordered]@{
  evidenceComplete = $evidenceComplete
  evidenceError = $evidenceError
  currentSid = $currentSid
  expectedSid = $ExpectedSid
  runnerSid = $RunnerSid
  mode = $Mode
  userProfile = $userProfile
  knownFolderRoaming = $roaming
  knownFolderLocal = $local
  envAppData = $envRoaming
  envLocalAppData = $envLocal
  testRoot = $TestRoot
  targetData = $targetData
  targetVault = $targetVault
  targetLocal = $targetLocal
  targetInstall = $targetInstall
  ownerSid = $ownerSid
  profileRegistered = $profileRegistered
  profileImagePath = $profileImagePath
  reparsePoints = @($reparsePoints)
  existingInstall = @($existingInstall)
  existingData = @($existingData)
  cleanupProbe = $cleanupProbe
  phase = $Phase
  runId = [string]$env:UPGRADE_RUN_ID
  vmAttestation = if ([string]::IsNullOrWhiteSpace($env:UPGRADE_VM_RUN_ID)) {
    $null
  } else {
    [ordered]@{
      runId = [string]$env:UPGRADE_VM_RUN_ID
      instanceId = [string]$env:UPGRADE_VM_INSTANCE_ID
      imageId = [string]$env:UPGRADE_VM_IMAGE_ID
    }
  }
  powershell = [ordered]@{
    version = [string]$PSVersionTable.PSVersion
    edition = [string]$PSVersionTable.PSEdition
    bitness = [Environment]::Is64BitProcess
  }
  action = "read-only preflight; no install, delete, or profile write"
}

$tempRoot = if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) { [System.IO.Path]::GetTempPath() } else { $env:RUNNER_TEMP }
$temp = Join-Path $tempRoot ("windows-isolation-evidence-" + [Guid]::NewGuid().ToString("N") + ".json")
$evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temp -Encoding UTF8
$classifier = Join-Path $PSScriptRoot "windows-isolation-classify.mjs"
$targetReport = if ([string]::IsNullOrWhiteSpace($OutFile)) {
  Join-Path $tempRoot "windows-isolation.json"
} else {
  $OutFile
}
# The classifier writes the report; the wrapper only prints and forwards exit.
& node $classifier --evidence $temp --out $targetReport
$classifierExit = $LASTEXITCODE
if (Test-Path -LiteralPath $targetReport) {
  Get-Content -LiteralPath $targetReport -Raw | Write-Output
} else {
  Write-Error "REFUSED_EVIDENCE_INCOMPLETE: classifier produced no report."
  exit 1
}
Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
exit $classifierExit
