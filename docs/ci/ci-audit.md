# CI/CD 审计

基线：`main@ca8406d8`。审计时间：2026-11-15。
本文只记录**实际读到的事实**；猜测一律标「未验证」。

## 1. 现状速览

| 项 | 实测值 |
| --- | --- |
| main 分支保护 | **无**。`gh api repos/.../rulesets` → `[]`；`branches/main/protection` → `Branch not protected` (404) |
| Workflow 数量 | 6 |
| 同一 commit 的 CI 运行次数 | **2**（`push` + `pull_request`）|
| 最近 30 次 CI 结论 | failure 24、cancelled 5、无结论 1 |
| 阻塞 PR 的 required check | **不存在**（无分支保护，所以没有任何检查真正阻塞）|

### 1.1 重复运行的实测证据

最近 6 个 commit 各自产生一对运行：

```
43692358326 pull_request  e67ee9f2
43692356593 push          e67ee9f2
43692006376 pull_request  3a190983
43692003382 push          3a190983
43690691476 pull_request  fef82976
43690687372 push          fef82976
```

原因：`ci.yml` 的 `on:` 同时声明了 `push` 与 `pull_request`，两者的 concurrency group 用
`github.ref` 区分 —— push 是 `refs/heads/<branch>`，PR 是 `refs/pull/N/merge`，所以**不会互相
取消**。

### 1.2 最近失败的真实原因分类

| 原因 | 频率 | 证据 |
| --- | --- | --- |
| evidence 指纹失配 | 绝大多数 | `Repository gates` 的 `Verification evidence matches this checkout` 步骤失败，`check:source-size` 通过 |
| 真实代码缺陷 | 2 次 | `Rust quality`（clippy `unused import` / `useless vec!`）、`Rust quality`（`sftp_download_tests` 写缓冲时序）|
| 既有产品缺陷 | 持续 | GUI E2E 的 `right-panel` 超时（#81 已修）、Windows 终端不挂载 |

**关键区分**：evidence 失配占绝大多数，且它**不是代码问题**。把这些混在一起是当前 CI 最
大的可读性问题。

## 2. 每个 Workflow 的作用与触发

| Workflow | 触发 | 作用 | 是否阻塞 |
| --- | --- | --- | --- |
| `ci.yml` | `push`(非 md)、`pull_request`(非 md)、dispatch | 11 个质量 job | **否**（无分支保护）|
| `native-gui-e2e.yml` | `pull_request`(paths: e2e/gui、src-tauri 等)、dispatch | 真实 WebView E2E | macOS 阻塞 / Win+Linux informational |
| `real-machine-matrix.yml` | `schedule`(周一 03:30)、dispatch | 实机 SSH 矩阵 → 六份证据 | 否 |
| `upgrade-e2e.yml` | 待确认 | 安装升级 E2E | 待确认 |
| `cold-start-stress.yml` | dispatch + 分支 push | 冷启动压力采样 | 否 |
| `release.yml` | `push` tag `v*`、dispatch | 打包发布 | 发版路径 |

### 2.1 `ci.yml` 的 job 与契约

| job | 验证内容 |
| --- | --- |
| `frontend` | lint、typecheck、vitest、bundle budget、Vault probe 不在生产包 |
| `frontend-audit` | `pnpm audit --prod` |
| `team-server` | prisma validate、lint、typecheck、test、build、真实 PG 并发、跨版本同步（诊断）|
| `zsh-probe-diagnostic` | **`continue-on-error: true`** —— 诊断，不阻塞 |
| `source-size` | source-size、evidence gate、script tests（三项同一 job）|
| `rust` | fmt、check --all-targets --all-features、clippy、test、smoke-vault-probe |
| `cargo-audit` | 三态裁定（0 基线内 / 1 新 advisory / 2 扫描失败）|
| `docker` | Compose 校验、镜像构建 |
| `tauri` | 三平台打包 + 安装链 + 数据保留 + Windows 恢复测试 |

## 3. 真正阻塞 PR 的检查

**没有。** main 无分支保护，因此：

- 任何检查失败都可以直接合并；
- required status checks 未配置；
- force push 与删除 main 均未阻止。

这是 P0。#81/#82 目前「除 evidence 外全绿」的表述在技术上没有强制力 —— 它只说明我作为
维护者愿意等，不说明 GitHub 会拦。

## 4. 未被任何 workflow 调用的验证

