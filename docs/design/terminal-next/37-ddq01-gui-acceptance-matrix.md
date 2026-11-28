# DDQ01 — 三平台 GUI 验收矩阵（真实 verdict，不是 workflow 结论）

**Run** `45937332982`，PR #171，PR 头 `222ed198e7fe`，检出并测量的是合并提交
`ae0c795951eff03705569585027a879c2ec03bd1`（`Merge 222ed19 into bcfc7eb`）
**采集于** 2026-11-28，`gh run download 45937332982`
**制品** 三份 `gui-e2e-evidence-*` 目录，每 case 一个 JSON

本文件回答一个问题：**每个 case 在每个平台上，真正执行了什么、真正没执行什么。**
GitHub check 的 success 只说明"工作流没报错"，不说明任何一个 case 测到了东西——
两者的差距正是本轮 DDQ01 要量化的对象。

---

## 判定约定

| 值 | 含义 |
| --- | --- |
| `PASS` | 该 case 声明的全部断言在本次运行中执行并通过 |
| `PARTIAL` | 执行了，但有 **声明过的** gap；每条 gap 带 `id`、`reason`、`covers` |
| `NOT_RUN` | 前置条件不成立，case 主动记录原因后退出，**不是**通过 |
| `FAIL` | 断言不成立 |
| `INSUFFICIENT_DATA` | 本轮新增（DDQ03）：数据不足以回答所问的问题 |

`PARTIAL` 不等于"部分通过"这种模糊说法。聚合门禁
（`scripts/gui-e2e-report.mjs`）要求 `notRunCount ≤ Σ gaps[].covers`，
**多出来的 NOT_RUN 会让整个 job 变红**——所以 `PARTIAL` 是一个有约束的声明，
不是"差不多过了"。

---

## 矩阵

同一份源码、同一次运行，三个平台各一个 job：

| job | jobId | 时长 |
| --- | --- | --- |
| macOS GUI E2E（阻塞门禁） | 140303537088 | 8m59s |
| Windows GUI E2E（informational） | 140303537055 | 15m01s |
| Linux GUI E2E（informational） | 140303537429 | 11m00s |

| case | macOS | Windows | Linux | 测量范围（实际执行到哪） |
| --- | --- | --- | --- | --- |
| e2e-01 启动与终端就绪 | PASS | PASS | PASS | 真实 WebView，真实 shell 提示符往返 |
| e2e-02 布局与宽度矩阵 | PASS | PASS | PASS | 1440/1280/1024 三档 + canvas 实测 |
| e2e-03 SFTP dock | PARTIAL(1) | PARTIAL(1) | PARTIAL(1) | 目录列举与 dock 绑定；**原生文件选择器不可驱动** |
| e2e-04 dock occupants | PARTIAL(2) | PARTIAL(2) | PARTIAL(2) | dock 占位者互斥；**无模型端点**、snippet 由 e2e-05 覆盖 |
| e2e-05 snippet 工作流 | PASS | PASS | PASS | 真实 DB 行读回 |
| e2e-06 SFTP 真实字节 | PARTIAL(4) | PARTIAL(4) | PARTIAL(4) | 双侧 SHA-256 一致；**原生文件对话框**、**高延迟链路**未覆盖 |
| e2e-07 连接失败诊断 | PASS | PASS | PASS | 失败步骤归因 |
| e2e-08 大输出与背压 | **NOT_RUN** | **PASS** | **PASS** | 见下文 |
| e2e-09 资源曲线 | **PASS**(100轮) | **NOT_RUN** | **PASS**(100轮) | 见下文 |
| t09 refresh 命中测试 | PASS | PASS | PASS | 真实点击后目录刷新 |
| t11 overlay 交互 | PARTIAL(3) | PARTIAL(3) | PARTIAL(3) | 三个浮层；**Tab 顺序不可观测**、Select/Sheet/ContextMenu 未挂载 |
| r04 焦点钩子回归 | PARTIAL(2) | PARTIAL(2) | PARTIAL(2) | **单实例单窗口**，多窗口事件目标不可达 |

括号内是该 case 声明的 gap 条数。每条 gap 的原文（含 `reason`/`needs`）在各 case 的
`extra.gaps` 里，本表不转述。

---

## 两处与旧报告不符，以本表为准

### 1. Linux 的 e2e-09 是完整 100 轮，不是"未覆盖"

`docs/design/terminal-next/32-rc-readiness-report.md` 的 RC18 行写着"未覆盖 Linux /
Windows"。这句话对 Windows 仍然成立（`NOT_RUN`），对 **Linux 已经不成立**：

```
verdict           PASS
rounds            100
sampleCount       101        （1 个基线点 + 100 个轮后采样）
rssSeries.length  101
fdSeries.length   101
roundLines        100 项，全部 43
```

判读：RSS `218,140,672 → 219,213,824 B`（208.04 → 209.02 MiB，**+1.02 MiB**），
`NO_LEAK_DETECTED`；描述符 `69 → 73`（+4），`NO_LEAK_DETECTED`；线程 44–49。

macOS 同轮：RSS `111,149,056 → 119,291,904 B`（106.0 → 113.8 MiB，**+7.76 MiB**，
仍在 8 MiB `growthFloor` 之内），描述符 `78 → 78`（持平），线程 22–26。

