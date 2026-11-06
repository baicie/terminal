# Phase 9.4 — RC Readiness

> 日期：2026-11-03（2026-11-04 追加 F 轮与 Phase 9.4.2 工作项）
> 基线：`47b9a6e`（stacked branch，PR #6 尚未合并）

## 0. 最终验收快照（2026-11-04）

| 项 | 值 |
| --- | --- |
| 分支 HEAD | `ac010913dc0e60c8f4af58c2db093edf4e02921a` |
| PR #7 | OPEN / Draft，base 仍为 `feat/phase9-2-sync-security-hardening` |
| PR #6 | OPEN / Draft，Phase 9.3.2 条件已满足，待人工合并；main 未变更 |
| 最新 CI | run `41850097122`（`d4a972a`）：**11/11 success** |
| CI 失败项 | 无；`Repository gates` 的证据门禁已随六份证据归档通过 |
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
“首次挂载”门禁为红，该红色状态保留；修复后的 clean round 在 `41850205866`
重跑。

**clean 轮（run `41850205866`，`d4a972a`）**：**300/300 `RELIABILITY_PASS`**；
首次挂载与最终挂载都是 `remote=300`；中位 3721 ms / p95 5482 ms；控制组两个成功
样本各有 1 次 `CRASHSTRING`、0 个 `processExits`；隔离步骤 success。

**最终 CI（run `41850097122`，`d4a972a`）**：**11/11 success**，包括
`Repository gates`（证据 0 problem）、三平台 Tauri build、cargo/npm audit、
Frontend/Rust/Team Server。**RC 仍为否的原因已不再是冷启动或 CI，而是跨版本
升级、硬件矩阵、签名与身份迁移等 NOT_RUN/BLOCKED_EXTERNAL 项。**

详见 `docs/phase9-4/phase9-4-2-fallback-arbitration.md`。

## 1. 逐项状态

| 项 | 状态 | 证据 / 原因 |
| --- | --- | --- |
| macOS 冷启动诊断链 | **PASS** | `terminal-mounted`、串行 trace、30/30 阶段完整 |
| macOS 冷启动 20% 根因 | **PARTIAL** | F 轮的确定性机制已定位（8 秒 deadline 错传 + journal 污染）；历史 20% 的 Unified Log 仍未采到，但 G/第二轮/clean 轮共 900 样本 0 个最终 local 挂载，未再复现 |
| 修复前 300 次冷启动样本 | **FAIL（3.67%）** | run `41602408642`：289/300 |
| 修复后 A 300 次冷启动样本 | **FAIL（2.33%）** | run `41607668007`：293/300 |
| 修复后 B 300 次冷启动样本 | **FAIL（3.00%）** | run `41612216952`：291/300 |
| 修复后 C 300 次冷启动样本 | **FAIL（2.00%）** | run `41637922942`：294/300；失败仍为 3 对 |
| 修复后 D 300 次冷启动样本 | **FAIL（6.00%）** | run `41644270883`：282/300；18 个失败，测量脚本还有缺陷 |
| 修复后 E 300 次冷启动样本 | **FAIL（2.00%）** | run `41674133535`：294/300；3 未挂载 / 2 本地 fallback / 1 prompt marker |
| 修复后 F 300 次冷启动样本 | **FAIL（0.67%）** | run `41683645429`：298/300；2 个失败均为本地 fallback；点估计首次低于 1%，但 Wilson 95% 上界约 2.40%，且只有一轮 |
| **修复后 G 300 次冷启动样本** | **PASS（100%）** | run `41838269784`：300/300，`remote=300`，`RELIABILITY_PASS`；单轮 0/300 的 Wilson 95% 上界约 1.26% |
| **第二轮 artifact 复算** | **PASS（最终挂载 100%）** | run `41843065808`：300/300；首次 remote 299 / local 1（样本 37），最终 remote 300；旧首次挂载门禁使 workflow 为红，已修 |
| **clean 轮** | **PASS（100%）** | run `41850205866`：300/300，首次与最终均 `remote=300`；中位 3721 ms / p95 5482 ms |
| 本地 fallback 抢占恢复的远程 tab | **PASS（最终状态）** | 900 个样本 0 个最终 local 挂载；唯一 1 个首次 local（第二轮样本 37）在 5124 ms 被 remote 替换 |
| 跨样本隔离（真实 runner） | **PASS** | run `41838269784` 的 `Verify cross-sample isolation`：forced port 49195 / control 49199，临时目录已删除 |
| tab 缺失时误建本地 PTY | **FIXED（证据）** | E/F 轮 `terminal-mounted ... @local` 证明失败是 fallback 本地会话，不是 SSH |
| late-tab 挂载竞态 | **FIXED（更强证据）** | F 轮 `terminal-mounted=300`，E 轮的 3 个 `terminal-not-mounted` 未复现 |
| 压力测试样本完整性门禁 | **PASS** | `--expected-samples`、1..N 连续性、sampleIndex 一致性、JSON 结构；12 项脚本测试 |
| 压力工作流 verdict | **PASS** | 有失败时 `MEASUREMENT_COMPLETE_WITH_FAILURES` 并让 job 失败；不再用绿图标冒充可靠性 |
| WebKit 失败日志 | **CLOSED（非根因）** | G 轮控制组两个**成功**样本各出现 1 次 `CRASHSTRING`、0 个 `processExits`；该字符串不是失败信号 |
| 失败样本逐样本构建身份 | **PASS（G 轮）** | 300/300 的 `sourceSha=ac01091`、`sourceParentSha=7600963`、`binarySha256=0eb823fa…`、`timeoutMs=10000` |
| 跨样本隔离 | **PASS（G 轮，真实 runner）** | `Verify cross-sample isolation` success；强制 1 ms 超时后正常样本仍 300/300 远程 |
| 修复后本地门禁 | **PASS** | 前端 153 文件 / 1393 项、冷启动相关脚本 83 项（最终 26 项新增/变更通过）、typecheck、ESLint、source-size 568 文件、actionlint |
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

