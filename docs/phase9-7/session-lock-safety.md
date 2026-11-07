# Phase 9.7 P0-A.2 — Database Session & Runtime Lock Safety

> 分支 `feat/phase9-7-product-acceptance`（Draft PR #9）
> 基线：`42990ce`（P0-A 已通过 CI 11/11、E2E 5/5）

## 1. 发现的风险

P0-A 的 `getDb()` 只在**首次建立连接**前检查运行时锁：

```ts
assertDatabaseAllowed()
if (db) return db                 // 缓存连接直接返回
if (initPromise) return initPromise // 初始化中直接返回
await assertRuntimeInstanceLock()
```

锁文件被删除/替换后，已缓存的连接仍可执行 SQL；初始化中的 Promise 也会在锁
失效后继续 publish。`RuntimeInstanceLock::is_held()` 能识别 inode 变化，但这一
检查没有覆盖全部 SQL 路径。

## 2. 修复后的不变量

> 运行时锁失效后，本进程不得再通过受保护的数据库服务执行新语句。

- `getDb()` **每次调用**（缓存命中、初始化中、新建）都先调用
  `runtime_instance_lock_held`；
- 失败时：`closeCachedConnection()` 关闭并丢弃缓存句柄、清空 `initPromise`、
  `blockStartup()`，然后抛错；
- `establishConnection()` 在 `db = database` 之前**再检查一次**；失败时关闭刚打开的
  句柄，不发布缓存；
- 因此缓存路径、init 竞争路径、普通查询路径共享同一个检查点，不存在
  “检查一次、之后一直放行”的 window。

### 锁文件身份

- 锁身份取自**已加锁的文件描述符**（`file.metadata()`），不是路径 metadata；
- 获取时同时 `symlink_metadata(path)`：路径必须是普通文件且不是 symlink；
- Unix 对比 descriptor 与路径的 `(device, inode)`；路径在 open/lock/stat 之间被
  替换会直接失败；
- 运行期 `is_held()` 重新 `symlink_metadata`：路径被删除、替换或变成 symlink
  立即返回 false；
- Windows 使用 `creation_time + file_size` 作为身份近似（Rust 标准库不暴露
  file index），并依赖独占锁；标记为 **PARTIAL**，未外推 Unix 结论。

## 3. plugin-sql 信任边界

`src-tauri/capabilities/default.json` 仍允许 `sql:allow-load/execute/select`。
Tauri 的 plugin-sql 命令是静态注册的，无法按进程/锁状态动态吊销。本轮选择：

- **B 方案**：明确信任模型。正常应用生命周期里 `StartupGate` 在锁失败时不挂载
  业务 App；`getDb` 在每次调用时拒绝；Rust 的完成/备份/Retry 命令也拒绝。
- 被攻陷的 webview 直接调用 `plugin:sql|load` 不在本轮信任模型内；文档明确
  记录，**不声称已通过前端检查解决原生命令绕过**。
- 真正的后端 SQL guard 需要替换 plugin-sql 命令面，列为后续工作。

## 4. 测试

| 层 | 测试 | 结果 |
| --- | --- | --- |
| Rust | 删除锁文件 → `is_held()` false | PASS |
| Rust | 替换锁文件（新 inode）→ false | PASS |
| Rust | 锁路径变 symlink → false；获取时拒绝 symlink | PASS |
| Rust | 真实双进程 runtime lock / SIGKILL 释放 | PASS |
| 前端 | 缓存连接在锁丢失后被关闭并拒绝 | PASS |
| 前端 | 锁丢失后 `executeQuery` 被拒绝 | PASS |
| 前端 | 首次连接、正常查询、门禁拒绝路径 | PASS |
| 构建 | 生产 bundle 不含 Vault probe 常量 | PASS（本地 + CI 步骤） |
| 构建 | smoke overlay 包含 Vault probe chunk | PASS（本地 + CI 步骤） |
| Rust | 无 feature 时 `vault_probe_report` 为 no-op；有 feature 时只写测试路径 | PASS（两种构建各一测） |

## 5. 判定

```text
RUNTIME_LOCK_CACHED_CONNECTION_SAFE=PASS
RUNTIME_LOCK_INFLIGHT_INIT_SAFE=PASS
RUNTIME_LOCK_FILE_REPLACEMENT_SAFE=PASS
RUNTIME_LOCK_WINDOWS_IDENTITY_VERIFIED=PARTIAL
DIRECT_PLUGIN_SQL_TRUST_BOUNDARY_DOCUMENTED=PASS
RUNTIME_LOCK_RETRY_BYPASS_BLOCKED=PASS

VAULT_PROBE_PRODUCTION_DISABLED=PASS
VAULT_SERVICE_E2E_VERIFIED=PASS
VAULT_UI_E2E_VERIFIED=NOT_RUN
VAULT_CROSS_VERSION_VERIFIED=NOT_RUN
```

## 6. 未闭合

- Windows 文件身份是 creation_time + size 近似，不是 file index；需要
  `GetFileInformationByHandle` 级别的验证。
- plugin-sql 原生命令无动态吊销；需要真正的 SQL guard 才能把恶意 webview
  纳入威胁模型。
- Vault UI 自动化与 A→B 跨版本仍未执行。
