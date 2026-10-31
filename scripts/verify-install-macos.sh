#!/usr/bin/env bash
# Phase 8.8 Task E1 (install chain) + Phase 8.9 Task 5 (real data retention).
#
# What this proves, macOS:
#   1. the DMG exists, mounts read-only, and its .app copies into a throwaway
#      Applications directory with the expected CFBundleIdentifier
#   2. the app data directory it really uses is MEASURED, not assumed: the app is
#      launched with HOME pointing at a throwaway directory and must create
#      Library/Application Support/<identifier>/terminal.db there, while nothing
#      is created in the runner's own HOME (that leak check is an assertion)
#   3. the database the app itself created passes PRAGMA integrity_check, and the
#      schema it created (hosts/settings/workspaces/workspace_layouts/...) is
#      there before any test data is written
#   4. controlled rows are written through the app's own schema: one host (no
#      credential: auth_type=agent, password and private_key NULL), the
#      app_settings row, one workspace plus its workspace_layouts row, and a
#      schema-valid test vault file at the path the app really uses
#      (dirs::config_dir()/terminal/vault.json - note: NOT the identifier
#      directory; see src-tauri/src/vault.rs fn get_vault_path)
#   5. after an overwrite install the app is launched again and the data is read
#      BACK FIELD BY FIELD and compared with the pre-install snapshot. A file
#      hash is reported for the record only; it is never the evidence
#   6. the app really read the seeded row: booting makes it persist
#      terminalThemeLightMigrated=true into the very settings row this run wrote
#      (store/app.ts hydrateFromDatabase -> getAppSettings -> setSetting), which
#      is a content-dependent side effect and is asserted, not assumed
#
# macOS isolates its data directory through HOME: the app resolves the path with
# dirs::config_dir() (tauri app_config_dir), which honours HOME, so an isolated
# HOME moves both the database and the vault without touching the runner's own
# home. That was measured on a real macOS host before being relied on here.
#
# NOT automatable on a runner (printed as NOT_RUN at the end): the Gatekeeper
# "cannot verify the developer" prompt, Developer ID signing, notarization.
#
# Every assertion exits non-zero. Nothing is swallowed with '|| true'; the only
# best-effort spots are the cleanup trap and process teardown, both labelled.
set -euo pipefail

BUNDLE_DIR="src-tauri/target/release/bundle"
PLIST_BUDDY=/usr/libexec/PlistBuddy
EXPECTED_ID=com.baicie.termius
HARNESS="scripts/verify-install/data-retention.mjs"
WORK="$(mktemp -d)"
ISOLATED_HOME="${VERIFY_INSTALL_HOME_DIR:-$WORK/home}"
EVIDENCE_DIR="${VERIFY_INSTALL_EVIDENCE:-verify-install-evidence}/macos"
FAULT_INJECT="${VERIFY_INSTALL_FAULT_INJECT:-}"
TOKEN="p89mac-$(date +%Y%m%d%H%M%S)-$$"
MOUNTED=0

pass() { echo "[PASS] $*"; }
fail() { echo "[FAIL] $*"; exit 1; }
notrun() { echo "[NOT_RUN] $*"; }
step() { echo; echo "=== $* ==="; }

