# Phase 9.2 基线

> 采集于 2026-11-02，分支 `feat/phase9-2-sync-security-hardening`。
> 基线提交 `84f73b0`（P9.2-1..6 已完成并推送），main 为 `2f1d68f`。

## 1. 仓库状态

| 项 | 值 |
| --- | --- |
| 工作分支 | `feat/phase9-2-sync-security-hardening` |
| 阶段起点 HEAD | `2f1d68f`（= main） |
| P9.2-1..6 提交 | `84f73b0` |
| 后半程提交 | `e367e3d`（门禁与文档）、`a093fc7`（矩阵注释更正，= 证据所指提交） |
| 本次工作树 | 证据重采结果（6 份证据 + manifest + `raw/41434165000/`），见 `git status` |

## 2. 测试基数（本机实跑）

| 套件 | 文件 | 用例 | 命令 |
| --- | --- | --- | --- |
| 前端 | 150 | **1347** | `pnpm --filter=@terminal/frontend test` |
| Team Server 单测 | 25 | **117** | `pnpm --filter=team-server test` |
| Team Server 真实 PostgreSQL | 9 | **80** | `pnpm --filter=team-server test:pg` |
| Rust 单测 | — | **302** | `cargo test --locked --all-targets --all-features` |
| Rust 集成测试 | — | **3** | 同上 |
| 门禁脚本 | — | **359** | `node --test scripts/*.test.mjs` |
| 源码规模门禁 | 560 个生产文件 | — | `node scripts/check-source-size.mjs` |

真实 PostgreSQL 使用本机 `127.0.0.1:5432`（`pg_isready` 通过），非 Docker。P9.2-6 的双客户端 E2E 就在这套 PG 上跑。

## 3. 各栈门禁状态

| 门禁 | 状态 | 备注 |
| --- | --- | --- |
| 前端 `lint` | ✅ 0 error | — |
| 前端 `typecheck` | ✅ | — |
| 前端 `test` | ✅ 150 / 1347 | — |
| Team Server `lint` | ✅ 0 error / 88 warning | 88 条均为测试里的 `no-console`，非阻断 |
| Team Server `typecheck` | ✅ | — |
| Team Server `test` / `test:pg` | ✅ 117 / 80 | — |
| Rust `fmt --check` | ✅ | — |
| Rust `clippy -D warnings` | ✅ | — |
| Rust `test` | ✅ 302 + 3 | — |
| 源码规模 | ✅ 560 文件 | — |
| **验收证据指纹** | ✅ **0 problem** | run `41434165000` 重采后指纹 `365bdee7…`，见第 4 节 |
| 安全门禁 | ✅ 13 条全部在基线内 | 其中 1 条是真实且不可修复的暴露，见第 5 节 |

## 4. 验收证据：曾失配，已重采闭合

`node scripts/check-verification-evidence.mjs` 最终报 **0 problem（exit 0）**。
中间经历了一次完整、正确的红：

```
（重采前）
evidence-manifest.json           2f62fabd… → 41b45f31…
2026-10-11-macos-cold-start-current.json
2026-10-11-macos-remote-shell-prompt-rerun.json
2026-10-11-macos-ssh-matrix-current.json
2026-10-11-macos-shell-interaction-current.json
2026-10-11-macos-release-terminal-gate.json
2026-10-11-macos-release-ssh-matrix.json
→ Verification evidence gate failed: 7 problem(s).
```

**原因**：`scripts/check-verification-evidence.mjs` 的 `FINGERPRINT_PATHS` 包含 `src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/src`。本阶段做了 russh 0.60 → 0.65 迁移和 15 个依赖升级，这些路径必然改变。

**这是门禁在正确工作的表现，不是故障。** 旧的 6 份证据测的是 `2f62fabd…` 那次 checkout 的代码；改完依赖后代码不同了，把旧测量当作新代码的证据就是伪造。

