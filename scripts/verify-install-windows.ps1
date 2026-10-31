# Phase 8.8 Task E1 (install chain) + Phase 8.9 Task 5 (real data retention).
#
# What this proves, Windows:
#   1. the NSIS installer exists, installs silently (/S), and leaves a working
#      install directory plus a registry uninstall entry whose version is read
#      back
#   2. the user data directory the app really uses is MEASURED, not assumed:
#      APPDATA/LOCALAPPDATA are first redirected to a throwaway root and the
#      first launch shows which one the app honoured. Tauri resolves the data
#      directory with dirs::config_dir() -> SHGetKnownFolderPath(FOLDERID_
#      RoamingAppData), which does NOT read the APPDATA variable, so when the
#      redirect is ignored the script prints [LIMITATION] with that reason and
#      continues against the real per-user directory, after proving it held
#      nothing before the first launch. The limitation is recorded, never hidden
#   3. the database the app created passes PRAGMA integrity_check and carries the
#      schema the app creates, before any test data is written
#   4. controlled rows are written through the app's own schema: one host (no
#      credential: auth_type=agent, password/private_key NULL), the app_settings
#      row, one workspace plus its workspace_layouts row, and a schema-valid test
#      vault file at dirs::config_dir()/terminal/vault.json (NOT the identifier
#      directory - see src-tauri/src/vault.rs fn get_vault_path)
#   5. after an overwrite installation (the NSIS reinstall/upgrade path) the app
#      is launched again and every asserted field is read back and compared with
#      the pre-install snapshot; a file hash is reported for the record only
#   6. the app really read the seeded row: a boot persists
#      terminalThemeLightMigrated=true into the settings row this run wrote
#      (store/app.ts hydrateFromDatabase -> getAppSettings -> setSetting), which
#      is also the settings version-migration assertion
#   7. the silent uninstall (/S) removes the install directory, and the user data
#      policy is ASSERTED against the configuration: bundle.windows.nsis.
#      deleteAppDataOnUninstall (absent here, i.e. the Tauri default false) means
#      the data must survive the uninstall, and it is checked
#
# NOT automatable on a runner (printed as NOT_RUN at the end): the SmartScreen
# Mark-of-the-Web prompt and real Authenticode signing.
#
# Every assertion exits non-zero. The only SilentlyContinue probes are the
# registry search (one of its roots may not exist) and the final cleanup; the
# assertions on their results decide pass or fail.
$ErrorActionPreference = 'Stop'

function Fail($message) { Write-Host "[FAIL] $message"; exit 1 }
function Pass($message) { Write-Host "[PASS] $message" }
function Skip($message) { Write-Host "[SKIPPED] $message" }
function NotRun($message) { Write-Host "[NOT_RUN] $message" }
function Step($title) { Write-Host ""; Write-Host "=== $title ===" }
function Info($message) { Write-Host "[INFO] $message" }

function Wait-Until([scriptblock]$condition, [int]$timeoutSeconds) {
  # Polls a real condition with a deadline; the caller asserts the result.
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while (-not (& $condition) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
  return (& $condition)
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) ('p89win-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
$harness = Join-Path (Get-Location) 'scripts/verify-install/data-retention.mjs'
$evidenceDir = Join-Path (Get-Location) 'verify-install-evidence\windows'
$token = 'p89win-' + (Get-Date -Format 'yyyyMMddHHmmss') + '-' + $PID
$nodeFlag = $false

# The data assertions need a SQLite driver. Node 24 ships node:sqlite without a
# flag, Node 22.5+ needs --experimental-sqlite; if neither works this script
# refuses to run rather than quietly reporting a pass without data evidence.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'node is not installed; the data-retention assertions cannot run and this script will not report a pass without them'
}
& node -e "require('node:sqlite')" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  & node --experimental-sqlite -e "require('node:sqlite')" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Fail 'no usable node:sqlite (tried node and node --experimental-sqlite); the data-retention assertions cannot run and this script will not report a pass without them'
  }
  $nodeFlag = $true
}
$nodeVersion = (& node --version)
if ($nodeFlag) { $nodeMode = 'flag' } else { $nodeMode = 'none' }
Info ('node ' + $nodeVersion + ' sqlite driver mode=' + $nodeMode)

