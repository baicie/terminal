# Phase 9.4 — RC Readiness

> 日期：2026-11-03（2026-11-04 追加 F 轮与 Phase 9.4.2 工作项）
> 基线：`47b9a6e`（stacked branch，PR #6 尚未合并）

## 0. 最终验收快照（2026-11-04）

| 项 | 值 |
| --- | --- |
| 分支 HEAD | `760096341d0273c3833a5244ff2cb522fbcdeb08` |
| PR #7 | OPEN / Draft，base 仍为 `feat/phase9-2-sync-security-hardening` |
| PR #6 | OPEN / Draft，Phase 9.3.2 条件已满足，待人工合并；main 未变更 |
| 最新 CI | run `41683644910`：**10 success / 1 failure** |
| CI 唯一失败 | `Repository gates` 的 `Verification evidence matches this checkout`：当前源码指纹 `890cc0d1…`，证据仍为 `6d7536e7…`（7 problem） |
| CI 三平台构建 | macOS / Windows / Linux 均 success |
| 冷启动 F 轮 | run `41683645429`（`7600963`）：**298/300，0.67%** |
| 本地门禁 | 待 Phase 9.4.2 修复后重跑；上次记录为前端 152 文件 / 1371 项、脚本 385 项 |

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

本地门禁：前端 **153 文件 / 1393 项**、脚本 **83 项**、typecheck、ESLint、
source-size **568 文件**、actionlint 通过。新增 `startup-recovery-arbiter` 状态机、
分段 trace、provenance fail-closed、跨样本隔离验证。本机真实回归 **10/10 remote、
0 local**（中位 3475 ms），隔离验证 **ISOLATION_PASS**；但二进制来自未提交工作树
（`sourceTreeClean=false`），不是 CI 证据。**真实 300 次复测与证据重采尚未执行，
因此本节只能算“代码完成”，不能算 RC 通过。**

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
| 本地 fallback 抢占恢复的远程 tab | **CODE FIXED（待真实复测）** | 228 = 8 秒 deadline 错传；229 = 共享 WebKit localStorage 的 journal 污染。产品与 harness 均已修 |
| tab 缺失时误建本地 PTY | **FIXED（证据）** | E/F 轮 `terminal-mounted ... @local` 证明失败是 fallback 本地会话，不是 SSH |
| late-tab 挂载竞态 | **FIXED（更强证据）** | F 轮 `terminal-mounted=300`，E 轮的 3 个 `terminal-not-mounted` 未复现 |
| 压力测试样本完整性门禁 | **PASS** | `--expected-samples`、1..N 连续性、sampleIndex 一致性、JSON 结构；12 项脚本测试 |
| 压力工作流 verdict | **PASS** | 有失败时 `MEASUREMENT_COMPLETE_WITH_FAILURES` 并让 job 失败；不再用绿图标冒充可靠性 |
| WebKit 失败日志 | **PARTIAL（非根因）** | F 轮失败样本日志 2112 / 2048 行；`CRASHSTRING` 无进程退出事件、无成功对照，已由 tab id 证据排除为本次根因；新 workflow 采控制组 |
| 失败样本逐样本构建身份 | **CODE FIXED（待真实复测）** | 失败路径补 `binarySha256`/fixture/stages；checkout depth=2；汇总器 fail closed |
| 跨样本隔离 | **CODE + WORKFLOW FIXED（待真实 runner）** | 每个样本前清空 WebKit 数据；新增 1 ms 强制超时 + 正常样本的隔离验证；单元测试通过 |
| 修复后本地门禁 | **PASS** | 前端 152 文件 / 1367 项、脚本 383 项、typecheck、ESLint、source-size、actionlint |
| 六份验收证据（当前源码） | **STALE** | 当前改动在 `FINGERPRINT_PATHS` 内；必须真实 runner 重采，禁止改旧证据 |
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

1. 用修复后的构建做**多轮** 300 次样本，并把失败率稳定降到 1% 以下；修复前 3.67%、
   修复后 A 2.33%、B 3.00%、C 2.00%、D 6.00%、E 2.00%、F 0.67%。F 轮只是
   点估计达标，2/300 的 Wilson 95% 上界约 2.40%，且只有一轮，不能宣布统计上稳定。
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
