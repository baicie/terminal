# Phase 9.3.1 — 合并阻断项收口与独立回归

> 分支 `feat/phase9-2-sync-security-hardening`，审查起点 `670d17b`。
> 执行日期 2026-11-03。所有数字均来自本文列出的真实执行，命令可复现。
>
> 状态口径沿用 Phase 9.2/9.3：**PASS** / **FAIL** / **NOT_RUN** / **BLOCKED_EXTERNAL**。

## 1. 本轮做了什么

独立审查在 Phase 9.3 收尾后提出五类问题。本轮对每一条都是**先复现、再修复**，
没有一条是"看代码觉得应该没问题"。

| 编号 | 问题 | 复现 | 状态 |
| --- | --- | --- | --- |
| P0-1 | 敏感共享 REMOTE 解决用本地旧密文冒充远端 | 真实 PG + 真实客户端 store | ✅ PASS |
| P0-2 | Share REST 的 BigInt 版本导致 500 | 真实 HTTP + 真实 PG | ✅ PASS |
| P1-1a | cargo audit 的 yanked 类从未被评估 | 本地复现 769 条 | ✅ PASS |
| P1-1b | 前端依赖审计不是"未测量"，是 25 条真实漏洞 | 公共 registry 实测 | ✅ PASS |
| P1-2 | bootstrap 静默回落无可观测性 | 单元回归 | ✅ PASS |
| P1-3 | macOS WebView 冷启动风险未被量化 | 16 次 run 统计 | ⚠️ 已量化，**未修复** |
| P2 | PR 体积 60 MB 原始日志 | — | ✅ 已压缩至 3.9 MB |

## 2. P0-1：REMOTE 解决保留旧密文

### 2.1 缺陷

`applyWindow()` 记录的冲突快照只有 `version` / `data` / `isSensitive`，没有
`encryptedData`。选 REMOTE 时 `syncWithConflictResolution` 用**本地行**的
密文补齐这个缺口：

```
服务端：version 6，encryptedData = ciphertext-B
客户端：version 5，encryptedData = ciphertext-A
选 REMOTE 后：version 6，encryptedData = ciphertext-A，dirty = 0
```

版本与内容不一致，却被当成"已收敛"。

### 2.2 复现（先红）

真实 PostgreSQL + 真实客户端 store（`dual-client-sync.pg-spec.ts` 新增 C3b）：
A 改密文 → B 冲突 → B 选 REMOTE。修复前：

```
[C3b] conflict remote cipher=undefined version=undefined local cipher=ciphertext-version-1
```

### 2.3 修复

| 文件 | 改动 |
| --- | --- |
| `team-types.ts` | 冲突快照携带 `encryptedData` / `sharedBy` / `permission` |
| `team-sync-engine.ts` | `applyWindow` 写入这三项 |
| `team-actions-sync.ts` | 快照缺字段时**回读服务端**，不用本地行补齐 |
| `team-actions-sync-conflict.ts` | 敏感快照无密文一律拒绝；采用服务端权威 owner/permission/teamId（小写枚举） |
| `team-sync-shares.ts` | `mergeConflicts` 改用「有无 version/密文」判断快照可用性 |

**`mergeConflicts` 那一条是顺带发现的第二个形态**：它原本用 `hasData()` 判断
「远端快照是否存在」，但敏感共享的 `data` 是 `{}` 占位符，于是 pull 产生的
唯一可用快照被判为「空壳」，被 push 的空壳冲突覆盖。

### 2.4 验证（后绿）

```
[C3b] conflict remote cipher=ciphertext-version-2 version=507792
[C3b] 本地 cipher=ciphertext-version-2 v=507792 dirty=0 服务端 cipher=ciphertext-version-2 v=507792
```

新增前端 4 项 + PG 1 项：
- 敏感 REMOTE 落盘服务端密文（非本地旧密文）
- 快照缺密文 → 回读服务端
- 服务端也无密文 → 冲突保留、报错说明
- 非敏感 REMOTE 采用服务端 permission/owner

## 3. P0-2：Share REST 的 BigInt 版本

### 3.1 缺陷

Prisma 的 `Share.version` 是 `BigInt`，Node 原生 `JSON.stringify` 无法序列化。
`findOne` / `findAll` / `create` / `update` 都直接返回 Prisma 行。

