# Phase 9.7 — Single-Instance Runtime Safety

> 分支 `feat/phase9-7-product-acceptance`（Draft PR #9）
> 代码 HEAD：`172207d`（结果以最终 CI/E2E 为准）

## 1. 产品契约

- **每个应用 identifier 只允许一个实例**。第二次启动由首进程接管并激活主窗口，
  第二个进程退出，不接触数据库。
- **运行时锁按数据目录隔离**：`instance.lock` 位于应用配置目录，进程启动时在任何
  数据库/恢复访问之前获取，持有到进程结束。
- 插件身份是**全局**的（按 identifier）：不同数据目录不会并行运行；
  `MULTI_DATA_DIR_ISOLATED=NO`，这是明确的产品决定，不是隔离缺陷。

## 2. 实现

| 层 | 位置 | 行为 |
| --- | --- | --- |
| 单实例 IPC | `tauri-plugin-single-instance v2.5.5`，首个注册插件 | macOS Unix socket / Linux D-Bus / Windows named mutex；第二次启动激活首进程 |
| 窗口激活 | `activate_main_window`（`src-tauri/src/lib.rs`） | show/unminimize/focus；窗口被托盘关闭时按配置重建 |
| 运行时锁 | `acquire_runtime_lock`（`src-tauri/src/db_recovery.rs`） | `instance.lock` + `try_lock`；失败返回 Manual，启动门禁阻断数据库 |
| 所有权校验 | `RuntimeLockHandle` | 记录 inode；锁文件被删除/替换后 `is_held()` 立即为 false |
| Retry | `retry_recovery(..., runtime_held)` | 未持锁一律 Manual，绝不升级为 HEALTHY |
| 完成/备份 | `database_migration_completed` / `backup_database_before_migration` | 未持锁直接拒绝 |
| 前端 | `getDb` | 打开 plugin-sql 前调用 `runtime_instance_lock_held`，失败则 `blockStartup()` |

## 3. 负向矩阵

| 场景 | 期望 | 覆盖 |
| --- | --- | --- |
| runtime lock 被另一进程持有 | 第二进程拒绝、DB 不变 | 真实双进程 Rust 测试；E2E 场景 A |
| runtime lock 从未获取成功 | Manual，不打开 DB | `retry_cannot_upgrade_a_runtime_lock_refusal_to_healthy` |
| 获取失败后 Retry / 多次 Retry | 始终 Manual | 同上 |
| 外部删除 lock 文件 | `is_held()` false，命令拒绝 | `deleting_the_runtime_lock_path_invalidates_ownership` |
| 进程异常终止 | OS 释放锁 | `a_second_process_cannot_take_the_runtime_lock`；E2E 场景 B |
| 锁文件存在但无人持有 | 新进程可获取 | `a_second_handle_cannot_take_the_runtime_lock` 的 drop 分支 |
| 托盘隐藏/窗口关闭 | 第二次启动激活/重建 | 代码路径；真实窗口焦点 **NOT_RUN**（headless） |
| 运行时锁与恢复锁持有者不同 | 不允许 | 两把锁分离；恢复锁按标记/操作持有 |
| 恢复完成后 | runtime lock 持续持有 | `recovery_completion_keeps_the_runtime_lock` |

## 4. 真实进程 E2E

`scripts/verify-install/single-instance-e2e.mjs` 从 **B 的真实 DMG** 安装到一次性
目录，校验 DMG SHA 与二进制 SHA，然后：

- **场景 A**：首进程建库并写 probe 行；第二次启动在 30s 内退出（code 0）、
  激活记录出现、首进程仍存活、HOME 下只有一个 `terminal.db`。
- **场景 B**：对首进程发送 **SIGKILL**，断言 `signal=SIGKILL`；第三进程启动、
  读到 `before-kill` 行、写入 `after-kill` 行（真实数据库访问）、正常退出。
- **场景 C**：托盘/窗口焦点在无窗口服务器的 runner 上 **NOT_RUN**；
  仅断言激活回调。
- **场景 D**：不同 HOME 的启动同样被激活（全局身份契约）。

脚本处理 spawn `ENOENT/EACCES`、超时、SIGTERM/SIGKILL、孤儿清理，并在任何失败
路径写出结构化 `single-instance-report.json`。

### 结果

- 运行：待 `172207d` 的 Upgrade E2E 回填（run/job URL）。
- 旧脚本已在 `3c8a919` 的 run `42342729294` 的 macOS current job 通过
  （`Single-instance real process check | success`），但那版只覆盖场景 A。

## 5. 未闭合

- 真实窗口焦点（macOS Accessibility/窗口服务器）在 headless runner 上不可观察，
  仅能证明“回调在第一进程执行”。
- Linux 无 D-Bus session 时插件不启用；运行时锁仍阻止数据库访问，但没有
  “激活已有窗口”的 IPC（记录为平台限制）。
- plugin-sql 的 Tauri 命令面本身无法按进程动态禁用；`getDb` 已在打开前查询
  `runtime_instance_lock_held`，后端命令各自校验。恶意 webview 绕过 UI 直接调用
  `plugin:sql|load` 不在本轮信任模型内，已记录。
