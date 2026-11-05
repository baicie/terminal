# Phase 9.5 — Integration Closure & Real Upgrade Foundation

> 日期：2026-11-05
> 分支：`feat/phase9-5-upgrade-integrity`
> 基线：`a7a65bc`（PR #7 HEAD，stacked on PR #6）
> 本阶段不合并 PR、不打 tag、不发布 Release。

## 1. 目标

1. 正式归档 Phase 9.4.2（`docs/phase9-4/phase9-4-2-closure.md`）。
2. 给出 PR #6/#7 的可执行集成方案。
3. 建立真实双版本升级 harness，并完成第一条真实 A→B 数据完整性 E2E。
4. 完成第一批可确定性执行的失败/恢复测试。
5. 明确签名、身份迁移、回滚与跨平台阻塞项。

## 2. 分支与 PR 状态（2026-11-05 重新获取）

| 项 | 值 |
| --- | --- |
| main | `2f1d68ff9232f51a90de997e4dbfa240ed2068d0` |
| PR #6 | OPEN / Draft，head `47b9a6e`，base `main`，`mergeStateStatus=CLEAN`，11/11 checks pass |
| PR #7 | OPEN / Draft，head `a7a65bc`，base `feat/phase9-2-sync-security-hardening`，`mergeable=MERGEABLE`，`mergeStateStatus=UNSTABLE` |
| PR #6 evidence | 6 份，指纹 `6d7536e7…`，门禁 0 problem（独立 worktree 复核） |
| PR #6 source-size | 563 个生产文件 |
| PR #7 unique commits | `47b9a6e..a7a65bc` 共 **18** 个 |
| Phase 9.5 分支 | 从 `a7a65bc` 切出；**stacked dependency**，不是 main |

## 3. PR #6 人工合并检查表

- [x] `mergeable=MERGEABLE`，`mergeStateStatus=CLEAN`，无与 main 的冲突。
- [x] 11/11 checks pass（run `41612144366`，head `47b9a6e`）。
- [x] 六份 evidence 与源码指纹匹配，门禁 0 problem。
- [x] source-size 563 个生产文件通过。
- [x] 数据兼容性（**静态**）：PR #6 的 database diff 无 `DROP`/`DELETE FROM`；
      `team_shared_hosts`/`team_shared_snippets` 新增 `is_sensitive`/`encrypted_data`
      同时出现在 `CREATE TABLE IF NOT EXISTS` 与 `ALTER TABLE` 迁移中。**main →
      PR #6 的实机 A→B 升级仍是 NOT_RUN**；本轮 dev.1→dev.2 是历史发布链，不是
      main 的升级证据。该限制已在此写明，不把静态审查写成运行证据。
- [x] 依赖安全：`cargo audit` 13 条已记录，`RUSTSEC-2023-0071` 仍阻塞发布、不阻塞合并；
  `pnpm audit --prod` 无已知漏洞。
- [x] 同步冲突五处 P0、双客户端真实 PG、Share REST、Linux zsh 等证据见
  `docs/phase9-2/final-report.md`、`docs/phase9-3/`。
- [ ] 人工确认 PR #6 的 Draft 状态与合并方式（不得由 Agent 转 Ready 或合并）。
- [ ] 人工确认发布范围的 RSA 残余风险被接受。

**`PR_6_READY_FOR_HUMAN_MERGE = YES`**（条件：人工操作；Draft 转 Ready 与合并均由人完成）。

## 4. PR #7 集成方案

### 4.1 独立提交

PR #7 的 18 个提交均以 `47b9a6e` 为父链起点；PR #6 的 Phase 9.2/9.3 内容通过
base branch 共享，不会在 PR #7 的 diff 中重复出现。

### 4.2 合并方式对历史的影响

- **Merge commit**：main 树 = `main` + PR #6 树；PR #7 的 `--onto main 47b9a6e`
  重放 18 个提交。
- **Squash**：main 树与 merge commit 相同（提交历史被压缩）；同样用
  `--onto main 47b9a6e`，不会重复 Phase 9.2/9.3 内容。
- **Rebase merge**：提交 SHA 改变，但树相同；PR #7 仍按 `--onto` 重放。

已在本机用 `git merge --no-ff 47b9a6e` 模拟 post-#6 main，然后
`git rebase --onto tmp/post-pr6 47b9a6e a7a65bc`：

- **18/18 提交重放成功，0 冲突**；
- `check-verification-evidence.mjs` **0 problem**（指纹保持 `d14fb1d1…`）；
- source-size **568 文件**通过；
- diff 为 62 文件 / 45,205 insertions / 504 deletions（含 evidence 原始日志）。

