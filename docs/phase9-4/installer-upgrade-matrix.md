# 安装、升级与回滚矩阵

> 日期：2026-11-03
> 基线：`44ae449`（stacked on Phase 9.3.2）

## 1. 已有真实证据

`ci.yml` 的三平台安装 job 使用真实安装包与隔离用户目录，逐字段读回：

| 平台 | 安装 | 数据内容保留 | 证据 |
| --- | --- | --- | --- |
| macOS DMG | PASS | PASS（数据库内容读回） | `verify-install-macos.sh` |
| Windows NSIS | PASS | PASS（数据库内容读回） | `verify-install-windows.ps1` |
| Linux deb | PASS | PASS（deb 解包 + 启动） | `verify-install-linux.sh` |
| Linux AppImage | PASS | PASS（直接启动） | `verify-install-linux.sh` |

`scripts/verify-install/data-retention.mjs` 会写入并逐字段比较：

- `hosts` 行（`auth_type=agent`，密码/私钥为 NULL）；
- `app_settings` 标记；
- `workspaces` 与 `workspace_layouts`；
- 一个 schema-valid、零条目的测试 vault 文件。

它明确拒绝把“文件哈希相同”当成数据保留证据。

## 2. 仍未验证

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 旧版本 → 新版本升级（内容级） | **NOT_RUN** | CI 只构建一个版本；没有双版本安装链 |
| 新版本 → 旧版本回滚 | **NOT_RUN** | 没有回滚测试包与降级策略 |
| 升级失败后的自动回滚 | **NOT_RUN** | 产品没有升级事务/回滚状态机 |
| 真实 Vault 主密码解锁 | **NOT_RUN** | 需要交互式主密码；测试 vault 为零条目 fixture |
| Team Sync 数据在升级后的保留 | **NOT_RUN** | 当前 data-retention 只覆盖 hosts/settings/workspace |
| macOS Gatekeeper 弹窗 | **NOT_RUN** | 阻塞式 GUI 安全对话框，需人工 |
| Windows SmartScreen / MOTW | **NOT_RUN** | 需人工判断 |
| Apple notarization | **BLOCKED_EXTERNAL** | 无签名身份 |
| Windows Authenticode | **BLOCKED_EXTERNAL** | 无证书 |
| Tauri updater 真实签名 | **BLOCKED_EXTERNAL** | `pubkey` 仍为占位符 |

## 3. 升级验收门禁（后续实现）

跨版本升级至少需要：

1. 构建并保存版本 A、版本 B（同一平台、同一标识）。
2. 安装 A，写入受控主机/设置/工作区/Vault/Team Sync 数据。
3. 覆盖安装 B，启动并逐字段读回。
4. 安装 A 覆盖 B（人工回滚），启动并逐字段读回。
5. 在升级中途 kill 进程，重启后必须收敛到 A 或 B，不允许半写库。
6. 失败时保留 A 的数据目录，不自动删除。

当前没有满足这些条件的 CI job，因此不能把“安装包存在”或“单版本覆盖安装”
写成跨版本升级通过。

## 4. 判定

- 单版本安装 + 覆盖安装 + 内容级数据保留：**PASS**（历史真实 runner 证据）。
- 跨版本升级 / 回滚 / 失败恢复 / updater 签名：**NOT_RUN / BLOCKED_EXTERNAL**。

本阶段不新增“升级事务”产品代码；没有双版本真实证据前，READY_FOR_RC 不能因
安装链而成立。
