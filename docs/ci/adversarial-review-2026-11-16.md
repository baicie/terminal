# 对抗性审查与工程收口报告（T01–T20）

> 基线：`main = bc53cf1`（2026-11-16 复核，无变化）
> 分支：`ci/t14-t24-gui-triggers-and-failure-attribution`（PR #86）
> 本报告只记录**已执行**的结论。未运行的一律标 `NOT_RUN`，未验证的一律标
> `NOT_VERIFIED`，不存在的证据不写。

---

## 0. 一句话结论

PR #86 的失败归因链路**从未成功读取过任何真实日志**。它在真实失败 run
`43716684905` 上把 `error[E0433]: cannot find \`unix\` in \`os\``（典型编译失败）
报成 `UNKNOWN`，而整个过程没有任何报错——这是本次审查最重要的一条，因为一个
「看起来在工作」的诊断工具比没有工具更危险。

修完之后，同一个 run、同样真实日志：`PRODUCT_REGRESSION`。

---

## 1. 审查结果：确认的问题（按严重度）

### P0

| # | 问题 | 源码位置 | 复现 |
| --- | --- | --- | --- |
| 1 | **Job ID 丢失，日志从未被读取** | `.github/workflows/ci.yml` 的 `jq` 投影 + `scripts/attribute-ci-failure.mjs` | `gh api … \| jq '[.jobs[] \| {name, conclusion, informational}]'` 后再取 `jobs/${job.id}/logs` → 全部 404，`catch` 吞掉 |
| 2 | **`timed_out` 被当作 clean** | `scripts/ci-failure-attribution.mjs` `classifyRun` | `classifyRun({conclusion:'timed_out'})` → `{category:null, detail:'clean'}` |
| 3 | **裸短语即 `KNOWN_ISSUE`** | 同上 `SIGNATURES` | `known issue: renderer problem` → `KNOWN_ISSUE`（非阻塞） |
| 4 | **`job.id` 缺失时静默降级为按名字分类** | `attribute-ci-failure.mjs` `logTail` | `catch { return '' }`，无 `LOG_UNAVAILABLE` 输出 |
| 5 | **`success` + 0 job 视为通过** | `classifyRun` | `classifyRun({conclusion:'success', jobs:[]})` → `clean` |
| 6 | **发布可放行未完成的 check** | `scripts/verify-release-qualification.mjs` `judgeRelease` | 所有 check 写 `{status:'in_progress', conclusion:'success'}` → `ok:true` |
| 7 | **发布状态机默认路径永远到不了通道** | `scripts/release-state-machine.mjs` `simulate` | `simulate({})` → `skipped: verify-downloadable, verify-manifest, switch-channel` |
| 8 | **`changed` 输出恒为空** | `.github/workflows/ci.yml` | `git diff … \|\| true >> "$GITHUB_OUTPUT"`：`>>` 绑定到 `true` |
| 9 | **App ID + 名字即可冒充 Required Check** | `scripts/check-run-selection.mjs` | GitHub Actions 是全仓库共用一个 App；新增 workflow 文件即可发布同名 check |

### P1

| # | 问题 | 源码位置 | 复现 |
| --- | --- | --- | --- |
| 10 | 通过率可虚高（未分类测试消失） | `scripts/ci-coverage-report.mjs` | `layerEntry({total:100, passed:50})` → `passRate 1` |
| 11 | 计数接受负数 / NaN / Infinity / 小数 | 同上 | `{total:-5, passed:-5}` 被接受 |
| 12 | 测试覆盖报告零数据接入 | 同上 | `LAYERS` 为手写静态数组，无任何 runner 输出读取 |
| 13 | `jq -e '.version and .platforms'` 放行残缺 manifest | `.github/workflows/release.yml` | 4/4 全部放行（空签名、错版本、外域 URL、空 platforms） |
| 14 | `.sig` 只检查非空，从不校验 | 同上 | 非空 ≠ 有效 |
| 15 | `RELEASE_CHECK_APP_IDS` 拼错 = 信任所有 App | `scripts/release-facts.mjs` | `=none` → `null` → 任意 App |
| 16 | GUI 门禁不在发布契约里（注释声称在） | `scripts/verify-release-qualification.mjs` | `/gui/i` 匹配 0 项 |
| 17 | GUI workflow 触发路径不含它驱动的代码 | `.github/workflows/native-gui-e2e.yml` | 改 `components/`、`store/`、`router/` 不触发 |
| 18 | GUI workflow 不含自身 | 同上 | 削弱门禁的 PR 不被该门禁观察到 |
| 19 | `fully-signed` 可选中但必然失败 | `.github/workflows/release.yml` | 选完、构建开始后才发现 |
| 20 | 状态机无 workflow 漂移检测 | `scripts/release-state-machine.test.mjs` | 无任何测试读取 `release.yml` |

