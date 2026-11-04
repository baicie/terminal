# macOS 远程冷启动统计

> 日期：2026-11-03（2026-11-04 追加 F 轮）
> 工作流：`Cold-start stress`
> 目标：用同一 SHA、同一 runner 类型、同一 instrumented binary 重复采样，
> 明确失败率分母，不用一次成功掩盖历史失败。

## 0. 事实更正（2026-11-03）

本文件此前把修复后的两次 300 次运行写成 **NOT_RUN**，这是错误的。两次运行都已真实
执行并保存完整 artifacts：

- run `41607668007`（commit `dd597eb`，293/300）
- run `41612216952`（commit `1a4e5ec`，291/300）

本轮重新下载并校验了三次运行的 artifact：每次均为 300 个 `sample-*.json`，编号
`1..300` 连续、无重复、无 JSON 损坏；失败样本 11 / 7 / 9 个，`summary.json` 与逐样本
文件一致。修复后的 300 次样本因此是 **已运行、已留证、未通过**，不是未运行。

3 秒 probe 预算对两次修复后运行均生效：workflow 用
`VITE_TERMINAL_SMOKE_BUILD=1` 构建 debug binary，`bootstrapConfigDeadlineMs()`
在该构建下返回 3000 ms；`bootstrap-gates` stage 出现在 300/300 个样本中。

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

为把 95% 上界压到约 1%，工作流已提高到 **300** 次；结果见下一节。

## 3. 300 次样本

| 项 | 值 |
| --- | --- |
| run | `41602408642` |
| commit | `8542ca522dca06ef58e6cf14f05b53a1d9d65cac` |
| commit 父提交 | `a1bd3b6b1ebe42878b16d15fbbf3c1403b1c1bd6` |
| instrumented build | `VITE_TERMINAL_SMOKE_BUILD=1`，debug，`--no-bundle` |
| probe 配置预算 | 旧 1000 ms（`44ae449` 尚未合入） |
| binary SHA256（artifact 记录） | `613aeab7156350546b92d9a194f1bd4922986d5e1a7166b53bf0e099195f4b9f` |
| 每样本成功结果内 SHA | 289/289 全部为该值；11 个失败样本未写 `binarySha256` |
| runner | `macos-latest` → `macos-26-arm64`，image `20261026.0455.2` |
| OS | macOS 26.6.2（`25G83`） |
| 每样本 readiness timeout | `10000` ms |
| 样本 | 300 |
| 成功 | 289 |
| 失败 | 11 |
| 点估计成功率 | 96.3% |
| 点估计失败率 | **3.7%** |
| Wilson 95% 失败率上界 | **约 6.4%** |

| 耗时 | ms |
| --- | --- |
| spawn→ready 最小 | 3529 |
| 中位 | 4602 |
| p95 | 6143 |
| 最大 | 8814 |

阶段出现：

```text
frontend-boot=300 ready=300 terminal-mounted=295
session-create-requested=294 session-created=294
```

失败分类：

| 分类 | 次数 |
| --- | --- |
| `terminal-not-mounted` | 5 |
| `ssh-request-not-entered-rust` | 5 |
| `session-not-requested` | 1 |

失败样本：`24, 49, 50, 56, 57, 109, 110, 230, 231, 241, 242`。
它们集中在几个时间窗口，而不是均匀分布，提示 runner 负载/调度窗口可能参与。

关键形态：

- 5 次 `ready` 后 9.5 秒内没有 `terminal-mounted`；`frontend-boot` 存在，
  所以不是 WebView 完全没加载。
- 1 次 `terminal-mounted@8756ms` 后才挂载，但已没时间请求会话。
- 5 次 `session-created` 已出现，但 10 秒内没有 prompt marker。

**重要限定**：这 300 次使用的是 `8542ca5`（probe 配置预算仍为 1s）。其中 5 次
`ssh-request-not-entered-rust` 可能受 `remotePrompt` gate 超时影响，不能全部
归因于 SSH 慢；
修复后的 `44ae449` 需要单独复测。无论原因如何，**3.7% 的失败率不满足
“高可靠 RC”要求**，不能因为 300 次比历史 20% 低就宣称已修复。

