#!/usr/bin/env bash
# Phase 8.8 Task E1 - macOS install-chain verification for the CI-built DMG.
#
# Automated assertions (each one exits non-zero on failure; nothing is swallowed):
#   1. the DMG exists and is not empty
#   2. the DMG mounts read-only
#   3. the .app inside it copies to a throwaway Applications directory
#   4. CFBundleIdentifier is still com.baicie.termius
#   5. the copied binary stays alive for 5s
#   6. an overwrite install keeps the bundle, its identity and the app data dir
#
# NOT automatable on a runner (printed as NOT_RUN at the end): the Gatekeeper
# "cannot verify the developer" prompt, real Developer ID signing/notarization.
set -euo pipefail

BUNDLE_DIR="src-tauri/target/release/bundle"
PLIST_BUDDY=/usr/libexec/PlistBuddy
EXPECTED_ID=com.baicie.termius
WORK="$(mktemp -d)"
MOUNTED=0

pass() { echo "[PASS] $*"; }
fail() { echo "[FAIL] $*"; exit 1; }
skip() { echo "[SKIPPED] $*"; }
notrun() { echo "[NOT_RUN] $*"; }
step() { echo; echo "=== $* ==="; }

cleanup() {
  # Cleanup is best effort and never asserts: a failure here cannot turn a real
  # assertion result into a pass, it only leaves a temporary resource behind.
  if [[ "$MOUNTED" == 1 ]]; then
    hdiutil detach "$WORK/mnt" -force >/dev/null 2>&1 || echo "[WARN] hdiutil detach failed (cleanup only)"
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

step "locate DMG"
[[ -d "$BUNDLE_DIR/dmg" ]] || fail "bundle directory missing: $BUNDLE_DIR/dmg (the bundle step produced nothing)"
DMG="$(find "$BUNDLE_DIR/dmg" -maxdepth 1 -name '*.dmg' -print -quit)"
[[ -n "$DMG" ]] || fail "no .dmg inside $BUNDLE_DIR/dmg"
DMG_BYTES="$(stat -f%z "$DMG")"
[[ "$DMG_BYTES" -gt 1048576 ]] || fail "dmg is suspiciously small: $DMG_BYTES bytes"
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
[[ -n "$APP_SRC" ]] || fail "no .app payload inside the mounted DMG"
mkdir -p "$WORK/Applications"
cp -R "$APP_SRC" "$WORK/Applications/"
INSTALLED="$WORK/Applications/$(basename "$APP_SRC")"
[[ -d "$INSTALLED" ]] || fail "copying the .app payload failed"
pass "installed=$(basename "$INSTALLED")"

step "assert bundle identity"
BUNDLE_ID="$("$PLIST_BUDDY" -c 'Print :CFBundleIdentifier' "$INSTALLED/Contents/Info.plist")"
[[ "$BUNDLE_ID" == "$EXPECTED_ID" ]] || fail "CFBundleIdentifier=$BUNDLE_ID, expected $EXPECTED_ID (product identity changed)"
pass "CFBundleIdentifier=$BUNDLE_ID"

BIN="$(find "$INSTALLED/Contents/MacOS" -maxdepth 1 -type f -perm -111 -print -quit)"
[[ -n "$BIN" ]] || fail "no executable inside $INSTALLED/Contents/MacOS"

launch_and_check() {
  local label="$1" log pid
  log="$WORK/launch.log"
  "$BIN" >"$log" 2>&1 &
  pid=$!
  sleep 5
  if kill -0 "$pid" 2>/dev/null; then
    pass "$label: process alive after 5s (pid $pid)"
    kill "$pid" 2>/dev/null            # cleanup only, assertion already made
    wait "$pid" 2>/dev/null || true    # cleanup only, exit status not asserted
    return 0
  fi
  echo "[FAIL] $label: process exited within 5s"
  tail -20 "$log"
  return 1
}

step "launch from the copied bundle"
DATA_DIR="$HOME/Library/Application Support/$EXPECTED_ID"
DATA_BEFORE=0
if [[ -d "$DATA_DIR" ]]; then DATA_BEFORE=1; fi
launch_and_check "first launch"
HAVE_DATA=0
if [[ -d "$DATA_DIR" ]]; then HAVE_DATA=1; fi
if [[ "$DATA_BEFORE" == 1 ]]; then
  skip "app data dir creation - ~/Library/Application Support/$EXPECTED_ID already existed before this run, so its creation was not observed"
elif [[ "$HAVE_DATA" == 1 ]]; then
  pass "app data dir created by the first launch: ~/Library/Application Support/$EXPECTED_ID"
else
  skip "app data dir creation - no ~/Library/Application Support/$EXPECTED_ID within 5s of the first launch"
fi

step "overwrite install (reinstall over the existing bundle)"
ditto "$APP_SRC" "$INSTALLED" || fail "overwrite install failed"
[[ -d "$INSTALLED" ]] || fail "overwrite install removed the .app"
DITTO_ID="$("$PLIST_BUDDY" -c 'Print :CFBundleIdentifier' "$INSTALLED/Contents/Info.plist")"
[[ "$DITTO_ID" == "$EXPECTED_ID" ]] || fail "overwrite install changed CFBundleIdentifier to $DITTO_ID"
pass "overwrite install kept the bundle and its identity"
launch_and_check "launch after overwrite install"

if [[ "$HAVE_DATA" == 1 ]]; then
  [[ -d "$DATA_DIR" ]] || fail "app data dir vanished after the overwrite install"
  pass "data retention: app data dir survived the overwrite install"
else
  skip "overwrite-install data retention - the app created no ~/Library/Application Support/$EXPECTED_ID within 5s, so there was nothing to preserve"
fi

step "unmount"
hdiutil detach "$WORK/mnt" -force >/dev/null
MOUNTED=0
pass "dmg unmounted"

step "not automatable"
notrun "Gatekeeper 'cannot verify the developer' prompt - a blocking GUI security dialog that needs a human click; it cannot be scripted, auto-dismissed or asserted on a runner"
notrun "Developer ID signature and notarization - no signing identity is available in CI and the dev build is unsigned (see docs/release/)"

echo
pass "macOS install chain (automated portion) completed"