### P2

- 测试计数无 `INCOMPLETE` 语义，未运行层与零失败混同。
- `informational` 仅靠 `name.includes('informational')`，且跨 workflow 完全不可见。
- heredoc 分隔符 `EOF` 与合法文件名冲突。
- `updater-latest` 的 `--clobber` 空窗无记录、无读回校验。

---

## 2. 修复与验证（逐条对应）

### T01–T07：失败归因（commit `59b0b2a`）

**T01 数据契约**
`ci.yml` 投影改为 `{id, name, conclusion, status, html_url, run_id, run_attempt, steps}`。
`JOB_LIST_FIELDS` 与 `ci.yml` 由测试互相锁定（`ci-github-api.test.mjs`），删字段本地即红。

**T02 权限与日志**
- `permissions` 增加 `actions: read`（jobs 与 logs 两个端点都需要），**不加 write**。
- 日志失败区分 `403/404/410/429/空/超时/过大/网络`，统一输出 `LOG_UNAVAILABLE` + 原因。
- **修掉一个我第一版引入的缺陷**：excerpt 取「第一个 `##[error]` 之后的内容」。
  真实日志里 `##[error]` 是 EOF 前 5 行的 runner 清理行，导致 40 行前的编译错误被截掉。
  改为收集全部 anchor 窗口。
- 分页读取 job 列表；页数用尽标 `PAGE_LIMIT_REACHED`，不谎报「完整」。

**T03 状态机**（新增 `ci-run-state.mjs`）
只有 `success` 是 pass；`timed_out`/`startup_failure`/`action_required` → fail；
`cancelled`/`stale`/`skipped` → superseded；未知结论与 `success`+0 job → inconclusive。

**T04 KNOWN_ISSUE**（新增 `ci-known-issue.mjs`）
裸短语不再命中。必须带可解析引用：GitHub issue / `docs/issue.md` 锚点 / `AGENTS.md:行号`，
且**必须真实存在**（读取真实文档校验）。文档不可读 → 一律 `UNKNOWN`。

**T05 informational**（新增 `ci-informational.mjs`）
改为 `workflow 文件 + job 名` 白名单，每条必须写明 `why` 与 `removeWhen`。
未归类 job 默认阻塞并标 `unknown`。GUI 在独立 workflow，明确产出 `NOT_COLLECTED`。

**T06 语义拆分**
报告分列 `Classification` / `Human action` / `Required check result` / `Merge eligibility`。
分类永不改变门禁裁决：`required` 失败时即使原因是 `INFRA_FAILURE` 也标 `blocked`。

**T07 真实集成验收**
可注入 API adapter + 真实可执行 `gh` stub + fixture。19 项 CLI 子进程测试。

**修复前 → 修复后（同一个真实 run `43716684905`、同样的真实日志）**

```
修复前:  **Category:** `UNKNOWN`      （日志从未读到）
修复后:  **Category:** `PRODUCT_REGRESSION`
         | Required check result | **failed** — the merge gate is blocked |
         | Merge eligibility     | blocked |
         | Tauri build (windows-latest) | failure | PRODUCT_REGRESSION | yes | no | read |
```

### T08–T10：测试执行报告（commit `14984b7`）

