# Two-version upgrade report

- Status: **PASS**
- Platform: darwin
- A: 0.0.1-dev.1 (73cf7483e912af33)
- B: 0.0.1-dev.4-local (02e0930f5494b0f1)
- Fault mode: restore-backup

## Checks

- [PASS] A metadata: 0.0.1-dev.1 73cf7483e912af33
- [PASS] B metadata: 0.0.1-dev.4-local 02e0930f5494b0f1
- [PASS] install A: /Users/runner/work/terminal/terminal/upgrade-current-restore/terminal-upgrade-RfQMU4/Applications/Termius.app
- [PASS] A database created: /Users/runner/work/terminal/terminal/upgrade-current-restore/terminal-upgrade-RfQMU4/home/Library/Application Support/com.baicie.termius/terminal.db
- [PASS] A schema ready
- [PASS] A stopped: graceful pid=34322 exit=null signal=SIGTERM exitObserved=true closeObserved=true escalation=false elapsedMs=45
- [PASS] seed A data: compatible with A schema
- [PASS] vault encrypted fixture: Argon2id + AES-256-GCM entry created
- [PASS] A read-back snapshot: hosts/settings/workspace/layout/vault readable
- [PASS] install B: /Users/runner/work/terminal/terminal/upgrade-current-restore/terminal-upgrade-RfQMU4/Applications/Termius.app
- [PASS] B migration: agent_forwarding,shell_integration
- [PASS] pre-migration backup: /Users/runner/work/terminal/terminal/upgrade-current-restore/terminal-upgrade-RfQMU4/home/Library/Application Support/com.baicie.termius/backups/pre-migration-1793879210612.db
- [PASS] B stopped: graceful pid=34542 exit=null signal=SIGTERM exitObserved=true closeObserved=true escalation=false elapsedMs=258
- [PASS] data integrity after B: field-by-field
- [PASS] vault crypto unlock after B: encrypted entry decrypted with the same password
- [PASS] vault wrong password rejected
- [PASS] Team Sync local persistence: teams/members/shared hosts/sync_queue/user_profile
- [PASS] backup readable: /Users/runner/work/terminal/terminal/upgrade-current-restore/terminal-upgrade-RfQMU4/home/Library/Application Support/com.baicie.termius/backups/pre-migration-1793879210612.db
- [PASS] backup restore stages: PREPARE>QUIESCE>VERIFY_BACKUP>STAGE>VERIFY_STAGED>COMMIT>VERIFY>COMPLETE
- [PASS] restored DB matches backup: 38351f33cf160270
- [PASS] restored A launch: A process stayed alive through schema wait
- [PASS] backup restore: A launched and read the restored pre-migration DB

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
  "afterTables": [
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
  "afterHostColumns": [
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
    "updated_at",
    "agent_forwarding",
    "shell_integration"
  ],
  "addedHostColumns": [
    "agent_forwarding",
    "shell_integration"
  ]
}
```

## NOT_RUN

- app-level Vault unlock through the UI (encrypted fixture is unlocked by the independent Node verifier; file persistence is asserted)
- incompatible-schema downgrade refusal (dev.1 reads the additive current schema; a non-additive future schema is not tested)
- Linux and Windows adapters (NOT_RUN in this first implementation)
- Gatekeeper / notarization / Authenticode (BLOCKED_EXTERNAL)
- disk-full (read-only data directory is covered; installer media read-only is not)

Evidence directory: /Users/runner/work/terminal/terminal/upgrade-current-restore/terminal-upgrade-RfQMU4
