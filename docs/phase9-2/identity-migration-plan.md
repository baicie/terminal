# 身份迁移方案（P9.2-12）

> **状态：本阶段未改 identifier、未改 productName、未移动或删除任何旧数据目录。**
> 本文只做一件事：把「如果要改，必须按什么顺序、用什么测试证明、失败怎么回滚」
> 写成可执行的门禁清单。
>
> 任务书原文：「**没有完整迁移测试前，不要直接更改 identifier 或删除旧数据目录。**」
> 本阶段遵守这一条，且把它落成了本文第 5 节的测试前置条件。

## 0. 结论先行

| 项 | 状态 |
| --- | --- |
| identifier / productName 变更 | 🔴 **未执行**（P9.2-12 只交付方案） |
| 旧数据目录清理 | 🔴 **未执行**，且方案明令禁止自动清理 |
| 迁移代码骨架 | 🔴 **不存在**（`src-tauri/src/` 下无任何 identity/migration 模块） |
| 本文档 | ✅ 方案 + 测试前置 + 受影响面清点 |

上一轮的 `docs/phase8/identity-migration.md` 已经写了「要按什么状态机迁移」。
本文补的是它没有的三块：**本阶段实测到的硬编码身份点**、**测试先行的验收条件**、
以及**为什么现在不能做**。

## 1. 当前身份面（实测，非推断）

```
src-tauri/tauri.conf.json:3    "productName": "Termius"
src-tauri/tauri.conf.json:5    "identifier":  "com.baicie.termius"
src-tauri/tauri.conf.json:17   "title":       "termius"        // 主窗口
src-tauri/tauri.conf.json:53   updater endpoint → github.com/baicie/terminal/releases/...
```

### 1.1 数据落点：两条互不相干的路径

| 数据 | 解析方式 | 实际路径 | 跟着 identifier 变？ |
| --- | --- | --- | --- |
| `terminal.db` | `sqlite:terminal.db` 相对路径 → 插件解析到 `app_config_dir()` | `<config>/<identifier>/terminal.db` | **是** |
| `vault.json` | `dirs::config_dir()/terminal/vault.json`，`get_vault_path()` 硬编码 | `<config>/terminal/vault.json` | **否** |

出处：`src-tauri/src/db_import/mod.rs:30`（`DB_KEY`）、
`packages/frontend/src/service/database/connection.ts:9`、
`src-tauri/src/vault.rs:917-921`。

**这条不对称是整件事的核心风险**：改 identifier 之后，数据库"搬家"了，
vault 却原地不动。于是会出现「主机列表空了，但保险库还能解锁」这种一半搬一半没搬的状态。
任何"数据都还在"或"数据丢了"的结论都必须分别对这两条路径成立。

### 1.2 硬编码了旧 identifier 的地方（改了就会一起坏）

| 位置 | 内容 | 失效表现 |
| --- | --- | --- |
| `scripts/verify-install-macos.sh:45` | `EXPECTED_ID=com.baicie.termius` | 安装链验证会在「应用应在此创建 terminal.db」处失败 |
| `scripts/verify-install-linux.sh:45` | `EXPECTED_ID=com.baicie.termius`，`:141/:167/:315` 用它拼数据路径 | 同上 |
| `scripts/run-remote-cold-start-stopwatch.mjs:14` | `APP_BUNDLE_ID = 'com.baicie.termius'` | 冷启动探针找不到应用的配置目录，会读不到游标 |
| `scripts/run-remote-cold-start-stopwatch.test.mjs` | 4 处 fixture 路径含该标识 | 脚本自测会红 |

这四处**不是"顺手改一下"**：它们都是证据产出链路。改 identifier 的同一个提交
必须同时改它们，否则安装链验证与冷启动测量的结论会静默变成"路径不存在→零数据→通过"。
这正是本文第 5 节要求"迁移测试先行"的原因之一。

## 2. 为什么本阶段不做

三个独立理由，任一成立都足够：

1. **任务书直接禁止**：没有完整迁移测试前不改 identifier。
2. **迁移代码不存在**：`src-tauri/src/` 里没有 identity 探测、没有迁移标记、
   没有 DB 复制/校验/切换。现在改 identifier 等于让所有现有用户的 terminal.db
   在新版本里**找不到**——而应用不会报错，它会创建一个空库正常启动。
3. **本阶段已有的备份机制不是迁移机制**：`db_import/backup.rs` 的
   `backup_database_before_migration()` 是 **schema 迁移前**的 `VACUUM INTO` 快照
   （保留 5 份，只读重开校验），它保护的是"ALTER TABLE 把库改坏"。
   它**不跨目录**，也不认识 identifier。把它当身份迁移用是错的。

## 3. 迁移必须遵守的形态（承自 phase8 设计，这里只列不可协商项）