**闭合方式**：`.github/workflows/real-machine-matrix.yml` 在真实 GitHub runner 上重采（run `41434165000`，sha `a093fc7`），本机只负责下载与安装。本机 macOS 不是合格的采集环境（无法代表 CI runner 的窗口/输入行为，且 `provenance.source` 必须为 `github-actions`）。

**两次 run 的有效范围**：

| run | sha | 结果 | 证据 |
| --- | --- | --- | --- |
| `41432020659` | `e367e3d` | 三平台全绿 | ❌ 于是我又改了矩阵工作流注释，指纹随即改变 |
| `41434165000` | `a093fc7`（= HEAD） | 三平台全绿 | ✅ 已安装，0 problem |

**明确不做的事**：不改证据文件里的指纹让它变绿。那一行数字存在的意义就是防止这件事。

## 5. 依赖安全基线

`cargo audit` 实测：**8 vulnerabilities + 4 unmaintained + 1 unsound + 0 yanked = 13 条**。

| 分组 | 条数 | 平台 |
| --- | --- | --- |
| 锁文件残留（不在任何构建图） | 7 | — |
| 真实但只在 Linux | 5 | Linux |
| 真实且三平台 | **1** | Linux / macOS / Windows |

那 1 条是 `RUSTSEC-2023-0071`（rsa 0.10.0-rc.18，Marvin 攻击），`patched = []`，上游无修复。详见 `docs/phase9-2/security-remediation.md` 第 3.3 节。

**不得在任何交付材料中声称「生产依赖审计为 0 个已知漏洞」。**

## 6. 本阶段已闭合的项

| 项 | 状态 | 位置 |
| --- | --- | --- |
| P9.2-1 CAS 绕过 | ✅ 已修 | `84f73b0` + `docs/phase9-2/sync-conflict-root-causes.md` |
| P9.2-2 敏感数据保护 | ✅ 已修 | 同上 |
| P9.2-3 假成功 | ✅ 已修 | 同上 |
| P9.2-4 REMOTE 必须落盘 | ✅ 已修 | 同上 |
| P9.2-5 版本协议一致性 | ✅ 已修 | 同上 |
| P9.2-6 双客户端真实 PG E2E | ✅ 9 文件 / 80 项通过 | `packages/team-server/src/__tests__/pg/` |
| P9.2-7 依赖漏洞 | 🟡 29/42 已修，1 条真实不可修 | 第 5 节 |
| P9.2-8 可信安全 CI | ✅ 阻塞门禁 + 四类覆盖 | `scripts/security-gate.mjs` |
| P9.2-11 证据门禁进 CI | ✅ 已接入 `source-size` job | 证据已在 run `41434165000` 重采，见第 4 节 |

## 7. 仍未闭合的项

| 项 | 状态 | 阻塞原因 |
| --- | --- | --- |
| 6 份验收证据 | ✅ **已重采** | run `41434165000`（sha `a093fc7`），0 problem |
| P9.2-9 Linux zsh 探测 | ✅ **PASS** | 两个 run 的 Linux job 均 success，14 用例（bash 7 + zsh 7）全绿，含此前三条 |
| P9.2-10 macOS 冷启动 | ✅ **本轮实测通过** | 三次 7679 / 4042 / 3301 ms，均 < 10 s；**不等于已证明稳定**，见下 |
| 前端依赖漏洞审计 | 🔴 **NOT_RUN** | 镜像源无 audit 端点，见 security-remediation 第 6 节 |
| P9.2-12 身份迁移方案 | 📋 计划已写，迁移未做 | 按约束「没有完整迁移测试前不改 identifier」 |

一条必须与上面三个 ✅ 区分开的事实：Phase 9.0 记录的 **macOS 远程冷启动约 20% WebKit
加载失败率（`code=-1004`）没有被本阶段修复**。三次观测在 20% 单次失败率的假设下仍有约 51% 的
全过概率，所以「本轮测到的三次都过」不能读成「已稳定」。