- **T08**：守恒式 `passed+failed+skipped+notRun === total`，否则 `INCOMPLETE`；
  负值/NaN/Infinity/小数一律抛错；六态 `PASS/FAIL/SKIPPED/NOT_RUN/INCOMPLETE/BLOCKED`；
  `complete`（覆盖全层）与 `green`（无失败）分离。
- **T09**：四类真实解析器（vitest JSON / libtest 文本 / TAP / harness JSON）。
  解析不了就抛错，**绝不返回 0**。10 层全覆盖，由测试锁定。
- **T10**：每个 job 上传机器可读输出（`if: always()`，失败也上传）；新增
  `test-report` job 聚合，输出 Step Summary + JSON artifact；缺 artifact = `NOT_RUN`，
  job 被跳过 = `BLOCKED`，多 SHA 混入直接拒绝。

> 明确声明：这是**测试执行报告**，不是行覆盖率。

### T11–T12：发布检查来源与契约（commit `f56bb11` + `0002dc9`）

**T11**：新增 `check-run-provenance.mjs`。实测证据链（真实 commit `bc53cf1`）：

```
check_run.details_url  -> actions/runs/43770018507/job/132988523228
actions/runs/<id>      -> path=.github/workflows/ci.yml, workflow_id, run_attempt,
                          head_sha, event
PROVENANCE VERIFIED: true
```

`check_suite.app` / `.head_sha` 实测**均为 null**，所以「从 suite 反查」不可行——
这一点写进了模块注释，避免下一个人重走。

**T12**：新增 `release-check-contract.mjs`。每个 check 记录 `owner` 与
`freshness(on-commit / pr-evidence)`。GUI 门禁纳入但标 `pr-evidence`：
`native-gui-e2e.yml` 无 tag 触发，直接列入会让**每个发布必然失败**。
缺失时给出专门的 `check-missing-pr-evidence` 并说明原因。

**两项由独立复审发现、我第一轮漏掉的（`0002dc9`）**

- `judgeRelease` 从不读 `status`（P0，见问题 6）
- `RELEASE_CHECK_APP_IDS` 拼错 → 信任所有 App（P1，见问题 15）

### T13–T15：状态机与 Updater（commit `9c8771c`）

**T13**：`publish` 改为状态转移，`simulate({})` 现在跑完全部 11 步。
新增 `channelState` 三态 `untouched / written / half-written`。
测试直接读取 `release.yml` 比对。

> 实测发现：`switch-channel` **并不是**独立 workflow step，而是
> `Publish the draft release` 内部的最后一段。测试改为断言该脚本内的真实顺序
> （`--draft=false` → 资产可达 → 切换通道），而不是假装存在一个不存在的步骤。

**T14**：`jq -e '.version and .platforms'` 实测放行 4/4 残缺 manifest。
新增 `updater-manifest-check.mjs`：版本必须等于本次发布、平台集合精确匹配、
签名非空、URL 为 https 且以本 release 前缀开头、payload 不重复、`pub_date` ISO-8601。
**明确区分「签名非空」与「签名有效」**：payload 不可得时返回 `NOT_VERIFIED`，绝不 `VALID`。
通道写入后**读回并与已验证副本 diff**。

**T15**：`fully-signed` 从 `options` 移除；`case` 分支保留作为纵深防御
（API dispatch 不受 `options` 约束）并注明原因。

### T16–T17：变更分类与 GUI 触发（commit `0e50e22`）

**T16**：实测证明重定向优先级 bug。

```
错误写法捕获: []
正确写法捕获: [b.txt]
```

改为 `classify-change.mjs --print-files`：文件列表走 stdout、裁决走 stderr，
**一次调用同时产出两个事实**，不再有两个可能不一致的 diff。

**T17**：触发路径补齐 19 项，含 workflow 自身与 specs 真正驱动的
`components/`、`view/`、`router/`、`store/`。阻塞/非阻塞划分**未变**——
Windows/Linux 仍 `informational`。

### T18–T20：产品级验收

**T18 Windows 本地终端真实挂载 — `NOT_RUN`**
需要真实 Windows runner 的 GUI 时间线证据，本机（macOS）无法产出。未做任何 PASS 声明。