| 规则 | 原因 |
| --- | --- |
| **复制**而非移动 | 移动一旦中途失败，源与目标都可能不完整 |
| 任一步失败 → 源不动 + 删目标 + `rolled-back` | 不允许"降级到旧库继续写"，否则双库双写 |
| 状态机幂等：唯一判据是「目标是否已完整且哈希一致」 | 杀进程/断电后重启必须能收敛，不能依赖内存状态 |
| 目标已存在且哈希不同 → **判冲突，不覆盖** | 覆盖等于销毁用户数据 |
| 迁移只在启动最早阶段执行 | 晚于任何 DB 写入就需要第二套并发保护 |
| **禁止**自动删除旧目录 | 清理是独立、显式、人工触发的操作 |
| vault 路径变更必须单独评审 | 它是"创建永不覆盖"语义，建错路径等于空 vault 顶替真数据 |

完整状态机（`backed-up` / `copied` / `verified` / `active` / `rolled-back` 及各自重启行为）
见 `docs/phase8/identity-migration.md` §4；失败模式与回滚矩阵见其 §7。本文不重复。

## 4. 建议的实施顺序（每步都可独立回滚）

1. **只读探测骨架**：能定位 legacy / current / legacyVault 三者，只做存在性与大小/哈希，
   不读不解析 vault，不写任何标记，对所有启动零行为变更。
2. **迁移标记 + 状态机**，仍不改 identifier；用环境变量把"新 id"指向一个临时目录来测。
3. **DB 备份/校验/切换/回滚**接上第 2 步，仍用环境变量。
4. **单独决策 vault 路径**：维持现状（推荐）或字节级迁移 + 解锁探针，写死结论。
5. **最后**才改 `identifier` / `productName`，并在同一提交里改第 1.2 节的四处硬编码。
6. 发一个**旧 id 的过渡版本**——updater 按 bundle id 判定同源，旧包不会自动升级到新 id。

## 5. 测试前置条件（未满足前不得改 identifier）

这部分是本阶段对 phase8 设计的**新增**，也是任务书那句"没有完整迁移测试前"的具体化。
每一条都必须是能在 CI 上跑的红→绿：

| # | 测试 | 断言 |
| --- | --- | --- |
| T1 | legacy 存在、current 不存在 | 完整走完 backed-up → verified → active；源文件字节未变 |
| T2 | 目标已存在且哈希与源一致 | 判为已迁移，**不重复复制**（幂等） |
| T3 | 目标已存在但哈希不同 | 判冲突，**不覆盖**，两文件都还在 |
| T4 | 复制后目标被截断 | 检测到 → 删目标 → `rolled-back`；源仍可读 |
| T5 | 迁移中途 kill 进程，重启 | 按 state 收敛，最终 active 或 rolled-back，无第三种状态 |
| T6 | 备份阶段失败（只读目录 / 磁盘满） | 立即中止，不写标记，旧路径正常启动 |
| T7 | 新库打不开 / `integrity_check` 失败 | 删目标、`rolled-back`、旧数据可用 |
| T8 | legacy 与 current 同时存在且不同 | 启动但持续提示；**不自动合并** |
| T9 | vault 路径未变 | 解锁成功，且**没有**创建第二份 vault.json |
| T10 | 安装链 | `verify-install-macos.sh` / `verify-install-linux.sh` 用新 id 全绿 |
| T11 | 冷启动探针 | `run-remote-cold-start-stopwatch.mjs` 用新 id 能读到应用自建目录 |
| T12 | 升级路径 | 旧 id 版本 → 新 id 版本，**真实数据留存**逐字段比对 |

T1–T8 是纯 Rust 单测可以覆盖的（`db_import/tests.rs` 已有 12 个用例的测试风格可以直接复用）；
T10–T12 必须在真实 runner 上跑，且 T12 需要**两个版本**的安装包——当前 CI 只构建一个版本，
这是它成为 NOT_RUN 而不是 PASS 的原因（与 `docs/phase9/startup-and-migration.md` §6 记录一致）。

## 6. 明确不做的事

- ❌ 不改 `productName` / `identifier` / 窗口 title；
- ❌ 不移动、不删除 `<config>/com.baicie.termius/`；
- ❌ 不移动、不删除 `<config>/terminal/vault.json`；
- ❌ 不预先写一份"以后能用的"迁移代码到产品路径里（死代码会腐坏，且必然无测试）；
- ❌ 不因为"只是占位名"就顺手改名。

## 7. 状态

| 项 | 状态 | 归属 |
| --- | --- | --- |
| 方案（本文 + phase8 设计） | ✅ 完成 | P9.2-12 |
| 硬编码身份面清点 | ✅ 完成（4 处，见 1.2） | P9.2-12 |
| 测试前置条件 | ✅ 列出（T1–T12） | P9.2-12 |
| 迁移实现 | 🔴 **NOT_RUN**（按约束不做） | 后续阶段 |
| 商标清查 / 法务确认 | 🔴 **BLOCKED_EXTERNAL** | 非工程侧 |
