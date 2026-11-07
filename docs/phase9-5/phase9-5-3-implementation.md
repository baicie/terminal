# Phase 9.5.3 — Process Lifecycle & Crash-Safe Recovery

> 日期：2026-11-05
> 代码 HEAD：`d958e28`；最终 E2E `42019746261`、CI `42019753323`
> 分支：`feat/phase9-5-upgrade-integrity`（PR #8 Draft）
> 约束：不合并 PR、不打 tag、不发布 Release、不改生产密钥/identifier。

## 1. 交付

| 项 | 结果 |
| --- | --- |
| 异步进程生命周期 | **完成**：`process-lifecycle.mjs`，7 项单元测试；真实 E2E 11 次 stop 全部 graceful、0 forced |
| 真实子进程停止 | **完成**：exit/close 事件、SIGTERM→SIGKILL、日志 close 后写入 |
| SQLite 恢复状态机 | **完成**：8 阶段、顺序断言、crash point hook |
| busy checkpoint | **完成**：真实第二连接测试，checkpoint 非零退出 |
| 恢复顺序 | **完成**：sidecar 先删、A 快照验证、A 启动证据 |
| Windows disposable | **NOT_RUN**：状态机已有，无真实一次性用户/VM |
| Vault app-level | **NOT_RUN**：crypto fixture/KAT/独立解密已有 |
| Team Sync 跨版本客户端 | **NOT_RUN**：服务端 HTTP 已有 |
| Updater 运行时 | **NOT_RUN**：静态 manifest 契约已有 |
| AppImage | **PARTIAL**：payload-only，stock 启动仍失败 |

## 2. 代码

| 文件 | 变更 |
| --- | --- |
| `process-lifecycle.mjs` | 异步 launch/stop、结构化结果、日志 close 后写入 |
| `process-lifecycle.test.mjs` | 7 项 dummy child 测试 |
| `recovery-state-machine.mjs` | 8 阶段、顺序、crash point、plan |
| `recovery-state-machine.test.mjs` | 阶段/单点/开关测试 |
| `checkpoint-safety.test.mjs` | 真实 WAL + 第二连接 busy checkpoint |
| `upgrade-e2e.mjs` | 使用异步 lifecycle；`backup restore stages`；crash point |
| `data-retention.mjs` | checkpoint busy 校验（Phase 9.5.2 已有） |

## 3. 测试

- `node --test scripts/verify-install/*.test.mjs`：**57 passed / 2 skipped**
  （本地 Node 22 跳过 Argon2；Node 24 CI 全过）。
- 本机 normal / restore：PASS；`A stopped`/`B stopped` 为
  `graceful exitObserved=true closeObserved=true escalation=false`。
- busy checkpoint：真实第二个连接持读事务，checkpoint 非零退出。
- 未执行 crash point 的真实恢复链；仅单元测试 hook。

## 4. 15 项判定

| # | 判定 | 结果 | 依据 |
| --- | --- | --- | --- |
| 1 | `PHASE_9_5_3_ENGINEERING_COMPLETE` | **PARTIAL** | P0 生命周期/恢复完成；外部环境与部分故障矩阵未完成 |
| 2 | `PROCESS_LIFECYCLE_VERIFIED` | **YES** | 7 项单测 + 真实 normal/restore |
| 3 | `PROCESS_ISOLATION_VERIFIED` | **PARTIAL** | 只清理直接子进程；进程组/lsof 未实现 |
| 4 | `SQLITE_RECOVERY_CRASH_SAFETY_VERIFIED` | **PARTIAL** | 状态机/顺序/checkpoint 已验证；crash point 未逐点执行 |
| 5 | `BUSY_CHECKPOINT_VERIFIED` | **YES** | 真实第二连接测试 |
| 6 | `DISK_FULL_RECOVERY_VERIFIED` | **NOT_RUN** | 无安全小容量卷 |
| 7 | `WINDOWS_DISPOSABLE_PROFILE_VERIFIED` | **NOT_RUN** | 状态机/负测试，无真实 profile/VM |
| 8 | `WINDOWS_UPGRADE_E2E` | **NOT_RUN** | 未安装/升级 |
| 9 | `VAULT_APP_LEVEL_UNLOCK_VERIFIED` | **NOT_RUN** | 无 app-level probe |
| 10 | `VAULT_CROSS_VERSION_VERIFIED` | **PARTIAL** | 升级后独立解密 PASS；app-level continuity NOT_RUN |
| 11 | `TEAM_SYNC_CLIENT_UPGRADE_VERIFIED` | **NOT_RUN** | 服务端 HTTP 已有，跨版本客户端未做 |
| 12 | `UPDATER_RUNTIME_E2E_VERIFIED` | **NOT_RUN** | 只有静态 manifest |
| 13 | `LINUX_APPIMAGE_FULL_UPGRADE` | **PARTIAL** | payload-only；stock 启动 NOT_RUN |
| 14 | `READY_FOR_RC` | **NO** | Windows/磁盘满/app-level Vault/跨版本同步/签名身份未闭合 |
| 15 | `READY_FOR_RELEASE` | **NO** | 同 RC，另加 updater/notarization/Authenticode |

## 5. 未完成与风险

- process group / WebKit / PTY / lsof quiescence；
- crash point 真实逐点执行、恢复失败重试、ENOSPC；
- Windows disposable 用户/VM 与 NSIS A→B；
- Vault app-level probe、change_password、legacy verifier；
- Team Sync 跨版本客户端、冲突/离线/删除传播；
- Updater 运行时下载/验签/安装/重启；
- AppImage stock 启动；
- 签名/公证/身份迁移/RC/Release。

## 6. Phase 9.5.4 提示词

> 在 `feat/phase9-5-upgrade-integrity` 继续：
> 1) 执行 8 个 recovery crash point 的真实链，记录 DB/sidecar/备份 SHA、重启
>    状态和人工恢复需求；失败必须保留可用备份。
> 2) 用安全小容量卷执行 ENOSPC 矩阵（备份/迁移/staged restore/安装），不得
>    填满共享 runner 根分区。
> 3) 建立 Windows disposable VM/用户：SID、Known Folder、ACL、cleanup、NSIS
>    A→B、数据/vault/Team Sync 本地表；结束按 SID 销毁。
> 4) 增加 Vault smoke probe：A/B app-level unlock、change_password、legacy
>    verifier；密码不走 argv/日志。
> 5) 将 `real-server-sync` 扩展为 A→B 客户端真实 fetch 链，覆盖 dirty row、
>    冲突、删除传播、断线重试。
> 6) 实现隔离 updater 运行时链（临时 key、loopback、A/B bundle、错误签名/
>    篡改/截断/重启/version readback）。
> 7) 若改 `FINGERPRINT_PATHS`，官方重采六份证据并保持 0 problem。