**修复后的局部验证**：`44ae449` 的 real-machine run `41605898002` 已通过
shell interaction 与 physical keyboard probe（这两步在修复前分别因 1s 配置预算
失败）。这证明 3s 预算覆盖了冷首 IPC，但**不是** 300 次冷启动复测。

## 3.1 修复后 A：run `41607668007`

| 项 | 值 |
| --- | --- |
| run | `41607668007` |
| commit | `dd597eb1972c3069c153cea024faa148c1dba048` |
| commit 父提交 | `510eae95d040055de45723b48e4431f26cef8aa4` |
| 与修复的关系 | `44ae449` 是祖先，重放链为 `44ae449 → … → 510eae9 → dd597eb` |
| instrumented build | `VITE_TERMINAL_SMOKE_BUILD=1`，debug，`--no-bundle` |
| probe 配置预算 | 3000 ms |
| binary SHA256 | `2bf151cb6b617a4b2a30d30427c1b6abc5f7622e706e1d584e22e6420cc81b91` |
| 每样本成功结果内 SHA | 293/293 全部为该值；7 个失败样本未写 `binarySha256` |
| runner | `macos-latest` → `macos-26-arm64`，image `20261026.0455.2` |
| OS | macOS 26.6.2（`25G83`） |
| 每样本 readiness timeout | `10000` ms |
| samples | 300（1..300 完整） |
| 成功 / 失败 | **293 / 7** |
| 点估计失败率 | **2.33%** |
| Wilson 95% 失败率上界（仅作参考） | 约 4.74% |
| spawn→ready 中位 / p95 / 最大 | 5095 / 6798 / 8201 ms |

阶段出现：`frontend-boot=300`、`ready=300`、`terminal-mounted=296`、
`session-create-requested=296`、`session-created=295`。

失败样本：`1, 69, 70, 208, 209, 252, 279`。

分类：`terminal-not-mounted` 4（69/208/252/279）；`ssh-request-not-entered-rust` 2
（70/209）；`ssh-tcp-pending` 1（1，`ssh-connect-start@4039ms` 后无 TCP 完成）。

## 3.2 修复后 B：run `41612216952`

| 项 | 值 |
| --- | --- |
| run | `41612216952` |
| commit | `1a4e5ec6d9211ee71eb91278e1d6c6a0602ce5c4` |
| commit 父提交 | `00ee17a4b1e27dce3572c8e344be3ca595bf5677` |
| 与修复的关系 | `44ae449` 是祖先，重放链为 `44ae449 → … → 00ee17a → 1a4e5ec` |
| instrumented build | `VITE_TERMINAL_SMOKE_BUILD=1`，debug，`--no-bundle` |
| probe 配置预算 | 3000 ms |
| binary SHA256 | `2bf151cb6b617a4b2a30d30427c1b6abc5f7622e706e1d584e22e6420cc81b91` |
| 每样本成功结果内 SHA | 291/291 全部为该值；9 个失败样本未写 `binarySha256` |
| runner | `macos-latest` → `macos-26-arm64`，image `20261026.0455.2` |
| OS | macOS 26.6.2（`25G83`） |
| 每样本 readiness timeout | `10000` ms |
| samples | 300（1..300 完整） |
| 成功 / 失败 | **291 / 9** |
| 点估计失败率 | **3.00%** |
| Wilson 95% 失败率上界（仅作参考） | 约 5.60% |
| spawn→ready 中位 / p95 / 最大 | 5061 / 6237 / 7600 ms |

阶段出现：`frontend-boot=300`、`ready=300`、`terminal-mounted=296`、
`session-create-requested=296`、`session-created=295`。

失败样本：`1, 106, 107, 190, 191, 201, 202, 293, 294`。

分类：`terminal-not-mounted` 4（106/190/201/293）；`ssh-request-not-entered-rust` 4
（107/191/202/294）；`ssh-shell-no-output` 1（1：`ssh-pty-ready@3365ms` 后 shell
首字节未出现）。

## 3.3 汇总

| run | commit | 构建 | 3s probe | 成功 / 失败 | 失败率 |
| --- | --- | --- | --- | --- | --- |
| `41602408642` | `8542ca5` | instrumented debug | 否 | 289 / 300 | 3.67% |
| `41607668007` | `dd597eb` | instrumented debug | 是 | 293 / 300 | 2.33% |
| `41612216952` | `1a4e5ec` | instrumented debug | 是 | 291 / 300 | 3.00% |

