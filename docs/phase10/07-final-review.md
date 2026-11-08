# Phase 10 — 最终审查

- 基线：`main = 18d6ed0ef38f330088c70b795ca62109c5c60e62`
- 分支：`feat/phase10-daily-driver`
- Draft PR：[#22](https://github.com/baicie/terminal/pull/22)
- 未合并、未打 Tag、未发布 Release

## 交付内容

### 代码

| 工作包 | 文件 | 测试 |
| --- | --- | --- |
| 凭据边界 | `service/credential-boundary.ts`、`service/vault-secret-provider.ts`、`service/database/hosts.ts`、`features/terminal/services/session-credentials.ts` | `credential-boundary.test.ts`（10）、`hosts-secrets.test.ts`（6） |
| 主机搜索 | `components/command-palette/host-ranking.ts`、`use-palette-searchers.tsx` | `host-ranking.test.ts`（20） |
| Quick Connect | `view/hosts/quick-connect-parser.ts` | 语法矩阵 36（新增 9 条，含 `-p` 前置） |
| 快捷键持久化 | `service/shortcuts.ts`、`service/shortcuts-storage.ts`、`App.tsx`、`shortcuts-settings.tsx` | `shortcuts-persistence.test.ts`（11） |
| 安全粘贴 | `features/terminal/services/paste-policy.ts`、`use-safe-paste.ts`、`paste-confirm-dialog.tsx`、两个菜单 | `paste-policy.test.ts`（14） |
| Terminal-first | `router/nav-tier.ts`、`nav-config.tsx`、`route-table.tsx`、`app-sidebar/index.tsx` | `nav-tiers.test.ts`（5） |
| OpenSSH 导入 | `features/import/ssh-config-parser.ts`、`import-plan.ts` | 42 项 |

### 修复的真实缺陷（不是新功能）

1. **主机凭据明文入库**（P0）：保存路径现在 SQL 恒 NULL，秘密进 Vault。
2. **第 21 台主机永远搜不到**（P1）：`slice(0, 20)` 先截断后搜索。
3. **快捷键重启即丢失**（P1）：无任何持久化。
4. **恢复默认会把 Ctrl+J 换成 Ctrl+K**（P1，改持久化时发现）：按 `action` 合并
   使同一 action 的两个绑定互相覆盖。
5. **多行粘贴直接执行最后一行**（P1）：无任何确认。
6. **`ssh -p 2222 user@host` 不被接受**（P2）：选项只允许在目标之后。
7. **打开应用落在主机管理表**（P1）：索引路由指向 `/hosts`。

每项都有"旧实现失败 / 新实现通过"的证据。

## 验证

| 套件 | 结果 |
| --- | --- |
| Frontend Vitest | **1558 passed / 174 files** |
| Frontend typecheck | 通过 |
| Frontend ESLint（改动文件） | 通过 |
| Rust `cargo test --lib` | **364 passed**（4 ignored） |
| Team Server unit | **124 passed** |
| `check:source-size` | **598 文件通过** |
| 六份实机证据 | run `42507184186`，指纹 `6771e2b3…`，门禁 **0 problem** |
| 证据内容 | SSH 11/11、shell 14/14、release SSH 8/8、冷启动 6093/3427/3185 ms |

## 判定

```
BASE_SHA=18d6ed0ef38f330088c70b795ca62109c5c60e62
FINAL_BRANCH=feat/phase10-daily-driver
FINAL_HEAD=（见 PR，证据提交后）
DRAFT_PR_URLS=https://github.com/baicie/terminal/pull/22

CREDENTIAL_DEFAULT_SAFE=PASS
CREDENTIAL_MIGRATION=NOT_RUN
PLAIN_EXPORT_SECRET_EXCLUDED=PASS

HOST_SEARCH_COMPLETE=PASS
QUICK_CONNECT_COMMON_SYNTAX=PASS
SHORTCUT_PERSISTENCE=PASS
SHELL_KEYBOARD_COMPATIBILITY=NOT_RUN
SAFE_PASTE_VERIFIED=PARTIAL

TERMINAL_FIRST_STARTUP=PASS
TERMINAL_SESSION_LIFECYCLE=NOT_RUN
SSH_REAL_E2E=NOT_RUN
SFTP_REAL_E2E=NOT_RUN
WORKSPACE_RESTORE=NOT_RUN

OPENSSH_CONFIG_IMPORT=PASS
TABBY_IMPORT_SUPPORTED_SCOPE=NOT_RUN
GUI_VISUAL_EVIDENCE=NOT_RUN

FRONTEND_QUALITY=PASS
RUST_QUALITY=PASS
UPGRADE_E2E=NOT_RUN
EVIDENCE_FINGERPRINT_VALID=PASS

DAILY_DRIVER_READY=NO
TABBY_REPLACEMENT_READY=NO
READY_FOR_PUBLIC_RELEASE=NO
```

## 为什么这些仍是 NO / NOT_RUN

- `CREDENTIAL_MIGRATION=NOT_RUN`：迁移代码未写。已有列与 ADR，但没有"把旧行搬到
  Vault 并验证读回"的实现，也没有回滚演练。宣称 PASS 会掩盖用户数据仍在明文列的事实。
- `SHELL_KEYBOARD_COMPATIBILITY` / `TERMINAL_SESSION_LIFECYCLE`：需要真实终端与
  真实键盘输入（含中文 IME），jsdom 无法证明。
- `SSH_REAL_E2E` / `SFTP_REAL_E2E` / `WORKSPACE_RESTORE`：本阶段改动后未重跑；
  既有 Phase 9 的实机结果不能替代本轮源码。
- `GUI_VISUAL_EVIDENCE`：本机 `screencapture` 只能得到壁纸，无 Screen Recording 权限。
- `SAFE_PASTE_VERIFIED=PARTIAL`：策略与 UI 接线完成并有 14 项测试，但未在真实
  Vim / less / readline / TUI 上验证粘贴行为。
- `DAILY_DRIVER_READY` / `TABBY_REPLACEMENT_READY`：需要 7 天真实使用数据；
  CI 全绿不等于可以替换日常工具。

## 后续优先级

1. 凭据迁移实现 + 回滚演练（M1 剩余）
2. `ssh_keys` 明文列迁移
3. 导入向导 UI（file dialog + 预览 + 确认）
4. 真实 GUI 与键盘验收（需授权环境）
5. 7 天 Scorecard 记录
