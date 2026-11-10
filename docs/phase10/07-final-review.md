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

---

# Phase 10.1 — 安全收尾审查

- 基线：`main = 7c1524ed38daac4dab69b92babcac9102e87ce22`
- 分支：`feat/phase10-1-credential-security-closure`
- Draft PR：[#23](https://github.com/baicie/terminal/pull/23)
- 未合并、未打 Tag、未发布 Release

## 为什么需要这一轮

Phase 10 的验收写的是 `PLAIN_EXPORT_SECRET_EXCLUDED=PASS`、
`HOST_WRITE_PATH_UNIFIED=PASS`。这两条都是**在它自己的范围内**成立的，而范围漏掉了
用户真实的四条导入入口。逐条复核后的结论：

1. `db_import/writer.rs` 仍绑定 `password` / `private_key` / `passphrase` 到真实列 —
   任何备份导入都写明文，包括云同步恢复和团队包；
2. `syncServiceToken` 位于 `app_settings` 的 JSON 值内部，导出与云上传都带真实凭据；
3. 固定 Vault key 直接覆盖，多秘密更新部分失败会留下从未存在的凭据组合；
4. `credential-migration.ts` 只有规则与 Fake Vault 测试，没有任何生产调用链。

第 1 条是 P0：它让「新建路径安全」这个结论对一个**已经被删除的旧版本备份**完全不成立。

## 本轮变更

### 代码

| 层 | 文件 | 性质 |
| --- | --- | --- |
| Rust 导入边界 | `db_import/secrets.rs`（新）、`payload.rs`、`writer.rs` | 秘密列从 SQL 中移除；三态策略；源引用永不入库 |
| 导入前端边界 | `service/import-security.ts`（新）、`import-vault-migration.ts`（新）、`sync-import.ts` | 诊断/决定/迁移/补偿 |
| 设置导出策略 | `service/settings-export-policy.ts`（新）、`sync-export.ts` | 字段级白名单，含 `team_settings.apiToken` |
| 版本化凭据 | `credential-boundary.ts` + `credential-ref.ts`（新） | `version` 字段、`LEGACY_VERSION`、命名空间拆分、三态解析 |
| 主机写入 | `database/hosts.ts` + `host-credentials.ts`（新） | 新版本写入 → 读回 → 单语句切换 → 清理旧版本 |
| SSH Key | `database/ssh-keys.ts` + `connection-schema-migrations.ts`（新） | 新增 `credential_ref` 列、按需读取、独立命名空间 |
| 迁移 | `credential-migration.ts` + `-runner.ts` + `-verify.ts` + `-run.ts`（均新/拆） | 计划不含秘密；快照→执行→重读验证 |
| Store | `store/host.ts`、`host-mappers.ts` | 保存后回读；损坏引用随主机携带 |
| UI | `import-secrets-panel.tsx`、`import-preview-card.tsx`、`credential-migration-panel.tsx`、`key-secret-actions.tsx`（均新） | 决策面板、需重绑清单、迁移面板、显示/复制私钥 |

### 测试增量

| 文件 | 项数 | 锁住的性质 |
| --- | --- | --- |
| `db_import/tests.rs`（Rust） | +12 | 秘密列不可达、策略三态、源引用不持久化 |
| `import-security.test.ts` | 15 | 发给 Rust 的 payload 文本不含明文 |
| `settings-export-policy.test.ts` | 9 | 真实导出文件与上传 body 不含 token |
| `hosts-credential-versions.test.ts` | 12 | 各失败点只留完整版本 |
| `credential-migration-run.test.ts` | 11 | 生产链路、快照、故障注入 |
| `credential-ref-problems.test.ts` | 12 | 损坏引用不等于无凭据 |
| `ssh-keys-lifecycle.test.ts` | 16 | 新建/查看/复制/编辑/删除/命名空间 |
| `host-refresh.test.ts` | 7 | 新建→保存→Store→立即连接 |

## 判定

见 `docs/phase10/11-phase10-1-report.md` 的完整状态表。核心结论：

- 所有真实导入入口（文件、云同步、团队包、Merge、Replace、旧版备份、恶意构造）
  现在经过同一个边界，且该边界在 Rust 侧结构性成立；
- `syncServiceToken` 与 `apiToken` 不进入任何导出与上传；
- 版本化凭据使多秘密更新的每个失败点都可恢复；
- 迁移有真实调用链、快照、断点续跑与重读验证。

**仍未闭合**：真实 GUI 的 Vault/SSH/Jump/SFTP/IME 验收、三平台真机回归、
历史 WAL 与备份文件明文擦除、身份迁移、签名/公证、`RUSTSEC-2026-0459`。
`DAILY_DRIVER_READY` 与 `TABBY_REPLACEMENT_READY` 仍为 **NO**。