注意：直接 rebase 到**未包含 PR #6 的旧 main** 会在
`scripts/run-cold-start-stopwatch.test.mjs` 产生冲突；这是预期的假冲突，不是
post-#6 集成的真实冲突。**必须先合并 PR #6，再 rebase。**

### 4.3 执行步骤（PR #6 真正合并后）

1. 核对 main 最新 SHA，确认它包含 PR #6 的树。
2. 在 PR #7 分支执行 `git fetch origin && git rebase --onto origin/main 47b9a6e`。
3. 若上游不是 merge commit 而是 squash/rebase，仍以 `47b9a6e` 作为 old base；
   不要用 `origin/main` 作为 old base（会把 PR #6 内容重复带入）。
4. 解决冲突时保留 PR #7 的 Phase 9.3.2/9.4 变更；不得回退证据或测试。
5. 重跑 `pnpm typecheck`、前端/脚本测试、`check-source-size`、证据门禁。
6. 推送 PR #7 的新 head，等待 CI；**不自动合并**。
7. 确认 diff 只包含 Phase 9.4 的 18 个提交；若 main 在 #6 之后又有新提交，重新
   rebase 并重跑。

### 4.4 哪些修改会改变源码 fingerprint

`check-verification-evidence.mjs` 的 `FINGERPRINT_PATHS` 包含前端源码、Rust 源码、
Cargo 配置、Tauri 配置、部分 scripts 和 `real-machine-matrix.yml`。以下会作废
六份 evidence：

- 任何前端/Rust/依赖/Tauri 配置/`real-machine-matrix.yml`/采样脚本改动；
- rebase 本身不会改变树，因此不会作废；冲突解决若改了这些文件则会。

PR #6 合并不会改变 PR #7 的树；rebase 后在最终 HEAD 重跑门禁即可。Phase 9.5
的升级 harness 不在 `FINGERPRINT_PATHS`，不会自动作废证据；但若要把升级报告
作为 release 证据，需要显式把它纳入指纹并重采（见 `release-blockers.md`）。

## 5. 升级 harness 架构

`scripts/verify-install/upgrade-e2e.mjs`：

```
inspect A/B (asset-metadata.mjs: sha256/version/identifier/arch)
  -> install A into isolated Applications dir
  -> launch A with HOME=<isolated>
  -> wait DB + schema (migration-columns + integrity)
  -> stop A + WAL checkpoint
  -> seed A schema-compatible fixture (hosts/settings/workspace/layout/team/vault)
  -> snapshot before
  -> install B over the same path
  -> launch B, wait expected new columns + integrity
  -> stop B + checkpoint
  -> field-by-field verify + backup-verify
  -> JSON + Markdown report
```

复用 `scripts/verify-install/data-retention.mjs`，不新建第二套数据保留框架。

### 5.1 数据契约

- hosts：A 实际存在的列逐字段比较；B 新增列必须存在，默认值报告。
- settings：比较 A 的所有键（`terminalThemeLight`/`terminalThemeLightMigrated`
  一次性迁移单独报告），未知新键只记录。
- workspaces/workspace_layouts：逐字段 + JSON 语义。
- Team Sync 本地表：teams / team_members / team_shared_hosts / sync_queue /
  user_profile 逐字段。
- Vault：文件存在、可解析、salt/entries 不变；**真实主密码解锁 NOT_RUN**。
- schema：A 的表/列是 B 的子集；B 新增列显式断言。
- backup：有备份能力的 B 必须产出 `pre-migration-<epoch>.db`，且可打开、可读回
  seeded 行；没有备份能力的历史 B 标 `NOT_RUN`，不伪造 PASS。

### 5.2 平台契约

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| macOS | **实现** | DMG mount + .app copy + HOME 隔离；A/B 真实发布资产已验证 |
| Linux | **NOT_RUN** | 现有 Linux 脚本在 apt 失败时会退回解包仍判绿；升级 harness 必须 fail-closed，下一轮实现 |
| Windows | **BLOCKED/NOT_RUN** | APPDATA 重定向不被 `SHGetKnownFolderPath` 采纳，现有脚本会删除真实 `%APPDATA%\Termius`；必须在一次性 profile/VM 中实现，禁止在真实用户目录跑故障注入 |

## 6. 判定

- `PR_6_READY_FOR_HUMAN_MERGE = YES`
- `PR_7_INTEGRATION_READY = YES`（条件：先由人工合并 PR #6；已模拟 0 冲突/门禁通过）
- `PHASE_9_5_FOUNDATION_COMPLETE`：见 `implementation-report.md`
- `READY_FOR_RC / RELEASE`：见 `release-blockers.md`
