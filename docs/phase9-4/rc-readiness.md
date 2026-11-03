# Phase 9.4 — RC Readiness

> 日期：2026-11-03
> 基线：`47b9a6e`（stacked branch，PR #6 尚未合并）

## 0. 最终验收快照（2026-11-03）

| 项 | 值 |
| --- | --- |
| 分支 HEAD | `ff28ebe6173fcac5ff3d14d34c0ba7667216cc2d` |
| PR #7 | OPEN / Draft，base 仍为 `feat/phase9-2-sync-security-hardening` |
| PR #6 | OPEN / Draft，未合并；main 未变更 |
| 最新 CI | run `41680750423`：9 success / 1 failure / 1 cancelled |
| CI 唯一失败 | `Repository gates` 的 `Verification evidence matches this checkout`：当前源码指纹 `890cc0d1…`，证据仍为 `6d7536e7…` |
| CI macOS job | `cancelled`（被同 sha 的并发 run 取消，不是编译失败）；Windows / Linux 均 success |
| 冷启动 E 轮 | run `41674133535`（`b5c7f46`）：294/300，2.00% |
| 本地门禁 | 前端 152 文件 / 1371 项；脚本 385 项；typecheck、ESLint、source-size 563 文件、actionlint 通过 |

六份验收证据必须由 `real-machine-matrix` 在当前源码上重采，不能改旧 manifest；
本轮不自动合并、不打 tag、不发布。

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
| 本地 fallback 抢占恢复的远程 tab | **PARTIAL** | E 轮仍有 2 个 local mount（195/293），说明该路径未消除 |
| tab 缺失时误建本地 PTY | **FIXED（证据）** | E 轮 195/293 的 `terminal-mounted ... @local` 证明是 fallback 本地会话，不是 SSH |
| late-tab 挂载竞态 | **FIXED（待更强证据）** | `tabAvailable` 已参与 effect；E 轮 3 个未挂载仍连 `terminal-open-start` 都没有 |
| 压力测试样本完整性门禁 | **PASS** | `--expected-samples`、1..N 连续性、sampleIndex 一致性、JSON 结构；12 项脚本测试 |
| 压力工作流 verdict | **PASS** | 有失败时 `MEASUREMENT_COMPLETE_WITH_FAILURES` 并让 job 失败；不再用绿图标冒充可靠性 |
| 跨样本隔离 | **PARTIAL** | 主进程与独立 HOME 已确认；WebKit 子进程、端口/锁残留、故意超时负面测试 **NOT_RUN** |
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

1. 用修复后的构建重新做 300 次样本，并把失败率降到 1% 以下；修复前 3.67%、
   修复后 A 2.33%、B 3.00%、C 2.00%、D 6.00%、E 2.00% 都不满足高可靠 RC。
2. 历史 20% 失败的 Unified Log 根因，或明确的“环境/时间窗口”解释。
3. `terminal-not-mounted` 的产品级修复。当前日志没有 WebKit 崩溃证据，失败发生在
   React 挂载阶段，机制尚未定位。
4. 跨样本隔离的负面测试：故意让一轮超时，确认下一轮仍从干净状态开始；
   确认 WebKit 子进程、端口、socket 与文件锁都已回收。
5. 修复本地 fallback 与 tab 缺失路径后，真实采样必须证明 `ssh-request-not-entered-rust`
   不再出现；E 轮仍有 2 个，前端回归不能替代实机结果。
6. 跨版本升级、回滚、失败恢复。
7. Windows / Pageant / 串口 / 物理键盘实机验收。

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
