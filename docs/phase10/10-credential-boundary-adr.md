# ADR: 凭据安全的完整边界（Phase 10.1）

状态：已接受
取代：`08-credential-single-write-path-adr.md` §4、§6 中关于「覆盖同一 key 是安全的」的结论
相关：`docs/phase10/04-architecture-and-credential-policy.md`、`docs/phase10/09-pr22-review-remediation.md`

## 1. 问题：Phase 10 的边界只覆盖了它自己写的那一条路径

Phase 10 把「秘密进 Vault、SQLite 列恒 NULL」做成了 `service/database/hosts.ts`
的一个性质，并用测试锁住。但它漏掉的是**入口**，不是实现：

| 入口 | Phase 10 状态 | 实际后果 |
| --- | --- | --- |
| 新建 / 编辑主机 | ✅ 唯一写入路径 | 安全 |
| Rust `import_backup_data` | 🔴 `HOST_INSERT`/`SSH_KEY_INSERT` 仍绑定秘密列 | 任何备份导入都写入明文 |
| 旧版备份导入 | 🔴 无策略、无提示 | 用户的密码被静默丢弃或被明文写入，二选一都是错的 |
| 云端同步恢复 | 🔴 走同一条 Rust 导入 | 同上 |
| 团队包导入 | 🔴 走同一条 Rust 导入 | 同上 |
| `syncServiceToken` | 🔴 位于 `app_settings` JSON 内部 | 导出文件与云上传都带真实存储凭据 |
| SSH Key 秘密 | ⚠️ 写入 Vault，但 `getSSHKeySecret` 无调用方 | 保存成功却永远读不回来 |
| 多秘密更新 | 🔴 固定 key 直接覆盖 | 第一部分成功、第二部分失败时留下从未存在过的组合 |
| 损坏的 `credential_ref` | 🔴 解析失败返回 `null` | 与「没有凭据」同义，导致空密码登录 |
| 历史明文迁移 | ⚠️ 只有规则与 Fake Vault 测试 | 无生产调用链，等于未实现 |

结论：**「新建路径安全」和「凭据系统安全」是两件不同的事。** 本轮以「所有入口
经过同一个边界」为目标，逐个封堵。

## 2. 决定一：Rust 写入端的秘密列在 SQL 文本里就不存在

`db_import/writer.rs` 的 `HOST_INSERT` / `HOST_UPDATE` / `SSH_KEY_INSERT` /
`SSH_KEY_UPDATE` 现在把秘密列写成**字面 `NULL`**，占位符数量相应减少。

为什么不是「绑定 NULL」：绑定 NULL 仍然保留一个参数位，任何一次「顺手传个值」
的改动都不会失败，只会悄悄恢复泄露。字面 NULL 让重新引入秘密必须同时修改 SQL 与
参数构造函数，而这正是 `db_import/tests.rs` 直接断言的东西。

## 3. 决定二：导入的秘密策略是三态，默认拒绝

`ImportPayload.secrets` 为 `reject` / `migrate` / `discard`，缺省与未知值都按
`reject`。理由是三种情况需要三个不同答案，而默认值必须是最安全的那个：

| 策略 | 含义 | 后端行为 |
| --- | --- | --- |
| `reject`（默认） | 调用方没有对秘密作出决定 | 文件含明文即整批拒绝，返回各类型计数 |
| `discard` | 用户选择不带走凭据 | 剥离秘密字段，不写 `credential_ref`，返回需重新绑定的清单 |
| `migrate` | 前端已把值写进**本机** Vault 并读回验证 | 要求每行带 `bound_credential_ref`，且不得再带明文 |

`reject` 默认化封堵的是「旧前端」：它不会传 `secrets` 字段，于是含明文的旧备份
会被拒绝而不是被静默剥离。静默剥离看起来更「友好」，但它让用户在主机上永远失去
一个从未被询问过的密码。

## 4. 决定三：文件里的 `credential_ref` 永不入库

导入 payload 现在有两个字段，语义严格区分：

- `credential_ref`：来自文件，描述**源设备**存了什么。仅用于生成「需重新绑定」
  清单与迁移提示，**不写入任何列**。
- `bound_credential_ref`：前端在把秘密写入**本机** Vault 后生成，是唯一允许持久化
  的引用。

跨设备恢复时 Vault 主密钥不同，源引用指向的 key 在目标机不存在。持久化它等于让
主机声称持有一个读不到的凭据——比没有凭据更糟，因为连接会以「Vault 里没有」失败，
而这条错误信息指向的是数据丢失，不是需要重新设置。

