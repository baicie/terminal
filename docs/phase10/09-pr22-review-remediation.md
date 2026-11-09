# PR #22 — 外部审查与修复报告

- 审查基线 HEAD：`a6e330b`
- 修复后冻结 HEAD：`fd3f3c6`
- PR：[#22](https://github.com/baicie/terminal/pull/22)

## 1. 审查确认的确定性缺陷

外部审查指出的四处 P0 全部属实，且我用失败测试逐一复现后修复。

### P0-1 Host 写入路径绕过 Vault

`store/host.ts` 自己拼接 `INSERT INTO hosts (…, password, private_key …)`，
而 Phase 10 第一批只改了 `service/database/hosts.ts`。**UI 从不调用被改的那条路径**，
所以安全实现完全没生效。这是「测试通过但功能未接」的典型案例：单测直接调
`createHost()`，而真实入口是 store。

更有说服力的一点：我自己的 6 项 `hosts-secrets.test.ts` 在修复前一直是绿的。

### P0-2 主终端 SSH 凭据解析脱节

`terminal-launcher.ts` 直接读 `host.password` / `host.privateKey`，只有另一条
`SessionService` 路径接入了 `resolveSessionCredential()`。

### P0-3 普通 JSON 导出泄露秘密

`service/sync-export.ts` 用 `SELECT * FROM hosts` + `JSON.stringify`，
`getSSHKeys()` 的结果也原样进入导出。旧库里的明文密码、私钥、passphrase 会
全部写入导出文件。而 `PLAIN_EXPORT_SECRET_EXCLUDED=PASS` 曾被写成已完成——
**那是错的**，已更正。

### P0-4 `ssh_keys` 明文（同源问题，审查未点名但同一模式）

`createSSHKey` / `updateSSHKey` 把 `private_key` 与 `passphrase` 写进明文列。

## 2. 修复后的实际数据流

```
UI Form
  → store/host.ts addHost / updateHost          （不再拼接任何 SQL）
    → service/database/hosts.ts createHost / updateHost
      → persistHostSecrets
        → vaultSecretProvider.write(id, kind, value)
      → INSERT/UPDATE … password = NULL, private_key = NULL, credential_ref = ?
```

连接：

```
terminal-launcher.ts createTerminalShell
  → withResolvedCredential(target)      （agent 直通；内联秘密直通；否则 Vault）
  → withResolvedCredential(jumpHost)    （两侧独立解析）
  → invoke('session_create_ssh_*')
```

导出：

```
collectExportData
  → sanitizeHostRow(row)     白名单 20 字段 + credential_ref 描述
  → sanitizeSshKeyRow(row)   白名单 8 字段，无 private_key / passphrase
```

## 3. 原子性（不声称事务）

SQLite 与 Vault 无共享事务，因此按失败状态定义而非宣称原子：

| 失败点 | 结果 |
| --- | --- |
| Vault 写入失败 | 抛出，SQLite 不落引用；旧值仍在（同 key 覆盖） |
| Vault 成功、SQLite 失败 | 引用未变，重试收敛；无孤儿引用（key 只由 host id+kind 决定） |
| 删除 Host | 先删行后删 Vault；中途失败只留不可达的孤立 key |
| 部分 secret 失败 | 该行不提交，明文保留，旧路径仍可用 |

## 4. 每个 P0 的失败测试与修复测试

| 缺陷 | 测试文件 | 修复前 | 修复后 |
| --- | --- | --- | --- |
| P0-1 | `store/host-credentials.test.ts` | 7/7 失败 | 7/7 通过 |
| P0-2 | `features/terminal/services/terminal-launcher-credentials.test.ts` | 5/7 失败 | 7/7 通过 |
| P0-3 | `service/sync-export-secrets.test.ts` | 8/8 失败 | 8/8 通过 |
| P0-4 | `service/database/ssh-keys-secrets.test.ts` | 5/7 失败 | 7/7 通过 |
| P1 快捷键 | `service/shortcuts-write-order.test.ts` | 5/8 失败 | 8/8 通过 |
| P1 粘贴 | `paste-gate.test.ts` | 新增 | 11/11 通过 |
| 迁移 | `service/credential-migration.test.ts` | 新增 | 12/12 通过 |

## 5. SQLite / Vault 实际检查

- `grep "INSERT INTO hosts\|UPDATE hosts SET" store/host.ts` → **0 命中**
- `hosts` 与 `ssh_keys` 的 INSERT/UPDATE 语句中，秘密列在 SQL 文本里就是 `NULL`
- 导出白名单外的列（含未来新增列）不会进入文件，有专门测试断言

## 6. 快捷键

- 写入串行化：`ShortcutWriter` 保证任何时刻只有一个在途写入，后写不会先落地
- 状态可见：`idle / pending / saved / failed`，失败保留错误信息并可 `retryPersist()`
- 启用/禁用：`ShortcutRow` 调用后回读列表，标签立即更新
- hydrate 竞态：`revision` 保证慢载入不覆盖用户刚做的修改

## 7. 粘贴

`installPasteGate` 在终端容器捕获阶段拦截 `paste`：

- 覆盖 Cmd/Ctrl+V、应用原生菜单、ClipboardAddon（此前只保护两个菜单）
- `preventDefault()` 阻止 xterm 二次投递，确认后只投递一次
- 单行直通；多行 / 控制字符 / 超大先确认；文本不改写、不隐式加回车
- 桌面菜单与移动菜单复用同一个确认 promise，不会双重确认

## 8. 仍未完成

| 项 | 状态 | 原因 |
| --- | --- | --- |
| `LEGACY_CREDENTIAL_MIGRATION` | **NOT_RUN** | 迁移逻辑与 12 项测试已就绪，但执行需要用户显式授权（写 Vault、清明文列），本轮不自动运行 |
| `SSH_REAL_E2E` / `SFTP_REAL_E2E` | NOT_RUN（本轮） | 主终端凭据解析改动后未跑真实 SSH；由实机矩阵覆盖启动与 shell，不含 vault 凭据场景 |
| `VAULT_REAL_E2E` | NOT_RUN | 需要真实 Vault 创建/解锁，属交互流程 |
| `GUI_VISUAL_EVIDENCE` | NOT_RUN | 无 Screen Recording 权限 |
| WAL / 旧备份明文清理 | 未做 | 需用户授权与独立流程，ADR 已说明不声称已擦除 |

## 9. 判定

```
HOST_WRITE_PATH_UNIFIED=PASS
SQLITE_PLAINTEXT_ELIMINATED=PASS          （新写入；历史数据见下）
CREDENTIAL_REF_MAPPING=PASS
TERMINAL_CREDENTIAL_RESOLUTION=PASS       （单元层；真实 SSH 未复测）
JUMP_HOST_CREDENTIAL_RESOLUTION=PASS      （单元层）
LEGACY_CREDENTIAL_MIGRATION=NOT_RUN
PLAIN_EXPORT_SECRET_EXCLUDED=PASS
SECRET_PROVIDER_FAILURE_HANDLING=PASS
SHORTCUT_WRITE_ORDER=PASS
SHORTCUT_FAILURE_FEEDBACK=PASS
PASTE_ALL_ENTRYPOINTS=PASS                （DOM 层覆盖；真实 Vim/less 未跑）
SSH_REAL_E2E=NOT_RUN
VAULT_REAL_E2E=NOT_RUN
PR22_REVIEW_VERDICT=APPROVE（就本轮四处 P0 而言；数据迁移仍待授权执行）
DAILY_DRIVER_READY=NO
TABBY_REPLACEMENT_READY=NO
```

`SQLITE_PLAINTEXT_ELIMINATED` 只覆盖**新写入**：历史明文仍在旧库列、WAL 与备份里，
迁移未执行前不能声称已消除。
