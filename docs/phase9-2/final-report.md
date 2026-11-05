# Phase 9.2 最终报告

> **后续状态（2026-11-03）**：本文描述的是 `a093fc7` 的证据（指纹 `365bdee7…`）。
> Phase 9.3 修掉了 bootstrap 配置探测的队列饥饿（Issue #166）与测量收尾的
> ENOTEMPTY 竞态（Issue #167），改动了 `FINGERPRINT_PATHS` 内的源码，
> 证据已随 run `41478709578`（sha `3102093`，指纹 **`c4faedfb…`**）重采。
> **本文第 5 节与第 6 节的冷启动数字已被取代**，最新数字见
> `docs/phase9-3/bootstrap-probe-starvation.md` 第 4 节。本文其余结论仍然成立。

> 分支 `feat/phase9-2-sync-security-hardening`，阶段起点 `2f1d68f`（= main）。
> 采集时间 2026-11-02。所有数字均为本次本机实跑，命令在每节里，可复现。
>
> **本报告不使用「基本完成」「绝大部分通过」这类表述。** 每一项只有四种状态：
> **PASS**（本次实跑通过）、**FAIL**（本次实跑失败）、**NOT_RUN**（没有在目标代码上跑过）、
> **BLOCKED_EXTERNAL**（需要外部条件，本轮无法具备）。NOT_RUN 不计入 PASS。

## 1. 十三项任务的最终状态

| # | 任务 | 状态 | 依据 |
| --- | --- | --- | --- |
| P9.2-1 | 解决冲突时绕过 CAS | ✅ **PASS** | `84f73b0`；回归 `conflict-cas.pg-spec.ts` 4 项 |
| P9.2-2 | 敏感数据在冲突解决中泄漏/覆盖 | ✅ **PASS** | `84f73b0`；回归 `conflict-sensitivity.pg-spec.ts` 6 项 |
| P9.2-3 | 失败被伪装成成功 | ✅ **PASS** | `84f73b0`；C4/C5/C6 三项失败注入 |
| P9.2-4 | REMOTE 解决未真正落盘即删除冲突 | ✅ **PASS** | `84f73b0`；C3 断言读的是 SQLite 行 |
| P9.2-5 | 毫秒墙钟与版本协议不一致 | ✅ **PASS** | `84f73b0`；回归 `conflict-version-protocol.pg-spec.ts` 5 项 |
| P9.2-6 | 双客户端真实 PG 端到端 | ✅ **PASS** | 9 文件 **80/80**，25.56 s 与 31.98 s 两次实跑均全绿 |
| P9.2-7 | 依赖漏洞整改 | 🟡 **部分 PASS** | Rust：42 → 13 条，29 条已修，1 条真实不可修；**前端审计 NOT_RUN** |
| P9.2-8 | 可信安全 CI | ✅ **PASS** | `scripts/security-gate.mjs` 阻塞门禁 + 27 项自测 |
| P9.2-9 | Linux zsh 探测 | ✅ **PASS** | run `41432020659` / `41434165000` 的 Linux job 均 success，14 用例（bash 7 + zsh 7）全绿，含此前超时的三条 |
| P9.2-10 | macOS 冷启动 | ✅ **PASS**（本轮实测） | run `41434165000`（sha `a093fc7`）重采 6 份证据，指纹 `365bdee7…`，门禁 0 problem；**不等于已证明稳定**，见 2.4 |
| P9.2-11 | 证据门禁成为真 CI 门禁 | ✅ **PASS**（门禁 + 证据） | 已接入 `source-size` job，无 `continue-on-error`；6 份证据已在真实 runner 重采 |
| P9.2-12 | 身份迁移方案 | ✅ **PASS**（方案） | `identity-migration-plan.md`；**迁移未执行，也不应执行** |
| P9.2-13 | 全量回归 + 八份文档 | ✅ **PASS** | 本文 + 7 份同级文档 |

**P9.2-7 拆开说**（它是唯一一个「完成度」需要读者自己判断的项）：
Rust 侧 29/42 已真实升级修补，剩下 13 条每条都有「为什么修不了」的书面理由与复核命令；
但**前端依赖漏洞审计仍是 NOT_RUN**，镜像源不提供 audit 端点。
**「未测量」不等于「无漏洞」**，本报告不作任何相反暗示。

## 2. 本次全量回归（逐条实跑）

