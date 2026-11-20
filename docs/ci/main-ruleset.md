# `main` 分支保护与合并前检查（部分规则已按授权移除）

> ## ⚠️ 当前状态与本文下半部分不一致，先读这一节
>
> **2026-11-20**：仓库所有者明确指示移除 `main` 的 CI 前置门禁，理由是采用
> OpsWeave 0.0.1 平台发行版的做法——「pr 可以绕过 ci 检验直接合并」「取消掉 main 的前置 ci」。
> 这是**产品负责人对策略的明确要求**，因此未被撤销。
>
> `gh api repos/baicie/terminal/rulesets/27354680` 实测现状：
>
> | 规则 | 现状 |
> | --- | --- |
> | `deletion` | ✅ 保留 —— `main` 不能被删除 |
> | `non_fast_forward` | ✅ 保留 —— 不能强推改写历史 |
> | `pull_request` | ✅ 保留 —— 一切改动必须走 PR |
> | `required_status_checks` | ❌ **已移除**（授权变更） |
>
> `bypass_actors: []`、`enforcement: active`、`updated_at: 2026-11-20T12:14:39+08:00`。
>
> ## 代价是真实的，且已经发生过
>
> 移除后的**同一天**，两个 PR 在门禁全红的情况下被合并：
>
> | PR | 合并时失败的检查 |
> | --- | --- |
> | #128 | `Frontend quality`、`required`、macOS/Windows/Linux GUI E2E |
> | #129 | `Frontend quality`、`required` |
>
> 后果不是理论上的：`Frontend quality` 的红是 bundle 预算
> （实测 653.63 KB > 653.50 KB 上限）。两个 PR 合入后 **`main` 自己过不了自己的门禁**，
> 一直到下一次任务复核才发现。这不是「CI 慢一点」的代价，是「红线不再意味着任何东西」。
>
> ## 因此门禁移到合并前检查脚本
>
> 规则集不再拦「检查是否通过」，那这件事就必须由**一个能重跑、规则可读、可测试**的地方来做，
> 而不是靠记忆。见 `scripts/check-merge-gate.mjs`：
>
> ```bash
> node scripts/check-merge-gate.mjs --pr <number>
> ```
>
> 退出码 0 = 可合并，1 = 阻止，2 = 无法判定（认证/网络）。
>
> 它拒绝三种特定的错误，每一种都对应一次真实事故：
>
> 1. **旧的 PASS 不是 PASS** —— 只读 PR 当前 head SHA 的检查；报告里打印 SHA，
>    因为读者看的浏览器标签页可能比合并按钮旧。
> 2. **pending 不是 pass** —— 检查没跑完时合并，等于没有门禁，只是*看起来*有。
> 3. **可以缺席的检查不设为必需** —— `native-gui-e2e.yml` 是 `paths:` 过滤的，
>    docs-only PR 根本不会产生这些 run。这正是本文 §4.1 记录的第一版 ruleset P0。
>
> 它的规则由 `scripts/merge-gate.test.mjs` 的 9 个用例钉住，其中 3 个变异验证成立
> （把 pending 当 pass、把 skip 全放行、把「没有检查」当已验证，各自让对应用例变红）。
>
> **这份流程是约定，不是强制。** 它拦不住 `gh pr merge` 直接执行——只有规则集能拦，
> 而规则集按授权不再拦这一条。任何人跳过这一步，仓库不会阻止他。
>
> ## 2026-11-20 的探针实测（以下是实跑结果，不是描述）
>
> 移除 `required_status_checks` 后，逐条确认留下来的规则仍然生效：
>
> ```text
> $ git push origin HEAD:main
>  ! [remote rejected] HEAD -> main (push declined due to repository rule violations)
>
> $ git push --force origin HEAD:main
>  ! [remote rejected] HEAD -> main (push declined due to repository rule violations)
>
> $ git push origin --delete main
>  ! [remote rejected] main (refusing to delete the current branch: refs/heads/main)
> ```
>
> ```text
> $ gh api repos/baicie/terminal/rulesets/27354680 --jq '…'
> { "enforcement": "active", "bypass_actors": [],
>   "rules": ["deletion", "non_fast_forward", "pull_request"],
>   "has_required_checks": false,
>   "updated_at": "2026-11-20T12:14:39.837+08:00" }
> ```
>
> 三项全部拒绝，规则集如授权所述不含 `required_status_checks`。
> **合并前的检查是否通过，现在完全取决于 `check-merge-gate.mjs` 有没有被运行。**
>
> ---
>
> ## 以下为 2026-11-16 首次启用时的记录（历史）
>
> 状态：**ENABLED**（2026-11-16 实测）
> Ruleset id `27354680`，`enforcement: active`，`bypass_actors: []`。
>
> ## 实测的拦截证据（2026-11-16，`required_status_checks` 尚在时）
>
> | 操作 | 结果 |
> | --- | --- |
> | 直推 `main` | 拒绝：`Changes must be made through a pull request` + `11 of 11 required status checks are expected` |
> | `git push --force origin HEAD:main` | 拒绝：同上 |
> | `git push origin --delete main` | 拒绝：`refusing to delete the current branch` |
> | 带失败 required check 的 PR 合并 | 拒绝：`the base branch policy prohibits the merge` |
> | docs-only PR | `mergeState: CLEAN`，可合并（详见第 4.1 节） |
>
> ## 一个必须记录的例外
>
> `bypass_actors: []` 阻止了普通账号，但**仓库管理员仍可用 `gh pr merge --admin` 绕过**
> （GitHub 对 admin 角色的既有行为，ruleset 不覆盖）。这是平台限制，不是配置缺陷；
> 任何要求「管理员也不能绕过」的表述都是不准确的。
>
> ## 4.1 为什么 only `required`，不列 11 个具体 job 名
>
> 第一版 ruleset 把 11 个 job 名逐条列为 required。实测发现这让 **docs-only PR 永久
> 无法合并**：
>
> ```
> docs-only PR 的 check 状态：
>   Frontend quality / Rust quality / Tauri build (…) / …  -> completed  skipped
>   required                                              -> completed  success
> mergeState: BLOCKED        （所有具体 job 都是 skipped，GitHub 不接受 skipped 为满足）
> ```
>
> `required` 是聚合器，它已经读取 `needs` 并对每个 job 的结论做裁决（docs-only 时
> 正确地判为通过）。把具体 job 名也列进去是**双重裁决**，而第二重不理解 docs-only。
>
> 收窄为只要求 `required` 后，同一 docs-only PR 变为 `mergeState: CLEAN`。