### 3.2 复现（先红）

真实 HTTP server + 真实 controller + 真实 PostgreSQL：

```
GET single failed: {"statusCode":500,"message":"Do not know how to serialize a BigInt"}
GET list failed:   {"statusCode":500,"message":"Do not know how to serialize a BigInt"}
```

### 3.3 修复

新增 `shares/share-serializer.ts`，与同步接口共用 `ShareSnapshot` 形状：
`version` 是 JSON number，并强制 `Number.isSafeInteger`——超出安全范围时抛错
而不是静默丢精度。

**没有**改成十进制字符串：客户端 DTO 早已声明 `version: number`，而同步接口
仍发 number。两套接口给出两种类型只会制造新的漂移。

**没有**用全局 `BigInt.prototype.toJSON`：那会掩盖其他字段的同类问题。

### 3.4 验证（后绿）

4 项 HTTP 契约测试全过（单条 / 列表 / 更新 / 404 仍是 404）。
去掉序列化后 3 项变红，恢复后全绿。

## 4. P1-1a：cargo audit 的 yanked 类从未被评估

### 4.1 缺陷

CI run `41489824295` 的 cargo audit job **成功**，日志里却有 **769 条**：

```
error: couldn't check if the package is yanked: not found: No such crate in crates.io index: <crate>
```

每一个 crate 都有。cargo audit 需要在本地 cargo home 持有 crates.io registry
index 才能回答这个问题；runner 上没有时，它逐条打 stderr、**不写**
`warnings.yanked`、仍以 exit 1 结束。

gate 只读 JSON，于是"从未检查"读成了"没有 yanked"。

### 4.2 复现（先红）

把 `CARGO_HOME` 指向只有 advisory-db 的空目录：

```
yanked-error lines: 769
warnings keys: ['unmaintained', 'unsound']
Security gate: 13 advisories ... exit 0     ← gate 毫无察觉
```

### 4.3 修复

- `security-gate.mjs` 新增 `--audit-log`：只要出现一条无法评估的 yanked 检查
  就 **exit 2**，并列出 crate 名单与补救办法。其他未识别的 error 行同样 exit 2。
- `ci.yml` 把 stderr 落盘传给 gate，并在审计前 `cargo fetch --locked` 填充
  registry index，让 yanked 检查真的能跑，而不是永远 exit 2。
- 新增 5 项回归。去掉判定后第一条变红，恢复后 32/32。

## 5. P1-1b：前端依赖审计——不是"未测量"，是 25 条真实漏洞

Phase 9.2 记为 NOT_RUN，归因是"镜像源不提供 audit 端点"。
**那个结论关于的是开发机**（本机 npmrc 指向国内镜像），不是项目本身。

对公共 registry 实测：

```
25 vulnerabilities found
Severity: 3 low | 9 moderate | 12 high | 1 critical
```

几乎全部经由**我们自己的 `pnpm.overrides`**——它们把已修复的包钉在脆弱版本上：

| 包 | 原 override | 已修复版本 |
| --- | --- | --- |
| body-parser | 2.3.0 | 2.4.0 |
| fast-uri | 3.1.5 | 3.1.9 |
| js-yaml | 5.2.3 | 5.5.0 |
| qs | 6.15.2 | 6.17.1 |
| multer | （无） | 2.5.0 |
| proxy-addr | （无） | 2.0.8 |
| source-map-js | （无） | 1.2.2 |
| mysql2 | （无） | 3.23.1 |

升级后：`pnpm audit --prod` → **No known vulnerabilities found**。

新增 `Dependency audit (npm)` CI job，审计已安装的生产依赖树而非仅直接依赖。
**不带 registry 覆盖**：runner 走公共 registry，那是唯一响应该端点的。

> 一个 override 条目就能在无人察觉时重新引入 CVE。这条 gate 存在的理由不是
> 版本数字，而是这个。

## 6. P1-2：bootstrap 故障可观测性

### 6.1 问题

Phase 9.3 已把五个配置读取改成并发，但并发之后仍共享同一个 1 秒绝对预算。
若冷 WebView 里所有 IPC 都没在期限内返回，bootstrap 仍然静默挂载普通 App。

