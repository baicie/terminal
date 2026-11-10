# Phase 10.1.1 — 凭据生命周期回归收口

- 基线：`main = 7d9639584b944282a383e64d6fe1c3b9dfa2826f`
- 分支：`fix/phase10-1-1-credential-regressions`
- 前置：PR #23（`00643e7`）与 PR #24（`7d96395`）已合入；main CI `42761771099` 11/11

## 1. 一句话结论

Phase 10.1 建立了凭据的**结构边界**（秘密列不在 SQL 文本、四条导入入口统一策略），
但生命周期上有三处确定性缺陷：**部分更新会丢秘密**、**导入准备阶段不补偿自己的写入**、
**版本解析在读失败时猜一个数**。三处都已先红后绿修复。

这不是「Phase 10.1 做错了」，而是它验证的范围是「写入路径不会把明文漏进 SQLite」，
而「一次更新之后用户原来存的东西还在不在」是另一个问题，它没有测。

## 2. 三项审查结论

| WP | 结论 | 证据 |
| --- | --- | --- |
| WP1 Host 部分凭据更新 | **CONFIRMED（函数级）/ DISPROVED（生产可达性）** | 见 §3.1 |
| WP2 Import Prepare 阶段补偿 | **CONFIRMED** | 行号定位 `sync-import.ts:209` 在 `try`（211）之外；`bound.push` 在整行成功后（`import-vault-migration.ts:128/158`） |
| WP3 Version Resolver fail-closed | **CONFIRMED**，且**实际风险大于题设** | 见 §3.3 |

**WP1 的结论被独立复审推翻了一半，这一条必须先说清楚。**

## 3. 每个缺陷的最小复现与失败模式

### 3.1 WP1 — 双秘密主机只改密码，私钥永久丢失

**先给结论，因为它不是完整的 CONFIRMED：**

| 断言 | 判定 |
| --- | --- |
| `persistHostSecrets` 本身会丢未重输的 kind | **CONFIRMED**（真实运行验证） |
| 存在真实 UI 路径能触发它 | **DISPROVED** |

复审推翻的是第二条。`HostDialog` 在两处入口被渲染，**都没有传 `host` prop**：

- `components/top-toolbar/toolbar-overlays.tsx`：`<HostDialog open={...} onClose={...} />`
- `view/hosts/index.tsx:218`：同样是 `<HostDialog open={...} onClose={...} />`

`host` 未传 → `host` 为 `undefined` → `handleSubmit` 走 `addHost` 分支，**永远不到 `updateHost`**。
全仓库唯一提到「编辑主机」的地方是 i18n 文案（`hostDialog.editHost` / `hosts.form.editHost`），
没有任何代码传入 `host`。**编辑已有主机的 UI 在 main 上根本没有接线。**

所以：这是一个**函数级真实、生产不可达**的缺陷。它会在编辑入口接线的那一天立刻变成
数据丢失，但今天没有用户能触发它。

**修复仍然保留**，理由：修复是 20 行、与 `persistKeySecrets` 对齐、且被独立测试覆盖；
留着一个「一旦接线就丢秘密」的陷阱比修掉它更糟。但**不把它记为已发生的事故**。

**设置**（对函数级验证）：`credential_ref = {"kinds":["password","privateKey"],...}`，
vault 持有两把钥匙，秘密列均为 NULL。

**调用**：`updateHost('h1', { password: 'NEW' })`。

**修复前的失败模式**（真实运行输出）：

```
NEW_REF       = {"kinds":["password"],"provider":"vault","version":2}
VAULT_ENTRIES = [["host:h1:2:password","NEW"]]
```

私钥没有版本 2 的副本，版本 1（唯一副本）已被 `retirePreviousVersion` 删除。

**为什么测试没抓到**：现有 5 个相关测试文件 42 项全部在缺陷存在时通过。
`hosts-credential-versions.test.ts` 的双秘密用例**同时写入两个秘密**，`splitHostSecrets`
自然产出两个 kind，引用「碰巧」完整；它的 `kinds:['password','privateKey']` 是对新引用的
**断言**，不是对存储行的**种子**。其余文件种子的 `credential_ref` 要么是 `null`，
要么只含 `password`。

