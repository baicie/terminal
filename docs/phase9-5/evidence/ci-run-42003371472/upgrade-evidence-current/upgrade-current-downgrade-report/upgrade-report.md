# Two-version upgrade report

- Status: **PASS**
- Platform: darwin
- A: 0.0.1-dev.1 (73cf7483e912af33)
- B: 0.0.1-dev.4-local (dcd865d1d9159e48)
- Fault mode: downgrade

## Checks

- [PASS] A metadata: 0.0.1-dev.1 73cf7483e912af33
- [PASS] B metadata: 0.0.1-dev.4-local dcd865d1d9159e48
- [PASS] install A: /Users/runner/work/terminal/terminal/upgrade-current-downgrade/terminal-upgrade-6ixUrF/Applications/Termius.app
- [PASS] A database created: /Users/runner/work/terminal/terminal/upgrade-current-downgrade/terminal-upgrade-6ixUrF/home/Library/Application Support/com.baicie.termius/terminal.db
- [PASS] A schema ready
- [PASS] A stopped: sigkill
- [PASS] seed A data: compatible with A schema
- [PASS] vault encrypted fixture: Argon2id + AES-256-GCM entry created
- [PASS] A read-back snapshot: hosts/settings/workspace/layout/vault readable
- [PASS] install B: /Users/runner/work/terminal/terminal/upgrade-current-downgrade/terminal-upgrade-6ixUrF/Applications/Termius.app
- [PASS] B migration: agent_forwarding,shell_integration
- [PASS] pre-migration backup: /Users/runner/work/terminal/terminal/upgrade-current-downgrade/terminal-upgrade-6ixUrF/home/Library/Application Support/com.baicie.termius/backups/pre-migration-1793872231684.db
- [PASS] B stopped: sigkill
- [PASS] data integrity after B: field-by-field
- [PASS] vault crypto unlock after B: encrypted entry decrypted with the same password
- [PASS] vault wrong password rejected
- [PASS] Team Sync local persistence: teams/members/shared hosts/sync_queue/user_profile
- [PASS] backup readable: /Users/runner/work/terminal/terminal/upgrade-current-downgrade/terminal-upgrade-6ixUrF/home/Library/Application Support/com.baicie.termius/backups/pre-migration-1793872231684.db
- [PASS] downgrade A launch: A process stayed alive through schema wait
- [PASS] downgrade readability: A reads the additive post-migration schema
- [PASS] downgrade preserved B columns: B-era rows/columns still compare
- [PASS] downgrade did not destroy data: field-level verify against the B snapshot passed; sha ff71862c08c3b2c3

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

Evidence directory: /Users/runner/work/terminal/terminal/upgrade-current-downgrade/terminal-upgrade-6ixUrF