**两台 runner 的绝对值不可比**，判据是各自曲线后半段的 floor 是否还在爬，不是末值减初值。

### 2. 两个 `NOT_RUN` 的原因不同，且都不是产品缺陷

| | 原因 | 性质 |
| --- | --- | --- |
| macOS e2e-08 | `no local terminal tab in this run (tabs: 0)` | **启动竞态**（DDQ02） |
| Windows e2e-09 | `this platform (win32) cannot sample a process` | **能力缺口**（DDQ05） |

两者被记录成 `NOT_RUN` 而不是 `FAIL` 是对的——它们都没有测到产品。但它们也**不是**
`PASS`，任何把这一行读成"e2e-08/e2e-09 在三个平台都过了"的汇总都是错的。

---

## 每个 PARTIAL 的实测数字（不是"大概过了"）

`PARTIAL` 的 gap 都是**结构性**的，不是"没时间做"：

| case | 具体 gap | 为什么不可自动化 |
| --- | --- | --- |
| e2e-03 | `native-file-picker-not-drivable`（covers 2） | WebDriver 驱动不了 OS 文件选择器；队列与 24 MiB 真实上传由 `sftp-transfer-queue.test.ts` 与 `sftp-staged-upload-e2e.mjs` 覆盖 |
| e2e-04 | `real-model-answer`（无 covers）、`snippet-draft-capture`（coveredBy e2e-05） | 环境无 OpenAI 兼容端点；后者由 e2e-05 端到端覆盖 |
| e2e-06 | `native-file-dialog-not-driven`（covers 2）、`high-latency-link-not-simulated` | 同上；fixture sshd 是本机环回，不代表抖动链路 |
| t11 | `overlays-not-reachable-from-dock`、`tab-order-not-observable`、`physical-input-not-available`（各 covers 1） | 该 WebView 在 WebDriver 下不执行默认 Tab 动作；Select/Sheet/ContextMenu 不在 dock 挂载 |
| r04 | `MULTI_WINDOW_EVENT_TARGETING`、`SWITCH_TO_WINDOW_SELECTION`（各 covers 1） | `tauri-plugin-single-instance` 使第二窗口在结构上不存在 |

`e2e-04` 的 `real-model-answer` 没有 `coveredBy`，也不进 `notRunCount`——
它是一条**范围声明**，不是被掩盖的跳过。

---

## 这一轮改了什么（DDQ01 的产品侧动作）

**没有改产品代码。** 本轮对 GUI 验收的改动全部在测试与判读层：

1. **e2e-08 的 `NOT_RUN` 是假的**（DDQ02）：读一次 tab 栏就下结论，而 macOS 上产品自己
   要等 2 s 的 startup fallback 才开第一个 tab。修复见 `e2e-08` 的 readiness wait 与
   `wdio.conf.mjs` 的 `beforeSuite`。
2. **e2e-09 的 `PASS` 不足以支撑"资源验收通过"**（DDQ03）：它先
   `filter(v => v !== null)` 再判曲线，而曲线规则本来是拒收带洞序列的。修复见
   `fixtures/resource-series.mjs`。
3. **e2e-09 的 `measurementScope` 此前没有写进证据**（DDQ04）：单个 Tauri 主进程的 RSS
   不等于整个应用的内存，现在证据里带 `measurement.processScope = MAIN_PROCESS` 与
   未测量项清单。

前两条都会让本表的 verdict 在下一轮变化：e2e-08 在 macOS 上应当变成 `PASS`，
e2e-09 的 `PASS` 会因为新增完整性门槛而更难拿到——**变严格，不是变松**。

---

## 剩余限制

- 三个平台的 PARTIAL gap 都是结构性的，本轮**不改**它们，也不把 gap 删掉来换绿色。
- Windows e2e-09 在 DDQ05 完成前保持 `NOT_RUN`。
- 本矩阵只描述 GUI 层。SSH/PTY/SFTP 的 Rust 层证据在
  `docs/design/terminal-next/36-ssh-runtime-acceptance-matrix.md`，两者不互相替代。
- **源码身份的两个 SHA 都已核对，不是矛盾。** 证据 JSON 里的 `source.sha` 是
  `ae0c795`，`gh api runs/… --jq .head_sha` 报的是 `222ed19`。前者是 GitHub 为 PR
  生成的合并提交（`Merge 222ed19 into bcfc7eb`，父提交 `bcfc7eb` + `222ed19`），也就是
  `actions/checkout` 在 `pull_request` 事件下实际检出的 tree；后者是 PR 的头。
  证据里的 `dirty: false` 说明工作区没有未提交改动。结论：这份矩阵描述的是
  **`222ed19` 的代码内容**，与 PR #171 合并前 19/19 的那一轮是同一份源码。
  复核命令：

  ```
  gh api repos/baicie/terminal/commits/ae0c795951eff03705569585027a879c2ec03bd1 \
    --jq '.commit.message, .parents[].sha'
  ```
- 该合并提交的回溯链只在 Actions 的 merge ref 上存在，PR 分支删除后本地
  `git cat-file ae0c795` 会失败。**要复现这一轮测量，必须重新派发当前 HEAD 的
  GUI workflow，不能指望检出这个 SHA。**