**修复**：`persistHostSecrets` 把未重输的 kind 从旧版本复制到**新版本**（与
`persistKeySecrets` 同一契约）。旧版本不持有该 kind 时**失败**而不是带空洞过去 ——
一个列了但读不出的引用比没有引用更糟。所有被引用的 kind 都在切换引用前读回验证。

### 3.1b WP4 复审另外发现的缺陷：损坏引用的写入路径

复审在尝试推翻 `OLD_CREDENTIAL_PRESERVED_ON_FAILURE=PASS` 时，写出了这条失败用例并**成功**：

```
DAMAGED mapper.credentialRef        = null
DAMAGED mapper.credentialRefProblem = {"kind":"malformed",...}
DAMAGED boundRef = {"kinds":["password"],"provider":"vault","version":1}
DAMAGED vault    = {"1:password":"new-password","1:privateKey":"OLD-KEY"}
```

`credential_ref` 损坏时，mapper 交付的是 `credentialRef: null` **加上** `credentialRefProblem`。
`updateHost` 只看前者，于是把它当成「没有存储凭据」：选版本 1、写入新密码、
产出只列 `password` 的引用。私钥仍在 vault 的同一个版本下，**但没有任何引用能到达它**。

修复前这台主机在连接时会报「请重新保存凭据」—— 一个显式、可恢复的失败。
写入之后它静默变成「只有密码的主机」，**严格更糟**。

这是 Phase 10.1 的 DEFECT-1（损坏引用在连接路径未 fail-closed）在**写入路径**上的镜像：
当时修了读，没修写。

**修复**：`updateHost` 在携带秘密且 `existing.credentialRefProblem` 存在时拒绝写入。
这是连接路径已有的守卫在写侧的对偶。

**这条与 WP1 的可达性不同**：它需要「损坏引用 + 冒号后有秘密写入」，而编辑入口未接线，
所以**当前同样不可达**。但 `clearCredential` 与未来的编辑入口都会走到这里，守卫是必要的。


### 3.2 WP2 — 导入准备阶段失败留下无人回收的密文

**调用链**：`importWithSecretPolicy` 第 209 行 `bound = await migrateSecretToVault(...)`，
`try` 在第 211 行才开。`bound.push` 分别在 `import-vault-migration.ts:128` 与 `:158`，
都在整行写完之后。

**修复前的失败模式**：准备阶段写到第 2 个秘密时抛错 → 第 1 个已写入的密文无人删除；
多个 host 写完后 key 循环因缺 id 抛错 → **全部 host 写入都无人删除**；
而 `catch` 里的 `rollbackMigratedSecrets(bound)` 永远不会执行，因为 `bound` 仍是 `[]`
（赋值从未完成）。

**修复**：逐 kind 记录每次写入（`written`），Prepare 阶段自行补偿；只删本次调用写过的
版本，绝不触碰行原本指向的版本；补偿失败留下脱敏 `console.warn`；原始异常优先。

### 3.3 WP3 — 版本解析在无法读取时猜数（实际比题设更严重）

题设说的是 `localNextVersion()` 读库异常时返回固定 `10000`。**核实后发现那行是死代码**：

`select()` 在 `connection.ts:156-176` 把查询失败转换成 `[]`（只对启动门禁拒绝重抛）。
于是：
- `try/catch` 几乎进不去，`return 10_000` 不生效；
- `[]` 被解析为「这一行没有引用」，于是返回 **版本 1**。

版本 1 恰恰是最可能正在被使用的版本 —— 这比固定 10000 更危险，因为 10000 至少不太可能撞上。
`vaultService.set` 是 `config.entries.insert(key, ...)`，**无条件覆盖**。

**修复前的失败模式**：数据库读失败（启动门禁阻塞、连接未就绪、瞬时 I/O 错误）时，
导入会以版本 1 覆盖用户的在用密码，并且 `Merge` 模式下该行不会被改写，
**行继续指向版本 1，解析出的却是导入值** —— 用户的密码从 vault 里静默消失。

