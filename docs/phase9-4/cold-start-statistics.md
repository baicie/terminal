# macOS 远程冷启动统计

> 日期：2026-11-03
> 工作流：`Cold-start stress`
> 目标：用同一 SHA、同一 runner 类型、同一 instrumented binary 重复采样，
> 明确失败率分母，不用一次成功掩盖历史失败。

## 1. 30 次样本

| 项 | 值 |
| --- | --- |
| run | `41601372583` |
| commit | `a1bd3b6` |
| binary SHA256 | `613aeab7156350546b92d9a194f1bd4922986d5e1a7166b53bf0e099195f4b9f` |
| 样本 | 30 |
| 成功 | 30 |
| 失败 | 0 |
| 成功率 | 100% |

| 耗时 | ms |
| --- | --- |
| spawn→ready 最小 | 3393 |
| 中位 | 3512 |
| p95 | 3819 |
| 最大 | 4858 |

阶段出现：`frontend-boot=30`、`ready=30`、`terminal-mounted=30`、
`session-create-requested=30`、`session-created=30`。

分段：

| 边 | 最小 / 中位 / p95 / 最大 (ms) |
| --- | --- |
| `ready → terminal-mounted` | 389 / 406 / 426 / 740 |
| `terminal-mounted → session-create-requested` | 56 / 87 / 104 / 255 |
| `session-create-requested → ssh-connect-start` | 1 / 2 / 6 / 12 |

## 2. 统计解释

0/30 的单侧 95% 置信上界约 **9.5%**（Clopper–Pearson 近似），不能用它宣称
“失败率低于 1%”。30 次全过只说明：在这台 runner、这个 SHA、这批样本里没有
复现历史 20%；如果真实失败率仍是 20%，30 次全过的概率约 `0.8^30 ≈ 0.12%`，
这反而提示环境或时间窗口发生了变化，而不是证明根因已修复。

为把 95% 上界压到约 1%，工作流已提高到 **300** 次；结果以
`Cold-start stress` run `41602408642` 为准，见下一节（完成后回写）。

## 3. 失败分类口径

每个失败样本按第一个未到达阶段分类：

| 分类 | 含义 |
| --- | --- |
| `webview-never-evaluated` | 连 `frontend-boot` 都没有 |
| `db-not-ready` | 有 `frontend-boot`，没有 `ready` |
| `terminal-not-mounted` | 有 `ready`，没有 `terminal-mounted` |
| `session-not-requested` | 已挂载，没有 `session-create-requested` |
| `ssh-path` | 已请求会话，未到 prompt marker |

失败样本的 `sample-*.json` 和（若采集到）`sample-*-webkit.log` 会随 artifact
上传；不会因为 job 汇总而丢弃。