**T19 SFTP IPC E2E — 部分达成，缺口已证明（commit `48140cd`）**
尝试用 `tauri::test::mock_runtime` 驱动真实 `invoke_handler`。**不可达，且原因不是测试写错**：

- `mock_context` 的 ACL 为空 → `invoke` 在命令执行前被拒
  （`"sftp_connect not allowed. Plugin not found"`）
- 换 `generate_context!()` 无效：生成的 app ACL manifest 是 `[]`，
  即本应用**没有声明任何 application-command 权限**，生产靠「无条目即允许」，
  mock runtime 没有该兜底

所以 `MOCK_IPC_SFTP_E2E=NOT_ACHIEVABLE`：要达成它，要么给每个命令补 ACL 权限
（改生产安全面），要么有真实 WebView（GUI 套件）。

改为钉住今天可验证的事实（7 项测试全通过）：命令注册、state `manage`、IPC authority
确实拒绝无权限命令且命令体未执行、前端 camelCase ↔ 命令 snake_case 双向契约、
mock-runtime 可覆盖命令集合、app-level 权限数为 0、以及缺口本身写在源码里。

**T20 Team Sync 跨版本 — `PARTIAL`**
需要历史客户端二进制 + 真实 PostgreSQL 的跨版本矩阵；本机无该 fixture 的完整链，
**不伪造执行证据**。

但判定逻辑是可测的，且此前完全没有测试保护：`TEAM_CROSS_VERSION_A_TO_B_VERIFIED`
设计上必须是 `FAIL`（ADR 最低版本策略用 426 提前拒绝旧客户端），而这个「看起来坏、
其实正确」的字段若被将来某次「修成绿色」改动，真正的回归检测会静默消失。

处理：抽成 `team-cross-version-matrix.mjs` 纯函数（已验证与原文 20 种输入组合逐一
等价），9 项测试钉住两个方向——健康 run 必须 `A_TO_B=FAIL` 且
`SAFE_REJECTION`/`MIN_POLICY=PASS`；旧客户端能继续同步必须被判为不健康。

### Phase 6：Ruleset — `EXTERNAL_ACTION_REQUIRED`

实测：`rulesets -> []`；`branches/main/protection -> 404 Branch not protected`。
即 **`main` 当前完全不受保护**。配置与验证命令见
[`docs/ci/main-ruleset.md`](main-ruleset.md)，含 11 个 required check 的精确字符串、
完整 ruleset JSON、逐字段理由、以及一次失败 PR 的门禁验证步骤。

`REQUIRED_CHECK_BLOCKS_MERGE=NOT_VERIFIED`。

---

## 3. 门禁实测

| 门禁 | 结果 |
| --- | --- |
| Gate scripts (`node --test`) | **800 项 / 796 pass / 4 skipped / 0 fail** |
| Rust (`cargo test --lib`) | **434 passed / 0 failed / 9 ignored** |
| Rust (`--features gui-e2e`, IPC) | **7 passed / 0 failed** |
| GUI 证据完整性（新增） | **6 项** |
| 报告聚合端到端（新增） | **19 项**（含真实命令与真实目录布局） |
| Team Sync 判定契约（新增） | **9 项** |
| Frontend vitest | **255 文件 / 2337 项 / 0 fail** |
| source-size | **684 个生产文件通过** |
| verification evidence (integrity) | **6 份证据通过** |
| bundle budget | initial 130.92 KB / 240 KB；total 626.59 KB / 628 KB |
| workflow YAML 可解析 | `ci.yml` / `native-gui-e2e.yml` / `release.yml` 均通过 |

---

## 4. 测试质量：分层实况