修复后合计 **584 / 600（97.33% 成功，2.67% 失败）**。这三个 run 不能合并成一个
独立伯努利样本：失败成对出现（见 §3.5），观测到的簇内相关性使 Wilson 上界偏乐观。
本节不使用 Wilson 数值宣称达标。

再加上产品修复后首轮 `41637922942` 的 294/300，修复后合计
**878 / 900（97.56% 成功，2.44% 失败）**。该合计同样**不能**按独立样本套用
Wilson 上限；失败仍然成对，见 §3.7。

## 3.4 失败样本的最终分类

| run | 分类 | 次数 | 失败样本 |
| --- | --- | --- | --- |
| `41602408642` | `terminal-not-mounted` | 5 | `24, 49, 109, 230, 241` |
| `41602408642` | `ssh-request-not-entered-rust` | 5 | `50, 57, 110, 231, 242` |
| `41602408642` | `session-not-requested` | 1 | `56` |
| `41607668007` | `terminal-not-mounted` | 4 | `69, 208, 252, 279` |
| `41607668007` | `ssh-request-not-entered-rust` | 2 | `70, 209` |
| `41607668007` | `ssh-tcp-pending` | 1 | `1` |
| `41612216952` | `terminal-not-mounted` | 4 | `106, 190, 201, 293` |
| `41612216952` | `ssh-request-not-entered-rust` | 4 | `107, 191, 202, 294` |
| `41612216952` | `ssh-shell-no-output` | 1 | `1` |

两次修复后运行的 SSH 失败里，连 `ssh-connect-start` 都没有出现的占 A 2/3、B 4/5。
它们不是认证失败，也不是 PTY 失败；产品已请求会话，但 Rust 首个 SSH stage 没有写进
时间线。旧分类把它们全部叫 `ssh-path`，掩盖了这一点。

## 3.5 连续失败对

失败不是独立散点，而是固定成对出现，且中间恰好执行一次 `log show`：

| run | 连续失败对 | 对间间隔 |
| --- | --- | --- |
| `41607668007` | `69/70`、`208/209` | 14.60 s / 12.55 s |
| `41612216952` | `106/107`、`190/191`、`201/202`、`293/294` | 14.14 / 12.69 / 12.57 / 12.75 s |

正常样本之间的间隔约 5–6 s；失败对内部及失败后的间隔约 12–15 s，与 workflow 执行
`log show` 的窗口吻合。必须把它当作测量/资源隔离问题调查，不能按独立随机事件计算。

## 3.6 样本完整性

三次 run 的 artifact 均校验：

- 300 个 `sample-*.json`，编号 `1..300` 连续；
- 无重复编号、无缺失文件、无 JSON 解析失败；
- 成功样本的 `binarySha256` 与 artifact 中 `cold-start-binary.sha256` 完全一致；
- 失败样本没有 `binarySha256` 字段（旧 stopwatch 只把 SHA 写进成功结果）；
- 旧 stopwatch 的成功结果没有 `timeoutMs`；本文件只用失败 JSON 的 `timeoutMs`
  和 workflow env 证明三次均为 10000 ms，不伪称每个成功样本都自证了该值。

## 3.7 修复后 C：run `41637922942`（产品修复后首轮）

这一轮在 `0ba671e` 上运行，包含本地 fallback / tab 缺失两个产品修复，以及新的
样本完整性门禁。**它仍不是一次通过**，但失败从 7–9 个降到 6 个。

| 项 | 值 |
| --- | --- |
| run | `41637922942` |
| commit | `0ba671eaa576f75f28983b35b285e694f3b13546` |
| commit 父提交 | `3cd02c1fdff38e900bd3a99a0184e5369a7abf48`（来自 GitHub commit API；workflow checkout 为 depth=1，样本内 `sourceParentSha` 为 `null`） |
| instrumented build | `VITE_TERMINAL_SMOKE_BUILD=1`，debug，`--no-bundle` |
| probe 配置预算 | 3000 ms |
| binary SHA256 | `2a9351e822b5d6f2cb2df98527a58e92aff9c85b582dfec6330b7cdddd62c7b9` |
| 每样本成功结果内 SHA | 294/294 全部为该值；6 个失败样本按旧路径未写 SHA（新路径会写） |
| runner | GitHub Actions `macos-26-arm64`；样本内 `cpuCount=3`、`memoryBytes=7516192768`、macOS 26.6.2 |
| 每样本 readiness timeout | `10000` ms |
| samples | 300（1..300 完整） |
| 成功 / 失败 | **294 / 6** |
| 点估计失败率 | **2.00%** |
| Wilson 95% 失败率上界（仅作参考） | 约 4.29% |
| spawn→ready 最小 / 中位 / p95 / 最大 | 3186 / 4410 / 5742 / 8763 ms |
| 阶段出现 | `frontend-boot=300`、`ready=300`、`terminal-mounted=297`、`session-requested=297`、`session-created=297` |

