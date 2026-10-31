#!/usr/bin/env bash
# Phase 8.8 Task E1 - Linux install-chain verification for the CI-built .deb and
# AppImage.
#
# The .deb is unpacked with dpkg-deb -x instead of dpkg -i on purpose: dpkg -i
# would drag the full WebKitGTK/GTK runtime dependency set into the assertion
# and fail for reasons that have nothing to do with the package. Unpacking plus
# an ldd check plus a real launch proves the same thing about the payload.
#
# Every assertion exits non-zero. Nothing is swallowed with `|| true`; the two
# best-effort spots (cleanup traps, retry after a failed first launch) are
# labelled as such.
set -euo pipefail

BUNDLE_DIR="src-tauri/target/release/bundle"
EXPECTED_ID=com.baicie.termius
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass() { echo "[PASS] $*"; }
fail() { echo "[FAIL] $*"; exit 1; }
skip() { echo "[SKIPPED] $*"; }
notrun() { echo "[NOT_RUN] $*"; }
step() { echo; echo "=== $* ==="; }

# Starts the given binary under Xvfb and reports whether the app process is
# still alive after 5s. Returns 0 when alive, 1 when it already died.
try_launch() {
  local label="$1" bin="$2" log pid
  shift 2
  log="$WORK/launch.log"
  xvfb-run -a --server-args="-screen 0 1280x1024x24" "$bin" "$@" >"$log" 2>&1 &
  pid=$!
  sleep 5
  if pgrep -f "$bin" >/dev/null; then
    echo "    alive after 5s: $label (xvfb-run pid $pid)"
    pkill -f "$bin" >/dev/null 2>&1 || true   # cleanup only, assertion already made
    sleep 1
    return 0
  fi
  echo "    not running after 5s: $label"
  tail -15 "$log" | sed 's/^/    /'
  return 1
}

step "deb package"
[[ -d "$BUNDLE_DIR/deb" ]] || fail "bundle directory missing: $BUNDLE_DIR/deb"
DEB="$(find "$BUNDLE_DIR/deb" -maxdepth 1 -name '*.deb' -print -quit)"
[[ -n "$DEB" ]] || fail "no .deb inside $BUNDLE_DIR/deb"
DEB_BYTES="$(stat -c%s "$DEB")"
[[ "$DEB_BYTES" -gt 1048576 ]] || fail "deb is suspiciously small: $DEB_BYTES bytes"
pass "deb=$(basename "$DEB") bytes=$DEB_BYTES"
dpkg-deb -f "$DEB" Package Version Architecture Depends | sed 's/^/    /'

dpkg-deb -x "$DEB" "$WORK/root" || fail "dpkg-deb -x failed for $(basename "$DEB")"
[[ -d "$WORK/root/usr/bin" ]] || fail "deb payload has no /usr/bin"
DEB_BIN="$(find "$WORK/root/usr/bin" -maxdepth 1 -type f -executable -print -quit)"
[[ -n "$DEB_BIN" ]] || fail "no executable in the deb payload under /usr/bin"
pass "deb payload binary=$(basename "$DEB_BIN")"

step "deb payload shared libraries"
if ldd "$DEB_BIN" | grep -q 'not found'; then
  ldd "$DEB_BIN" | grep 'not found' | sed 's/^/    /'
  fail "deb payload has unresolved shared libraries on this runner"
fi
pass "all shared libraries of the deb payload resolve (ldd)"

step "launch the deb payload under Xvfb"
DATA_DIR="$HOME/.local/share/$EXPECTED_ID"
DATA_BEFORE=0
if [[ -d "$DATA_DIR" ]]; then DATA_BEFORE=1; fi
try_launch "deb payload" "$DEB_BIN" || fail "the deb payload did not stay alive for 5s"
pass "deb install chain: unpack + launch"

HAVE_DATA=0
if [[ -d "$DATA_DIR" ]]; then HAVE_DATA=1; fi
if [[ "$DATA_BEFORE" == 1 ]]; then
  skip "app data dir creation - ~/.local/share/$EXPECTED_ID already existed before this run, so its creation was not observed"
elif [[ "$HAVE_DATA" == 1 ]]; then
  pass "app data dir created by the first launch: ~/.local/share/$EXPECTED_ID"
else
  skip "app data dir creation - no ~/.local/share/$EXPECTED_ID within 5s of the first launch"
fi

step "overwrite install (re-unpack the same .deb over the installed tree)"
dpkg-deb -x "$DEB" "$WORK/root" || fail "re-unpack over the existing tree failed"
[[ -x "$DEB_BIN" ]] || fail "overwrite install lost the binary"
pass "overwrite install kept the binary in place"
try_launch "deb payload after overwrite install" "$DEB_BIN" || fail "the deb payload did not stay alive for 5s after the overwrite install"
if [[ "$HAVE_DATA" == 1 ]]; then
  [[ -d "$DATA_DIR" ]] || fail "app data dir vanished after the overwrite install"
  pass "data retention: app data dir survived the overwrite install"
else
  skip "overwrite-install data retention - the app created no ~/.local/share/$EXPECTED_ID within 5s, so there was nothing to preserve"
fi

step "AppImage"
[[ -d "$BUNDLE_DIR/appimage" ]] || fail "bundle directory missing: $BUNDLE_DIR/appimage"
APPIMAGE="$(find "$BUNDLE_DIR/appimage" -maxdepth 1 -name '*.AppImage' -print -quit)"
[[ -n "$APPIMAGE" ]] || fail "no .AppImage inside $BUNDLE_DIR/appimage"
APPIMAGE_BYTES="$(stat -c%s "$APPIMAGE")"
[[ "$APPIMAGE_BYTES" -gt 1048576 ]] || fail "AppImage is suspiciously small: $APPIMAGE_BYTES bytes"
chmod +x "$APPIMAGE" || fail "chmod +x failed on the AppImage"
[[ -x "$APPIMAGE" ]] || fail "AppImage is not executable after chmod +x"
pass "appimage=$(basename "$APPIMAGE") bytes=$APPIMAGE_BYTES executable=yes"

if try_launch "AppImage direct run" "$APPIMAGE"; then
  pass "AppImage launch (mode=direct, FUSE mount)"
elif try_launch "AppImage extract-and-run" "$APPIMAGE" --appimage-extract-and-run; then
  pass "AppImage launch (mode=extract-and-run; direct FUSE mount unavailable on this runner)"
else
  fail "AppImage did not stay alive in either run mode (direct, then extract-and-run)"
fi

step "not automatable"
notrun "distribution-level install via a desktop environment (menu entry, .desktop association) - a runner has no desktop session to observe it"

echo
pass "Linux install chain (automated portion) completed"
