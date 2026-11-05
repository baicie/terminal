# Upgrade evidence — run 41980039459

- Commit: `94f4b32` (final scripts for Phase 9.5.1)
- macOS current-version: current HEAD test build `0.0.1-dev.4-local`, source SHA
  `94f4b32…`, DMG SHA `00afd8ff…`; seven reports (normal, interrupted,
  restore-backup, downgrade, corrupt-db, read-only-data-dir,
  restart-idempotent) all PASS and passed `check-upgrade-evidence.mjs`.
- Linux DEB: `0.0.1-dev.1` → `0.0.1-dev.2`, real dpkg, PASS.
- Linux AppImage: payload-only; B replaces A at the same path, replacement SHA
  equals B, A/B metadata is unknown; app startup and migration are `NOT_RUN`
  because headless Xvfb fails in the bundled WebKit EGL default-display path.
- Windows: isolation preflight only; shared profile refused, no upgrade run.