失败样本：`189, 190, 260, 261, 287, 288`。

| 分类 | 次数 | 失败样本 |
| --- | --- | --- |
| `terminal-not-mounted` | 3 | `189, 260, 287` |
| `ssh-request-not-entered-rust` | 3 | `190, 261, 288` |

成对形态仍在：`189/190`、`260/261`、`287/288`，对间间隔分别为 11.00 s、10.86 s、
10.93 s；正常样本约 5–6 s。这说明修复没有消除成对失败，只是把每轮样本数从 7–9
降到 6。

**测量缺陷暴露**：本轮新增的 `Record runner and sample provenance` 步骤因 CommonJS
`require` 与 top-level await 混用而失败（exit 1），导致即使样本与 summary 都已完整，
job 仍在 provenance 步骤变红。该脚本已在后续提交修复，并本地用同一 artifact 验证。
这不是产品失败，不能算作一次可靠性的通过或失败；但**样本本身的统计仍然有效**。

## 3.8 修复后 D：run `41644270883`（第二次产品修复后）

这一轮在 `fda76ae` 上运行，包含 provenance 脚本修复。**结果更差**：

| 项 | 值 |
| --- | --- |
| run | `41644270883` |
| commit | `fda76aeae7ccc41be997f38774327a4327b25c35` |
| binary SHA256 | `2a9351e822b5d6f2cb2df98527a58e92aff9c85b582dfec6330b7cdddd62c7b9` |
| samples | 300（1..300 完整） |
| 成功 / 失败 | **282 / 18** |
| 点估计失败率 | **6.00%** |
| Wilson 95% 失败率上界（仅作参考） | 约 9.28% |
| spawn→ready 最小 / 中位 / p95 / 最大 | 3913 / 4892 / 6123 / 9973 ms |
| 阶段出现 | `frontend-boot=300`、`ready=300`、`terminal-mounted=291`、`session-requested=290`、`session-created=290` |

失败样本：`52, 61, 62, 112, 113, 143, 144, 162, 163, 208, 209, 211, 212, 221, 222, 243, 244, 263`。

| 分类 | 次数 | 失败样本 |
| --- | --- | --- |
| `terminal-not-mounted` | 9 | `52, 112, 143, 162, 208, 211, 221, 243, 263` |
| `ssh-request-not-entered-rust` | 8 | `62, 113, 144, 163, 209, 212, 222, 244` |
| `session-not-requested` | 1 | `61`（`terminal-mounted@7888ms` 后无会话请求） |

失败形态仍是“前一条挂载失败、后一条无 SSH 阶段”的成对/连续窗口：`208/209`、
`211/212`、`221/222`、`243/244`，以及 `52`、`61/62`、`112/113`、`143/144`、
`162/163`、`263`。正常样本间隔约 5–7 秒，失败对内部约 11 秒。

**本轮测量缺陷（已修，未用于本轮结论）**：

- 样本内 `sourceSha` 全为 `null`：`gitValue` 的 cwd 多退了一层目录；已改回仓库根。
- `cold-start-build.json` 的 `instrumentedBuild` 为 `false`，与 provenance 硬编码的
  `true` 自相矛盾：workflow 的 `VITE_TERMINAL_SMOKE_BUILD` 只写在构建命令前，
  Node 步骤读不到；已提升为 job env。
- 所有失败样本的 `sample-*-webkit.log` 都是 0 字节：`log show` 不接受
  ISO `T`/小数秒，且 stderr 被 `|| true` 吞掉；已改成 `Y-M-D H:m:s` 并加
  `--info --debug`，provenance 现在会因空日志直接失败。

