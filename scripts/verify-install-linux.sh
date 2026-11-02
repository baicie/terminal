#!/usr/bin/env bash
# Phase 8.8 Task E1 (install chain) + Phase 8.9 Task 5 (real data retention).
#
# What this proves, Linux:
#   1. the .deb metadata, its payload, and the shared libraries of the payload
#      binary; the .desktop entry the package installs (Exec/Icon/Type) and, when
#      desktop-file-validate exists, its structural validity
#   2. a REAL dpkg installation (sudo apt-get install ./pkg.deb, which drives
#      dpkg and resolves the declared dependencies). If the runner cannot install
#      the package it is printed as [SKIPPED] with the reason and the unpacked
#      payload path below still verifies the payload - it is never a pass
#   3. the app data directory it really uses is MEASURED: with XDG_CONFIG_HOME /
#      XDG_DATA_HOME / XDG_CACHE_HOME / HOME all pointed at throwaway
#      directories, the app must create $XDG_CONFIG_HOME/<identifier>/terminal.db
#      and must not fall back to $HOME/.config or $HOME/.local/share (both are
#      asserted absent, so an ignored XDG variable cannot pass silently)
#   4. the database the app created passes PRAGMA integrity_check and carries the
#      schema the app creates, before any test data is written
#   5. controlled rows are written through the app's own schema: one host (no
#      credential: auth_type=agent, password/private_key NULL), the app_settings
#      row, one workspace plus its workspace_layouts row, and a schema-valid test
#      vault file at dirs::config_dir()/terminal/vault.json (NOT the identifier
#      directory - see src-tauri/src/vault.rs fn get_vault_path)
#   6. after an overwrite installation the app is launched again and every
#      asserted field is read back and compared with the pre-install snapshot; a
#      file hash is reported for the record only, never as the evidence
#   7. the app really read the seeded row: a boot persists
#      terminalThemeLightMigrated=true into the settings row this run wrote
#      (store/app.ts hydrateFromDatabase -> getAppSettings -> setSetting). That
#      is also the version-migration assertion: the seeded row is an older shape
#      (missing the migrated flag, legacy light theme) and the app upgrades it
#   8. the same cycle for the AppImage, which is a separate artifact
#   9. removing the package keeps the user data directory (deb removal never
#      deletes user data: no postrm touches it)
#
# NOT automatable on a runner (printed as NOT_RUN): menu integration inside a
# live desktop session (no session bus / desktop environment exists here), and
# AppImage desktop integration through its own .desktop export.
#
# Every assertion exits non-zero. Nothing is swallowed with '|| true'; the only
# best-effort spots are the cleanup trap and process teardown, both labelled.
set -euo pipefail

BUNDLE_DIR="src-tauri/target/release/bundle"
EXPECTED_ID=com.baicie.termius
HARNESS="scripts/verify-install/data-retention.mjs"
WORK="$(mktemp -d)"
EVIDENCE_DIR="${VERIFY_INSTALL_EVIDENCE:-verify-install-evidence}/linux"
FAULT_INJECT="${VERIFY_INSTALL_FAULT_INJECT:-}"
TOKEN="p89lin-$(date +%Y%m%d%H%M%S)-$$"
export DISPLAY=:99

pass() { echo "[PASS] $*"; }
fail() { echo "[FAIL] $*"; exit 1; }
skip() { echo "[SKIPPED] $*"; }
notrun() { echo "[NOT_RUN] $*"; }
step() { echo; echo "=== $* ==="; }

