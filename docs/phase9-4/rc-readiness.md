# Phase 9.4 — RC Readiness

> 日期：2026-11-03（2026-11-04 追加 F 轮与 Phase 9.4.2 工作项）
> 基线：`47b9a6e`（stacked branch，PR #6 尚未合并）

## 0. 最终验收快照（2026-11-04）

| 项 | 值 |
| --- | --- |
| 分支 HEAD | `ac010913dc0e60c8f4af58c2db093edf4e02921a` |
| PR #7 | OPEN / Draft，base 仍为 `feat/phase9-2-sync-security-hardening` |
| PR #6 | OPEN / Draft，Phase 9.3.2 条件已满足，待人工合并；main 未变更 |
| 最新 CI | run `41838270083`：**10 success / 1 failure** |
| CI 唯一失败 | `Repository gates` 的 `Verification evidence matches this checkout`：当前源码指纹 `d14fb1d1…`，证据仍为 `6d7536e7…`（7 problem） |
| CI 三平台构建 | macOS / Windows / Linux 均 success |
| 冷启动 F 轮 | run `41683645429`（`7600963`）：**298/300，0.67%** |
| **冷启动 G 轮（9.4.2 修复后）** | run `41838269784`（`ac01091`）：**300/300，100%，RELIABILITY_PASS**；`remote=300`，中位 3412 ms / p95 3722 ms |
| 跨样本隔离 | run `41838269784`：**ISOLATION_PASS**（真实 runner） |
| 第二轮压力 | run `41843065808`（`2db95aa`）：artifact 复算 **300/300 `RELIABILITY_PASS`**；首次挂载 remote 299 / local 1（样本 37），最终挂载 **remote 300**。workflow 因旧的“首次挂载”门禁变红，门禁已改为最终挂载；clean round 待重跑 |
| 本地门禁 | 前端 **153 文件 / 1393 项**、冷启动相关脚本 **83 项**、source-size **568 文件**、typecheck/ESLint/actionlint 通过 |

六份验收证据必须由 `real-machine-matrix` 在**最终冻结源码**上重采，不能改旧 manifest；
本轮不自动合并、不打 tag、不发布。

## 0.1 Phase 9.4.2 代码修复（2026-11-04）

F 轮的两个失败已定位为两个确定性缺陷，不是 WebKit 崩溃：

| 缺陷 | 证据 | 状态 |
| --- | --- | --- |
| App chunk 的 8 秒 deadline 被错传成 terminal fallback deadline | 样本 228 的 `local-1793728115282` 生成于 `17:48:35.282Z`，frontend boot 约 `17:48:27.05`，间隔 8.2 秒 | **CODE FIXED**；改为 attempt + 2 秒 |
| 共享 WKWebView localStorage 的 local-only recovery journal 污染下一个样本 | 样本 228/229 的 `terminal-open-start` detail 是同一个 tab id；该 id 早于样本 229 的 `capturedAt` | **CODE + WORKFLOW FIXED**；journal 不再遮蔽 remote 布局，每个样本前清空 WebKit 数据 |
| layout 读取失败被吞、workspace/layout 无超时、`loadHosts` generation 竞态 | 代码审查 + 现有测试 | **CODE FIXED**；抛错重试、3 秒超时、host 快照不可用时保留远程 tab |
| fallback 全有或全无替换、程序化写入误判为用户接管 | 代码审查 | **CODE FIXED**；用户输入过的 fallback 与远程布局合并，`wasUserInput` 区分来源 |

本地门禁：前端 **153 文件 / 1393 项**、冷启动相关脚本 **83 项**、typecheck、ESLint、
source-size **568 文件**、actionlint 通过。新增 `startup-recovery-arbiter` 状态机、
分段 trace、provenance fail-closed、跨样本隔离验证。本机真实回归 **10/10 remote、
0 local**（中位 3475 ms），隔离验证 **ISOLATION_PASS**；但二进制来自未提交工作树
（`sourceTreeClean=false`），不是 CI 证据。

**真实 runner G 轮（run `41838269784`，`ac01091`）**：**300/300，100%，
`RELIABILITY_PASS`**；`remote=300`，0 个 local；中位 3412 ms / p95 3722 ms；
严格 provenance 汇总通过；`Verify cross-sample isolation` success；控制组成功样本
也出现 1 次 `CRASHSTRING`、0 个进程退出，证明该字符串不是失败信号。