**不能用本轮证明任何修复有效**。它只证明：在产品修复后、测量脚本仍有缺陷的状态下，
失败率仍为 6%，高于修复前 3.67% 和修复后 A/B 的 2.33%/3.00%。

### 3.9 已确认的确定性挂载缺陷

第二轮失败暴露了两个可复现的 React 生命周期缺陷：

1. `useTerminalInstance` 的挂载 effect 依赖 `[tabId, workspaceId]`。工作区恢复时
   容器可以先渲染、`containerRef.current` 仍为空，effect 直接 return；tab 随后恢复
   但依赖不变，effect 不会重跑，xterm 永远不会创建。这正是 `terminal-not-mounted`
   的“ready 后 9 秒无挂载”形态。
2. `term.open()` 抛错会直接跳出 effect，React 报未捕获错误；对探针而言与“容器从未
   出现”完全同形。

已在 `0ba671e` 之后的提交修复：`tabAvailable` 参与 effect 依赖；`term.open()` 的
异常被记录为 `terminal-open-failed` 并保留可观测 surface；新增
`terminal-open-start` / `terminal-open-done` / `terminal-open-failed` 三个阶段。
真实 300 次复测见 §3.10；不能把上述失败计为已消除。

## 3.10 修复后 E：run `41674133535`（late-tab + open 证据修复后）

这是目前唯一一轮“测量链完整”的产品修复后 300 次运行：样本内源码 SHA、二进制 SHA、
clean 状态、probe timeout 都齐全，WebKit 日志文件非空（虽然只含表头，见下）。

| 项 | 值 |
| --- | --- |
| run | `41674133535` |
| commit | `b5c7f4695a3430e6f6ba0d0f4ba06c8a5fa99eb3` |
| commit 父提交 | `fda76aeae7ccc41be997f38774327a4327b25c35` |
| instrumented build | `VITE_TERMINAL_SMOKE_BUILD=1`，debug，`--no-bundle` |
| probe 配置预算 | 3000 ms |
| binary SHA256 | `d843a2f6d011ca18222910e3dc55db0294bce09b2d311252768d5a24e6922751` |
| 每样本 SHA | 300/300 均为该值 |
| runner | `macos-26-arm64`，3 vCPU / 7 GiB，macOS 26.6.2 |
| 每样本 readiness timeout | `10000` ms |
| samples | 300（1..300 完整） |
| 成功 / 失败 | **294 / 6** |
| 点估计失败率 | **2.00%** |
| Wilson 95% 失败率上界（仅作参考） | 约 4.29% |
| spawn→ready 最小 / 中位 / p95 / 最大 | 3605 / 4677 / 5978 / 7124 ms |
| 阶段出现 | `frontend-boot=300`、`ready=300`、`terminal-mounted=297`、`session-requested=297`、`session-created=296` |
| mount evidence | `remote=295`、`local=2`、`unknown=3` |

失败样本：`1, 122, 194, 195, 292, 293`。

| 分类 | 次数 | 失败样本 | 最终状态 |
| --- | --- | --- | --- |
| `terminal-not-mounted` | 3 | `122, 194, 292` | `ready` 后没有 `terminal-open-start`，即 xterm 构造/挂载根本没有开始 |
| `ssh-request-not-entered-rust` | 2 | `195, 293` | `terminal-open-*` 完整，但 detail 明确是 `local-...@workspace@local`，即本地 fallback 会话 |
| `ssh-prompt-marker-missing` | 1 | `1` | SSH 全部到 `ssh-startup-settle`，没有 `ssh-startup-write-begin`，prompt marker 未完成 |

关键结论：

- 两个 `ssh-request-not-entered-rust` 不再需要猜测：`terminal-mounted` detail 是
  `local`，证明这是本地 fallback 抢占，不是 SSH 认证/PTY 故障。
- 三个 `terminal-not-mounted` 连 `terminal-open-start` 都没有，说明问题发生在
  `useTerminalInstance` effect 之外（tab/容器尚未出现），不是 `term.open()` 抛错；
  之前修的 late-tab 依赖只覆盖“effect 已进入但 ref 为空”的路径。
- `terminal-open-*` 阶段在 297 个挂载样本中出现，说明新诊断链有效。
- 6 个失败仍成对/相邻：`194/195`、`292/293`，正常样本间隔 5–6 秒，失败对间隔
  11–12 秒；`1` 是首样本，`122` 是单条第 122 个样本。