## 5. 决定四：版本化 CredentialRef

`CredentialRef = { kinds, provider: 'vault', version }`，Vault key 为
`host:<id>:<version>:<kind>` 与 `ssh-key:<id>:<version>:<kind>`。

Phase 10 用固定 key 直接覆盖，理由是「覆盖同一 key 不会产生孤儿引用」。这个理由
对**单秘密**更新成立，对**多秘密**更新不成立：

```
写入 password 到 host:h1:password   ← 旧密码在这一刻已消失
写入 privateKey 失败
结果：新密码 + 旧私钥。这个组合从未存在过，且无法回滚。
```

版本化的写入顺序把每一步都变成可恢复的：

1. 在**新版本**下写入全部 kind；
2. 逐个读回验证；
3. 一条 UPDATE 把引用切到新版本；
4. 提交后才删除旧版本。

任何崩溃点都落在「完整旧版本」或「完整新版本」之一，外加至多若干无人引用的密文。
失败点与结果：

| 失败点 | 结果 |
| --- | --- |
| 第 1 步 | 本次写入的部分新版本被清理；行仍指向旧版本 → 可用 |
| 第 2 步 | 同上（读回不一致即视为写入失败） |
| 第 3 步 | 新版本清理；行仍指向旧版本 → 可用 |
| 第 4 步 | 行已指向新版本 → 可用；旧密文成为孤儿，记录 warning 而非报错 |

**命名空间分离**：`host:` 与 `ssh-key:` 此前共用 `host:`，一个主机与一个密钥
若 id 相同会互相读到对方的秘密。现在两者独立。

### 5.1 修正（Phase 10.1.1）：新引用必须是「supplied ∪ current」

版本化解决了「一次写多个秘密时中途失败」，但没有解决**只写其中一个**的情形。

编辑对话框的秘密字段初值来自 `host.password || ''` 与 `host.privateKey || ''`，
而 Phase 10.1 之后这两列恒为 NULL —— 打开编辑框时**每个秘密字段都是空的**。
用户只重新输入密码并保存，`splitHostSecrets` 只产出 `password`，新引用于是只列
`password`；随后第 4 步删除旧版本，**把私钥一起删掉了**，而且新引用根本不提它，
所以连接时的报错是「这个主机没有私钥」而不是「私钥读不到」—— 丢失是静默的。

修正后的规则，与已有的 `persistKeySecrets` 契约一致：

- 新版本的 kind 集合是 **`supplied ∪ current.kinds`**，不是 `supplied`；
- 未重输的 kind 从旧版本**读取并写入新版本**（结转）；
- 旧版本不真正持有它时**失败**，而不是带一个空洞过去 —— 一个列了但读不出的引用
  比没有引用更糟，它让主机在连接时报「有存储但读不到」，且没有恢复手段；
- 读回验证覆盖**结转的 kind 也是**，在切换引用之前完成。

禁止的两种写法（都不是修复）：

| 错误写法 | 后果 |
| --- | --- |
| 把结转的 kind 写回**旧版本号**再删除旧版本 | 正是「复用后删除」，等于覆盖在用代，重新引入版本化要防的缺陷 |
| 完全不删旧版本 | 每次编辑都积累孤儿密文，且下次保存不同子集时可能解析到陈旧值 |

**清除凭据的顺序**：先 UPDATE 把引用置 NULL，再删 Vault。反过来的话，删除成功后
UPDATE 失败会留下「指向已删除 key 的引用」，而那条路径没有恢复手段。

## 6. 决定五：损坏的引用是独立状态

`parseCredentialRef` 返回三态，替代 `CredentialRef | null`：

| 返回值 | 含义 |
| --- | --- |
| `{ ok: true, ref: null }` | 列是空的，主机不存凭据（Agent / 每次询问） |
| `{ ok: true, ref: {...} }` | 可用引用 |
| `{ ok: false, problem }` | 存在凭据但本版本读不了：`malformed` / `unknown-provider` / `unsupported-version` / `empty-kinds` |

`problem` 会挂在 `Host.credentialRefProblem` 上，连接路径在接触 Vault **之前**就
拒绝并给出可执行提示（「重新保存凭据」/「升级 Terminal」）。旧版无版本字段的引用
解析为 `LEGACY_VERSION = 0`，对应无版本段的 key，因此历史主机仍能连接。

### 6.1 修正（Phase 10.1.1）：版本号不可猜，读不到就拒绝

