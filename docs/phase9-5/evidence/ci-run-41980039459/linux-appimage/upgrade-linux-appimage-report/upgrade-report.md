# Two-version upgrade report

- Status: **PARTIAL**
- Platform: linux
- A: unknown (5a60bb64264e8dac)
- B: unknown (9ec65f538e8ef0a1)
- Fault mode: none

## Checks

- [NOT_RUN] A metadata: UNKNOWN
- [NOT_RUN] B metadata: UNKNOWN
- [NOT_RUN] A/B version comparison: internal AppImage version metadata unavailable
- [PASS] install A (AppImage replacement): /home/runner/work/terminal/terminal/upgrade-linux-appimage/terminal-upgrade-linux-iN6Fh7/apps/Terminal-A.AppImage
- [PASS] AppImage payload replacement: /home/runner/work/terminal/terminal/upgrade-linux-appimage/terminal-upgrade-linux-iN6Fh7/apps/Terminal-A.AppImage
- [NOT_RUN] AppImage app startup: headless Xvfb: bundled WebKit EGL_BAD_PARAMETER; system-WebKit fallback hits bundled GStreamer/GLib ABI

## Schema

```json
null
```

## NOT_RUN

- real Vault master-password unlock (file persistence only)
- Team Sync server synchronization (local tables only)
- fault injection on Linux (not implemented; root/read-only semantics differ)
- Windows adapter
- AppImage internal metadata when extraction is unavailable
- AppImage app startup and A->B migration (headless WebKit/EGL limitation; replacement only)

Evidence directory: /home/runner/work/terminal/terminal/upgrade-linux-appimage/terminal-upgrade-linux-iN6Fh7