| 脚本 | 状态 |
| --- | --- |
| `scripts/run-terminal-smoke-matrix.mjs` | 被 `real-machine-matrix.yml` 调用 |
| `scripts/verify-install/sftp-command-e2e.mjs` | **未被任何 workflow 调用** |
| `scripts/verify-install/sftp-staged-upload-e2e.mjs` | **未被任何 workflow 调用** |
| `scripts/verify-install/team-cross-version.mjs` | 被 `ci.yml` 的 team-server job 调用（诊断，`continue-on-error`）|

前两项意味着 **Rust 侧 SFTP 命令级 E2E 从未在 CI 上跑过**。这是实测，不是推测 ——
它们是 `pnpm verify:sftp-command` / `verify:sftp-upload` 的目标，而这两个 script 只出现在
`package.json`。

## 5. 重复构建

| 重复点 | 证据 |
| --- | --- |
| 同一 commit 跑两次完整 CI | 见 §1.1，6/6 成对 |
| `pnpm install` 在 11 个 job 各跑一次 | 每个 job 独立 `pnpm install --frozen-lockfile` |
| 前端构建在 `frontend`、`rust`（custom-protocol 需要）、`tauri` 各跑一次 | `rust` job 有 "Build the frontend that `custom-protocol` embeds" 步骤 |
| GUI E2E 构建一次完整 release 二进制 | 每轮约 15–20 分钟 |

## 6. 证据机制依赖

```
real-machine-matrix.yml (schedule/dispatch, macOS runner)
  → 产出 artifact（六份 JSON + 原始日志 + 两个二进制）
  → scripts/fetch-verification-evidence.mjs 下载并落盘
  → docs/verification/evidence-manifest.json 记录 fingerprint/runId/两个 SHA
  → scripts/check-verification-evidence.mjs 在 `Repository gates` 里比对
```

**核心耦合**：`computeSourceFingerprint()` 覆盖 `FINGERPRINT_PATHS`（含 `src-tauri/src`、
`packages/frontend/src`、门禁脚本自身）。任何一处改动都让六份证据**同时**失效。

**当前状态**：main 上指纹失配 7 个 problem（实测）。这意味着 `Repository gates` 在 main 上
也是红的 —— 所有 PR 共享这个失败，无法区分「我的改动破坏了证据」与「证据本来就过期」。

这就是任务书 §3.1 描述的问题，也是最需要改的地方。

## 7. 跨平台覆盖

| 平台 | 编译 | 打包 | 安装链 | 真实 SSH | GUI E2E |
| --- | --- | --- | --- | --- | --- |
| macOS | 是 | DMG | 是 | 是（证据矩阵）| 是（阻塞）|
| Linux | 是 | deb+AppImage | 是 | 部分（ssh smoke）| 是（informational）|
| Windows | 是 | NSIS | 是 | 部分（PowerShell/cmd）| 是（informational，**当前失败**）|

**Windows GUI E2E 实测失败原因**（run 43687188164 与 43692003382）：终端从未挂载，
`mounts exactly one terminal workbench` 失败，probe 因此未安装。这是 AGENTS.md:567 已记录的
「Windows 本地 PTY 仍需实机验证」，不是 Harness 缺陷。

## 8. 发布链路风险

| 风险 | 证据 | 级别 |
| --- | --- | --- |
| 顶层 `contents: write` 被所有 job 继承 | `release.yml:25-26`，无 job 级 permission | P1 |
| 发布资格仅靠 tag/version 一致性 | 待细读 `prepare-release` | P1 |
| updater 发布顺序 | 待细读 `verify-release` | P0（任务书 §4.2）|
| main 无保护 → 可向 main 直推后打 tag | 无 ruleset | P0 |

## 9. 改造后应达到的行为（本阶段目标）

| 目标 | 判定方式 |
| --- | --- |
| main 有 required check | `gh api repos/.../branches/main/protection` 返回非 404 |
| 同一 commit 只跑一次 CI | run 列表里不再成对出现 |
| 证据失配不再误伤日常 PR | Integrity 与 Qualification 分离，PR 只跑 Integrity |
| 被跳过的 job 不会让 required 永久 pending | 聚合检查显式列出 expected/actual |

## 10. 明确未验证

- `upgrade-e2e.yml` 的触发与 job 契约（未逐行读）
- `release.yml` 的 `prepare-release` / `verify-release` 细节
- Merge Queue（未启用，无法测）
- Fork PR 的权限行为（本仓库无 fork）
