---
status: canonical-draft
updated: 2026-11-16
fact_baseline: "main@5f248631e6fff10e824de34cd73b2291fc8ab416"
scope: "Persistent and runtime data, IPC boundary, migration, recovery, rollback and identifier continuity"
---

# 08 · 数据、安全、迁移与回滚

## 1. 数据分类

### 持久数据

Hosts、Groups、Connection Logs、Known Hosts、Workspace Layout、Snippets、Port Forward rules、Settings、Team/Sync metadata、CredentialRef、Model Profile 公共字段。必须有 schema version、迁移、备份和旧版本读取策略。

### 安全 Provider 数据

Vault 文件、系统 Keychain/Windows Credential Manager/Secret Service 条目、Model API key、SSH password/private key/passphrase。它们不进入 SQLite，也不由普通导出复制。Provider 记录自己的 namespace/version/availability，应用只持有引用。

### 运行时数据

PTY、SSH transport/channel、SFTP session、Transfer worker/Lease、xterm buffer、Extension instance、AI Run/Approval、Inspector probe、解锁 master key 和读取出的 Secret。原则上不序列化，不在重启时自动连接或执行。

### 派生 UI 数据

当前 pathname、Panel presentation、焦点、打开的 Drawer、选中的 File Row、Selection、AI preview、Toast。除非明确是用户偏好，否则不写 DB。

## 2. Schema 与兼容

所有新增持久字段使用 additive migration：

1. 读取旧 schema 和旧 layout。
2. 在临时副本或事务边界中增加字段/表。
3. 验证 `integrity_check`、目标列、外键、引用和默认值。
4. 写入 migration marker/transaction ID。
5. 原子提交并保留可读 backup。
6. 首次启动验证后清除 marker；验证失败进入 Recovery Gate。

Workspace 目标模型：

```ts
interface WorkspaceLayoutV2 {
  schemaVersion: 2
  workspaceId: string
  orderedTabIds: string[]
  activeTabId: string | null
  panesByTabId: Record<string, SplitTreeNode>
  selectedPaneIdByTabId: Record<string, string | null>
  leftPanelPreference: 'none' | 'explorer' | 'navigation'
  sidebarWidthPreference: number
}
```

`terminal.sidebar.width` 旧 key 和已存在的 tab/pane 字段继续可读；默认值变化不能覆盖老用户的宽度和布局。Right Dock pin/presentation 不自动持久化为“下次启动自动连接远端”。

## 3. Credential Provider 迁移

### 三种失败要分开

| 类型 | 含义 | 恢复 |
| --- | --- | --- |
| Secret data loss | Provider 密文删除 | 只能从受保护备份恢复 |
| Reference loss | 密文还在，row 指针被清空 | 通过原 ref/审计人工重建 |
| Rebind required | 跨设备 Provider 不能解密 | 用户重新输入并绑定 |

设计和导入流程必须让这三种情况有不同报告；任何未知/损坏 ref 都不能静默转成“没有凭据”。

### Provider 迁移顺序

```text
snapshot old ref + provider availability
→ allocate migrationId / target version
→ write every kind to target provider
→ read back every kind
→ verify target namespace/resource
→ update row reference in one DB write
→ mark old version retired
→ best-effort delete old provider entries
→ record result
```

- 迁移计划不包含 Secret，只包含 host/key/model ID、旧 ref 摘要、目标 Provider 和版本。
- 失败时保留旧 row/ref/Provider；新 Provider 部分写入由 migrationId 标识并可回收。
- 进程在任意阶段被杀后，下一次启动通过 marker/ledger 继续或回滚，不猜测哪个 provider 成功。
- 清理旧 provider 不是提交新 ref 的前置；旧密文暂时 orphaned 比数据丢失安全。
- Provider 不可用、用户拒绝系统授权、Keychain 读失败都不能自动改用明文或空凭据。

## 4. 导入导出

### 普通配置导出

导出 Host、Group、Workspace、Snippet、Settings 等非秘密数据和可重绑定的 CredentialRef 信息。导出文件必须明确“不是凭据备份”。

### 导入策略

- `reject`：检测到未处理 Secret/unknown ref 时在写入前拒绝，报告各类计数。
- `migrate`：每行必须由用户/当前设备显式提供 `bound_credential_ref`，不能把源设备 ref 直接持久化。
- `discard`：不伪造引用，写入非秘密配置，并报告需重绑清单。
- Unknown provider/version/damaged ref：保留原始安全摘要，不能写 NULL 覆盖本机可用 ref。
- Merge 和 Replace 对凭据的语义分开；Replace 必须由 UX-2a 决定 `preserve-existing` 或“明确删除”，不能用模糊确认框。

## 5. Tauri IPC 与 capability

### 当前事实

`src-tauri/capabilities/default.json` 当前允许 `sql:allow-select/execute`、受 scope 限制的文本 FS、dialog、shell open、updater、窗口和 global shortcut。`vault_get` 是通用 KV 命令；B01 审计明确它在当前单一可信 WebView 下可解释，但未来扩展/远程内容进入后会放大信任面。

