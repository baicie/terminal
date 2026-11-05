# Two-version upgrade report

- Status: **PASS**
- Platform: darwin
- A: 0.0.1-dev.1 (73cf7483e912af33)
- B: 0.0.1-dev.4-local (dcd865d1d9159e48)
- Fault mode: read-only-data-dir

## Checks

- [PASS] A metadata: 0.0.1-dev.1 73cf7483e912af33
- [PASS] B metadata: 0.0.1-dev.4-local dcd865d1d9159e48
- [PASS] install A: /Users/runner/work/terminal/terminal/upgrade-current-readonly/terminal-upgrade-fZnwK5/Applications/Termius.app
- [PASS] A database created: /Users/runner/work/terminal/terminal/upgrade-current-readonly/terminal-upgrade-fZnwK5/home/Library/Application Support/com.baicie.termius/terminal.db
- [PASS] A schema ready
- [PASS] A stopped: sigkill
- [PASS] seed A data: compatible with A schema
- [PASS] vault encrypted fixture: Argon2id + AES-256-GCM entry created
- [PASS] A read-back snapshot: hosts/settings/workspace/layout/vault readable
- [PASS] install B: /Users/runner/work/terminal/terminal/upgrade-current-readonly/terminal-upgrade-fZnwK5/Applications/Termius.app
- [PASS] read-only data dir preserved DB: cba350df33d026a5 -> cba350df33d026a5
- [PASS] read-only failure detected by the app: app log: attempt to write a readonly database
- [PASS] no partial migration: hosts schema is still A
- [PASS] read-only recovery: B migrated after the directory became writable
- [PASS] fault.FAULT_INJECTED
- [PASS] fault.APPLICATION_FAILURE_OBSERVED
- [PASS] fault.ORIGINAL_DATA_PRESERVED
- [PASS] fault.NO_PARTIAL_MIGRATION
- [PASS] fault.RECOVERY_SUCCEEDED

## Schema

```json
{
  "beforeTables": [
    "command_history",
    "connection_logs",
    "groups",
    "hosts",
    "known_hosts",
    "port_forward_rules",
    "script_executions",
    "scripts",
    "settings",
    "snippet_packages",
    "snippets",
    "ssh_keys",
    "sync_queue",
    "team_audit_logs",
    "team_invites",
    "team_members",
    "team_shared_hosts",
    "team_shared_snippets",
    "teams",
    "user_profile",
    "workspace_layouts",
    "workspaces"
  ],
  "beforeHostColumns": [
    "id",
    "name",
    "hostname",
    "port",
    "username",
    "auth_type",
    "password",
    "private_key",
    "certificate",
    "group_id",
    "is_favorite",
    "color",
    "tags",
    "port_forwards",
    "startup_command",
    "environment",
    "jump_host_id",
    "jump_host_auth_type",
    "created_at",
    "updated_at"
  ],
  "afterTables": null,
  "afterHostColumns": null,
  "addedHostColumns": null
}
```

## NOT_RUN

- app-level Vault unlock through the UI (encrypted fixture is unlocked by the independent Node verifier; file persistence is asserted)
- incompatible-schema downgrade refusal (dev.1 reads the additive current schema; a non-additive future schema is not tested)
- Linux and Windows adapters (NOT_RUN in this first implementation)
- Gatekeeper / notarization / Authenticode (BLOCKED_EXTERNAL)
- disk-full (read-only data directory is covered; installer media read-only is not)

Evidence directory: /Users/runner/work/terminal/terminal/upgrade-current-readonly/terminal-upgrade-fZnwK5
