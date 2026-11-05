# Upgrade evidence — run 41975451672

- Workflow: `Upgrade E2E` / `macOS current-version upgrade and recovery`
- Commit: `0819fd0fd3a3af98f57553ed8e0149612cf1c38b`
- A: published `0.0.1-dev.1` (`73cf7483…`)
- B: current HEAD test build `0.0.1-dev.4-local` (`c3bb8caf…`), instrumented with
  `VITE_TERMINAL_SMOKE_BUILD=1` and `VITE_TERMINAL_MIGRATION_DELAY_MS=1500`
- Reports: normal, interrupted, restore-backup, downgrade, corrupt-db,
  read-only-data-dir, restart-idempotent
- All seven reports passed `check-upgrade-evidence.mjs` in CI.
