# Two-version upgrade report

- Status: **PASS**
- Platform: darwin
- A: 0.0.1-dev.1 (73cf7483e912af33)
- B: 0.0.1-dev.3-local (66f2465d44bb3e8e)
- Fault mode: none

## Checks

- [PASS] A metadata: 0.0.1-dev.1 73cf7483e912af33
- [PASS] B metadata: 0.0.1-dev.3-local 66f2465d44bb3e8e
- [PASS] install A: /tmp/phase95-upgrade-work5/terminal-upgrade-xwH6YB/Applications/Termius.app
- [PASS] A database created: /tmp/phase95-upgrade-work5/terminal-upgrade-xwH6YB/home/Library/Application Support/com.baicie.termius/terminal.db
- [PASS] A schema ready
- [PASS] A stopped: sigkill
- [PASS] seed A data: compatible with A schema
- [PASS] A read-back snapshot: hosts/settings/workspace/layout/vault readable
- [PASS] install B: /tmp/phase95-upgrade-work5/terminal-upgrade-xwH6YB/Applications/Termius.app
- [PASS] B migration: agent_forwarding,shell_integration
- [PASS] pre-migration backup: /tmp/phase95-upgrade-work5/terminal-upgrade-xwH6YB/home/Library/Application Support/com.baicie.termius/backups/pre-migration-1793844401192.db
- [PASS] B stopped: sigkill
- [PASS] data integrity after B: field-by-field
- [PASS] Team Sync local persistence: teams/members/shared hosts/sync_queue/user_profile
- [PASS] backup readable: /tmp/phase95-upgrade-work5/terminal-upgrade-xwH6YB/home/Library/Application Support/com.baicie.termius/backups/pre-migration-1793844401192.db

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

- real Vault master-password unlock (requires interactive credential; file persistence is asserted only)
- rollback B->A (no product rollback state machine; pre-migration backup readability is asserted)
- Linux and Windows adapters (NOT_RUN in this first implementation)
- Gatekeeper / notarization / Authenticode (BLOCKED_EXTERNAL)
- disk-full (read-only data directory is covered; installer media read-only is not)

Evidence directory: /tmp/phase95-upgrade-work5/terminal-upgrade-xwH6YB
