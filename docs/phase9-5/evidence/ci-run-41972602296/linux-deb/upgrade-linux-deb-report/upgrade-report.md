# Two-version upgrade report

- Status: **PASS**
- Platform: linux
- A: 0.0.1-dev.1 (4ed449bf4a64727f)
- B: 0.0.1-dev.2 (80c40e72989b4c59)
- Fault mode: none

## Checks

- [PASS] A metadata: 0.0.1-dev.1
- [PASS] B metadata: 0.0.1-dev.2
- [PASS] install A (deb): termius 0.0.1-dev.1
- [PASS] A database created: /home/runner/work/terminal/terminal/upgrade-linux-deb/terminal-upgrade-linux-g6vOI2/config/com.baicie.termius/terminal.db
- [PASS] A schema ready
- [PASS] A stopped: sigkill
- [PASS] seed A data: compatible with A schema
- [PASS] A read-back snapshot: hosts/settings/workspace/layout/vault readable
- [PASS] B installed version: 0.0.1-dev.2
- [PASS] A->B version changed: 0.0.1-dev.1 -> 0.0.1-dev.2
- [PASS] B migration: agent_forwarding,shell_integration
- [PASS] B stopped: sigkill
- [PASS] data integrity after B: field-by-field
- [PASS] Team Sync local persistence: teams/members/shared hosts/sync_queue/user_profile
- [NOT_RUN] pre-migration backup: Linux B has no backup probe in this iteration

## Schema

```json
{
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

- real Vault master-password unlock (file persistence only)
- Team Sync server synchronization (local tables only)
- fault injection on Linux (not implemented; root/read-only semantics differ)
- Windows adapter
- AppImage internal metadata when extraction is unavailable

Evidence directory: /home/runner/work/terminal/terminal/upgrade-linux-deb/terminal-upgrade-linux-g6vOI2
