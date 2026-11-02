# Phase 9.1 基线（A0）

> 生成于本轮开工时。HEAD 3fb006c。

## 1. 仓库状态

| 项 | 值 |
| --- | --- |
| 本地 HEAD | 3fb006c |
| origin/feat/phase8-rc-hardening | 3fb006c（一致，0/0） |
| origin/main | 301cf04（**未前进**，无后续提交需避让） |
| 工作树 | 干净（仅 ?? .workbuddy/，历史遗留，不提交） |
| PR #5 | OPEN / **draft** / 82 commits |

**未发现其他开发者未提交的修改。**

## 2. CI 与实机矩阵

| 运行 | SHA | 结论 |
| --- | --- | --- |
| CI 41233703193 | 3fb006c | **success（9/9）** |
| CI 41230214611 | 030fda4 | success（9/9） |
| 矩阵 41231265959 | 030fda4 | **failure**（Linux zsh 三条；macOS/Windows success） |
| 矩阵 41211466016 | 9a1d7ed | failure |

**结论：核心 CI 9/9 全绿；实机 Linux 仍失败。**

## 3. 依赖漏洞的当前实际状态

`cargo audit --json` 实测：**27 条**，与 Phase 9.0 记录一致，未变化。

按可达性分类（由 `scripts/build-security-ledger.mjs` 从 `cargo tree` 自动推导）：

| 可达性 | 条数 | 含义 |
| --- | --- | --- |
| normal dependency | **21** | 在正常构建图中，**必须修复或充分论证缓解** |
| absent-from-build-graph | **6** | `cargo tree` 完全不列出（quinn-proto ×5、rkyv ×1） |

### 一个必须纠正的 Phase 9.0 结论

Phase 9.0 我写过「quinn-proto 本项目不使用 HTTP/3，实际不可达」。
**那是猜测，不是证据。** 任务书明确指出「无法证明不可达 ≠ 不可达」。

本轮把它换成了可核对的证据：`cargo tree --prefix none --edges all --target all` 中
**完全不出现 quinn-proto 与 rkyv**——不是「我读代码觉得不用」，而是「构建图里没有它」。

即便如此，这 6 条**没有被标记为豁免**：台账只记录事实，豁免需要单独的证据、期限与负责人。

### 21 条 normal 依赖的重点

| crate | 条数 | 备注 |
| --- | --- | --- |
| rustls | 4 | 经 hyper-rustls → reqwest → tauri-plugin-updater 与产品本体 |
| quick-xml | 4 | 两条 CVSS 7.5 |
| zip | 3 | 经 tauri-plugin-updater |
| rsa | 2 | |
| crypto-bigint | 2 | |
| h2 | 1 | 经 hyper → reqwest |
| russh / russh-cryptovec | 各 1 | **核心 SSH 库** |
| rustls-webpki / webpki-root-certs / ctutils | 各 1 | |

## 4. 本轮开工时的关键判断

### 4.1 A1（Linux zsh 产品门禁）的边界

Phase 9.0 已确认：`plain` 变体缺启动文件是**诊断脚本缺陷**。
但任务书明确指出：**诊断脚本修复不等于产品门禁修复。**

矩阵里的产品门禁是 `smoke:shell-probe:matrix`，走 Tauri Rust local PTY + WebView/xterm，
与 Python 诊断脚本是两条完全不同的路径。三条用例在该路径上**仍然超时**，且失败日志里的
`trace ready>step>pass` 是**预期轨迹**，不能当作实际成功。

### 4.2 A2（macOS 冷启动）不能因一次通过而关闭

Phase 9.0 记录 10 次里 2 次失败（WebView `didFailProvisionalLoadForFrame`，code=-1004，
frontend stages 为空）。本轮需要重复测量取得失败率，不能因为矩阵某次 macOS success 就结案。

## 5. 本轮的计划与优先级

| 阶段 | 优先级 | 状态 |
| --- | --- | --- |
| B1 漏洞台账 | 高（其他安全工作的前提） | **完成**（scripts/build-security-ledger.mjs + security-advisories.md/json） |
| A1 Linux zsh 产品门禁 | P0 | **机制已定位，闭合 NOT_RUN**：根因见 `docs/phase9/linux-zsh-probe-diagnosis.md`（compinit 停在 insecure directories，`read -q` 只吃一个字符）。本机无 Linux runner，需重跑矩阵确认 |
| A2 macOS 冷启动 | 高 | 待多次重复测量 |
| B0 堆叠安全分支 | 高 | 待建 |
| B2 russh/TLS 升级 | 高 | **部分完成**：quick-xml 0.39.2 → 0.42.0（经 plist 1.10.1）修掉 2 条；russh / russh-cryptovec 未修，见 `docs/phase9-1/dependency-upgrade-result.md` |
| B4 前端供应链 | 中 | **许可证已取得**（135 个生产依赖零 copyleft）；**漏洞审计仍 NOT_RUN**（沙箱拒绝全部 9 个外部域名）。见 `docs/phase9-1/frontend-dependency-audit.md` |
| B5 安全 CI 门禁 | 中 | **已接入**：ci.yml `cargo-audit-diagnostic`（continue-on-error，被 `needs` 依赖：无）。未在真实 runner 上运行过 |
| C1 身份迁移准备 | 中 | 待盘点 |

### 5.1 本轮新增的阻塞事实

**6 份实机证据已失效，且这是门禁的正确行为。** `src-tauri/Cargo.lock` 与
`src-tauri/src/session/pty_diagnostics.rs` 都在 `FINGERPRINT_PATHS` 内，
本轮改动后 `check-verification-evidence.mjs` 报 7 个问题：
manifest 与 6 份证据记录的指纹 `2f62fabd…` 与当前源码指纹
`b9904fcb…` 不再匹配。

证据必须由 real-machine-matrix 在真实 runner 上重采（本机 `gh` 网络被拒）。
**不得修改证据文件来让门禁变绿**——那会把「测量于旧源码」伪装成「测量于当前源码」。

## 6. 证据分类约定（沿用 Phase 9.0）

代码证明 / 真库证明 / runner 证明 / 推断 / NOT_RUN。
本轮所有结论必须标注属于哪一类。