此外：损坏引用（`parseCredentialRef` 返回 `ok:false`）原本也被当作 `null` → 版本 1。

**修复**：改用 `selectStrict`（启动恢复路径专用，本就是为区分「没有行」与「读不到」而写），
读失败与损坏引用**一律拒绝本次写入**，不再猜。回退固定数字与回退版本 1 都被移除。

**为什么不过度设计**：没有引入版本分配表、没有加锁、没有改 schema。拒绝写入是
最小且可靠的答案 —— 导入可以重试，被覆盖的凭据不能。

### 3.4 并发写入方的真实边界（记录，不在本轮修复范围）

两个导入方同时读同一行会各自选到 `N+1` 并互相覆盖。当前产品的导入是**单实例、
用户逐次触发**的（`tauri-plugin-single-instance` 已在 Phase 9.7 落地，运行时锁保证
一个数据目录只有一个进程），因此同进程内不存在并发导入；跨进程则被运行时锁挡住。
这条**不以 PASS 记录**，见 §6。

## 4. 回归测试

三个新文件共 25 项，全部先红后绿：

| 文件 | 项数 | 覆盖 |
| --- | --- | --- |
| `database/hosts-partial-secret-update.test.ts` | 9 | password-only / privateKey-only / 三秘密 / 旧版本不持有该 kind / 结转顺序 / **损坏引用拒绝写入** / **mapper 交付 null+problem** / **legacy 无版本引用结转** |
| `import-vault-migration.test.ts` | 8 | 第二个写失败 / 读回不符 / 后续行缺 id / key 循环失败 / 不删在用版本 / 异常不被覆盖 / 补偿失败可见 |
| `import-vault-version.test.ts` | 8 | 读失败拒绝 / 不当作无引用 / 损坏引用拒绝 / 新版本引用拒绝 / N→N+1 / 无引用→1 / legacy→1 / 连续导入递增 |

**先红证据**（修复前）：

- WP1：`5 failed | 1 passed (6)`
- WP2：`4 failed | 4 passed (8)`
- WP3：`6 failed | 2 passed (8)`
- 损坏引用（WP4 复审发现）：`1 failed | 7 passed (8)`

**测试用的是真实 mapper**，不是 `JSON.parse` 的替身。这一条是刻意的：损坏引用的
行为完全由 mapper 决定（它把 `credentialRef` 变成 `null` 并把原因放进
`credentialRefProblem`），一个手写的替身会把这个 case 直接藏起来 ——
本轮第一版测试就是那样写的，直到复审指出。

## 5. 门禁结果

| 项 | 结果 |
| --- | --- |
| 前端全量 | **198 文件 / 1776 项通过**（基线 195 / 1751，新增 3 文件 25 项） |
| service 层 | 51 文件 / 468 项通过 |
| typecheck | 通过 |
| ESLint | 0 error / 0 warning |
| source-size | **624** 个生产文件通过 |
| 证据门禁 | **0 problem**，六份证据 + 七个原始日志，run `42773465085` |
| Rust lib | 381 passed / 0 failed（本轮未改 Rust） |

本轮过程中被 CI 抓到一个**自己引入的**规范违反：给 `hosts.ts` 加守卫注释后
文件达到 316 行，超过 `source-size` 的 300 行上限。已把 `hostUpdateArgs`（纯 SQL
参数构造）拆到 `host-update-args.ts`，`hosts.ts` 回到 257 行。

记录这一条是因为它说明：改完代码后**没有立刻重跑全部门禁**，而是等到 CI 才
发现。项目里这不是小事 —— 源码改动会让证据失效，任何补丁都会再触发一轮重采。

### 5.1 Rust

本轮只改前端 TypeScript，Rust 无改动。Rust 门禁按 CI 结果记录，不在本机冒充。

## 6. 没有以 PASS 记录的项