| 层 | 状态 | 机器可读结果 |
| --- | --- | --- |
| Unit — frontend (vitest) | PASS | ✅ JSON reporter 已接线 |
| Unit — Rust (cargo test) | PASS | ✅ libtest 文本已接线 |
| Unit — Team Server | PASS | ✅ vitest JSON 已接线 |
| Gate scripts (node --test) | PASS | ✅ TAP 已接线 |
| Command E2E — SFTP over real sshd | 既有套件 | 🔄 harness JSON 适配器就绪，job 尚未上传 |
| IPC E2E — Tauri invoke | **NOT_ACHIEVABLE**（已证明原因） | — |
| GUI E2E — real WebView | macOS PASS / Windows+Linux informational | 🔄 |
| Real machine | 未在本轮运行 | `NOT_RUN` |
| Upgrade E2E | 未在本轮运行 | `NOT_RUN` |
| Release qualification | 未在本轮运行 | `NOT_RUN` |

如实说明：T09 建立了 10 层的解析器与聚合器，并已把 **4 个实际在 CI 里跑的层**
接上数据源。其余 6 层的适配器已就绪（`INGESTION_PLAN` 覆盖并被测试锁定），
但对应 job 尚未在 workflow 里上传报告——它们在报告里会显示为
`NOT_RUN（no report was uploaded）`，**不会被当作零失败**。

---

## 5. Release 安全性逐问

| 问题 | 回答 | 依据 |
| --- | --- | --- |
| Check Run 是否可信 | **是，且现在可证明** | `details_url` → run → workflow path，真实 commit 验证通过 |
| 能否防同名 Check 欺骗 | **能** | `provenance-wrong-workflow`；另测「全部 check 均来自冒充 workflow」 |
| 能否防旧成功覆盖新失败 | **能** | 按 id 取最新；`status !== completed` 拒绝 |
| Manifest 是否完整 | **是** | 版本/平台集合/签名非空/https 同源/唯一 payload/pub_date |
| Signature 是否有效 | **部分** | 结构校验完成；**密码学校验在 payload 可得时才做，否则 `NOT_VERIFIED`** |
| Updater 通道是否安全 | **是（有已知空窗）** | 先验证再覆盖 + 读回 diff；`--clobber` 空窗已记录并说明唯一残余失败模式 |
| Release 状态机是否与真实 Workflow 一致 | **是** | 测试读取 `release.yml` 断言步骤与脚本内真实顺序 |

---

## 6. 未完成事项（明确状态）

| 项 | 状态 |
| --- | --- |
| T01–T07 失败归因 | **COMPLETE** |
| T08 计数契约 | **COMPLETE** |
| T09 数据接入 | **PARTIAL**（4/10 层已接，其余适配器就绪未接） |
| T10 跨 Job 聚合 | **COMPLETE** |
| T11 Check 来源 | **COMPLETE** |
| T12 契约同步 | **COMPLETE** |
| T13 状态机 | **COMPLETE** |
| T14 Manifest | **COMPLETE**（签名密码学校验为 payload 条件性 `NOT_VERIFIED`） |
| T15 Release 模式 | **COMPLETE** |
| T16 `changed` 契约 | **COMPLETE** |
| T17 GUI 触发 | **COMPLETE** |
| T18 Windows GUI 挂载 | **NOT_RUN**（需 Windows runner） |
| T19 SFTP IPC E2E | **PARTIAL** — 边界事实已钉住（7 项测试），执行层 `NOT_ACHIEVABLE` |
| T20 Team Sync 跨版本 | **PARTIAL** — 判定逻辑已纯函数化并测试（9 项）；真实跨版本矩阵执行仍 `NOT_RUN`（需历史客户端 + 真实 PG） |
| Ruleset | **EXTERNAL_ACTION_REQUIRED** |
| `REQUIRED_CHECK_BLOCKS_MERGE` | **NOT_VERIFIED** |
| `GUI_SFTP_REAL_E2E` | **NOT_RUN** |
| `MOCK_IPC_SFTP_E2E` | **NOT_ACHIEVABLE**（原因已证） |

---

## 6.5 独立复审后又发现并修复的问题

第一轮报告写完后，三个独立来源（对抗性复审 agent、完整性 critic、我自己的复审）又找出以下问题。
全部已修复。