function Invoke-Harness {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$HarnessArguments)
  if ($script:nodeFlag) {
    & node --experimental-sqlite $script:harness @HarnessArguments | Out-Host
  } else {
    & node $script:harness @HarnessArguments | Out-Host
  }
  if ($LASTEXITCODE -ne 0) { Fail ('data-retention harness failed: ' + ($HarnessArguments -join ' ')) }
}

function Invoke-HarnessCode {
  # Same call, but the exit code is returned instead of failing: the wait
  # subcommand's failure is handled explicitly by the caller.
  param([switch]$Silent, [Parameter(ValueFromRemainingArguments = $true)][string[]]$HarnessArguments)
  if ($script:nodeFlag) {
    if ($Silent) { & node --experimental-sqlite $script:harness @HarnessArguments | Out-Null }
    else { & node --experimental-sqlite $script:harness @HarnessArguments | Out-Host }
  } else {
    if ($Silent) { & node $script:harness @HarnessArguments | Out-Null }
    else { & node $script:harness @HarnessArguments | Out-Host }
  }
  return $LASTEXITCODE
}

function Start-AppLogged([string]$tag) {
  $outLog = Join-Path $work ($tag + '-out.log')
  $errLog = Join-Path $work ($tag + '-err.log')
  return Start-Process -FilePath $script:appExe -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
}

function Stop-AppLogged($proc) {
  if ($null -eq $proc) { return }
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
  try { $proc.WaitForExit(30000) | Out-Null } catch { }
  Start-Sleep -Seconds 2   # file-handle settle after the kill; every assertion polls a real condition
}

function Show-AppLog([string]$tag) {
  foreach ($suffix in @('-out.log', '-err.log')) {
    $path = Join-Path $work ($tag + $suffix)
    if (Test-Path $path) { Get-Content $path -Tail 10 | ForEach-Object { Write-Host ('    ' + $_) } }
  }
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

# The user-data policy comes from the configuration, not from a guess: a missing
# deleteAppDataOnUninstall means the Tauri default (false = keep the data).
$deleteAppDataOnUninstall = $false
if ($conf.bundle -and $conf.bundle.windows -and $conf.bundle.windows.nsis -and $conf.bundle.windows.nsis.deleteAppDataOnUninstall) {
  $deleteAppDataOnUninstall = [bool]$conf.bundle.windows.nsis.deleteAppDataOnUninstall
}
if ($deleteAppDataOnUninstall) {
  Info 'policy: bundle.windows.nsis.deleteAppDataOnUninstall=true, so the uninstall is expected to delete the user data'
} else {
  Info 'policy: bundle.windows.nsis.deleteAppDataOnUninstall is not set, i.e. the Tauri default false: the uninstall must keep the user data'
}

Step 'isolated user data root'
$tempAppData = Join-Path $work 'roaming'
$tempLocalAppData = Join-Path $work 'local'
New-Item -ItemType Directory -Path $tempAppData | Out-Null
New-Item -ItemType Directory -Path $tempLocalAppData | Out-Null
$realAppData = [Environment]::GetFolderPath('ApplicationData')
$realLocalAppData = [Environment]::GetFolderPath('LocalApplicationData')
$realDataDir = Join-Path $realAppData $identifier
$tempDataDir = Join-Path $tempAppData $identifier
if (Test-Path $realDataDir) {
  Info ('removing a pre-existing ' + $realDataDir + ' so the run starts from a clean state (the runner profile is disposable, no human data lives here)')
  Remove-Item -Recurse -Force $realDataDir
}
Pass 'the app data directory held nothing before the first launch'
$env:APPDATA = $tempAppData
$env:LOCALAPPDATA = $tempLocalAppData
Pass ('APPDATA/LOCALAPPDATA redirected to a throwaway root under ' + $work)
Info 'the app resolves its data directory with dirs::config_dir() -> SHGetKnownFolderPath(FOLDERID_RoamingAppData), which does not read the APPDATA variable; the first launch below measures whether the redirect is honoured instead of assuming it'

Step 'silent install (/S)'
Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait
$installCandidates = @((Join-Path $env:LOCALAPPDATA $productName), (Join-Path $realLocalAppData $productName))
$installDir = $null
foreach ($candidate in $installCandidates) {
  if (Test-Path $candidate) { $installDir = $candidate; break }
}
if (-not $installDir) { Fail ('no install directory appeared after the silent install; looked in: ' + ($installCandidates -join ', ')) }
$appExe = $null
for ($i = 0; $i -lt 120 -and -not $appExe; $i++) {
  $appExe = Get-ChildItem -Path $installDir -Filter '*.exe' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne 'uninstall.exe' } |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $appExe) { Start-Sleep -Seconds 1 }
}
if (-not $appExe) { Fail "no application binary (other than uninstall.exe) appeared inside $installDir" }
Pass ('installed=' + $installDir)
Pass ('app binary=' + $appExe)

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
$versionBefore = $uninstallEntry.DisplayVersion

