# Phase 9.5 — Real Two-Version Upgrade E2E

> 日期：2026-11-05
> 平台：macOS arm64（本机真实执行）
> 资产：GitHub Releases `v0.0.1-dev.1` / `v0.0.1-dev.2` + 当前源码本地构建
> 报告与日志：`docs/phase9-5/evidence/`

## 1. 执行命令

```bash
node scripts/verify-install/upgrade-e2e.mjs run \
  --a-installer <A.dmg> --b-installer <B.dmg> --platform darwin \
  --expect-a-sha256 <A-SHA> --expect-b-sha256 <B-SHA> \
  --expect-a-version <A-version> --expect-b-version <B-version> \
  --expect-identifier com.baicie.termius \
  --expect-new-host-columns agent_forwarding,shell_integration \
  [--expect-backup] \
  --work-dir <work> --report-dir <report>
```

## 2. 运行 1：dev.1 → dev.2（两个真实发布资产）

| 项 | 值 |
| --- | --- |
| A | `0.0.1-dev.1`，SHA256 `73cf7483…`，arm64，`com.baicie.termius` |
| B | `0.0.1-dev.2`，SHA256 `2c9a0ca3…`，arm64，`com.baicie.termius` |
| 结果 | **PASS** |
| schema | A 的 hosts 20 列 → B 的 22 列；新增 `agent_forwarding`、`shell_integration` |
| 数据 | hosts / settings（全键）/ workspaces / layout / Team Sync 本地 5 表 逐字段 PASS |
| vault | 文件存在、可解析、salt/entries 不变；真实主密码解锁 NOT_RUN |
| pre-migration backup | **NOT_RUN**（dev.2 的 schema 代码早于当前备份命令） |
| 证据 | `docs/phase9-5/evidence/dev1-to-dev2/upgrade-report.json` |

## 3. 运行 2：dev.1 → 当前源码 dev.3-local

| 项 | 值 |
| --- | --- |
| A | `0.0.1-dev.1`，发布资产 |
| B | `0.0.1-dev.3-local`，当前源码本地构建，SHA256 `66f2465d…`，arm64，identifier 不变 |
| 结果 | **PASS** |
| schema | 新增 `agent_forwarding`、`shell_integration` |
| 数据 | 与运行 1 相同的全字段检查 PASS |
| Team Sync 本地 | **PASS**（teams / team_members / team_shared_hosts / sync_queue / user_profile） |
| pre-migration backup | **PASS**：`pre-migration-<epoch>.db` 已生成且可打开、可读回 seeded 行 |
| 证据 | `docs/phase9-5/evidence/dev1-to-dev3-current/upgrade-report.json`、`backup-report.json` |

说明：`0.0.1-dev.3-local` 是用 Tauri `--config '{"version":"0.0.1-dev.3-local"}'`
构建的**当前源码**测试包，只用于标识 A→B 的版本差；它不是 GitHub 发布资产，报告
也没有把它写成历史发布包。

## 4. 结果分类

| 结论 | 结果 |
| --- | --- |
| A 元数据（版本/identifier/arch/SHA） | **PASS**（从产物自身读取） |
| A 安装、首启、真实 schema 创建 | **PASS** |
| A 数据 seed（按 A 的 schema 兼容列） | **PASS** |
| A SQL 读回 | **PASS**（app 级写回探针在 dev.1 不存在，见 data-integrity.md） |
| B 覆盖安装、版本/identifier 不变 | **PASS** |
| B schema migration | **PASS** |
| 字段级数据完整性 | **PASS** |
| Team Sync 本地持久化 | **PASS**（两张表以上的历史 schema 均存在） |
| Vault 文件持久化 | **PASS**；真实解锁 **NOT_RUN** |
| pre-migration backup（当前 B） | **PASS**；历史 B **NOT_RUN** |
| 三平台 | macOS **PASS**（本机）；Linux/Windows **NOT_RUN** |

## 5. CI

新增 `.github/workflows/upgrade-e2e.yml`：下载 dev.1/dev.2、校验
`SHA256SUMS.txt`、运行 A→B 与 corrupt/read-only/restart 三个故障测试，上传
`upgrade-report*/` 与日志。工作流与普通 CI 分离，只有路径命中
`scripts/verify-install/**` 或该 workflow 时触发。

**本文件中的 PASS 来自本机真实执行。** CI 另有一次真实 runner 运行：

| 项 | 值 |
| --- | --- |
| run | `41954815468`（`ab9515c`） |
| 结果 | **success** |
| 步骤 | 下载/校验 dev.1、dev.2；A→B 字段验证；corrupt DB；read-only；restart 全部 success |
| 证据 | `docs/phase9-5/evidence/ci-run-41954815468/` |
| 限制 | CI 的 B 是 dev.2，没有迁移备份命令，也没有当前产品的应用级错误日志；因此 `pre-migration backup` 与 `* detected by the app` 在 CI 报告中是 `NOT_RUN`。当前 B 的备份/日志证据来自本机运行 2。 |

普通 CI 的 `Repository gates` 现在也会运行
`scripts/verify-install/*.test.mjs`（已加入 `node --test` 命令），避免新增测试
只在本地执行。

## 6. 判定

- `REAL_TWO_VERSION_UPGRADE_VERIFIED = YES`（macOS 本机真实发布 dev.1→dev.2 与
  dev.1→当前源码；真实 runner `41954815468` 也 **success**）
- `UPGRADE_DATA_INTEGRITY_VERIFIED = YES`（macOS 本机；真实 Vault 解锁、Team Sync
  服务端同步、Linux/Windows 不在本判定内）
- `FAILURE_RECOVERY_VERIFIED = PARTIAL`（见 `failure-recovery.md`）