---

## 1. 为什么需要它

本仓库的 CI 已经能对 PR 给出裁决（`CI / required`、`Native GUI E2E` 的
`Driver isolation gate` / `macOS GUI E2E`），但裁决只有在**门禁会拦住合并**时才有意义。
没有 ruleset 时：

- 失败的 required check 不阻止合并；
- 可以直推 `main`，绕过全部检查；
- force-push 可以改写已发布的提交历史；
- 分支删除没有保护。

这三个都属于「检查存在但不生效」，与「没有检查」在风险上等价。

## 2. Required check 名称（精确字符串）

来自 `.github/workflows/*.yml` 的 job `name:`，**必须逐字匹配**，包括空格与括号。

### CI（`.github/workflows/ci.yml`）

| Check 名称 | 阻塞 | 说明 |
| --- | --- | --- |
| `CI / required` | ✅ | 聚合器；`scripts/verify-required-checks.mjs` 的契约 |
| `Frontend quality` | ✅ | |
| `Rust quality` | ✅ | |
| `Team Server quality` | ✅ | |
| `Repository gates (source size, evidence, script tests)` | ✅ | |
| `Dependency audit (npm)` | ✅ | |
| `cargo audit (blocking)` | ✅ | |
| `Team Server container` | ✅ | |
| `Tauri build (macos-latest)` | ✅ | matrix 展开后的具体名称 |
| `Tauri build (ubuntu-latest)` | ✅ | |
| `Tauri build (windows-latest)` | ✅ | |
| `zsh probe diagnostic` | ❌ | `continue-on-error: true`，AGENTS.md 明确其 success 不构成产品门禁 |
| `Test execution report` | ❌ | 只做报告，`continue-on-error: true` |

> `CI / required` 已经是聚合器：它读取 `needs` 并对每个 job 的结论做裁决。
> 因此 ruleset 里**只需要** `CI / required` 一个即能覆盖全部聚合 job；
> 逐一列出是冗余的，但**不是错误**——冗余的好处是某个 job 从聚合器里被误删时，
> 单独列出的 required check 仍会拦住。

### Native GUI E2E（`.github/workflows/native-gui-e2e.yml`）

| Check 名称 | 阻塞 | 说明 |
| --- | --- | --- |
| `Driver isolation gate` | ✅ | 确定性、快速，是安全契约 |
| `macOS GUI E2E` | ✅ | 唯一有稳定通过记录的平台 |
| `Windows GUI E2E (informational)` | ❌ | 无稳定通过记录前**不得**提升为阻塞 |
| `Linux GUI E2E (informational)` | ❌ | 同上 |

