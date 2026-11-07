# Phase 9.5.5 — Quiescence Closure & Remaining ENOSPC

> 日期：2026-11-05
> 分支：`feat/phase9-5-upgrade-integrity`（PR #8 Draft）
> 状态：**进行中**（进程树 quiescence 已完成；其余见第 3 节）

## 1. 本轮完成

| 项 | 结果 |
| --- | --- |
| `OWNED_CHILDREN_SETTLED` | **PASS**：停止前 `pgrep -P` 递归快照，退出后等待 2 s 收敛；泄漏判 FAIL 并列出 PID |
| 真实探针测试 | 父进程留下忽略 SIGTERM 的子进程 → FAIL；无子进程父进程 → PASS |
| Harness 接入 | 6 个 `assertQuiescence` 异步收敛；A/B/恢复/降级/Linux 全覆盖 |
| E2E 证据 | `42047193259`（`10fffd5`）**5/5 success**；10 份报告四项事实全 PASS（含 Linux WebKitGTK 子进程） |
| CI | `42047193385`（`10fffd5`）**11/11 success** |
| disk-full 备份/迁移 | **PASS（行为）**：64 MB DMG + 24 MB A 时代 DB + 约 8 MB 空闲；E2E `42061498904` 五事实 PASS；归档/门禁见下 |
| 本地脚本 | **467 tests / 465 pass / 2 skipped / 0 fail** |

详见 `process-tree-quiescence.md`。

## 2. 判定

| 判定 | 结果 |
| --- | --- |
| `PROCESS_TREE_QUIESCENCE_E2E` | **PASS**（macOS + Linux） |
| `PROCESS_RESOURCE_QUIESCENCE_VERIFIED` | **YES（macOS/Linux）**；Windows NOT_RUN |
| `ENOSPC_RECOVERY_VERIFIED` | **PARTIAL**（仅 staged restore） |
| `READY_FOR_RC` | **NO** |
| `READY_FOR_RELEASE` | **NO** |

## 3. 未完成

- ENOSPC：安装 B、目录 fsync；备份/迁移路径已有行为证据（未归因到具体错误码）；
- Windows disposable profile/VM 与 NSIS A→B（无 `pgrep`，进程树事实 NOT_RUN）；
- Vault app-level unlock/change_password；
- Team Sync A→B 跨版本客户端；
- updater 运行时下载/验签/安装/重启；
- AppImage stock 启动；
- 产品启动时自动恢复状态机；
- 签名/公证/身份迁移/RC/Release。

## 4. 约束

不合并 PR、不打 tag、不发布 Release、不改生产密钥/identifier、不触碰真实用户
profile、不用异常模拟冒充真实故障。