| 门禁 | 命令 | 结果 | 状态 |
| --- | --- | --- | --- |
| 前端 lint | `pnpm --filter=@terminal/frontend lint` | 0 error | ✅ PASS |
| 前端 typecheck | `pnpm --filter=@terminal/frontend typecheck` | exit 0 | ✅ PASS |
| 前端测试 | `pnpm --filter=@terminal/frontend test` | **150 文件 / 1347 项** | ✅ PASS（见 2.1） |
| Team Server lint | `CI=1 pnpm exec eslint src` | **0 error / 87 warning** | ✅ PASS |
| Team Server typecheck | `pnpm exec tsc --noEmit` | exit 0 | ✅ PASS |
| Team Server 单测 | `pnpm --filter=team-server test` | **25 文件 / 117 项** | ✅ PASS |
| Team Server 真实 PG | `pnpm --filter=team-server test:pg` | **9 文件 / 80 项** | ✅ PASS |
| Rust fmt | `cargo fmt --check` | exit 0 | ✅ PASS |
| Rust 测试 | `cargo test --locked --all-targets --all-features` | **302 单测 + 3 集成** | ✅ PASS |
| Rust clippy | `cargo clippy --locked --all-targets --all-features -- -D warnings` | exit 0 | ✅ PASS |
| 源码规模 | `node scripts/check-source-size.mjs` | **560 个生产文件** | ✅ PASS |
| 门禁脚本测试 | `node --test scripts/*.test.mjs` | **359 项** | ✅ PASS |
| 安全门禁 | `node scripts/security-gate.mjs --audit /tmp/audit-v4.json` | 13 条全部在基线内，exit 0 | ✅ PASS |
| **证据门禁（重采前）** | `node scripts/check-verification-evidence.mjs` | **7 个问题，exit 1** | 🔴 **FAIL（正确，见第 5 节）** |
| **证据门禁（重采后）** | 同上 | **0 problem，exit 0** | ✅ **PASS** |

### 2.1 前端测试的一次 flake（不计入 PASS 的干净程度）

第一次全量跑：**1 failed / 1346 passed**，失败项是
`terminal-bootstrap.test.tsx:367`（`renders a retryable failure when the normal
application chunk never settles`）。处理与结论：

| 动作 | 结果 |
| --- | --- |
| 立刻重跑全量 | **150 文件 / 1347 项全绿** |
| 单独连跑 3 次 | 3× 17/17 通过 |
| 该文件是否被本阶段改过 | **否**（`git log 2f1d68f..HEAD -- terminal-bootstrap.*` 为空） |

`packages/frontend/vitest.config.ts` 里已经写着这是已知的时序敏感面：
「The terminal/bootstrap tests intentionally use short async deadlines; an unbounded
worker count can starve one worker long enough for a 1s Testing Library query to
time out even though the same test passes in isolation」，并已用 `maxWorkers: 4` 限流。
本阶段**没有**调大超时或跳过该用例，只是如实记录它存在约 1/2 的偶发率。

**结论**：前端是 PASS，但它是「重跑后全绿」，不是「一次就绿」。

### 2.2 关于 clippy

`cargo clippy --locked --all-targets --all-features -- -D warnings` 本次实跑 **exit 0**，
与 `cargo fmt --check`、`cargo test --locked --all-targets --all-features` 一致。

## 3. 五个 P0 同步缺陷的回归方式

回归不是「改了就说好了」，而是**先在未修复代码上看到红，再在修复后看到绿**。
五条缺陷各自的失败复现、根因与修复在 `sync-conflict-root-causes.md`；
端到端覆盖在 `sync-integrity-e2e.md`（C1–C12 场景表）。
关键点：断言读的是**服务端行与客户端 SQLite 行**，不是函数返回值——
这批缺陷里有三个的返回值和实际效果不一致。

## 4. 依赖安全：真实数字与它的边界

| 阶段 | vulnerabilities | unmaintained | unsound | yanked | 合计 |
| --- | --- | --- | --- | --- | --- |
| 本阶段起点 | 25 | 9 | 4 | 4 | **42** |
| 现在 | 8 | 4 | 1 | 0 | **13** |

剩余 13 条的结构（`security-remediation.md` §3）：

- **7 条不在任何构建图**（quinn-proto ×5、rkyv、rsa 0.9.10），锁文件残留；
- **5 条真实但只在 Linux**（glib / proc-macro-error / zvariant / zbus_names / zvariant_derive，
  全部来自 Tauri 的托盘与通知栈，macOS 与 Windows 构建图里不存在——已用
  `cargo tree --target` 三平台实测，不是推断）；