- 失败样本的 WebKit 日志只有 44 字节表头。这满足 provenance 的“非空”门禁，但
  仍不足以证明 WebKit 子进程状态；剩余根因必须靠下一轮更聚焦的日志采集。

**判定**：294/300 比前几轮好，但仍高于 1% 的 RC 目标，且仍有 3 个未挂载 + 2 个
本地 fallback + 1 个 SSH prompt 失败，不能称为稳定。

## 3.11 修复后 F：run `41683645429`（WebKit 日志时区修复后）

这是目前**点估计最低**的一轮，也是第一次拿到失败样本的非空 WebKit 日志。它仍然是
一轮样本，不足以单独证明“稳定低于 1%”。

| 项 | 值 |
| --- | --- |
| run | `41683645429` |
| commit | `760096341d0273c3833a5244ff2cb522fbcdeb08` |
| workflow | `Cold-start stress`（push 触发） |
| instrumented build | `VITE_TERMINAL_SMOKE_BUILD=1`，debug，`--no-bundle` |
| build provenance | `cold-start-build.json`：`instrumentedBuild=true`、`buildKind=debug`、`bundled=false`、Node `v24.16.0`、pnpm `10.34.3` |
| binary SHA256 | `d843a2f6d011ca18222910e3dc55db0294bce09b2d311252768d5a24e6922751`（artifact `cold-start-binary.sha256`） |
| runner | `macos-26-arm64`，3 vCPU / 7 GiB，macOS 26.6.2 |
| samples | 300（1..300 完整，`expectedSamples=300`） |
| 成功 / 失败 | **298 / 2** |
| 点估计失败率 | **0.67%** |
| Wilson 95% 区间（仅作参考） | 约 **[0.18%, 2.40%]** |
| spawn→ready 最小 / 中位 / p95 / 最大 | 3200 / 3930 / 4365 / 7174 ms |
| 阶段出现 | `frontend-boot=300`、`ready=300`、`terminal-mounted=300`、`session-requested=300`、`session-created=300` |
| mount evidence | `remote=298`、`local=2` |

失败样本：**228、229**（相邻）。

| 分类 | 次数 | 失败样本 | 最终状态 |
| --- | --- | --- | --- |
| `ssh-request-not-entered-rust` | 2 | `228, 229` | `terminal-mounted` detail 均为 `local-...@remote-cold-workspace@local`，未进入 SSH 路径 |

关键结论：

- `terminal-mounted=300`：E 轮的 3 个 `terminal-not-mounted` 在本轮没有复现；
  late-tab 修复至少在这一轮有效。
- 298 个成功样本全部挂载 `remote`，2 个失败样本全部挂载 `local`。本地 fallback
  与失败完全重合，说明剩余失败不是 SSH 握手/认证/PTY 问题。
- 样本 228：`ready@434ms` → `terminal-open-start@8436ms`（detail `local`）→
  `session-created@8549ms`；从 frontend 启动到挂载有约 8 秒延迟。
- 样本 229：`ready@440ms` → `terminal-open-start@1107ms`（detail `local`）→
  `session-created@1211ms`；挂载很快，但探针在 10 秒内没有等到远程 prompt。
- **统计边界**：0.67% 只是点估计。2/300 的 Wilson 95% 上界约 2.40%，不能用这一轮
  宣称“统计上稳定低于 1%”；至少需要多轮样本与预先定义的置信口径。

### 3.11.1 WebKit 日志（首次非空）

`7600963` 把 `log show` 的时间参数从“手工加 8 小时”改为“epoch → `date -r` 本地
时间”后，失败样本的日志不再只有 44 字节表头：

| 样本 | 日志行数 | 关键异常 |
| --- | --- | --- |
| 228 | 2112 | `WebContent[62249] CRASHSTRING: rdar://problem/28724618 Couldn't connect to launchservicesd.`（17:48:26.554） |
| 229 | 2048 | `WebContent[62671] CRASHSTRING: rdar://problem/28724618 Couldn't connect to launchservicesd.`（17:48:38.397） |

两个失败样本都出现同一条 `CRASHSTRING`，并且都伴随新的 WebProcess PID
（228：62249 → 62597；229：62671 → 62931）与数秒的近静默窗口。