> GUI workflow 是 `paths:` 过滤触发的。一个只改 `docs/` 的 PR **不会**产生这两个 check。
> 若把 GUI check 加进「必需」，这类 PR 会永久 pending。正确的处理是：
> 要么在 ruleset 中不把它们列为必需，要么改 GUI workflow 为 always-run + job 内部
> 判定是否需要执行。**当前选择前者**，理由记录在此，避免「文档说要、实际没验证」。

## 3. Ruleset 精确配置

用 GitHub 的 repository ruleset（不是旧的 branch protection），因为它支持
`required_status_checks` 与 `bypass` 的显式列举。

```json
{
  "name": "main-protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [{ "context": "required" }]
      }
    }
  ]
}
```

### 每个字段的理由

| 字段 | 值 | 为什么 |
| --- | --- | --- |
| `bypass_actors` | `[]` | 空的 bypass 才是真门禁。留一个 `repository_admin` 等于给「紧急情况」留了永久后门，而紧急情况总是会发生 |
| `deletion` | 启用 | 防止 `git push origin --delete main` |
| `non_fast_forward` | 启用 | 禁止 force-push；AGENTS.md 记录了分支误删导致 PR 无法恢复的事故形状 |
| `required_approving_review_count` | `0` | 个人项目。设为 1 会让自己的 PR 无法合并（GitHub 不允许自我批准）。这个数值是**刻意的**，写在这里以免被误读为遗漏 |
| `dismiss_stale_reviews_on_push` | `true` | 新的提交让旧批准失效 |
| `required_review_thread_resolution` | `true` | 未解决的评论阻止合并 |
| `strict_required_status_checks_policy` | `true` | **关键**：要求分支在合并前与 `main` 同步。关掉它就会出现「在旧 base 上绿、合并后红」——这正是本仓库 Gate/证据链反复踩的坑 |

## 4. 应用与验证命令

```bash
# 1. 应用 ruleset（把上面 JSON 存为 ruleset.json）
gh api repos/baicie/terminal/rulesets \
  --method POST \
  --input ruleset.json

# 2. 验证它存在且生效
gh api repos/baicie/terminal/rulesets | jq '.[] | {id, name, enforcement}'

# 3. 验证规则内容与本文档一致
RULESET_ID=$(gh api repos/baicie/terminal/rulesets --jq '.[0].id')
gh api "repos/baicie/terminal/rulesets/${RULESET_ID}" \
  --jq '{enforcement, rules: [.rules[].type], checks: [.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context]}'
```

期望输出包含 `"enforcement": "active"`，`rules` 含
`deletion` / `non_fast_forward` / `pull_request` / `required_status_checks`，
且 `checks` 与第 2 节的 11 个名称逐字一致。

## 5. 一次失败 PR 的门禁验证

光看 ruleset 存在不够——要证明**一个失败的 required check 真的会阻止合并**。

```bash
# 1. 从一个干净 main 开一个分支，加一个必然失败的改动
git switch -c probe/required-check-blocks-merge main
printf '\n#[test]\nfn probe_must_fail() { assert_eq!(1, 2); }\n' >> src-tauri/src/lib.rs
git commit -am "probe: a change that fails Rust quality"
git push -u origin probe/required-check-blocks-merge

# 2. 开 PR
gh pr create --title "probe: required check must block merge" \
  --body "Verifies the ruleset blocks on a failing required check. DELETE THIS PR."

# 3. 等 CI 结束，确认 Rust quality 为 failure
gh pr checks --watch

# 4. 断言合并被阻止
gh pr merge --squash 2>&1 | tee /tmp/merge-attempt.log
grep -qiE "not mergeable|required status check|blocked" /tmp/merge-attempt.log \
  && echo "PASS: the failing required check blocked the merge" \
  || echo "FAIL: the merge was not blocked — the ruleset is not enforcing"

# 5. 清理
gh pr close --delete-branch
```

判定：第 4 步必须输出 `PASS`。在此之前，
`REQUIRED_CHECK_BLOCKS_MERGE=NOT_VERIFIED`。

## 6. 仍需人工决定的事项

| 项 | 现状 | 需要谁决定 |
| --- | --- | --- |
| 是否把 `Driver isolation gate` / `macOS GUI E2E` 列为 required | 当前**不列**，因 GUI workflow 是 path 过滤的 | 仓库所有者；若列为 required，需先把 GUI workflow 改为 always-run |
| 是否提高 `required_approving_review_count` | 当前 `0` | 仓库所有者（需要至少两名协作者） |
| 是否保留 `bypass_actors` 为空 | 当前为空 | 仓库所有者 |

这些都需要 GitHub 管理员权限。本文档不假装 Agent 拥有该权限。

