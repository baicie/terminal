# Phase 9.2 最终报告

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
| P9.2-9 | Linux zsh 探测 | 🔴 **NOT_RUN** | 夹具已修（`3d71988`），但修复后**从未在 Linux runner 上跑过** |
| P9.2-10 | macOS 冷启动 | 🔴 **NOT_RUN** | 6 份证据全部指纹失配；当前源码无有效测量 |
| P9.2-11 | 证据门禁成为真 CI 门禁 | ✅ **PASS**（门禁本身） | 已接入 `source-size` job，无 `continue-on-error` |
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
| **证据门禁** | `node scripts/check-verification-evidence.mjs` | **7 个问题，exit 1** | 🔴 **FAIL（正确）** |

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

## 5. 验收证据：当前是红的，而且应该红

```
$ node scripts/check-verification-evidence.mjs ; echo $?
Verification evidence gate failed: 7 problem(s).
1
```

`2f62fabd…` → `41b45f31…`。原因是本阶段真实改了七处 `FINGERPRINT_PATHS` 内的源码
（russh 0.65 迁移 + 15 个依赖升级）。详见 `verification-evidence.md`。

**本阶段最重要的结构性改动**：这条门禁此前只能通过 `pnpm verify` 抵达，
而 CI 里没有任何 job 调用它——等于一个自愿遵守的约定。现在它是 `source-size` job 里的阻塞步骤。
代价是接下来每一次 CI 都会红，直到证据在真实 runner 上重采。这是有意的取舍：
把「证据描述旧代码」从没人看的本地警告变成必须处理的红色 job。

**不得**改证据文件里的指纹让它变绿。

## 6. 三个仍然是 NOT_RUN 的实机项

| 项 | 为什么是 NOT_RUN | 怎么闭合 |
| --- | --- | --- |
| P9.2-9 Linux zsh 三条 | 唯一一次测量（run `41231265959`，sha `030fda4`）跑的是**修复前**的脚本；`3d71988` 之后没有任何矩阵 run | `gh workflow run real-machine-matrix.yml --ref <本分支>` |
| P9.2-10 macOS 冷启动 | 证据随源码指纹一起失效 | 同上，然后 `fetch-verification-evidence.mjs --latest` |
| 前端依赖漏洞审计 | 镜像源无 audit 端点 | 可访问 npm 官方 audit 端点的网络环境 |

第 1 项尤其重要：把一次**修复前**的失败记成当前 FAIL，会让下一个人去修一个可能
已经不存在的问题；而把它记成 PASS 更糟。NOT_RUN 是唯一诚实的写法。

## 7. 本轮遗留的风险（不是待办，是已知且未被消除的事实）

| 风险 | 说明 |
| --- | --- |
| macOS 远程冷启动概率性失败 | Phase 9.0 实测 10 次里 2 次失败（`didFailProvisionalLoadForFrame code=-1004`，WebKit 主框架）。**本阶段没有修它**，重采通过也不等于稳定 |
| rsa Marvin 攻击 | 真实、全平台、上游无修复。只能等 russh 换后端 |
| 冲突解决的前端 UI 路径无 E2E | `team-actions-sync` 状态机有覆盖，React 冲突对话框只有单测 |
| 双客户端测试是同一进程两个模块实例 | 证明协议与存储的并发正确性，不证明两台物理设备的网络时序 |
| 证据门禁会一直红 | 直到重采。任何"先把这条关掉"的提议都等于撤销 P9.2-11 |

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
| `shell-and-webview-stability.md` | Linux zsh 机制与 NOT_RUN 更正、macOS 冷启动历史数字 |
| `verification-evidence.md` | 证据门禁的五类绑定、为什么 7 个问题是对的 |
| `identity-migration-plan.md` | 身份面清点、测试前置 T1–T12、为什么现在不能做 |
| `final-report.md` | 本文 |

## 9. 四个独立状态

**READY_FOR_REVIEW = 是。** 代码、门禁、测试、八份文档齐备；每个 P0 都有先红后绿的证据；
每处「未做」都有名字与原因。

**READY_FOR_MERGE = 附条件。** 条件：
1. CI 的 `Repository gates` job 会因证据失配变红——这是**预期的、已解释的**红，
   不是新缺陷。合并决议必须在知情下做出，不能把它当噪声忽略。
2. Team Server lint 的导入顺序错误已在工作树修复（`84f73b0` 的 CI 正是红在这里），
   需随本次提交一起落地。
3. P9.2-9 / P9.2-10 的实机项在合并前仍为 NOT_RUN。

**READY_FOR_RC = 否。** 阻塞项：
1. 6 份验收证据全部失效，未重采 → NOT_RUN；
2. Linux zsh 产品门禁自修复后从未跑过 → NOT_RUN；
3. `RUSTSEC-2023-0071`（rsa）真实暴露，上游无修复；
4. macOS 远程冷启动存在约 20% 的 WebKit 加载失败率，未修。

**READY_FOR_RELEASE = 否。** 同 RC，另加前端依赖审计 NOT_RUN。

## 10. 一句话

这一轮把「同步会静默覆盖数据」「安全 CI 显示绿但没人看」「证据描述的是旧代码」三件事
各自变成了一个**会在 CI 上变红的门禁**，并留下了三项需要真实 runner 才能闭合的实机验证。
红的部分是这轮的成果，不是失败。
