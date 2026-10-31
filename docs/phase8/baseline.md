# Phase 8 · P8.0 基线报告

> 采集时间：2026-11-01 · 采集人：自动化执行
> 分支：`feat/phase8-rc-hardening`（基于 `main` `301cf04`）

## 1. 代码基线

| 项 | 值 |
| --- | --- |
| main HEAD | `301cf04e7ef8b0ed6bf70e623384ce1fbf8c8e6c` |
| 工作分支 | `feat/phase8-rc-hardening`（自 `301cf04` 切出） |
| 工作树 | 干净（仅会话既存的未跟踪 `.workbuddy/`） |
| 与 origin/main 差异 | `0 0`（切分支前） |

## 2. 运行环境核查 —— ⚠️ 发现偏差

| 组件 | 要求（仓库声明） | 实测 | 结论 |
| --- | --- | --- | --- |
| Node.js | `24.16.x`（`.node-version` 与 `package.json#engines`） | **`v22.12.0`** | 🔴 **不符合** |
| pnpm | `10.34.x` | `10.34.3` | ✅ |
| Rust | `1.96.0`（`rust-toolchain.toml`） | `1.96.0` | ✅ |

**这条偏差必须被显式记录**：Phase 6–7 所有「本机门禁全绿」的结论都是在**不受支持的 Node 上**取得的。这不必然意味着结论错误，但意味着「本地能过」与「CI 能过」之间多了一层未受控变量。CI 使用 `actions/setup-node` 读取 `.node-version`，因此 CI 环境是合规的——**本地与 CI 的 Node 次版本不一致**是当前必须承认的事实。

处置：本轮不擅自升级本机 Node（会引入与本次任务无关的变量），但所有「本机全绿」的表述必须附带 Node 版本。升级留给人类在有网络与权限的环境执行。

## 3. 基线门禁结果（`node scripts/verify.mjs all`）

在 `301cf04` + Node v22.12.0 上：

```
VERIFY_EXIT=0
frontend      Test Files 146 passed (146)
              Bundle budget passed (initial ≤240 KB, total ≤565 KB, JS chunk ≤500 KB)
team-server   Test Files 25 passed (25)
rust          test result: ok. 247 passed; 0 failed
              test result: ok. 3 passed; 0 failed   (integration)
scripts       # tests 246 / # pass 246 / # fail 0
source        Source-size gate passed for 558 production files
              Verification evidence gate passed for 6 current evidence file(s)
All requested verification groups passed.
```

基线无失败项。这是 P8 后续所有改动的对照点。

## 4. 有效证据索引

| 项 | 值 |
| --- | --- |
| 证据来源 run | `41112206442`（workflow: Real-machine terminal matrix，job: macos-ssh-matrix，attempt 1） |
| 产出提交 | `d530aac60fa0fcb367c07229619d20d5f0df405e` |
| manifest 指纹 | `81ffa0bf2d3bf0cbc705c6dd3e14164973bc3aeddca65e676e8de602e4ca56dc` |
| debugSha | `530a9ef0236fe64a2e9c954959027b8983246782db964e7e4dc289856070a80b` |
| releaseSha | `73311f675f9dd5ae…`（完整值见 manifest） |
| 原始日志 | `docs/verification/raw/41112206442/`（7 份） |
| 证据文件 | 6 份 `docs/verification/2026-10-11-macos-*.json` |

CI 索引：

| run | 提交 | 结论 |
| --- | --- | --- |
| `41158665105` | `301cf04`（main 合并提交） | ✅ success，8/8 job |
| `41112206442` | `d530aac` | ❌ failure（macOS ✅ / Windows ✅ / **Linux ❌**） |
| `41077965521` | `76c424d` | ❌ failure |
| `41077961864` | `76c424d` | ✅ success |

## 5. 关键结构性发现：门禁脚本在它自己的指纹路径里

`scripts/check-verification-evidence.mjs` 第 288 行把**自身**列入了 `FINGERPRINT_PATHS`。因此：

- 任何对该脚本的修改都会改变源码指纹；
- 指纹一变，6 份证据的指纹绑定立即失效，`evidence gate` 转红；
- 补救方式唯一：在冻结提交上重跑 macOS 证据 job，用 `fetch-verification-evidence.mjs` 回填。

这不是缺陷，是**有意的自指保护**：防止"改门禁让它通过"。但它的工程后果必须被显式管理：

> **Phase 8 战略约束**：本阶段会改动大量 fingerprinted 路径（`src-tauri/src/vault.rs`、`packages/frontend/src/service/sync-import*.ts`、`scripts/*` 等）。若每阶段都重采证据，将产生 7+ 次 macos 矩阵运行（每次约 28 分钟）且大部分立刻作废。
>
> 因此：**证据重采只在全部阶段源码冻结后执行一次**。在此之前，`evidence gate` 在分支上保持红色，并在每个阶段的提交说明与 `docs/phase8` 中如实标注「证据绑定已过期，待阶段末统一重采」。
>
> 这是唯一同时满足「不伪造证据」与「不浪费 CI」的路径。

## 6. 代码风险矩阵（P8.0 采集，后续阶段逐项消解）

| # | 风险 | 位置 | 严重度 | 归属阶段 |
| --- | --- | --- | --- | --- |
| R1 | `vault_unlock` 不校验密码，空 Vault 任意密码可"解锁成功" | `src-tauri/src/vault.rs` | **P0**（安全） | P8.1 |
| R2 | `vault_create` 覆盖已存在文件，无存在性保护 | `src-tauri/src/vault.rs` | **P0**（数据丢失） | P8.1 |
| R3 | 导入事务非严格原子（sqlx 连接池跨连接） | `service/sync-import-support.ts` | **P0**（数据） | P8.2 |
| R4 | 证据门禁的 hash 绑定可被"任意位置塞入正确值"绕过 | `scripts/check-verification-evidence.mjs` | **P1**（证据可信度） | P8.0 |
| R5 | Linux SSH reconnect `stale-output` 失败 | `scripts/run-terminal-smoke.mjs` | **P1** | P8.3 |
| R6 | Linux zsh 三条 shell probe 用例超时（Issue #156） | `scripts/run-terminal-shell-probe.mjs` | **P1** | P8.3 |
| R7 | shell probe 的 `trace` 由前端回填 expected，校验空转 | `automation-root.tsx` | **P1**（证据真实性） | P8.3 |
| R8 | 输出丢弃无显式错误、delivered 回执过期策略 | `terminal-output-scheduler` | P1 | P8.4 |
| R9 | 本机 Node 版本不符合仓库声明 | 环境 | P2 | 人类处置 |

## 7. 文档一致性核查（P8.0 第 4 项）

发现 5 处**反向失真**——Phase 7 结束时写成「证据待重采、gate 为红」，但证据随后已重采并合并，实际状态是 passed。已在本阶段修正：

| 文件 | 原声明 | 修正为 |
| --- | --- | --- |
| `AGENTS.md` | ⚠️ 6 份实机证据需重新采集 | ✅ 已重采（含 run/manifest 指纹） |
| `docs/project.md`（第 25 行） | 证据尚未重采，gate 为红 | 已重采并通过 |
| `docs/project.md`（Phase 7 证据段） | 证据尚未重采 | 已重采并通过 |
| `docs/todo.md`（页首） | 未重采实机证据 | 已重采，指纹 81ffa0bf… |
| `docs/todo.md`（未完成清单） | 🔴 待重采 | ✅ 已重采 |

**教训**：文档里的状态声明会朝两个方向腐化。这一次是"问题已解决但文档还写着没解决"，与上一次"问题未解决却写着全绿"同样有害。