**不能据此判定 WebKit 崩溃**：

- 同一 PID 在 `CRASHSTRING` 之后仍有日志输出，不能证明进程真实退出；
- 工作流只为失败样本采集 WebKit 日志，没有成功样本对照，无法证明该串只在失败时出现；
- `CRASHSTRING` 是 launchservices 的错误文本，不是 WebKit 的 `processDidExit` /
  `didCrash` 事件。

因此本轮只把它记为**待验证假设**，不写成已确认根因。下一轮必须加同一 runner、
同一构建、相近时间窗口的成功样本对照，并记录 PID 变化、导航失败回调与进程退出事件。

### 3.11.2 本轮 provenance 缺口

- 失败样本 JSON 没有 `binarySha256`（成功样本有），汇总中的失败行因此显示
  `binarySha256=unknown`；构建身份只能从 artifact 的 `cold-start-binary.sha256` 取得。
- 所有样本的 `sourceParentSha` 都是 `null`：CI checkout 为 `depth=1`，`HEAD^` 不存在。
- 这两项不改变 298/300 的统计有效性，但削弱了“失败样本 ↔ 构建身份”的逐样本绑定，
  已列入 Phase 9.4.2 的 P1 修复。

### 3.11.3 最终判读（2026-11-04，Phase 9.4.2）

F 轮两个失败不是 WebKit 崩溃，也不是两个独立的 SSH 故障：

1. **样本 228**：本地 tab id `local-1793728115282` 的时间戳是
   `17:48:35.282Z`，frontend boot 约 `17:48:27.05`，间隔约 8.2 秒。生产
   `terminal-bootstrap.tsx` 把 8 秒的 App chunk deadline 错当成了
   `startupTerminalFallbackAt`，所以本地 fallback 在 8 秒而不是 2 秒才触发。
   这一轮里 recovery 没有在 8 秒内恢复远程布局，具体停在哪一步由新加的
   `workspace-load-*` / `layout-load-*` / `host-load-*` 分段 trace 在下一轮回答。
2. **样本 229**：它复用了样本 228 的本地 tab id
   `local-1793728115282`，而该 id 的生成时间早于样本 229 的 `capturedAt`。
   WKWebView 的 localStorage 在真实用户目录
   `~/Library/WebKit/com.baicie.termius`，不受采样进程 `HOME` 重定向影响；
   recovery journal 的 workspaceId 又是固定的 `remote-cold-workspace`。
   样本 228 的 local-only journal 因此被样本 229 继承，并遮蔽了 SQLite 里的
   remote 布局。这是**跨样本污染**，不是产品 SSH 路径失败。

修复与验证方案见 `docs/phase9-4/phase9-4-2-fallback-arbitration.md`。在真实
runner 复测之前，本条仍不能写成“已修复”。

## 3.12 修复后 G 轮：run `41838269784`（2026-11-04）

这是 Phase 9.4.2 修复后的第一轮真实 300 次样本，也是目前唯一一轮
`RELIABILITY_PASS`。

| 项 | 值 |
| --- | --- |
| run | `41838269784` |
| commit | `ac010913dc0e60c8f4af58c2db093edf4e02921a` |
| 父提交 | `760096341d0273c3833a5244ff2cb522fbcdeb08`（`sourceParentShaSource=git`） |
| binary SHA256 | `0eb823fa8d366e070ac7cb6bd0810fd64a273ac23f73765aaf6e4f9f416eac8c` |
| samples | 300（1..300 完整） |
| 成功 / 失败 | **300 / 0** |
| 成功率 | **100.0%** |
| verdict | **RELIABILITY_PASS** |
| spawn→ready 最小 / 中位 / p95 / 最大 | 2667 / **3412** / **3722** / 4021 ms |
| 阶段出现 | `frontend-boot=300`、`ready=300`、`terminal-mounted=300`、`session-requested=300`、`session-created=300` |
| mount evidence | **`remote=300`** |

严格汇总门禁（`--require-provenance`、expected binary/source/timeout、
`--require-mount remote`）全部通过：300 个样本的 `sourceSha` 都是 `ac01091`，
`sourceParentSha` 都是 `7600963`，`binarySha256` 都是 `0eb823fa…`，
`timeoutMs` 都是 10000。