| # | 严重度 | 问题 | 证据 |
| --- | --- | --- | --- |
| R1 | **P0** | `e2e-02` 的 verdict 只看宽度计数，真实失败 run 被记成 PASS | artifact `gui-e2e-evidence-windows-43718510663`：`wdio-…json` 为 `{"passed":2,"failed":3}`，而 `e2e-02.json` 写 `{"verdict":"PASS"}` |
| R2 | P1 | 新增的 manifest 校验步骤缺 `VERSION` 环境变量 | `VERSION=… node verify-updater-manifest.mjs` → exit 2；会让每次 updater-signed 发布在最后一步失败 |
| R3 | P1 | 聚合步骤复制不存在的嵌套路径 | 各 job 都以 `test-results/` 为根 + `merge-multiple`，文件平铺在 `reports/`；原代码找 `reports/test-results/vitest.json` |
| R4 | P1 | `judgeRelease` 不读 `status`（第一轮遗漏的 P0） | 全部 `{status:'in_progress', conclusion:'success'}` → `ok:true` |
| R5 | P1 | `RELEASE_CHECK_APP_IDS` 拼错 → 信任所有 App | `=none` → `null` → 任意 App |
| R6 | P2 | 旧 `ci-coverage-report.mjs` 仍会误报且已成死代码 | `layerEntry(total=100,passed=50)` → 渲染 `100.0%`；除自身测试外无引用，已删除 |
| R7 | P2 | `docs/ci/test-matrix.md` 的 Team Sync 描述与当前代码矛盾 | 文档说「已知产品缺陷仍在」，代码已改为 426 提前拒绝 |
| R8 | P2 | Team Sync 的 `A_TO_B_VERIFIED=FAIL` 无任何测试保护 | 将来「修成绿色」会静默去掉真正的回归检测；已抽离为纯函数 + 9 项测试 |

### R1 的完整判定

`e2e-02-layout.e2e.mjs` 的 `failures` 只在宽度矩阵循环里自增，其余任何失败
（`waitUntil` 超时、explorer 没打开）都不影响它。修复照 `e2e-03` 已验证的做法加
`afterEach` 收集 `currentTest.state`。

新增 `scripts/gui-evidence-integrity.test.mjs`（6 项）把规则统一到整个 GUI 套件：
每个写证据的 spec 必须读 `currentTest.state`、必须有 `afterEach`、不得写字面量
`verdict: 'PASS'`，且已提交证据中 `PASS` 不得伴随 failures 或 error。

已核查：**已提交**的 `e2e/gui/artifacts` 是 macOS 2026-11-14 的结果，三份
`PASS` 且 `failures=0`、`error` 为空，内部一致。假 PASS 出现在**未提交**的
Windows artifact 里。

### R7 的完整判定

复审说「harness 在自己 matrix 报 FAIL 时仍退出 0」。核实：**退出码由 `allOk`
（步骤是否跑成）驱动，`A_TO_B_VERIFIED=FAIL` 是 ADR 最低版本策略设计上期望的
结果**——所以退出 0 是正确的。但复审指出的可混淆性是真实的，且文档确实过期。
处理：文档改为描述当前策略；判定抽成纯函数并加测试钉住两个方向。

---

## 6.6 第三次独立复审（逐文件对抗性复核）后又修复的问题

这次由未参与开发的 agent 逐文件复核，报出的问题全部用命令复现后修复。