以下**不得**因为本轮的测试通过而被读成已验证：

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 真实 GUI 的 Vault 创建/解锁/改密/重启 | NOT_RUN | 需真实 GUI 交互 |
| Vault 密码/私钥真实 SSH 登录 | NOT_RUN | 需真实 sshd + 真实 Vault 会话 |
| Jump Host 双端凭据 | NOT_RUN | 同上 |
| SFTP（本轮改动后） | NOT_RUN | 未重跑 |
| 中文 IME / 物理键盘 | NOT_RUN | 无辅助功能权限 |
| macOS / Windows / Linux 真机回归 | NOT_RUN | 无环境 |
| 两个写入方并发导入同一行 | **NOT_VERIFIED** | 单实例 + 运行时锁使其在当前架构下不可达，但**没有测试证明**，因此不记 PASS |
| 真实用户数据库迁移 | 按规范不做 | — |
| 历史 WAL 与备份明文擦除 | NOT_RUN | 需用户单独授权 |

## 7. 是否引入新的凭据兼容性问题

**不引入**，理由逐条：

| 兼容面 | 影响 |
| --- | --- |
| 老引用（无 `version` 字段） | 不受影响。`refVersion` 仍返回 `LEGACY_VERSION=0`，导入时以 0+1=1 向前写，不覆盖 legacy 键 |
| 老引用（`host:<id>:<kind>`） | 读取路径未改；`vaultKey` 对 `LEGACY_VERSION` 的拼法未动 |
| `clearCredential` | 语义未变，仍走「先 UPDATE 置 NULL，再删 vault」的独立分支 |
| Merge / Replace 模式 | 未改；`retirePreviousVersion` 仍只在新引用提交后调用 |
| 导出 / 导入格式 | 未改；`boundRef` 形状不变（`{kinds, provider, version}`） |
| `createHost`（`current === null`） | 不受影响；`kinds` 并集为空集与 supplied 的并，行为与之前一致 |
| 团队包导入 | 走同一 `importWithSecretPolicy`，行为随之收紧（更安全，不变更格式） |

**唯一的行为收紧**：导入时若本机该行的 `credential_ref` 损坏或不可读，现在会**拒绝导入**，
而以前会静默写到版本 1。这是刻意的 fail-closed，用户会看到明确的错误而不是丢失密码。

## 8. 判定

```
HOST_PARTIAL_SECRET_UPDATE_SAFE=PASS（函数级；生产编辑入口未接线，see §3.1）
IMPORT_PREPARE_ROLLBACK_SAFE=PASS
CREDENTIAL_VERSION_NO_COLLISION=PASS（单进程内）
OLD_CREDENTIAL_PRESERVED_ON_FAILURE=PASS
HOST_EDIT_UI_WIRED=NO（编辑已有主机的入口不存在，因此 WP1 的缺陷当前不可达）
CROSS_PROCESS_CONCURRENT_IMPORT=NOT_VERIFIED

PHASE10_1_1_VERDICT=PARTIAL
DAILY_DRIVER_READY=NO
TABBY_REPLACEMENT_READY=NO
```

`PARTIAL` 的理由与前几轮一致且未变：代码层面的确定性缺陷已修且可复现验证，
但真实 GUI 的凭据链路、三平台真机、历史明文擦除全部 NOT_RUN。

**另外必须写明的两条**：

1. `HOST_PARTIAL_SECRET_UPDATE_SAFE=PASS` 只在函数级成立。生产编辑入口不存在，
   所以这个 PASS 描述的是「接线后不会丢」，不是「今天不会丢」。
2. 报告初稿曾声称 WP1 走真实 UI 链路可达，**该说法被独立复审推翻并已更正**。
   这是本轮最重要的过程记录：一个在干净 worktree 上真实运行验证过的缺陷，
   仍然可能在可达性上判断错误。

## 9. Phase 10.2 产品验收准备情况

**未就绪。** 本轮关闭的是「会让用户静默丢凭据」这一类缺陷，这是 10.2 验收的**前置条件**
而不是它的内容。10.2 需要的真机矩阵（Vault 解锁后真实 SSH 登录、Jump Host 双端、
SFTP、三平台）本轮一条都没有执行。

可以给 10.2 的输入是：一个**不会再无声丢秘密**的写路径，以及
`OLD_CREDENTIAL_PRESERVED_ON_FAILURE=PASS` 这条可以在真机上被检验的不变量。
