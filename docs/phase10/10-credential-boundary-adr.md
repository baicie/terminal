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