| # | 严重度 | 问题 | 复现 |
| --- | --- | --- | --- |
| S1 | **P0** | 机器可读测试报告从未产出 | `pnpm test -- --reporter=json` 把 `--` 一起转发，vitest 当作位置参数；实测跑完 2337 项**没有任何 JSON 写出**。另外 `../test-results` 相对 vite root 解析到 `packages/test-results`，而 artifact 上传仓库根的 `test-results/` |
| S2 | **P0** | 失败的 job 被标 `BLOCKED`，真实报告被丢弃 | workflow 对任何非 success 结果传 `--skipped`，`collectLayers` 先查它再找文件 → 失败套件的真实计数归零 |
| S3 | P1 | `classifyRun` 在只有 `neutral` job 的 run 上抛 `TypeError` | `notEvaluated` 条目无 `category`，旧代码却读 `chosen.category`；归因步骤 `continue-on-error`，所以崩溃是静默的 |
| S4 | P1 | 发布门禁在本仓库永远无法通过 | GUI check 标 `pr-evidence` 但 `release-facts` 只读 `commits/{sha}/check-runs`，而 GUI workflow 无 tag 触发 → 绿 tag 上必然 `check-missing-pr-evidence` ×2 |
| S5 | P1 | `--print-files` 失败路径污染文件列表 | `catch` 硬编码 `console.log('docs_only=false')` 到 stdout，而该模式下 stdout 是纯路径列表 |
| S6 | P2 | 未预期平台被当作硬失败 | 注释写「not fatal」，代码却 `push` 进 `problems` → 加了 `windows-aarch64` 的 manifest 被整体拒绝 |
| S7 | P2 | 日志摘要仍可截掉最早的编译错误 | 真实错误在第一行、后面 300 行 runner `##[error]` 时：`contains the real error? false` |
| S8 | P2 | `missingScenarios`/`notPassed` 在真实路径上永远为空 | 采集器两个分支都返回 `[]`，judge 的两条规则在发布路径不可能触发 |

### S4 的修复与验证

新增 `collectPrEvidenceChecks`：用 `actions/runs?head_sha=<sha>` 取该 commit 的全部
workflow runs（此接口对任何 event 都返回，已实测），取最新一次 run 的 jobs 映射回
`checks`。真实 commit 上验证：

```
prEvidence checks: ['Driver isolation gate', 'macOS GUI E2E']
Driver isolation gate -> {conclusion: success, workflowPath: .github/workflows/native-gui-e2e.yml, runId: 43803610192}
macOS GUI E2E        -> {conclusion: success, workflowPath: .github/workflows/native-gui-e2e.yml, runId: 43803610192}
```

修复后跑完整发布门禁（同一真实 commit，只合成一个匹配的 tag 以隔离 check 评估）：

```
release qualification: FAIL — 1 problem(s)
  [evidence-not-qualified] the acceptance evidence does not describe this commit (7 problem(s))
```

**13 个 required check 全部通过**，GUI 两个也在内；唯一剩下的失败是证据确实过期——
这是正确报告的事实，不是缺陷。

### 我自己引入又修掉的三处

- 把 `shas` 挪进 `findMixedCommits` 后，写 JSON 处仍引用 `shas` → `ReferenceError`。
  端到端测试立刻抓到（带堆栈），已改为写前重新求值 `commits`。
- 在 `a94919a` 里把 `test-results/vitest.json`（763 KB 生成物）一起提交了。
  已移除、加入 `.gitignore`、并加一条测试断言 `git ls-files test-results` 为空。
- `test -s` 守卫写成 `../test-results/`（shell 的 cwd 不被 `pnpm --filter` 改变），
  已改为 `test-results/`。

---

## 6.7 最后一次 CI 反馈暴露的两个问题

| # | 严重度 | 问题 | 证据 |
| --- | --- | --- | --- |
| T1 | P1 | 证据守卫拒绝了合法的非 PASS 标签，把真实失败替换成守卫错误 | Windows GUI E2E 日志：`Error: writeEvidence(e2e-02): verdict PENDING_REQUIRES_TN01 contradicts the recorded error` |
| T2 | **P1（危险）** | 测试的清理删除了**仓库里所有已提交的验收证据** | 单独跑 `evidence.test.mjs` 后 `git status` 显示 `e2e-01/`、`e2e-02/`、`e2e-03/`、`run-summary.json` 全部被删除 |

### T2 的机制

`written()` 的清理原本是：

```js
await rm(path.dirname(path.dirname(file)), { recursive: true, force: true })
```

对 `writeEvidence('e2e-test-error')`，文件是
`e2e/gui/artifacts/e2e-test-error/<case>.json`，两次 `dirname` 正好落在
`e2e/gui/artifacts` —— `recursive: true` 于是清空了整个证据目录。

这是本轮最危险的一处：它不会让 CI 变红（测试自己是通过的），只会静默删掉
`docs/verification` 体系之外的另一套验收证据。已经被 git 恢复。