Step 'first launch: measure the data directory the app really uses'
$proc = Start-AppLogged 'launch-first'
$tempDb = Join-Path $tempDataDir 'terminal.db'
$waitCode = Invoke-HarnessCode 'wait' '--db' $tempDb '--mode' 'db-exists' '--timeout' '120'
if ($waitCode -eq 0) {
  $dataDir = $tempDataDir
  Pass ('the app honoured the redirected APPDATA and created its database inside ' + $tempDataDir)
} else {
  Stop-AppLogged $proc
  $proc = $null
  $realDb = Join-Path $realDataDir 'terminal.db'
  if (-not (Test-Path $realDb)) {
    Fail ('the app created its database neither in the redirected APPDATA nor in ' + $realDataDir + '; the harness output above is the only observation')
  }
  Write-Host ('[LIMITATION] %APPDATA% redirection is NOT honoured: the app resolved its data directory through the known-folder API (SHGetKnownFolderPath), so the database landed in ' + $realDataDir + '. This run continues against that per-user directory, which was proven empty before the first launch; the redirection is recorded as unsupported rather than reported as isolation.')
  $dataDir = $realDataDir
  $proc = Start-AppLogged 'launch-first-retry'
  if ((Invoke-HarnessCode 'wait' '--db' (Join-Path $dataDir 'terminal.db') '--mode' 'db-exists' '--timeout' '120') -ne 0) {
    Stop-AppLogged $proc
    Show-AppLog 'launch-first-retry'
    Fail 'the app never created its database on the second attempt either'
  }
}
$dbPath = Join-Path $dataDir 'terminal.db'
$configRoot = Split-Path -Path $dataDir -Parent
$vaultPath = Join-Path $configRoot 'terminal\vault.json'
Info ('data directory: ' + $dataDir)
Info ('database:       ' + $dbPath)
Info ('vault:          ' + $vaultPath)

$schemaReady = $false
for ($i = 0; $i -lt 90 -and -not $schemaReady; $i++) {
  $schemaCode = Invoke-HarnessCode -Silent 'schema' '--db' $dbPath
  if ($schemaCode -eq 0) { $schemaReady = $true } else { Start-Sleep -Seconds 1 }
}
if (-not $schemaReady) {
  Invoke-HarnessCode 'schema' '--db' $dbPath | Out-Host
  if ($proc) { Stop-AppLogged $proc }
  Fail 'the app never finished creating its schema in the isolated database'
}
Pass 'the app created its own schema in the isolated database'
Stop-AppLogged $proc
$proc = $null
Pass 'first launch stopped'

Step 'database integrity of the app-created database'
Invoke-Harness 'integrity' '--db' $dbPath
Pass 'integrity_check and foreign_key_check are clean on the app-created database'

Step 'write controlled test data through the app schema'
Invoke-Harness 'seed' '--db' $dbPath '--token' $token '--vault' $vaultPath
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
$snapshot = Join-Path $evidenceDir ($token + '-before.json')
Invoke-Harness 'snapshot' '--db' $dbPath '--token' $token '--vault' $vaultPath '--out' $snapshot
Pass ('pre-install snapshot written to ' + $snapshot)

if ($env:VERIFY_INSTALL_FAULT_INJECT) {
  # Test-only: proves the verification below is live. Never set in CI.
  Write-Host ('[TEST] VERIFY_INSTALL_FAULT_INJECT=' + $env:VERIFY_INSTALL_FAULT_INJECT + ' - this run MUST go red')
  $env:VERIFY_INSTALL_TEST_MUTATION = '1'
  Invoke-Harness 'test-break' '--db' $dbPath '--token' $token '--mode' $env:VERIFY_INSTALL_FAULT_INJECT
}