**跨样本隔离**：`Verify cross-sample isolation` 在真实 runner 上
**ISOLATION_PASS**；强制超时样本 fixture 端口 `49195`，紧随的正常样本端口
`49199`，临时目录已删除。

**WebKit 控制组**：前 2 个成功样本也采集了日志：

| 样本 | 行数 | `crashStrings` | `processExits` |
| --- | --- | --- | --- |
| 1 | 2299 | 1 | 0 |
| 2 | 2215 | 1 | 0 |

`CRASHSTRING: Couldn't connect to launchservicesd` 在**成功样本**里同样出现，
且没有进程退出事件，因此它不是失败信号，也不是 F 轮根因。

**统计边界**：0/300 的 Wilson 95% 上界约 **1.26%**（单侧 Clopper–Pearson 约
1.0%）。这只是单轮结果；不能因为这一轮 300/300 就宣布长期稳定。

## 3.13 第二轮：run `41843065808`（2026-11-04，artifact 复算）

第一次第二轮尝试 `41841717975` 在隔离门禁的 control 上遇到
`ssh-prompt-marker-missing`，300 样本未执行（见 Issue #189）。门禁解耦后重跑：

| 项 | 值 |
| --- | --- |
| run | `41843065808` |
| commit | `2db95aa633d0e2f950b0c0fd08fe472b89e639ea` |
| binary SHA256 | `0eb823fa8d366e070ac7cb6bd0810fd64a273ac23f73765aaf6e4f9f416eac8c`（与 G 轮相同） |
| samples | 300（1..300 完整） |
| 成功 / 失败 | **300 / 0** |
| verdict（artifact 复算） | **RELIABILITY_PASS** |
| spawn→ready 最小 / 中位 / p95 / 最大 | 4023 / 4978 / 6393 / 8635 ms |
| 首次挂载 | `remote=299`、`local=1` |
| **最终挂载** | **`remote=300`** |

**样本 37 是本轮唯一的 local 首次挂载，但不是失败**：

- `workspace-load-start@365ms`；
- `workspace-load-failed@3262ms`，原因是 **Workspace recovery timed out**（3 秒上限）；
- 重试 `recovery-2` 启动；`fallback-defer-expired@4022ms` 后本地 fallback 打开；
- `terminal-mounted local@5010/5066ms`；
- `layout-load-done@5101ms` → `restore-layout-committed@5119ms`
  （`reason=replaced-startup-fallback`）→ `terminal-mounted remote@5124ms`；
- 远程 marker `REMOTE_COLD_MARKER` 已写入，`markerReady=true`。

也就是说，本地 fallback 只存在约 1.1 秒，随后被保存的远程布局替换；最终状态是
remote。旧汇总器用**第一次** `terminal-mounted` 判定 `--require-mount remote`，
把这一样本判成失败，导致 workflow 在 `Summarize samples` 以 exit 3 变红。
用**最后一次**挂载复算 artifact 后是 **300/300 `RELIABILITY_PASS`**。

`mountEvidence` 现在同时报告首次与最终挂载：首次用于失败分析，最终用于
`--require-mount remote` 门禁。workflow 这一轮的红色状态保留在 GitHub 上，不
改写为绿；修复后的 clean round 将另行运行。

## 4. 失败分类口径

每个失败样本按第一个未到达阶段分类：

| 分类 | 含义 |
| --- | --- |
| `webview-never-evaluated` | 连 `frontend-boot` 都没有 |
| `db-not-ready` | 有 `frontend-boot`，没有 `ready` |
| `terminal-not-mounted` | 有 `ready`，没有 `terminal-mounted` |
| `session-not-requested` | 已挂载，没有 `session-create-requested` |
| `ssh-request-not-entered-rust` | 已请求会话，但没有 `ssh-connect-start` |
| `ssh-tcp-pending` | `ssh-connect-start` 后未完成 TCP/握手 |
| `ssh-auth-pending` | TCP/握手完成，未完成认证 |
| `ssh-pty-pending` | 认证完成，PTY/shell 未就绪 |
| `ssh-shell-no-output` | PTY 就绪，shell 未输出首字节 |
| `ssh-prompt-marker-missing` | shell 已输出，prompt marker 未完成 |

失败样本的 `sample-*.json` 和（若采集到）`sample-*-webkit.log` 会随 artifact
上传；不会因为 job 汇总而丢弃。