XVFB_PID=""
cleanup() {
  # Cleanup is best effort and never asserts. Runs from an EXIT trap, so a
  # non-zero return here would rewrite the script's real exit status - which is
  # exactly what happened on the runner: every assertion passed (74 passed,
  # 0 failed), then "rm: cannot remove ... Directory not empty" turned the whole
  # job red. The directory is not empty because the AppImage process can still
  # be writing into it while rm walks the tree.
  if [ -n "$XVFB_PID" ]; then
    kill "$XVFB_PID" >/dev/null 2>&1 || echo "[WARN] Xvfb did not stop (cleanup only)"
  fi
  local attempt=0
  while [ "$attempt" -lt 5 ] && [ -e "$WORK" ]; do
    attempt=$((attempt + 1))
    rm -rf "$WORK" 2>/dev/null || true
    [ -e "$WORK" ] && sleep 1
  done
  if [ -e "$WORK" ]; then
    echo "[WARN] $WORK survived cleanup (left behind on purpose, never an assertion)"
  fi
  return 0
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

step "headless X server"
command -v Xvfb >/dev/null 2>&1 || fail "Xvfb is not installed; the app cannot be launched and the data assertions cannot run (CI installs the xvfb package before this step)"
Xvfb "$DISPLAY" -screen 0 1280x1024x24 >"$WORK/xvfb.log" 2>&1 &
XVFB_PID=$!
for _ in $(seq 1 20); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then break; fi
  sleep 1
done
xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 || { tail -5 "$WORK/xvfb.log"; fail "Xvfb never came up on $DISPLAY"; }
pass "Xvfb running on $DISPLAY (pid $XVFB_PID)"

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

# --- one isolated data cycle -------------------------------------------------
# cycle_setup <label> <command> [args...]
cycle_setup() {
  CYCLE_LABEL="$1"
  shift
  APP_CMD=("$@")
  CYCLE_ROOT="$WORK/cycle-$CYCLE_LABEL"
  CYCLE_HOME="$CYCLE_ROOT/home"
  CYCLE_CONFIG="$CYCLE_ROOT/config"
  CYCLE_DATA="$CYCLE_ROOT/data"
  CYCLE_CACHE="$CYCLE_ROOT/cache"
  mkdir -p "$CYCLE_HOME" "$CYCLE_CONFIG" "$CYCLE_DATA" "$CYCLE_CACHE"
  DB="$CYCLE_CONFIG/$EXPECTED_ID/terminal.db"
  VAULT="$CYCLE_CONFIG/terminal/vault.json"
  SNAPSHOT="$EVIDENCE_DIR/$CYCLE_LABEL-$TOKEN-before.json"
  echo "[INFO] $CYCLE_LABEL: XDG_CONFIG_HOME=$CYCLE_CONFIG"
  echo "[INFO] $CYCLE_LABEL: expected database $DB"
  echo "[INFO] $CYCLE_LABEL: expected vault    $VAULT"
}

launch_app() {
  local log="$1"
  HOME="$CYCLE_HOME" XDG_CONFIG_HOME="$CYCLE_CONFIG" XDG_DATA_HOME="$CYCLE_DATA" \
    XDG_CACHE_HOME="$CYCLE_CACHE" WEBKIT_DISABLE_COMPOSITING_MODE=1 \
    "${APP_CMD[@]}" >"$log" 2>&1 &
  echo $!
}

cycle_first_phase() {
  if [ -e "$DB" ]; then fail "$CYCLE_LABEL: $DB already exists before the first launch"; fi
  SECONDS=0
  APP_PID="$(launch_app "$WORK/$CYCLE_LABEL-first.log")"
  if ! dr wait --db "$DB" --mode db-exists --timeout 180; then
    kill "$APP_PID" 2>/dev/null || true
    tail -20 "$WORK/$CYCLE_LABEL-first.log"
    fail "$CYCLE_LABEL: the app never created $DB inside XDG_CONFIG_HOME within 180s"
  fi
  pass "$CYCLE_LABEL: database initialised ${SECONDS}s after launch inside the isolated XDG_CONFIG_HOME"
  if [ -e "$CYCLE_HOME/.config/$EXPECTED_ID/terminal.db" ]; then
    fail "$CYCLE_LABEL: the app fell back to \$HOME/.config and ignored XDG_CONFIG_HOME"
  fi
  if [ -e "$CYCLE_HOME/.local/share/$EXPECTED_ID/terminal.db" ]; then
    fail "$CYCLE_LABEL: the app wrote to \$HOME/.local/share and ignored XDG_CONFIG_HOME"
  fi
  pass "$CYCLE_LABEL: no fallback copy in \$HOME/.config or \$HOME/.local/share (XDG isolation is real)"
  SCHEMA_READY=0
  for _ in $(seq 1 90); do
    if dr schema --db "$DB" >"$WORK/$CYCLE_LABEL-schema.log" 2>&1; then SCHEMA_READY=1; break; fi
    sleep 1
  done
  if [ "$SCHEMA_READY" != 1 ]; then
    grep -E '^\[FAIL\]' "$WORK/$CYCLE_LABEL-schema.log" | head -5 || true
    fail "$CYCLE_LABEL: the app never finished creating its schema inside $DB"
  fi
  grep -E '^\[INFO\] tables' "$WORK/$CYCLE_LABEL-schema.log" | head -1
  pass "$CYCLE_LABEL: the app created its own schema in the isolated database"
  wait_for_exit "$APP_PID"
  pass "$CYCLE_LABEL: first launch stopped (pid $APP_PID gone)"
  dr integrity --db "$DB"
  dr seed --db "$DB" --token "$TOKEN" --vault "$VAULT"
  mkdir -p "$EVIDENCE_DIR"
  dr snapshot --db "$DB" --token "$TOKEN" --vault "$VAULT" --out "$SNAPSHOT"
  pass "$CYCLE_LABEL: controlled data written, snapshot at $SNAPSHOT"
  if [ -n "$FAULT_INJECT" ]; then
    # Test-only: proves the verification below is live. Never set in CI.
    echo "[TEST] VERIFY_INSTALL_FAULT_INJECT=$FAULT_INJECT - this run MUST go red"
    VERIFY_INSTALL_TEST_MUTATION=1 dr test-break --db "$DB" --token "$TOKEN" --mode "$FAULT_INJECT"
  fi
}

cycle_second_phase() {
  APP_PID="$(launch_app "$WORK/$CYCLE_LABEL-second.log")"
  if ! dr wait --db "$DB" --mode app-write --token "$TOKEN" --timeout 180; then
    kill "$APP_PID" 2>/dev/null || true
    tail -20 "$WORK/$CYCLE_LABEL-second.log"
    fail "$CYCLE_LABEL: the app never persisted terminalThemeLightMigrated=true into the seeded settings row (the seeded data was not read back through the app's own path)"
  fi
  wait_for_exit "$APP_PID"
  pass "$CYCLE_LABEL: second launch stopped (pid $APP_PID gone)"
  dr verify --db "$DB" --token "$TOKEN" --vault "$VAULT" --before "$SNAPSHOT" --expect-app-write
  dr digest --db "$DB" --file "$VAULT"
  pass "$CYCLE_LABEL: every asserted field was read back unchanged after the overwrite install (digest above is for the record only)"
}

# --- the .deb ---------------------------------------------------------------
step "deb package metadata"
[ -d "$BUNDLE_DIR/deb" ] || fail "bundle directory missing: $BUNDLE_DIR/deb"
DEB="$(find "$BUNDLE_DIR/deb" -maxdepth 1 -name '*.deb' -print -quit)"
[ -n "$DEB" ] || fail "no .deb inside $BUNDLE_DIR/deb"
DEB_BYTES="$(stat -c%s "$DEB")"
[ "$DEB_BYTES" -gt 1048576 ] || fail "deb is suspiciously small: $DEB_BYTES bytes"
pass "deb=$(basename "$DEB") bytes=$DEB_BYTES"
PKG_NAME="$(dpkg-deb -f "$DEB" Package)"
PKG_VERSION="$(dpkg-deb -f "$DEB" Version)"
DEB_ARCH="$(dpkg-deb -f "$DEB" Architecture)"
[ -n "$PKG_NAME" ] || fail "the deb has no Package field"
[ -n "$PKG_VERSION" ] || fail "the deb has no Version field"
[ -n "$DEB_ARCH" ] || fail "the deb has no Architecture field"
pass "package=$PKG_NAME version=$PKG_VERSION arch=$DEB_ARCH"
dpkg-deb -f "$DEB" Depends | sed 's/^/    Depends: /'

step "deb payload (dpkg-deb -x, no root needed)"
dpkg-deb -x "$DEB" "$WORK/root" || fail "dpkg-deb -x failed for $(basename "$DEB")"
[ -d "$WORK/root/usr/bin" ] || fail "deb payload has no /usr/bin"
PAYLOAD_BIN="$(find "$WORK/root/usr/bin" -maxdepth 1 -type f -executable -print -quit)"
[ -n "$PAYLOAD_BIN" ] || fail "no executable in the deb payload under /usr/bin"
pass "payload binary=$(basename "$PAYLOAD_BIN")"
if ldd "$PAYLOAD_BIN" | grep -q 'not found'; then
  ldd "$PAYLOAD_BIN" | grep 'not found' | sed 's/^/    /'
  fail "deb payload has unresolved shared libraries on this runner"
fi
pass "all shared libraries of the payload binary resolve (ldd)"

step "desktop entry inside the deb payload"
DESKTOP=""
if [ -d "$WORK/root/usr/share/applications" ]; then
  DESKTOP="$(find "$WORK/root/usr/share/applications" -maxdepth 1 -name '*.desktop' -print -quit)"
fi
[ -n "$DESKTOP" ] || fail "the deb installs no .desktop entry (menu integration would be missing)"
grep -q '^Type=Application' "$DESKTOP" || fail ".desktop entry has no Type=Application"
grep -q '^Name=' "$DESKTOP" || fail ".desktop entry has no Name="
grep -q '^Icon=' "$DESKTOP" || fail ".desktop entry has no Icon="
EXEC_LINE="$(grep -m1 '^Exec=' "$DESKTOP" || true)"
[ -n "$EXEC_LINE" ] || fail ".desktop entry has no Exec="
EXEC_BIN="$(printf '%s' "$EXEC_LINE" | sed 's/^Exec=//' | awk '{print $1}')"
# Exec=terminal is the normal form for a packaged app: a bare command name that
# the desktop resolves through PATH, landing on the package's /usr/bin/terminal.
# Concatenating it onto the payload root produced ".../rootterminal" and failed
# a correct .desktop on the runner, so resolve both forms explicitly.
if [ "${EXEC_BIN#/}" != "$EXEC_BIN" ]; then
  EXEC_PATH="$WORK/root$EXEC_BIN"
else
  EXEC_PATH="$WORK/root/usr/bin/$EXEC_BIN"
fi
[ -x "$EXEC_PATH" ] || fail ".desktop Exec=$EXEC_BIN does not point at a binary the package installs (looked for $EXEC_PATH)"
pass ".desktop $(basename "$DESKTOP") Exec=$EXEC_BIN resolves inside the payload"
if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$DESKTOP" || fail "desktop-file-validate rejected $(basename "$DESKTOP")"
  pass "desktop-file-validate accepted $(basename "$DESKTOP")"
else
  skip "desktop-file-validate structural validation - desktop-file-utils is not installed on this runner; the key fields above were still asserted"
fi

step "real dpkg installation (requires root)"
PKG_INSTALLED=0
# shellcheck disable=SC2024  # the log file is owned by the calling user; the redirect needs no root
if sudo apt-get install -y "./$DEB" >"$WORK/apt-install.log" 2>&1; then
  PKG_INSTALLED=1
  INSTALLED_STATUS="$(dpkg-query -W -f='${Status}' "$PKG_NAME")"
  pass "dpkg reports status '$INSTALLED_STATUS' for $PKG_NAME"
  [ "$INSTALLED_STATUS" = "install ok installed" ] || fail "dpkg status is '$INSTALLED_STATUS', expected 'install ok installed'"
  INSTALLED_VERSION="$(dpkg-query -W -f='${Version}' "$PKG_NAME")"
  [ "$INSTALLED_VERSION" = "$PKG_VERSION" ] || fail "the installed version $INSTALLED_VERSION differs from the package version $PKG_VERSION"
  INSTALLED_BIN="/usr/bin/$(basename "$PAYLOAD_BIN")"
  [ -x "$INSTALLED_BIN" ] || fail "after a real installation $INSTALLED_BIN is missing or not executable"
  cmp -s "$PAYLOAD_BIN" "$INSTALLED_BIN" || fail "the installed binary differs from the payload binary of the same .deb"
  pass "installed $PKG_NAME $INSTALLED_VERSION at $INSTALLED_BIN (byte-identical to the payload)"
  APP_MAIN="$INSTALLED_BIN"
else
  tail -12 "$WORK/apt-install.log" | sed 's/^/    /'
  skip "real dpkg installation - 'sudo apt-get install ./$(basename "$DEB")' failed on this runner (see the log above); the unpacked payload below is still verified end to end, but a real install was NOT observed"
  APP_MAIN="$PAYLOAD_BIN"
fi

step "deb data cycle: phase 1 (app creates its data, controlled data is written)"
cycle_setup deb "$APP_MAIN"
cycle_first_phase

step "deb overwrite installation"
if [ "$PKG_INSTALLED" = 1 ]; then
  # shellcheck disable=SC2024  # see above: the redirect target is user-owned
  if ! sudo apt-get install -y --reinstall "./$DEB" >"$WORK/apt-reinstall.log" 2>&1; then
    tail -12 "$WORK/apt-reinstall.log" | sed 's/^/    /'
    fail "the overwrite installation (apt-get --reinstall) failed"
  fi
  [ -x "$APP_MAIN" ] || fail "the overwrite installation removed $APP_MAIN"
  cmp -s "$PAYLOAD_BIN" "$APP_MAIN" || fail "the binary changed across the overwrite installation"
  pass "overwrite installation through dpkg kept the binary in place and byte-identical"
else
  dpkg-deb -x "$DEB" "$WORK/root" || fail "re-unpacking the same .deb over the payload tree failed"
  [ -x "$APP_MAIN" ] || fail "the overwrite (re-unpack) lost the binary"
  pass "overwrite (dpkg-deb -x re-unpack) kept the binary in place"
fi

step "deb data cycle: phase 2 (relaunch, read back field by field)"
cycle_second_phase
DEB_DATA_DIR="$CYCLE_CONFIG/$EXPECTED_ID"
DEB_VAULT="$VAULT"
DEB_SNAPSHOT="$SNAPSHOT"

if [ "$PKG_INSTALLED" = 1 ]; then
  step "package removal must not delete user data"
  # shellcheck disable=SC2024  # see above: the redirect target is user-owned
  if ! sudo dpkg -r "$PKG_NAME" >"$WORK/dpkg-remove.log" 2>&1; then
    tail -12 "$WORK/dpkg-remove.log" | sed 's/^/    /'
    fail "dpkg -r $PKG_NAME failed"
  fi
  if dpkg-query -W -f='${Status}' "$PKG_NAME" >"$WORK/dpkg-after.log" 2>&1; then
    grep -q 'install ok installed' "$WORK/dpkg-after.log" && fail "dpkg still reports $PKG_NAME as installed after the removal"
  fi
  [ -f "$DEB_DATA_DIR/terminal.db" ] || fail "the user database disappeared when the package was removed: $DEB_DATA_DIR/terminal.db"
  [ -f "$DEB_VAULT" ] || fail "the vault file disappeared when the package was removed: $DEB_VAULT"
  pass "package removal kept the user database and vault (deb removal never deletes user data)"
  dr verify --db "$DEB_DATA_DIR/terminal.db" --token "$TOKEN" --vault "$DEB_VAULT" --before "$DEB_SNAPSHOT" --expect-app-write
  pass "every asserted field is still intact after the package removal"
fi

# --- AppImage ---------------------------------------------------------------
step "AppImage"
[ -d "$BUNDLE_DIR/appimage" ] || fail "bundle directory missing: $BUNDLE_DIR/appimage"
APPIMAGE="$(find "$BUNDLE_DIR/appimage" -maxdepth 1 -name '*.AppImage' -print -quit)"
[ -n "$APPIMAGE" ] || fail "no .AppImage inside $BUNDLE_DIR/appimage"
APPIMAGE_BYTES="$(stat -c%s "$APPIMAGE")"
[ "$APPIMAGE_BYTES" -gt 1048576 ] || fail "AppImage is suspiciously small: $APPIMAGE_BYTES bytes"
chmod +x "$APPIMAGE" || fail "chmod +x failed on the AppImage"
[ -x "$APPIMAGE" ] || fail "AppImage is not executable after chmod +x"
pass "appimage=$(basename "$APPIMAGE") bytes=$APPIMAGE_BYTES executable=yes"
APPIMAGE_COPY="$WORK/$(basename "$APPIMAGE")"
cp "$APPIMAGE" "$APPIMAGE_COPY" || fail "could not copy the AppImage into the work directory"

step "AppImage data cycle: phase 1"
cycle_setup appimage "$APPIMAGE_COPY" --appimage-extract-and-run
cycle_first_phase

step "AppImage replaced in place (the overwrite step for a single-file artifact)"
cp "$APPIMAGE" "$APPIMAGE_COPY" || fail "could not replace the AppImage"
[ -x "$APPIMAGE_COPY" ] || fail "the replaced AppImage is not executable"
pass "AppImage replaced with the freshly bundled file"

step "AppImage data cycle: phase 2"
cycle_second_phase

step "desktop integration"
if [ -n "${XDG_CURRENT_DESKTOP:-}" ] && [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
  skip "live menu integration - a desktop session is advertised here, but this check is not implemented; use docs/manual-acceptance-checklist.md"
else
  notrun "menu integration inside a live desktop session (a panel or shell rendering the installed entry) - the runner has no desktop environment and no session bus, so the entry is only validated structurally (done above)"
fi
notrun "AppImage desktop integration (its own .desktop export and menu entry) - needs a desktop session and a user-level desktop-file integration step; no such session exists on the runner"

echo
pass "Linux install chain + data retention (automated portion) completed"
