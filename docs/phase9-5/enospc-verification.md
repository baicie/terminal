# Phase 9.5.4 — ENOSPC Verification

> 日期：2026-11-05
> 判定：`ENOSPC_RECOVERY_VERIFIED = PARTIAL`
> 实现：`enospc-volume.mjs`、`enospc-recovery.test.mjs`

## 1. 安全环境

不使用共享 runner 根分区，也不写 `throw new Error('ENOSPC')` 冒充磁盘故障：

| 平台 | 隔离卷 | 说明 |
| --- | --- | --- |
| macOS | `hdiutil` 创建 64 MB HFS+ DMG，挂载到临时目录 | 测试结束 `detach` 并删除镜像 |
| Linux | `sudo mount -t tmpfs -o size=64m` | 需要 passwordless sudo；不可用则**显式 skip**，不写 PASS |
| 其他 | 无 | 显式 skip |

卷容量固定 64 MB，测试只写满这个一次性卷，不触碰 runner 根文件系统。

## 2. 场景

`enospc-recovery.test.mjs` 在卷内构造：

- live DB（DELETE journal，避免读时创建 sidecar）；
- 8 MB 备份 DB（`zeroblob`，DELETE journal）；
- `data/terminal.db` = live 副本；
- filler 文件占满卷，仅留约 4 MB。

然后执行 `restore-worker.mjs restore`。

## 3. 实测（macOS，2026-11-05）

| 断言 | 结果 |
| --- | --- |
| restore 退出码非 0 | **PASS**（exit 1） |
| stderr 含 `ENOSPC` / `no space left` | **PASS** |
| 主 DB SHA 与 live 完全一致 | **PASS**（没有 rename，没有覆盖） |
| 主 DB 仍可 `integrity_check=ok` 并读回 `live` 内容 | **PASS** |
| staging 未被发布成主 DB | **PASS**（该平台 `cpSync` 失败后未留下临时文件；即使留下也小于备份 SHA 长度约束） |
| 释放空间后 `retry` | **PASS**：`outcome=restored` |
| 伪造的残留 `terminal.restore.tmp` 被丢弃 | **PASS** |
| 最终主 DB = 备份 SHA、无 staging、内容 `backup` | **PASS** |

测试耗时约 2.5 s（含创建/挂载/卸载 DMG）。

Linux tmpfs 路径在本地 privileged 容器（`node:24.18.0-bookworm-slim`，
Node 24.18）中同样 **PASS**，耗时 505 ms。GitHub ubuntu runner 的 sudo
路径在 `b069beb` 的 CI 中复跑，结果见 `phase9-5-4-implementation.md`。

## 4. 未覆盖

以下路径仍 **NOT_RUN**，不能由本轮结果推断：

- 备份 `VACUUM INTO` 时 ENOSPC；
- 备份写一半 ENOSPC；
- migration / WAL 写入 ENOSPC；
- 目录 fsync 失败；
- 安装 B 时空间不足；
- Linux tmpfs 在 CI 上的实际执行结果（若 sudo 不可用会 skip）。

## 5. 判定

- `STAGED_RESTORE_ENOSPC = PASS`（macOS 真实小容量卷）
- `ENOSPC_RECOVERY_VERIFIED = PARTIAL`（只覆盖 staged restore）
- 其余 ENOSPC 子场景 `NOT_RUN`