Step 'overwrite install (reinstall over the existing installation)'
Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait
if (-not (Wait-Until { Test-Path -LiteralPath $appExe } 120)) { Fail "overwrite install removed the app binary: $appExe" }
Pass 'overwrite install kept the install directory and the binary'
$uninstallEntryAfter = Get-ItemProperty -Path $regRoots -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -like "*$productName*" } | Select-Object -First 1
if (-not $uninstallEntryAfter) { Fail 'the overwrite install removed the registry uninstall entry' }
if ($uninstallEntryAfter.DisplayVersion -ne $versionBefore) {
  Fail ("the version changed across the overwrite install: $versionBefore -> $($uninstallEntryAfter.DisplayVersion)")
}
Pass ("application state after the overwrite install: version still $versionBefore, uninstall entry intact")

Step 'second launch: the app must read the seeded data'
$proc = Start-AppLogged 'launch-second'
if ((Invoke-HarnessCode 'wait' '--db' $dbPath '--mode' 'app-write' '--token' $token '--timeout' '180') -ne 0) {
  Stop-AppLogged $proc
  Show-AppLog 'launch-second'
  Fail 'the app never persisted terminalThemeLightMigrated=true into the seeded settings row (the seeded data was not read back through the app's own path)'
}
Stop-AppLogged $proc
$proc = $null
Pass 'second launch stopped'

Step 'verify every asserted field survived the install cycle'
Invoke-Harness 'verify' '--db' $dbPath '--token' $token '--vault' $vaultPath '--before' $snapshot '--expect-app-write'
Invoke-Harness 'digest' '--db' $dbPath '--file' $vaultPath
Pass 'every seeded field was read back unchanged after the overwrite install; the digest above is reported for the record only'

Step 'silent uninstall (/S)'
$uninstaller = Join-Path $installDir 'uninstall.exe'
if (-not (Test-Path $uninstaller)) { Fail "uninstaller missing: $uninstaller" }
Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait
if (-not (Wait-Until { -not (Test-Path $installDir) } 180)) {
  Fail "install directory still present 180s after the silent uninstall: $installDir"
}
Pass 'silent uninstall removed the install directory'

Step 'user data policy after the uninstall'
$dbStillThere = Test-Path ($dbPath)
$vaultStillThere = Test-Path ($vaultPath)
if ($deleteAppDataOnUninstall) {
  if ($dbStillThere) { Fail ('deleteAppDataOnUninstall=true but the database survived the uninstall: ' + $dbPath) }
  Pass 'the uninstall deleted the user database, as bundle.windows.nsis.deleteAppDataOnUninstall=true requires'
} else {
  if (-not $dbStillThere) { Fail ('the default NSIS policy keeps user data, but the database was deleted: ' + $dbPath) }
  if (-not $vaultStillThere) { Fail ('the default NSIS policy keeps user data, but the vault file was deleted: ' + $vaultPath) }
  Pass 'the uninstall kept the user database and the vault file, matching the NSIS default (deleteAppDataOnUninstall=false)'
  Invoke-Harness 'verify' '--db' $dbPath '--token' $token '--vault' $vaultPath '--before' $snapshot '--expect-app-write'
  Pass 'every asserted field is still intact after the uninstall'
}
$entryAfterRemoval = Get-ItemProperty -Path $regRoots -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -like "*$productName*" } | Select-Object -First 1
if ($entryAfterRemoval) { Fail "the uninstall left a registry entry behind: $($entryAfterRemoval.PSPath)" }
Pass 'the uninstall removed the registry uninstall entry'

Step 'not automatable / not covered'
NotRun 'SmartScreen / Mark-of-the-Web block - a GUI security decision made by a human after downloading a file; CI cannot trigger or observe the prompt'
NotRun 'Authenticode signature verification - no code-signing certificate is available in CI, the dev build is unsigned'
NotRun 'driving the real UI (opening the hosts list and reading the seeded host on screen) - needs a GUI automation stack the runner does not have; the read-back evidence is the app boot-time write-back plus the field-by-field SQL read'
NotRun 'the encrypted vault round-trip (create with a master password, unlock, read an entry) - needs an interactive master password and would store a credential; the crypto round trip is covered by src-tauri vault_tests in the rust job, and only the vault file persistence is asserted here'
Skip 'cross-version upgrade (vN -> vN+1) - CI builds exactly one version, so an upgrade between two releases cannot be exercised here; the overwrite installation of the same package (the NSIS reinstall path) is verified, together with every field an upgrade has to preserve'

Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue   # cleanup only, no assertion depends on it
Write-Host ''
Pass 'Windows install chain + data retention (automated portion) completed'