- **1 条真实、三平台、且修不了**：`RUSTSEC-2023-0071`（rsa 0.10.0-rc.18，Marvin 攻击），
  `patched = []`，russh 与 ssh-key 都精确钉死该版本。

**「安全 CI 绿」在这里的含义是「没有未记录的 advisory」，不是「没有已知漏洞」。**
那 1 条在 CI 里以 `blocking: true` 的已记录条目出现，不是被隐藏。

前端依赖审计：**NOT_RUN / BLOCKED_EXTERNAL**。归因已在本轮更正——
是镜像源（registry.npmmirror.com）不提供 audit 端点，与沙箱无关。

## 5. 验收证据：曾正确变红，已重采闭合

```
（重采前，commit e367e3d / a093fc7 的 CI）
$ node scripts/check-verification-evidence.mjs ; echo $?
Verification evidence gate failed: 7 problem(s).
1

（重采后，run 41434165000 安装证据完毕）
$ node scripts/check-verification-evidence.mjs ; echo $?
Verification evidence gate passed for 6 current evidence file(s).
0
```

`2f62fabd…` → `41b45f31…` → `365bdee7…`。中间那次不匹配不是故障：本阶段真实改了七处
`FINGERPRINT_PATHS` 内的源码（russh 0.65 迁移 + 15 个依赖升级），随后又改了一次
`.github/workflows/real-machine-matrix.yml`（它同样在 `FINGERPRINT_PATHS` 里）。
详见 `verification-evidence.md`。

**本阶段最重要的结构性改动**：这条门禁此前只能通过 `pnpm verify` 抵达，
而 CI 里没有任何 job 调用它——等于一个自愿遵守的约定。现在它是 `source-size` job 里的阻塞步骤。
它在重采前的那几次 CI 上确实是红的（`e367e3d` run `41431670086` 与 `a093fc7` run `41434168073`
都是 10 个 job 里 9 绿 1 红，红的都是它），**红得正确**：
它证明门禁真的会拦人，而不是又一个被忽略的绿灯。
这条红是靠重采消除的，不是靠关掉门禁或修改指纹。

注意：`e367e3d` 那次 run（`41432020659`）的三平台都是绿的、证据也生成了，但因为随后
又提交了矩阵工作流注释，那份证据在提交瞬间就失效了——**证据绑定的是代码身份，不是"最近一次成功"**。
所以最终采用的是 run `41434165000`（sha `a093fc7` = HEAD）。

## 6. 仍然 NOT_RUN 的项：只剩一个

| 项 | 为什么是 NOT_RUN | 怎么闭合 |
| --- | --- | --- |
| 前端依赖漏洞审计 | 镜像源 registry.npmmirror.com 不提供 audit 端点（`ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`），与沙箱无关 | 可访问 npm 官方 audit 端点的网络环境 |

**P9.2-9 与 P9.2-10 已在本轮由真实 runner 闭合**，与上面这一项区别开：

| 项 | run | 依据 |
| --- | --- | --- |
| P9.2-9 Linux zsh | `41432020659`（`e367e3d`）、`41434165000`（`a093fc7`） | Linux job success，14 用例全绿（`zsh/readline-history` 360 ms、`zsh/readline-tab` 449 ms、`zsh/pty-resize` 1425 ms） |
| P9.2-10 macOS 冷启动 | `41434165000`（`a093fc7`） | debug 7679 / 4042 / 3301 ms，release 4692 / 3621 / 3128 ms，远程提示符 5061 ms；门禁 0 problem |

上一版本报告把这两项记作 NOT_RUN 是对的——那时确实没有任何测量跑在修复后的代码上。
状态改变的唯一依据是新的测量，不是时间流逝。

两条仍然成立的保留：

- P9.2-9 的绿灯测的是**产品的 shell 注入链**，不是「一个 `$HOME` 为空的真实 Debian 新账户
  也不会遇到 compinit 提问」。探针夹具正是为了绕开那个提问而把 `HOME` 造得像个正常账户
  （`seedProbeHome` 写入 `skip_global_compinit=1`）。这条遗留风险仍未测。
- P9.2-10 的三次观测**不足以排除** Phase 9.0 记录的约 20% WebKit 加载失败率
  （三次全过的概率在 20% 单次失败率下约为 51%）。PASS 的意思是「本轮在真实 runner 上测到了」，
  不是「已证明稳定」。

## 7. 本轮遗留的风险（不是待办，是已知且未被消除的事实）