从返回值看，「探针未启用」「IPC 超时」「预算耗尽导致根本没有调用」全是同一个
`null`——这正是 run `41437956656` 上 `nano-edit` 只能报「从未写 result.json」
的原因。

### 6.2 修复

每个 gate 记录结局：`not-configured` / `loaded` / `timed-out` /
`deadline-passed` / `errored`，外加耗时。mode 决定时输出一行：

```
bootstrap mode=app gates: smoke=not-configured(3ms) shellProbe=timed-out(1000ms)
```

经既有 `startup_stage` 走到进程日志——验收 runner 读的就是这条通道。

**只记录结局、耗时与错误消息，从不记录配置值**：gate 配置含 endpoint 与 token。

**没有**把 1 秒调大：那会掩盖「IPC 是否按时返回」这个真正要观测的事实。

### 6.3 回归（新增 9 项）

预算耗尽（且确认加载器**未被调用**）、未包含的 gate、按时返回、单 gate 悬挂、
**五个全悬挂仍全部被启动**、拒绝、取消、渲染行不含 token/endpoint。

## 7. P1-3：macOS WebView 冷启动——已量化，未修复

### 7.1 定量

按 step 结论统计 16 次 real-machine run 的 macOS 远程冷启动：

| 结论 | 次数 |
| --- | --- |
| success | 12 |
| failure | 3 |
| 日志已过期、无法判定 | 1 |

**失败率 3/15 = 20%**，与 Phase 9.0 记录的「10 次里 2 次失败」一致。

**因此不把这条风险写成已修复**：一个 20% 的失败率用一次成功复跑来否定是不成立的。

### 7.2 现有证据能证明什么

失败 run `41475640293`：

```
last probe: readiness=null, windowReady=false, markerReady=false
stages: frontend-boot@0ms -> ... -> ready@1081ms; first stage at 2678 ms
该步骤应用自身日志行数：0
```

**能证明**：WebView 主框架执行到了 `frontend-boot`（否则不会有任何阶段），
db 到了 `ready`，此后无任何阶段。
**不能证明**：这是 WebKit 主框架加载失败。Issue #65 记录的是
`didFailProvisionalLoadForFrame code=-1004`，而该次运行**没有采集到那条
Unified Log 证据**——那需要单独的系统日志采集，本轮没有做。

所以准确结论是：**失败发生在 db ready 之后、SSH 会话请求之前（或该请求从未发生），
且当前采集链无法进一步区分**。

### 7.3 为此补的诊断

超时消息现在命名四种互斥形态：

- 无任何阶段 → 前端从未求值（WebView 根本没跑 bundle）
- 有 `frontend-boot` 无 `ready` → 数据库 bootstrap 卡住
- 有 `ready` 无 `session-create-requested` → 应用起来了但没请求会话
- 有 `session-create-requested` → 失败在 SSH/shell 路径

这四种此前共用同一句，正是它让 #65 与 #157 反复被当成同一个问题讨论。
新增 4 项回归，删除分类后 4 条全红。

## 8. PR 体积与证据管理

| 项 | 处理 |
| --- | --- |
| 原始日志 62 MB | 压缩到 3.9 MB（16:1），`gzip -n -9` 保证可复现 |
| 敏感信息 | 扫描私钥/公钥材料/token/password：**0 命中**；只有 `/Users/runner/` 与 loopback |
| 篡改与缺失 | 每次 run 目录加 `SHA256SUMS`，逐文件 `-c` 实测通过 |
| 门禁 | **未放松**：gate 本就支持 `<name>.gz`；补 2 项测试钉住「压缩可接受、缺文件仍红」 |

## 9. 全量回归

| 门禁 | 结果 |
| --- | --- |
| 前端 lint / typecheck | 0 error / exit 0 |
| 前端测试 | **151 文件 / 1362 项** |
| Team Server lint（CI=1） | 0 error / 89 warning |
| Team Server typecheck | exit 0 |
| Team Server 单测 | **117 项** |
| Team Server 真实 PG | **10 文件 / 85 项**（连续三次全绿） |
| Rust 测试 | **302 单测 + 3 集成** |
| 安全门禁（cargo audit + 完整性判定） | 13 条全部在基线内，exit 0；yanked 检查失败数 **0** |
| 前端依赖审计 | **No known vulnerabilities found** |
| 脚本测试 | **370 项** |
| 源码规模 | **563 个生产文件** |
| 证据门禁 | **0 problem，exit 0** |