**是。** 代码、恢复仲裁状态机、分段 trace、provenance 门禁、跨样本隔离验证、
900 个真实样本（G 300/300、第二轮 artifact 300/300、clean 轮 300/300）、
六份验收证据（0 problem）与最终 CI **11/11** 均已落盘；剩余项明确标为
NOT_RUN / BLOCKED_EXTERNAL。

### READY_FOR_MERGE

**否（Phase 9.4 独立合并）。** PR #7 仍是 stacked branch，base 为
`feat/phase9-2-sync-security-hardening`；PR #6 已满足既定条件，交由人工合并。
PR #6 合并后需要 rebase/retarget PR #7，并在最终 HEAD 重跑 CI 与证据检查。
本阶段不自动合并。

### READY_FOR_RC

**否。** 冷启动、隔离、provenance 与 CI 已闭合：

- G 轮 300/300、clean 轮 300/300，两个 clean 轮 600/600；0/600 的 Wilson 95%
  上界约 0.64%（单侧 CP 约 0.50%）；
- 第二轮 artifact 复算 300/300，最终挂载 remote 300，唯一 1 个首次 local 在
  5124 ms 被 remote 替换；
- 隔离、控制组 WebKit、逐样本构建身份均 PASS；
- 六份证据 0 problem，最终 CI 11/11。

仍缺（这些不是冷启动问题）：

1. 历史 20% 失败的 Unified Log 仍未采到；当前 900 样本未复现，F 轮的确定性机制
   已定位，但历史样本本身无法事后补齐。
2. 跨版本升级、回滚、失败恢复 **NOT_RUN**。
3. Windows / Pageant / 串口硬件 **NOT_RUN**。
4. 物理键盘 / 中文 IME 人工验收 **NOT_RUN**。
5. notarization / Authenticode / updater 真实签名 **BLOCKED_EXTERNAL**。
6. 身份迁移 T1–T12 **NOT_RUN / BLOCKED_EXTERNAL**。
7. 安装后真实 Vault 解锁与 Team Sync 升级数据保留 **NOT_RUN**。

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