**真实矩阵（run `41841781191`，`ac01091`）**：macOS / Linux / Windows
**3/3 success**；六份证据已安装，`check-verification-evidence.mjs` 报
**0 problem**；debug `0eb823fa…`、release `a1cf8181…`。

**第二轮（run `41843065808`，`2db95aa`）**：artifact 用最终挂载判据复算为
**300/300 `RELIABILITY_PASS`**；首次挂载 remote 299 / local 1（样本 37 的临时
fallback，5124 ms 被 remote 替换），最终挂载 remote 300。workflow 因旧的
“首次挂载”门禁为红，该红色状态保留；修复后 clean round 待重跑。
**在 clean round 与最终 CI 11/11 出现之前，READY_FOR_RC 仍为否。**

详见 `docs/phase9-4/phase9-4-2-fallback-arbitration.md`。

## 1. 逐项状态

| 项 | 状态 | 证据 / 原因 |
| --- | --- | --- |
| macOS 冷启动诊断链 | **PASS** | `terminal-mounted`、串行 trace、30/30 阶段完整 |
| macOS 冷启动 20% 根因 | **NOT_RUN** | 30 次未复现；历史失败 Unified Log 未采到 |
| 修复前 300 次冷启动样本 | **FAIL（3.67%）** | run `41602408642`：289/300 |
| 修复后 A 300 次冷启动样本 | **FAIL（2.33%）** | run `41607668007`：293/300 |
| 修复后 B 300 次冷启动样本 | **FAIL（3.00%）** | run `41612216952`：291/300 |
| 修复后 C 300 次冷启动样本 | **FAIL（2.00%）** | run `41637922942`：294/300；失败仍为 3 对 |
| 修复后 D 300 次冷启动样本 | **FAIL（6.00%）** | run `41644270883`：282/300；18 个失败，测量脚本还有缺陷 |
| 修复后 E 300 次冷启动样本 | **FAIL（2.00%）** | run `41674133535`：294/300；3 未挂载 / 2 本地 fallback / 1 prompt marker |
| 修复后 F 300 次冷启动样本 | **FAIL（0.67%）** | run `41683645429`：298/300；2 个失败均为本地 fallback；点估计首次低于 1%，但 Wilson 95% 上界约 2.40%，且只有一轮 |
| **修复后 G 300 次冷启动样本** | **PASS（100%）** | run `41838269784`：300/300，`remote=300`，`RELIABILITY_PASS`；单轮 0/300 的 Wilson 95% 上界约 1.26%，第二轮进行中 |
| 本地 fallback 抢占恢复的远程 tab | **PASS（G 轮）** | 300 个成功样本全部 `remote`，0 个 local；228 = 8 秒 deadline 错传，229 = journal 污染，均已修 |
| 跨样本隔离（真实 runner） | **PASS** | run `41838269784` 的 `Verify cross-sample isolation`：forced port 49195 / control 49199，临时目录已删除 |
| tab 缺失时误建本地 PTY | **FIXED（证据）** | E/F 轮 `terminal-mounted ... @local` 证明失败是 fallback 本地会话，不是 SSH |
| late-tab 挂载竞态 | **FIXED（更强证据）** | F 轮 `terminal-mounted=300`，E 轮的 3 个 `terminal-not-mounted` 未复现 |
| 压力测试样本完整性门禁 | **PASS** | `--expected-samples`、1..N 连续性、sampleIndex 一致性、JSON 结构；12 项脚本测试 |
| 压力工作流 verdict | **PASS** | 有失败时 `MEASUREMENT_COMPLETE_WITH_FAILURES` 并让 job 失败；不再用绿图标冒充可靠性 |
| WebKit 失败日志 | **CLOSED（非根因）** | G 轮控制组两个**成功**样本各出现 1 次 `CRASHSTRING`、0 个 `processExits`；该字符串不是失败信号 |
| 失败样本逐样本构建身份 | **PASS（G 轮）** | 300/300 的 `sourceSha=ac01091`、`sourceParentSha=7600963`、`binarySha256=0eb823fa…`、`timeoutMs=10000` |
| 跨样本隔离 | **PASS（G 轮，真实 runner）** | `Verify cross-sample isolation` success；强制 1 ms 超时后正常样本仍 300/300 远程 |
| 修复后本地门禁 | **PASS** | 前端 152 文件 / 1367 项、脚本 383 项、typecheck、ESLint、source-size、actionlint |
| 六份验收证据（当前源码） | **PASS** | run `41841781191`（`ac01091`，指纹 `d14fb1d1…`）：macOS / Linux / Windows 3/3 success；debug `0eb823fa…`、release `a1cf8181…`；门禁 **0 problem** |
| RSA Marvin 可达性 | **PASS**（有条件接受） | 见 `rsa-threat-model.md` |
| RSA 上游修复 | **BLOCKED_EXTERNAL** | `patched = []` |
| 单版本安装 + 数据内容保留 | **PASS** | 现有三平台 install job |
| 跨版本升级 / 回滚 | **NOT_RUN** | 无双版本安装链；没有升级事务 |
| updater 真实签名 | **BLOCKED_EXTERNAL** | 公钥仍是占位符 |
| 身份迁移 T1–T12 | **NOT_RUN / BLOCKED_EXTERNAL** | 未改 identifier；无迁移实现 |
| Windows / Pageant / 串口硬件 | **NOT_RUN** | 无实机 |
| 物理键盘 / 中文 IME | **NOT_RUN** | 需人工键入 |