修复三件事：
1. 清理只删本次创建的 case 目录（一次 `dirname`）
2. helper 只接受 `e2e-test-` 前缀的临时 id，真实 case id 直接抛错
3. 新增两条测试：拒绝真实 id；跑完整测试文件后 artifacts 目录仍在且含三份已提交证据

### T1 的机制

守卫规则是 `error ⇒ verdict 必须是 FAIL`。`PENDING_REQUIRES_TN01` 是给「已知历史
缺陷」用的合法非通过标签，被这条规则拒绝——而写入发生在运行已失败之后，于是真实的
UI 失败（`activity-rail` 没渲染）被一条守卫错误顶掉，日志里再也看不到它。

守卫真正要防的是「失败却写 PASS」。改为：带 `error` 时不得写通过类 verdict
（PASS/OK/SUCCESS），其它显式非通过标签允许。

---

## 7. 过程中的自伤（记录而非隐藏）

本轮我自己引入并修复的缺陷，全部由门禁或真实数据发现：

1. `attributeJobs` 在 `--jobs` 模式下不构造 API → **所有日志都不取**。
   由 CLI 集成测试发现（`PRODUCT_REGRESSION` 断言失败）。
2. excerpt 取「第一个 anchor 之后」→ 真实日志里截掉了编译错误。
   **由真实 run 的日志发现，不是测试发现**——这正说明 fixture 无法替代真实数据。
3. `layerEntry` 校验 `value ?? 0` 却用原始值求和 → 每个部分调用都报 `INCOMPLETE`。
4. `incompleteEntry` 的 `total` 为 0，与「跑了且没失败」无法区分。
5. 测试 stub 的 regex 转义层层嵌套 → stub 静默不匹配，**让正确的产品代码看起来是坏的**。
   已改成子串匹配，消除整类问题。
6. stub 在 `process.stdout.write` 后立即 `exit` → 8 KiB 管道缓冲截断，
   表现为 `MALFORMED_RESPONSE`。
7. provenance 第一版写成 `workflowPath !== undefined && …` → 等于给「没有 provenance」
   开后门。改为**必填**。
8. GUI 测试的 job 切分用正则，把一个 job 的 `continue-on-error` 算到相邻 job 头上。
9. `paths:` 提取器把块内注释当作列表结束 → 一个都读不到。
10. `pnpm test -- --reporter=json` 转发 `--` → 机器可读报告从未产出（真实 suite 跑完无文件）。
11. 失败 job 被标 `BLOCKED`，真实计数归零。
12. `classifyRun` 在只有 `neutral` job 的 run 上抛 `TypeError`。
13. GUI 契约加了 GUI check 却没写采集器 → 每次发布必然失败。
14. `--print-files` 的失败路径把 `docs_only=false` 写进文件列表。
15. 日志摘要保留「所有 anchor 窗口的尾部」，仍可截掉最早的编译错误。
16. 误提交 763 KB 的 `test-results/vitest.json`。
17. `shas` 挪进 `findMixedCommits` 后，写 JSON 处仍引用它 → `ReferenceError`。
18. **测试的清理 `rm(dirname(dirname(file)))` 删除了整个 `e2e/gui/artifacts`**——
    全部已提交的 GUI 验收证据。测试自身是通过的，所以只有 `git status` 能发现。
19. 证据守卫拒绝 `PENDING_REQUIRES_TN01 + error`，把 Windows 的真实 UI 失败
    替换成守卫错误。

---

## 8. 明确的否定结论

- **不声称**「CI 全绿」：本报告的结论以 `3bea4de` 的 Actions 结果为准，
  在 run 完成前任何「已通过」都是预测。
- **不声称** T18/T20 已验收。没有 Windows runner、没有历史客户端与真实 PG，
  就没有证据。
- **不把** `NOT_RUN` / `NOT_ACHIEVABLE` / `EXTERNAL_ACTION_REQUIRED` 写成 PASS。
- **不把** 单元测试的模拟结果当作真实 GitHub Run 证据。