版本化要求「写到当前版本之上」。但当**读不到当前版本**时，有一个看起来安全的诱惑：
猜一个足够大的数字。Phase 10.1 的导入路径确实这么做了 —— `localNextVersion` 在
`catch` 里 `return 10_000`。

核实后那行是**死代码**，而且它掩盖了一个更糟的行为：

- `select()` 会把查询失败转换成 `[]`（`connection.ts`，只有启动门禁拒绝才重抛），
  所以 `try/catch` 几乎进不去；
- `[]` 被解析为「这一行没有引用」，于是返回 **版本 1**。

版本 1 是**最可能正在被使用**的版本。`vaultService.set` 是
`config.entries.insert(key, …)`，无条件覆盖。`Merge` 模式下该行不会被改写，
所以它继续指向版本 1、却解析出导入值 —— 用户的密码从 Vault 里静默消失。

同样地，**损坏引用**原本也被当作 `null`（→ 版本 1）。

规则改为：

| 行状态 | 行为 |
| --- | --- |
| 读到，无引用 | 写版本 1 |
| 读到，有可用引用（含 legacy 0） | 写 `version + 1` |
| **读失败** | **拒绝本次写入** |
| **引用损坏 / 版本超出本 build** | **拒绝本次写入** |

为什么拒绝而不是猜：回退任何固定数字都可能撞上某个真实行指向的版本；
回退版本 1 撞上的概率最高。导入可以重试，被覆盖的凭据不能。

实现用 `selectStrict`（启动恢复路径专用，本就是为区分「没有行」与「读不到」而写），
不是新增机制。

**并发边界（如实记录）**：两个写入方同时读同一行会各自选到 `N+1` 并互相覆盖。
当前架构下单实例 + 运行时锁使同数据目录的跨进程并发不可达，同进程导入由用户逐次触发。
但**没有测试证明**这一点，因此 `CROSS_PROCESS_CONCURRENT_IMPORT=NOT_VERIFIED`，
不记 PASS。

## 7. 决定六：设置按字段白名单，不按表 key 过滤

`syncServiceToken` 是 `app_settings` **值内部的字段**。删掉名为 `syncServiceToken`
的 settings 表行什么也删不掉——它会「看起来正确」而继续泄露。

因此：

- `settings-export-policy.ts` 维护**可导出字段白名单**，未知字段默认不导出（fail
  closed）。新增一个偏好需要在白名单里加一行，这是评审时可见的小成本；新增一个
  凭据则默认不会泄露，这是运行时不可见的大风险。
- `team_settings.apiToken` 同样处理（独立白名单）。
- 导入时：`syncServiceToken` 与 `team_settings` 的凭据字段不写入；`app_settings`
  过同一白名单后保留普通偏好。导入永不覆盖本机已有 token，也永不引入本机没有的
  token。

代价明确记录：一个新偏好如果忘记加白名单，它不会随备份恢复。这被测试覆盖
（`settings-export-policy.test.ts` 断言普通偏好确实恢复）。

## 8. 决定七：迁移的计划不含秘密

`MigrationPlan` 只描述「哪些行、哪些 kind」，**不携带值**。值是执行前一次性读取的
局部变量（`HostSecretValues` / `KeySecretValues`），生命周期只有一次执行。

原因：计划会被渲染、被持有在组件状态里、可能进日志。一个「顺手带着明文」的类型会
让这三处都成为泄露点，而泄露值看起来只是普通字符串。

执行语义：

- 需要显式 `authorized: true`，否则 `aborted`；
- 先 `VACUUM INTO` 快照（失败即中止），再执行；
- 每行写 Vault → 读回 → 一条 UPDATE 同时写引用与清明文列；
- 单行失败保留其明文，行自身就是「未迁移」状态，因此重跑天然幂等；
- 执行后**重新读表**验证，而不是复述执行器的计数。

已知限制，不声称已解决：清除列不会重写旧 WAL 或已存在的导出文件。迁移后历史备份
仍需单独授权清理，ADR 不声称「迁移后历史备份自动安全」。

## 9. 决定八：导入失败要补偿 Vault

`migrate` 策略下，前端先写 Vault 再调用 Rust。若 Rust 侧失败（约束冲突、磁盘满、
超时），已写入的密文成为无引用数据。补偿逻辑逐个删除本次写入的 (resource, version,
kind)。

补偿失败**记录而不抛出**：导入本身已经失败，用户看到的是真实原因；把补偿失败变
成另一个异常会掩盖前者。