### 目标 Gateway

```text
Trusted UI intent
  → Rust command validates stable resource/session IDs
  → typed domain service
  → provider/session/db operation
  → structured result without Secret
```

- SQL plugin 兼容路径在迁移期间保留，但新扩展/AI 不得直接获得 SQL capability。
- 文件操作按具体 feature scope；OpenSSH Import 只在用户通过文件选择器选择后读取，连接时不隐式打开 `IdentityFilePath`。
- Secret consumption 目标是 Rust/Provider typed command；不要给前端万能 `read_secret`。
- Model Driver 不得拥有 Tauri shell/fs/sql/secret 权限，只接收已批准文本和公开 profile。
- Extension Gateway 不能通过 `invoke` 继承主 UI 的任意 command 权限。

## 6. Product Identifier 策略

当前 `src-tauri/tauri.conf.json`：

- `productName = Termius`
- `identifier = com.baicie.termius`

当前 Vault 路径由 `vault.rs::get_vault_path()` 使用 `dirs::config_dir()/terminal/vault.json` 派生，未直接由 Tauri identifier 派生；`terminal.db`、backups、window state、WebView cache/runtime lock 等由 app config/runtime 路径管理。不能凭名称猜测改名影响范围。

任何品牌/Identifier 变更必须独立 PR：

1. 枚举旧/新 DB、backup、Vault、window state、WebView/cache、instance lock 的真实路径。
2. 旧版本 A 安装并写入所有 fixture 数据。
3. 新版本 B 在隔离 profile 安装，执行迁移前快照和路径迁移。
4. B 启动读回字段级数据、Vault 解密、Workspace、Team/Sync、窗口状态。
5. B→A 回退验证加法 schema 和未知字段保留；不兼容 schema 明确拒绝。
6. 重复启动、只读目录、损坏 DB、磁盘满、SIGKILL、半迁移、清理失败都 fail-closed。
7. 只有证据完整后才更新 productName/identifier；设计 PR 不改这两个值。

## 7. 备份、Recovery 与回滚

- 迁移前先做可读快照，验证 checkpoint/WAL/SHM 边界和 SHA。
- 标记包含 `transactionId`、owner PID/token、targets、source snapshot、phase、createdAt。
- 启动发现 marker 先获取 OS 文件锁和进程内互斥；第二实例 fail-closed。
- 恢复状态机：`PREPARE → QUIESCE → VERIFY_BACKUP → STAGE → VERIFY_STAGED → COMMIT → VERIFY → COMPLETE`。
- 主库只在 staged/backup/完整性验证通过后原子替换；恢复失败保留原库和证据，不用空库启动。
- `COMPLETE`/marker 清除必须再次核对 transaction ID、目标 schema 和 integrity；清除失败返回 `RestoreInterrupted`。
- 代码回滚和数据回滚不是一回事；任何 schema/provider/identifier PR 都必须写明旧版本是否可读、是否需要工具恢复。

## 8. 安全不变量

1. 未知 provider/version/ref 不变成 NULL。
2. SQLite 不保存 password/private key/passphrase/API key 明文。
3. Provider 写入失败不影响旧 ref；清理失败不删除旧 ref。
4. 任何恢复/迁移失败不自动覆盖原始数据。
5. 备份目录外符号链接、live DB、可疑 reparse point fail-closed。
6. AI、Extension、Inspector 不读 Secret，不拥有 raw PTY 或任意 SQL/FS。
7. Host/SSH key/Model 的 namespace 不共享。
8. UI 显示“已连接/在线/成功”必须来自真实 Session/Probe/connection log 的正确时间语义。
9. 迁移、导出、导入、Upgrade E2E 的报告把 PASS/FAIL/PARTIAL/NOT_RUN 分开。

## 9. 回滚测试矩阵

| 场景 | 期望 |
| --- | --- |
| 旧 DB → 新 schema | 新字段有默认值，旧字段/Host/Workspace/Settings 逐字段保留 |
| 新 schema → 旧版本 | 加法字段被忽略或旧版安全拒绝；不清理旧数据 |
| Vault → 新 Provider 写入中断 | 旧 ref 可读，新部分可回收 |
| 新 Provider → 旧版本 | 旧版显示 unsupported，保留原 ref，不写 null |
| 导入 Replace 无 Secret | 本机 ref 按明确 policy 保留或明确删除，不静默 |
| 迁移在每个 crash point SIGKILL | 重启可判断并恢复，不产生半 schema/半 ref |
| 磁盘满/只读/权限拒绝 | 原 DB/Vault 可读，状态是可行动错误 |
| Identifier 迁移失败 | 旧目录和旧标识仍可回滚，禁止删除原始数据 |

## 10. 交付要求

任何涉及数据、凭据、capability、Identifier、Updater 或 Provider 的 PR 必须带：Base/Head SHA、影响表和路径、旧版本行为、迁移 marker、回滚命令/证据、真实 SQLite/Provider/安装器测试、未运行的平台项和安全审查结果。