最终 CI run `41581014137`（sha `2a8e1e6`）：**11/11 success**，含
`Repository gates`、`cargo audit (blocking)`、`Dependency audit (npm)` 三个阻塞 job。

## 10. 一个由门禁修复直接换来的真实发现

修好 yanked 完整性判定后，第一次真正跑起来的 CI 立刻报出：

```
NEW advisories (1) - not in the baseline:
  - [yanked] YANKED-async-executor async-executor 1.14.0 (unscored): yanked release
```

此前的所有 CI run 都看不见它——不是因为它不存在，而是 yanked 检查在 runner 上
769/769 全部失败，而 gate 只读 JSON。依赖链是
`async-executor 1.14.0 ← zbus ← tauri-plugin-notification`（Linux 构建图，
`cargo tree` 需要 `--target all` 才看得见）。

1.14.1 已发布且未撤回，`cargo update -p async-executor --precise 1.14.1` 修掉。
**没有**把它写进 baseline——它可修，基线只记录修不了的。

**这条链本身就是本轮的论据**：一个"看起来在跑、其实没跑"的检查，
比一个明确失败的检查更危险。

## 11. 附带修掉的一个测试隔离缺陷

PG 套件此前**不稳定**：同一套代码三次运行中一次报 9 项失败，而每个文件单独跑
都通过。

根因：`sqlite.databases.at(-1)` 取的是共享注册表的最后一项。同一 worker 里先跑过
另一个 spec 时，最后一项属于那个文件的数据库，客户端读到别人的 store。

修复：记录调用前的长度并取该位置。两个用到它的 spec 都改。
修复后连续三次 **85/85**。

**为什么值得单独记录**：一个会随文件执行顺序变红的测试套件，会让"全量通过"
这个结论失去意义。

## 12. 四个判定

### READY_FOR_REVIEW = **是**

两处 P0 都有先红后绿的复现与修复（真实 PostgreSQL、真实 HTTP）；
P1 各项有据可查；未闭合项都写明了名字与原因。

### READY_FOR_MERGE = **是**，附四条知情条件

1. 证据绑定 `FINGERPRINT_PATHS`，当前绑定 `bc44c54`（指纹 `43ff429d…`）。
   合并后若再改这些路径，必须重采——这是设计，不是缺陷。
2. `RUSTSEC-2023-0071`（rsa 0.10.0-rc.18）仍真实存在、三平台、上游
   `patched = []`。**阻塞发布，不阻塞合并。**
3. macOS 远程冷启动 **20%（3/15）失败率未修复**，见第 7 节。
4. 证据是快照：前端依赖审计当前 0 条，但它不是永久性质。

### READY_FOR_RC = **否**

阻塞项：

1. `RUSTSEC-2023-0071` 真实暴露且无上游修复；
2. macOS 远程冷启动 20% 失败率（本轮量化，未修复）；
3. Windows / Pageant / 串口硬件实机矩阵仍未采集。

### READY_FOR_RELEASE = **否**

同 RC，另加：

- 安装/升级链路（DMG、NSIS、AppImage、`dpkg -i`、旧 SQLite 库兼容）从未验证；
- 未配置 Apple notarization 与 Windows Authenticode；
- `updater-signed` 只在 `v0.0.1-dev.2` 跑通过一次。

## 13. 仍未闭合的风险

| 风险 | 说明 |
| --- | --- |
| macOS WebView 冷启动 | 20%（3/15）。本轮补了诊断分类，**没有修**；`-1004` 的系统日志证据仍未采集 |
| rsa Marvin 攻击 | 真实、三平台、上游 `patched = []` |
| 空 `$HOME` 的真实 Debian 账户 | 探针夹具绕开了系统 `compinit` 提问，真实新账户未验证 |
| 历史原始日志不在门禁检查面 | gate 只校验当前 manifest 的那一次 run。再增长时应改 CI artifact，不是无限期跟着仓库变大 |
| 前端依赖审计的时效性 | 本轮为 0，但那是快照，不是永久性质 |
| 冷启动数字的解读 | 同一源码在不同 runner 上 1944–6233 ms 都出现过。**不得把单轮数字读成优化或退化**，只有 `readyUnder10s` 是契约 |