## 2. 四个判定

### READY_FOR_REVIEW

**是**（stacked PR）。三次 300 次样本、失败分类、两个确定性产品缺陷、压力测试
完整性门禁、RSA 威胁模型、安装与身份迁移前置均已落盘；剩余项明确标为
NOT_RUN / BLOCKED_EXTERNAL。

### READY_FOR_MERGE

Phase 9.4 是 stacked branch，不能独立合并到 main；PR #6 合并后需要 rebase。
本阶段不自动合并。

### READY_FOR_RC

**否。**

至少还缺：

1. 用修复后的构建做**多轮** 300 次样本，并把失败率稳定降到 1% 以下；F 轮 298/300
   （0.67%），G 轮 **300/300（100%）**。G 轮单轮 0/300 的 Wilson 95% 上界约
   1.26%，第二轮（`41841717975`）完成后才能谈统计稳定。
2. 历史 20% 失败的 Unified Log 根因，或明确的“环境/时间窗口”解释。
3. 本地 fallback 抢占远程 tab 的**真实 runner 闭合**：228 = 8 秒 deadline 错传，
   229 = 共享 WebKit localStorage journal 污染。代码与 harness 已修，状态机与分段
   trace 已加；仍需真实 300 次样本证明 `ssh-request-not-entered-rust` 不再出现。
4. `terminal-not-mounted` 的产品级修复。F 轮未复现，但 late-tab 修复后的机制仍未
   被独立证据闭合；新 trace 需要在真实 runner 上确认。
5. 跨样本隔离的负面测试：workflow 已加 1 ms 强制超时 + 正常样本的验证步骤，
   **尚未在真实 runner 执行**。
6. 失败样本的逐样本构建身份：代码已补，**真实 runner 的 provenance 尚未重采**。
7. 跨版本升级、回滚、失败恢复。
8. Windows / Pageant / 串口 / 物理键盘实机验收。

### READY_FOR_RELEASE

**否。** 同 RC，另加：

- notarization / Authenticode；
- updater 真实签名；
- 安装后真实 Vault 解锁与 Team Sync 数据保留；
- 跨版本升级与降级。

## 3. 不允许的绿色方式

- 不把 30/30 写成“20% 已修复”。
- 不把单版本覆盖安装写成跨版本升级。
- 不把 RSA 依赖图可达写成漏洞可利用，也不把可达性分析写成“无风险”。
- 不修改旧证据指纹。
- 不删除失败样本、不跳过失败 probe。
- 不把 `MEASUREMENT_COMPLETE_WITH_FAILURES` 或绿色 workflow 图标写成
  `RELIABILITY_PASS`。
- 不把 `MEASUREMENT_COMPLETE_WITH_FAILURES` 或绿色 workflow 图标写成
  `RELIABILITY_PASS`。
