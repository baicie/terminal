# PR #22 — 外部审查与修复报告

- 审查基线 HEAD：`a6e330b`
- 修复后冻结 HEAD：`1f8f517`（证据 `c2c9f2a`，矩阵 run `42586825845`，指纹 `65ff5262…`）
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
- **失败对用户可见**：`ShortcutPersistBanner` 订阅 `onPersistStateChange`，失败时在
  设置面板顶部显示原因并提供「重新保存」；`shortcuts-settings-wiring.test.tsx` 断言
  面板真的挂载了它——把那一行 JSX 删掉，该测试变红。此前只有服务层记录，用户看不到
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
SHORTCUT_FAILURE_FEEDBACK=PASS            （服务状态 + 设置面板横幅 + 重试）
PASTE_ALL_ENTRYPOINTS=PASS                （DOM 层覆盖；真实 Vim/less 未跑）
SSH_REAL_E2E=NOT_RUN
VAULT_REAL_E2E=NOT_RUN
PR22_REVIEW_VERDICT=APPROVE（就本轮四处 P0 而言；数据迁移仍待授权执行）
DAILY_DRIVER_READY=NO
TABBY_REPLACEMENT_READY=NO
```

`SQLITE_PLAINTEXT_ELIMINATED` 只覆盖**新写入**：历史明文仍在旧库列、WAL 与备份里，
迁移未执行前不能声称已消除。

## 10. 实机矩阵推翻的一次设计错误（重要）

第一次冻结（`fd3f3c6`）后，实机冷启动**真实失败**：
`session-create-requested` 之后没有任何 SSH 阶段记录。

根因是我在 `hostRowToHost` 里把 `password` / `private_key` 完全忽略，理由写作
"秘密只从 Vault 读"。这看似更安全，实际后果是：

- 任何由旧版本保存的主机，升级后读不到凭据，**直接连不上**；
- 迁移还没执行，用户没有别的补救途径；
- 实机夹具正是以明文列建主机，于是全部用例失效——这是它被发现的原因。

结论：安全边界在**写入端**（新写入永不产生明文），读取端必须继续兼容历史数据，
直到迁移清除它们。已在 `6ab950b` 修正，并新增测试断言"迁移前旧主机仍可连接"。

这条记录保留，作为"更严格"不等于"更正确"的实例。

## 11. 证据重采记录（源码改动必然作废旧证据）

| 冻结 HEAD | 矩阵 run | 指纹 | 作废原因 |
| --- | --- | --- | --- |
| `6ab950b` | `42574545815` | `f19198b4…` | 读端兼容修复 |
| `fe920f7` | `42578266796` | `ff11c12d…` | 快捷键失败横幅、pane-ui memo 化、三语文案 |
| `1f8f517` | `42586825845` | `65ff5262…` | 二次审查的 P0/P1 修复（导出白名单、局部更新、exec 跳板机、删除清 Vault、Vault 错误字段） |

两次都按官方流程 `fetch-verification-evidence.mjs --run-id` 获取，没有手改
manifest 或任何旧证据文件。`fe920f7` 是本轮源码改完后的统一冻结点。

`1f8f517` 是最终冻结点；其后只有文档提交与证据提交 `c2c9f2a`，均不改源码。

## 12. 第二次独立审查（不是自查）

第一次审查由外部提出，我据此修复；修复本身也需要被检查。第二次由独立的
审查 agent 在完全不知道修复过程的前提下，按"逐条证伪"的方式重读源码。

它的结论是：**我先前标记为 PASS 的项里有两项是错的，还漏掉三处 P1。**

### 12.1 被推翻的判定

| 原判定 | 实际 | 证据 |
| --- | --- | --- |
| `PLAIN_EXPORT_SECRET_EXCLUDED=PASS` | **不成立** | 白名单只覆盖 `sync-export.ts`；团队包导出 `sync-team.ts` 仍 `SELECT *` + `JSON.stringify`，而它有真实 UI 入口（Teams → 导出） |
| `HOST_WRITE_PATH_UNIFIED=PASS`（作为"唯一写入方"） | **不成立** | Rust 侧 `src-tauri/src/db_import/writer.rs` 仍把 `password`/`private_key` 绑进列，且经 `sync-import.ts` 可达 |

第二条尤其值得记下来：我 grep 的是前端，报告的却是"单一写入路径"这个跨语言
结论。范围没覆盖到，结论就越界了。

### 12.2 新发现的缺陷与修复

| 级别 | 缺陷 | 修复 |
| --- | --- | --- |
| P0 | 团队包导出泄露遗留明文密码/私钥 | 两个数组套用同一白名单；摘掉修复后 3 项测试变红 |
| P0 | 局部更新会摧毁迁移前明文凭据（`password = NULL` 无条件写） | 先读当前行合并；置空改为 `CASE WHEN ? = 1` 条件写入 |
| P1 | `toggleFavorite` 抛 NOT NULL（本轮引入的回归） | 同上，根因是丢了 `main` 上的合并步骤 |
| P1 | 脚本/批量执行经跳板机不带凭据 | 复用 `withResolvedCredential`；`terminal-launcher` 与 exec 路径收敛到 `resolveSessionCredential` |
| P1 | 删除主机不清 Vault | 删行后逐个删三种 kind |
| P2 | `vault-secret-provider` 读错错误字段（`.kind` vs `type`） | 改用 `toVaultCommandError`；补 7 项测试（此前为零） |

### 12.3 已知但本轮未修

| 项 | 级别 | 说明 |
| --- | --- | --- |
| 首次运行无法保存密码 | P1 | Vault 未创建与已锁定被映射成同一个 `false`，提示文案指向错误动作；需要区分 `uninitialized` / `locked` 并在主机对话框内提供创建入口 |
| 新存的主机需重载列表才能连接 | P2 | store 内的副本没有 `credentialRef`；应让 `createHost` 返回 ref 或保存后重载 |
| 损坏的 `credential_ref` 退化为"无凭据" | P2 | 解析失败返回 `null`，被当作合法空凭据；应区分"读不懂的引用"并失败 |
| 导出/同步仍带 `syncServiceToken` | P2 | 存储服务密码随设置表整体导出；是一行白名单的距离 |
| SSH key 的秘密无消费方 | P2 | `getSSHKeySecret` 零调用方，keychain 也没有展示/复制路径 |

这几项都记在案，不声称已解决。

### 12.4 一句结论

第一次修复解决了"外部指出的问题"。这一次说明：**自查的覆盖率本身就是缺陷来源**——
我验证了自己写的路径，没有验证"还有哪些路径"。第二次审查的价值不在找到了几个 bug，
而在于它证明第一次的 PASS 是范围内的 PASS。
