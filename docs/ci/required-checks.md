# Required Checks

基线：`main@ca8406d8`。

## 1. 现状：没有任何检查阻止合并

实测（2026-11-15）：

```
gh api repos/baicie/terminal/rulesets                        → []
gh api repos/baicie/terminal/branches/main/protection        → 404 Branch not protected
```

这不是「保护很弱」，是**完全没有保护**。任何检查的失败都能被直接合并绕过，force push 与
删除 main 也没有被阻止。

因此「#81/#82 除证据外全绿」这句话在技术上没有强制力 —— 它只表示维护者愿意等，不表示
GitHub 会拦。

## 2. `CI / required` 的设计

### 2.1 为什么需要一个聚合检查

`ci.yml` 有 11 个 job，但分支保护只能按 **check 名称** Required。直接把 11 个名字都列进去
有两个问题：

1. `paths-ignore: ['**/*.md', 'docs/**']` 意味着**只改 Markdown 的 PR 根本不会创建这些
   check run**。Required check 从未上报 = PR 永久 pending，无法合并。
2. 加一个新 job 就要同步改分支保护配置，而那是仓库设置，不在代码里，容易漏。

`CI / required` 是**无条件运行**的单个 job：它读 `needs` 的结果，自己决定通过与否。

### 2.2 判定规则

`scripts/verify-required-checks.mjs` 的 `EXPECTED_JOBS` 是契约：

| 情况 | 判定 | 理由 |
| --- | --- | --- |
| 期望的 job `success` | 通过 | — |
| 期望的 job `failure` / `cancelled` | **失败** | 未完成的检查不是通过的检查 |
| 期望的 job `skipped`（普通运行） | **失败** | 该跑没跑 |
| 期望的 job `skipped`（docs-only 运行） | 通过 | `paths-ignore` 过滤，没有任何东西退化 |
| 期望的 job **无结果** | **失败** | 沉默不是成功 |
| 未知的 result 字符串 | **失败** | GitHub 可能新增状态，默认放行是不安全方向 |
| `optional: true` 的 job 缺席 | 通过 | 只有 `zsh-probe-diagnostic`（`continue-on-error` 设计）|

**不能用 `needs.*.result == 'success'`** 的两个具体原因：

1. docs-only 运行时所有 job 都是 `skipped`，布尔表达式会把一个正常的 README PR 判失败；
2. 依赖链上某个 job 被 skip 会让下游也 skip，"没有失败" 与 "真的跑了" 是两个问题。

### 2.3 防止契约被悄悄放宽

`unclassifiedJobs()` 会读真实的 `ci.yml`，把 job 列表与 `EXPECTED_JOBS` 比对。**新增一个 job
而不在契约里分类，`CI / required` 直接失败**，并给出该 job 的名字。

这堵的是最隐蔽的一种退化：把新 job 加进 `ci.yml` 而不加进 `needs`，于是它永远不阻塞，
而所有人以为它阻塞。

### 2.4 测试

`scripts/verify-required-checks.test.mjs`，10 项：

| 测试 | 钉住什么 |
| --- | --- |
| every aggregated job succeeding passes | 正常路径 |
| a failed job fails the gate | failure |
| a cancelled job fails the gate | cancelled |
| a skipped required job fails unless docs-only | 两种 skip 语义 |
| a missing result fails | 沉默不是成功 |
| an optional job may be absent or skipped | 但失败仍然失败 |
| an unknown result string is a failure | 默认不放行 |
| the aggregator is not required to depend on itself | 自指不会死锁 |
| every job in ci.yml is classified | 读真实文件 |
| an unclassified job is reported | 契约漂移 |

## 3. 需要仓库管理员完成的配置

`CI / required` 只是**可以被 require 的 check**；把它设成 required 需要仓库设置权限，本轮
执行环境没有。**EXTERNAL_ACTION_REQUIRED。**

### 3.1 精确参数

```
Repository → Settings → Rules → Rulesets → New ruleset → New branch ruleset

Name:            main-protection
Enforcement:     Active
Bypass list:     (留空；见 §3.3)
Target branches: Include by pattern → refs/heads/main

Rules:
  ☑ Restrict deletions
  ☑ Block force pushes
  ☑ Require linear history          (可选，取决于合并策略)
  ☑ Require a pull request before merging
      Required approvals: 0         (当前无二审人力；见 §3.3)
      ☑ Dismiss stale pull request approvals when new commits are pushed
  ☑ Require status checks to pass
      ☑ Require branches to be up to date before merging
      Checks: "required"
```

### 3.2 验证步骤

```bash
# 应当返回 200 且包含 "required" 这个 check
gh api repos/baicie/terminal/rulesets
gh api repos/baicie/terminal/rulesets/<id> | jq '.rules[] | select(.type=="required_status_checks")'
```

再开一个故意失败的 PR，确认合并按钮被禁用。

### 3.3 关于 approvals = 0 与 bypass

- **Required approvals 设为 0**：这个仓库目前是单人维护，要求 1 个 approval 会让所有 PR
  永久不可合并，而"作者自己批自己"在 GitHub 上不算数。等有第二个维护者时再调。
- **Bypass list 留空**：管理员应当也走同一套门禁。如果确实需要紧急通道，应显式加一条
  带审计的 bypass 并记录理由，而不是默认给管理员放行。

## 4. 明确未验证

- 上述 Ruleset **未启用**（无权限）。
- Merge Queue 未启用，因此 `merge_group` 事件未测。若将来启用，`CI / required` 需要在
  `on:` 里加 `merge_group`，否则队列会因缺少 required check 卡住。
- Fork PR 的权限行为未测（本仓库无 fork）。