cleanup() {
  # Cleanup is best effort and never asserts: a failure here cannot turn a real
  # assertion result into a pass, it only leaves a temporary resource behind.
  if [ "$MOUNTED" = 1 ]; then
    hdiutil detach "$WORK/mnt" -force >/dev/null 2>&1 || echo "[WARN] hdiutil detach failed (cleanup only)"
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# The data assertions need a SQLite driver. Node 24 ships node:sqlite without a
# flag, Node 22.5+ needs --experimental-sqlite; if neither works this script
# refuses to run rather than quietly reporting a pass without data evidence.
NODE_FLAG=none
if ! node -e "require('node:sqlite')" >/dev/null 2>&1; then
  if node --experimental-sqlite -e "require('node:sqlite')" >/dev/null 2>&1; then
    NODE_FLAG=flag
  else
    fail "no usable node:sqlite in $(node --version 2>/dev/null || echo 'node not found'); the data-retention assertions cannot run and this script will not report a pass without them"
  fi
fi
echo "[INFO] node $(node --version) sqlite driver mode=$NODE_FLAG"

dr() {
  if [ "$NODE_FLAG" = flag ]; then
    node --experimental-sqlite "$HARNESS" "$@"
  else
    node "$HARNESS" "$@"
  fi
}

launch() {
  # Starts the app with the isolated HOME; the caller owns the pid.
  local log="$1"
  HOME="$ISOLATED_HOME" "$BIN" >"$log" 2>&1 &
  echo $!
}

wait_for_exit() {
  # Polls for the process to be gone; escalates to SIGKILL after 30s.
  local pid="$1" i=0
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 30 ]; do
    sleep 1
    i=$((i + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true   # teardown only, assertions already made
    sleep 1
  fi
  wait "$pid" 2>/dev/null || true
}

digest_of() { if [ -f "$1" ]; then shasum -a 256 "$1" | awk '{print $1}'; else echo absent; fi; }

step "locate DMG"
[ -d "$BUNDLE_DIR/dmg" ] || fail "bundle directory missing: $BUNDLE_DIR/dmg (the bundle step produced nothing)"
DMG="$(find "$BUNDLE_DIR/dmg" -maxdepth 1 -name '*.dmg' -print -quit)"
[ -n "$DMG" ] || fail "no .dmg inside $BUNDLE_DIR/dmg"
DMG_BYTES="$(stat -f%z "$DMG")"
[ "$DMG_BYTES" -gt 1048576 ] || fail "dmg is suspiciously small: $DMG_BYTES bytes"
pass "dmg=$(basename "$DMG") bytes=$DMG_BYTES"

step "mount DMG read-only"
mkdir -p "$WORK/mnt"
if ! hdiutil attach -nobrowse -readonly -mountpoint "$WORK/mnt" "$DMG" >"$WORK/hdiutil-attach.log" 2>&1; then
  tail -10 "$WORK/hdiutil-attach.log"
  fail "hdiutil attach failed for $(basename "$DMG")"
fi
MOUNTED=1
pass "mounted at $WORK/mnt (read-only)"

step "copy .app into a throwaway Applications directory"
APP_SRC="$(find "$WORK/mnt" -maxdepth 1 -name '*.app' -print -quit)"
[ -n "$APP_SRC" ] || fail "no .app payload inside the mounted DMG"
mkdir -p "$WORK/Applications"
cp -R "$APP_SRC" "$WORK/Applications/"
INSTALLED="$WORK/Applications/$(basename "$APP_SRC")"
[ -d "$INSTALLED" ] || fail "copying the .app payload failed"
BIN="$(find "$INSTALLED/Contents/MacOS" -maxdepth 1 -type f -perm -111 -print -quit)"
[ -n "$BIN" ] || fail "no executable inside $INSTALLED/Contents/MacOS"
BUNDLE_ID="$("$PLIST_BUDDY" -c 'Print :CFBundleIdentifier' "$INSTALLED/Contents/Info.plist")"
[ "$BUNDLE_ID" = "$EXPECTED_ID" ] || fail "CFBundleIdentifier=$BUNDLE_ID, expected $EXPECTED_ID (product identity changed)"
pass "installed=$(basename "$INSTALLED") binary=$(basename "$BIN") CFBundleIdentifier=$BUNDLE_ID"

# The data directory the app really uses, derived from the code path the app
# takes (tauri app_config_dir -> dirs::config_dir() -> HOME/Library/Application
# Support, then the bundle identifier). The launch below proves this derivation
# instead of trusting it.
DATA_DIR="$ISOLATED_HOME/Library/Application Support/$EXPECTED_ID"
DB="$DATA_DIR/terminal.db"
# The vault is NOT under the identifier directory: src-tauri/src/vault.rs
# get_vault_path() uses dirs::config_dir()/terminal/vault.json.
VAULT="$ISOLATED_HOME/Library/Application Support/terminal/vault.json"
REAL_DATA_DIR="$HOME/Library/Application Support/$EXPECTED_ID"
REAL_VAULT="$HOME/Library/Application Support/terminal/vault.json"
REAL_DB_BEFORE="$(digest_of "$REAL_DATA_DIR/terminal.db")"
REAL_VAULT_BEFORE="$(digest_of "$REAL_VAULT")"
echo "[INFO] isolated data root: $ISOLATED_HOME"
echo "[INFO] expected database path: $DB"
echo "[INFO] expected vault path:    $VAULT"

step "first launch in an isolated HOME"
mkdir -p "$ISOLATED_HOME"
if [ -n "$(ls -A "$ISOLATED_HOME" 2>/dev/null)" ]; then
  fail "the isolated data root $ISOLATED_HOME is not empty; this run would inherit another run's data"
fi
pass "isolated data root is empty before the first launch"
SECONDS=0
APP_PID="$(launch "$WORK/launch-first.log")"
if ! dr wait --db "$DB" --mode db-exists --timeout 180; then
  kill "$APP_PID" 2>/dev/null || true
  tail -20 "$WORK/launch-first.log"
  fail "the app never created $DB inside the isolated HOME within 180s (see the log above)"
fi
INIT_SECONDS=$SECONDS
pass "first launch initialised the database ${INIT_SECONDS}s after launch (frontend boot path: tauri-plugin-sql create_database + initSchema, not native startup)"
REAL_DB_AFTER="$(digest_of "$REAL_DATA_DIR/terminal.db")"
REAL_VAULT_AFTER="$(digest_of "$REAL_VAULT")"
if [ "$REAL_DB_AFTER" != "$REAL_DB_BEFORE" ] || [ "$REAL_VAULT_AFTER" != "$REAL_VAULT_BEFORE" ]; then
  kill "$APP_PID" 2>/dev/null || true
  fail "the app wrote outside the isolated data root (real HOME db $REAL_DB_BEFORE -> $REAL_DB_AFTER, vault $REAL_VAULT_BEFORE -> $REAL_VAULT_AFTER)"
fi
pass "nothing was written to the runner's own HOME (db=$REAL_DB_BEFORE vault=$REAL_VAULT_BEFORE unchanged)"

SCHEMA_READY=0
for _ in $(seq 1 90); do
  if dr schema --db "$DB" >"$WORK/schema.log" 2>&1; then SCHEMA_READY=1; break; fi
  sleep 1
done
if [ "$SCHEMA_READY" != 1 ]; then
  grep -E '^\[FAIL\]' "$WORK/schema.log" | head -5 || true
  fail "the app never finished creating its schema inside $DB"
fi
grep -E '^\[INFO\] tables|^\[SUMMARY\]' "$WORK/schema.log" | head -2
pass "the app created its own schema in the isolated database"
wait_for_exit "$APP_PID"
pass "first launch stopped (pid $APP_PID gone)"

step "database integrity of the app-created database"
dr integrity --db "$DB"
pass "integrity_check and foreign_key_check are clean on the app-created database"

step "write controlled test data through the app schema"
dr seed --db "$DB" --token "$TOKEN" --vault "$VAULT"
mkdir -p "$EVIDENCE_DIR"
SNAPSHOT="$EVIDENCE_DIR/$TOKEN-before.json"
dr snapshot --db "$DB" --token "$TOKEN" --vault "$VAULT" --out "$SNAPSHOT"
pass "pre-install snapshot written to $SNAPSHOT"

if [ -n "$FAULT_INJECT" ]; then
  # Test-only: proves the verification below is live. Never set in CI.
  echo "[TEST] VERIFY_INSTALL_FAULT_INJECT=$FAULT_INJECT - this run MUST go red"
  VERIFY_INSTALL_TEST_MUTATION=1 dr test-break --db "$DB" --token "$TOKEN" --mode "$FAULT_INJECT"
fi

step "overwrite install (reinstall the DMG payload over the existing bundle)"
ditto "$APP_SRC" "$INSTALLED" || fail "overwrite install failed"
[ -d "$INSTALLED" ] || fail "overwrite install removed the .app"
DITTO_ID="$("$PLIST_BUDDY" -c 'Print :CFBundleIdentifier' "$INSTALLED/Contents/Info.plist")"
[ "$DITTO_ID" = "$EXPECTED_ID" ] || fail "overwrite install changed CFBundleIdentifier to $DITTO_ID"
[ -x "$BIN" ] || fail "overwrite install lost the executable"
cmp -s "$APP_SRC/Contents/MacOS/$(basename "$BIN")" "$BIN" || fail "the installed executable is not byte-identical to the DMG payload after the overwrite install"
pass "overwrite install kept the bundle, its identity, and a byte-identical executable"

step "second launch: the app must read the seeded data"
APP_PID="$(launch "$WORK/launch-second.log")"
if ! dr wait --db "$DB" --mode app-write --token "$TOKEN" --timeout 180; then
  kill "$APP_PID" 2>/dev/null || true
  tail -20 "$WORK/launch-second.log"
  fail "the app never persisted terminalThemeLightMigrated=true into the seeded settings row (the seeded data was not read back through the app's own path)"
fi
wait_for_exit "$APP_PID"
pass "second launch stopped (pid $APP_PID gone)"

step "verify every asserted field survived the install cycle"
# When the schema assertions fail the harness only says which tables are
# missing; the reason lives in the app's own output. Dump it on failure so the
# next run explains itself instead of needing a second run to diagnose.
if ! dr verify --db "$DB" --token "$TOKEN" --vault "$VAULT" --before "$SNAPSHOT" --expect-app-write; then
  echo "--- app output from the first launch ---"
  tail -60 "$WORK/launch-first.log" 2>/dev/null || echo "(no launch log)"
  echo "--- app output from the second launch ---"
  tail -60 "$WORK/launch-second.log" 2>/dev/null || echo "(no launch log)"
  fail "data-retention verification failed; the app output above explains why the schema was not completed"
fi
dr digest --db "$DB" --file "$VAULT"
pass "every seeded field was read back unchanged; the digest above is reported for the record only"

step "unmount"
hdiutil detach "$WORK/mnt" -force >/dev/null
MOUNTED=0
pass "dmg unmounted"

step "not automatable"
notrun "Gatekeeper 'cannot verify the developer' prompt - a blocking GUI security dialog that needs a human click; it cannot be scripted, auto-dismissed or asserted on a runner"
notrun "Developer ID signature and notarization - no signing identity is available in CI and the dev build is unsigned (see docs/release/)"
notrun "driving the real UI (opening the hosts list and reading the seeded host on screen) - needs a GUI automation stack the runner does not have; the read-back evidence is the app's own boot-time write-back plus the field-by-field SQL read"
notrun "the encrypted vault round-trip (create with a master password, unlock, read an entry) - needs an interactive master password and would store a credential; the crypto round trip is covered by src-tauri vault_tests in the rust job, and only the vault file's persistence is asserted here"

echo
pass "macOS install chain + data retention (automated portion) completed"