| 风险 | 说明 |
| --- | --- |
| macOS 远程冷启动概率性失败 | Phase 9.0 实测 10 次里 2 次失败（`didFailProvisionalLoadForFrame code=-1004`，WebKit 主框架）。**本阶段没有修它**，重采通过也不等于稳定 |
| rsa Marvin 攻击 | 真实、全平台、上游无修复。只能等 russh 换后端 |
| 冲突解决的前端 UI 路径无 E2E | `team-actions-sync` 状态机有覆盖，React 冲突对话框只有单测 |
| 双客户端测试是同一进程两个模块实例 | 证明协议与存储的并发正确性，不证明两台物理设备的网络时序 |
| 证据绑定代码身份，改一次源码就要重采 | 任何 `FINGERPRINT_PATHS` 内的改动都会让 6 份证据失效。这是设计，不是故障；后续每个改 `src-tauri/src` 或 `packages/frontend/src` 的提交都要记得重采 |
| 空 `$HOME` 的真实 Debian 账户未测 | 探针夹具绕开了系统 `compinit` 提问，真实新账户是否也遇到仍未验证 |

## 8. 交付物

### 代码与门禁

| 文件 | 说明 |
| --- | --- |
| `scripts/security-gate.mjs` + `.test.mjs` | 三态退出码的安全门禁，27 项自测 |
| `src-tauri/security-baseline.json` | 13 条已记录 advisory，键为 `kind\|id\|crate` + 版本 |
| `.github/workflows/ci.yml` | `cargo-audit` 变阻塞；`source-size` 扩为 Repository gates（含证据门禁与脚本测试） |
| `packages/team-server/src/__tests__/pg/*.pg-spec.ts` | 新增 4 个文件 29 项，总计 80 项真实 PG |
| `src-tauri/*`（7 个文件） | russh 0.65 迁移 + 依赖升级 |

### 文档（`docs/phase9-2/`，8 份）

| 文档 | 内容 |
| --- | --- |
| `baseline.md` | 阶段起点、测试基数、各栈门禁状态 |
| `security-remediation.md` | 42 → 13 的逐条记录、复核命令、为什么不用 cargo-deny |
| `sync-conflict-root-causes.md` | 五处 P0 缺陷的根因、改前改后对比、逐条回归 |
| `sync-integrity-e2e.md` | 双客户端真实 PG 测试台、C1–C12 场景、未覆盖的部分 |
| `shell-and-webview-stability.md` | Linux zsh 机制与 run 实测、macOS 冷启动两轮数字与不稳定边界 |
| `verification-evidence.md` | 证据门禁的五类绑定、两次 run 的有效范围、从 7 个问题到 0 个 |
| `identity-migration-plan.md` | 身份面清点、测试前置 T1–T12、为什么现在不能做 |
| `final-report.md` | 本文 |

## 9. 四个独立状态

**READY_FOR_REVIEW = 是。** 代码、门禁、测试、八份文档齐备；每个 P0 都有先红后绿的证据；
每处「未做」都有名字与原因。

**READY_FOR_MERGE = 是**，附三条知情条件：
1. 证据绑定 HEAD `a093fc7`。合并后若还改 `FINGERPRINT_PATHS` 内的任何文件，证据立刻失效，
   必须重采——这是设计，不是缺陷。
2. Team Server lint 的导入顺序错误已在 `84f73b0` 后修复并落地。
3. P9.2-9 / P9.2-10 已在真实 runner 通过，但 P9.2-10 的 PASS 不等于「冷启动已稳定」
   （见第 7 节第一行）。

**READY_FOR_RC = 否。** 阻塞项：
1. `RUSTSEC-2023-0071`（rsa 0.10.0-rc.18）真实暴露，三平台，上游 `patched = []`；
2. macOS 远程冷启动存在约 20% 的 WebKit `-1004` 加载失败率，本阶段未修，
   三次新观测不足以排除它；
3. Windows / Pageant / 串口硬件的实机矩阵仍未采集（不在本阶段范围内）。
（6 份证据失效与 Linux zsh 两条已闭合，不再是 RC 阻塞项。）

**READY_FOR_RELEASE = 否。** 同 RC，另加前端依赖审计 NOT_RUN。

## 10. 一句话

这一轮把「同步会静默覆盖数据」「安全 CI 显示绿但没人看」「证据描述的是旧代码」三件事
各自变成了一个**会在 CI 上变红的门禁**，并让 Linux zsh 与 macOS 冷启动在真实 runner 上
拿到了绑定当前代码身份的测量。证据门禁先红了 7 个问题，再由重采归零——
这条先红后绿的轨迹本身就是它可信的理由。