### 9.0 修正（Phase 10.1.1）：补偿必须覆盖「准备阶段自己的失败」

上面这条决定写成时，补偿只挂在**调用方**（`importWithSecretPolicy`）的 `catch` 上，
而 `migrateSecretToVault` 在那个 `try` **之外**执行。后果是：

- 准备阶段写到第 2 个秘密时抛错，第 1 个已写入的密文无人删除；
- 多个主机写完后密钥循环抛错，**全部主机写入**都无人删除；
- 调用方的 `catch` 根本不会进入，因为它的 `bound` 变量仍是 `[]`（赋值从未完成）。

追踪粒度也不对：`bound.push` 在**整行成功后**才发生，所以连当前行已成功的第一个
kind 都不在任何清单里。

修正后的规则：

1. **逐 kind 记录**每次成功写入，而不是逐行；
2. 准备阶段在**自己的** `catch` 里删除本次调用写过的版本；
3. 只删本次调用写过的版本 —— 行原本指向的版本永远不会是候选；
4. 补偿失败留下可观察的脱敏告警，不伪装成完全清理成功；
5. 原始异常优先于补偿异常。

调用方的补偿仍然保留，两者**互斥而非叠加**：准备阶段抛错时调用方的 `bound` 仍是
`[]`，不会重复删除；准备阶段成功而 Rust 失败时，由调用方负责。

## 9.1 已知例外：团队共享主机（`team_shared_hosts.host_data`）

这是本轮**明确不覆盖**的第二条明文写入路径，必须写清楚而不是让它成为沉默的例外：

- `components/share-host-dialog/index.tsx` 提供「包含密码 / 私钥」选项；
- 用户勾选且**未**启用加密时，`hostData.password` / `host_data.private_key` 会被
  `JSON.stringify` 写入 `team_shared_hosts.host_data`（同一 SQLite 文件），并同步到
  服务端；
- 启用加密时走 `password_encrypted` / `private_key_encrypted`，不写明文。

为什么本轮不改：

1. 它是**用户显式选择且带警告**的主动操作，不是本文其余各节修复的「静默泄露」；
2. 改掉它等于移除一个已有功能（把凭据共享给队友），属于产品决策，不属于安全收尾；
3. 它不经过任何导入入口，本轮的边界声明（「所有导入路径」）在字面上仍成立。

仍然存在的风险，必须被记录：

- 明文随同步进入服务端存储；
- 队友拉取后明文落在**他们的** `team_shared_hosts` 里；
- 即使之后启用加密，已经写下的历史行仍是明文。

建议的下一步（未实现）：把共享凭据也改走 Vault + 引用，或至少在未加密时禁止包含
秘密。在实现之前，`SHARE_HOST_CREDENTIAL_PLAINTEXT` 应视为 **PARTIAL**，而不是 PASS。

## 10. 不在本轮范围

| 项 | 原因 |
| --- | --- |
| Vault 主密钥迁移 / 身份迁移 | 独立发布阻塞项，需要 T1–T12 |
| 历史 WAL 与备份文件的明文擦除 | 需要用户单独授权与独立流程 |
| Windows 一次性 profile、AppImage stock 启动 | 无可用环境，标 NOT_RUN |
| `RUSTSEC-2026-0459`（libsqlite3-sys） | 上游约束未解除，保留基线记录 |

## 11. 验证方式

| 层 | 证据 |
| --- | --- |
| Rust 写入端 | `db_import/tests.rs` 新增 12 项：拒绝未决策略、discard 不写秘密列、migrate 拒绝残留明文、拒绝源引用、拒绝缺绑定、replace 模式同样不写 |
| 前端序列化 | `import-security.test.ts` 15 项，断言发给 Rust 的 payload 文本不含任何明文 |
| 设置泄露 | `settings-export-policy.test.ts` 9 项，断言真实导出文件与真实上传 body 不含 token，且普通偏好恢复 |
| 版本一致性 | `hosts-credential-versions.test.ts` 12 项，覆盖两种秘密同时更新、各阶段失败、清除、删除 |
| 迁移链路 | `credential-migration-run.test.ts` 11 项 + `credential-migration.test.ts` 12 项 |
| 损坏引用 | `credential-ref-problems.test.ts` 12 项 |
| SSH Key 生命周期 | `ssh-keys-lifecycle.test.ts` 16 项 |
| Store 刷新 | `host-refresh.test.ts` 7 项：新建→保存→Store→立即连接 |
