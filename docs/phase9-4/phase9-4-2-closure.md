# Phase 9.4.2 — Engineering Closure

> 日期：2026-11-05
> 结论：`PHASE_9_4_2_ENGINEERING_CLOSED = YES`
> 这不代表 RC 或 Release 就绪。

## 1. 交付快照

| 项 | 值 |
| --- | --- |
| 分支 | `feat/phase9-4-rc-reliability` |
| 源码/证据提交 | `d4a972a513febc1785821bfc9c0b7e1a41e1f391` |
| 最终文档提交 | `a7a65bcfc0c0ded69c273dbab855ba744834d88c`（docs-only） |
| 压测 run（G） | `41838269784`：300/300，100%，`RELIABILITY_PASS` |
| 压测 run（第二轮 artifact） | `41843065808`：300/300（最终挂载 remote 300，1 个首次 local 在 5124ms 被 remote 替换） |
| 压测 run（clean） | `41850205866`：300/300，首次与最终均 `remote=300` |
| 合计 | **900 样本，0 个最终 local** |
| 真实矩阵 | `41841781191`：macOS / Linux / Windows **3/3 success** |
| 六份 evidence | 指纹 `d14fb1d1…`，debug `0eb823fa…`，release `a1cf8181…`，门禁 **0 problem** |
| 源码/证据 CI | `41850097122`（`d4a972a`）：**11/11 success** |
| 最终 HEAD PR CI | `41855859730`（`a7a65bc`）：10/11，macOS job 连续三次排队 15 分钟后被 GitHub runner 容量取消 |

## 2. 原始失败/取消记录（不美化）

- `41841717975`：第二轮第一次尝试，隔离门禁的 control 样本在
  `ssh-prompt-marker-missing` 处失败，300 样本未执行。该 control 已挂载 remote、
  进入 SSH、拿到 shell 首字节；问题在门禁与控制样本 readiness 耦合，不是隔离污染。
- `41843065808`：第二轮重跑，300 样本完成；workflow 因 `--require-mount remote`
  使用**第一次** `terminal-mounted` 把样本 37 判成 `37=local`，在 `Summarize
  samples` 以 exit 3 变红。artifact 用最终挂载判据复算为 300/300。该红色状态保留。
- `41855859730`：最终 HEAD 的 PR CI。`Tauri build (macos-latest)` 在
  `15:15:39` 开始排队，`15:30:41` 被取消；attempt 2 `15:34:02 → 15:49:04`
  同样被取消；attempt 3 `15:50:49 → 16:05` 同样被取消。其余 10 个 job 全绿。
  同一份源码 `d4a972a` 的 push CI 中 macOS 构建已成功（`41850097122` 11/11），
  因此这是 runner 容量限制，不是编译失败；但 **`a7a65bc` 没有获得完整绿色 CI**。

## 3. 代码/文档证据

- `ac01091`：恢复/fallback 状态机、分段 trace、provenance、每样本 WebKit 隔离。
- `2db95aa`：隔离门禁与 control readiness 解耦。
- `d4a972a`：最终挂载判据、六份 evidence、Phase 9.4 文档。
- `a7a65bc`：900 样本与最终判定回写。
- 详细根因与修复：`docs/phase9-4/phase9-4-2-fallback-arbitration.md`。
- 统计明细：`docs/phase9-4/cold-start-statistics.md`。

## 4. 判定

| 判定 | 结果 |
| --- | --- |
| `PHASE_9_4_2_ENGINEERING_CLOSED` | **YES**（无新的产品缺陷；冷启动/隔离/证据/CI 工程链闭合） |
| `READY_FOR_RC` | **NO**（跨版本升级、硬件矩阵、签名、身份迁移等未闭合） |
| `READY_FOR_RELEASE` | **NO** |

不再重复 300 次冷启动压测，也不再无限重试不可用的 GitHub runner。PR #6/#7 的
集成方案见 `docs/phase9-5/design.md`。
