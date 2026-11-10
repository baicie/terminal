# Phase 10.1 — 凭据安全收尾报告

- 基线：`main = 7c1524ed38daac4dab69b92babcac9102e87ce22`
- 分支：`feat/phase10-1-credential-security-closure`
- PR：[#23](https://github.com/baicie/terminal/pull/23) — **已 squash 合并为 `00643e77d17f4e38cfaf80b42d572cef917ba21d`（2026-11-10T05:22:51Z）**，本地与远端分支均已删除
- ADR：`docs/phase10/10-credential-boundary-adr.md`
- 未打 Tag、未发布 Release、未修改真实用户数据库

## 1. 一句话结论

Phase 10 的安全结论成立于「新建/编辑」这一条路径。本轮把其余四条真实入口
（普通文件导入、云同步恢复、团队包导入、旧版备份）接到同一个边界上，并使该边界
在 Rust 侧**结构性**成立——秘密列不在 SQL 文本中，而不只是绑定为 NULL。

## 2. 逐项状态

```
BASE_SHA=7c1524ed38daac4dab69b92babcac9102e87ce22
FINAL_SHA=00643e77d17f4e38cfaf80b42d572cef917ba21d（squash merge，2026-11-10T05:22:51Z）
PR_URL=https://github.com/baicie/terminal/pull/23

FRONTEND_HOST_WRITE_SAFE=PASS
RUST_IMPORT_WRITE_SAFE=PASS
TEAM_IMPORT_WRITE_SAFE=PASS
CLOUD_SYNC_WRITE_SAFE=PASS
SETTINGS_TOKEN_EXCLUDED=PASS
CREDENTIAL_REF_IMPORT_REBIND=PASS
VAULT_WRITE_COMPENSATION=PASS
HOST_CREDENTIAL_MIGRATION=PASS
SSH_KEY_CREDENTIAL_MIGRATION=PASS
HOST_STORE_REFRESH=PASS
CORRUPT_REF_FAIL_CLOSED=PASS
SSH_KEY_VAULT_LIFECYCLE=PASS
SHARE_HOST_CREDENTIAL_PLAINTEXT=PARTIAL

VAULT_REAL_E2E=NOT_RUN
SSH_VAULT_REAL_E2E=NOT_RUN
JUMP_HOST_VAULT_REAL_E2E=NOT_RUN
SFTP_REAL_E2E=NOT_RUN
WORKSPACE_RESTORE=NOT_RUN
GUI_IME=NOT_RUN

RUSTSEC_2026_0459=UNRESOLVED_BASELINED
CI=PASS（合并前 run 42759330993（`81e1bb7`）11/11；此前 run 42739526802（`b8dc716`）同为 11/11）
EVIDENCE_FINGERPRINT_VALID=PASS

PHASE10_1_SECURITY_VERDICT=PARTIAL
DAILY_DRIVER_READY=NO
TABBY_REPLACEMENT_READY=NO
```

### 为什么 `PHASE10_1_SECURITY_VERDICT=PARTIAL`

13 个凭据门禁中 12 个 PASS、1 个 PARTIAL（团队共享主机的明文路径，见 ADR §9.1，
属既有产品功能）。此外以下三类没有执行，且它们不是「可以推断」的：

1. **真实 GUI 的凭据链路**：Vault 创建/解锁/改密/重启持久化、Vault 密码与私钥真实
   SSH 登录、Jump Host 双端凭据、SFTP、IME 中文输入。本轮只有服务层测试与
   disposable 数据库演练。
2. **三平台真机回归**：macOS / Windows / Linux。
3. **历史明文擦除**：清除列不会重写旧 WAL 与已存在的导出文件。

按本项目的判定规则（`docs/phase10/06-daily-driver-acceptance.md` 末节），这三类一律
NOT_RUN，不用 jsdom 或单元测试结果冒充。

## 3. 本轮修复的缺陷

### P0 — Rust 备份导入明文写入

`packages/frontend/src/service/sync-import.ts` 把文件行原样展开交给
`import_backup_data`，而 `src-tauri/src/db_import/writer.rs` 的
`HOST_INSERT` / `HOST_UPDATE` / `SSH_KEY_INSERT` / `SSH_KEY_UPDATE` 仍把
`password` / `private_key` / `passphrase` 绑定到真实列。后果：**任何**备份导入——
包括云同步恢复与团队包——都把明文写回 SQLite。

修复：四个语句的秘密列改为字面 `NULL`，占位符数量相应减少（21/20/9/8，已核对与
绑定参数一一对应）。选择「从 SQL 中移除」而不是「绑定 NULL」，因为后者保留参数位，
一次「顺手传值」的改动不会失败，只会悄悄恢复泄露。

### P0 — 旧版备份被静默剥离或明文写入

修复为三态策略，默认拒绝：

| 策略 | 行为 |
| --- | --- |
| `reject`（默认、未知值） | 整批拒绝，返回各类型计数，**在 `BEGIN` 之前** |
| `migrate` | 前端须已写入本机 Vault 并读回；每行须带 `bound_credential_ref`，且不得残留明文 |
| `discard` | 剥离秘密，不伪造引用，返回需重新绑定清单 |

### P1 — `syncServiceToken` 泄露

它是 `app_settings` JSON **值内部**的字段，删除同名 settings 表行无效。改为字段级
白名单，未知字段默认不导出。`team_settings.apiToken` 同处理。

### P1 — 多秘密更新的部分失败

固定 Vault key 直接覆盖：password 写成功、privateKey 写失败 → 新密码 + 旧私钥，
从未存在过的组合且无法回滚。改为版本化写入（新版本写入 → 读回 → 单语句切换引用 →
清理旧版本）。任何崩溃点只留完整旧版或完整新版。

### P1 — 清除凭据顺序

原实现先删 Vault 再更新 SQLite，后者失败即留下指向已删除 key 的引用。已反转为
先 UPDATE 置 NULL，再删 Vault。

### P1 — 迁移无生产调用链

`credential-migration.ts` 只有规则与 Fake Vault 测试。新增
`credential-migration-run.ts`（快照 → 执行 → 重读验证）与设置面板入口。同时把
**明文值从 `MigrationPlan` 类型中移除**——计划会被渲染、持有与记录，带着值就会在
三处都成为泄露点。

### P2 — Store 与数据库不一致

`addHost` 用表单构造内存副本，而引用由写入路径决定。保存后立即连接会得到「未存
凭据」。改为保存后回读数据库。

### P2 — 损坏引用退化为「无凭据」

`parseCredentialRef` 解析失败返回 `null`，与「不存凭据」同义。改为三态，损坏引用
在接触 Vault 前拒绝并给出可执行提示。

### P2 — SSH Key 秘密无消费方

`getSSHKeySecret` 零调用方。新增 `ssh_keys.credential_ref` 列、keychain 的
「显示/复制私钥」（按需读 Vault），并将命名空间从 `host:` 拆为 `ssh-key:`
（此前同 id 的主机与密钥会互读秘密）。

### 自查中发现（不在原审查清单）

- `updateSSHKey` 用 `fields.join(', ')` 动态拼 SQL：秘密列只写字面 NULL 是安全的，
  但**结构脆弱**——未来在列表里加一行 `private_key = ?` 会和其它行看起来一样。
  已改为固定 SQL + `CASE WHEN ? = 1` 标记。

## 4. 为什么这次不是「只修前端」

第一轮的教训是「测试覆盖了 service，UI 走的是 store」。这一轮的同类风险是
「前端序列化正确，Rust 仍绑定」。因此：

- 秘密列的移除发生在 **Rust SQL 文本**中，由 `db_import/tests.rs` 直接断言写入后
  的列值（`secret_columns_are_empty`）；
- 前端测试断言的是**发给 Rust 的 payload 序列化文本**，不是 sanitizer 辅助函数；
- 两条断言必须同时成立才叫闭合。

## 5. 覆盖的入口矩阵

| 入口 | 策略入口 | 测试 |
| --- | --- | --- |
| 普通 JSON 导入 | `importDataWithSecretPolicy` | `import-security.test.ts` |
| 云同步恢复 | `downloadFromServer(mode, secrets)` | 同上 + `sync-export.test.ts` |
| 团队包导入 | `importTeamPackage(..., { policy })` | `sync-team-export-secrets.test.ts` |
| Merge 模式 | 后端 `is_replace() == false` | `db_import/tests.rs` |
| Replace 模式 | 后端 UPDATE 无秘密列 | `replace_mode_does_not_drop_...` |
| 旧版备份含明文 | `reject` 默认 / `migrate` / `discard` | 三项 Rust 测试 |
| 恶意构造 JSON | 策略 + 绑定引用校验 + 结构校验 | `migrate_refuses_*` 系列 |

## 6. 依赖安全

`RUSTSEC-2026-0459`（libsqlite3-sys 0.30.1 捆绑的 SQLite，构造 db + `-wal` 页大小
不一致时返回未初始化页缓存内存）**仍然不可修**：sqlx 0.9.0 要求 `<0.38.0`，
tauri-plugin-sql 2.6.0 要求 `sqlx ^0.8`，整条链够不到修补版 >= 0.39.0。

`cargo audit` PASS **不代表该漏洞已修复**，它只表示「没有未记录的 advisory」。
本轮不强行升级、不删除基线记录。输入边界评估：需要攻击者能同时提供 `.db` 与
`.wal` 文件，且应用会打开该数据库——当前应用只打开自己的数据目录，未提供「打开
外部 SQLite」功能。重新审查条件：sqlx 或 tauri-plugin-sql 解除版本约束。

## 6.1 已知限制：Host 与 SSH Key 没有关联字段

`hosts` 表没有 `ssh_key_id` 一类列，`Host` 类型也没有。因此：

- keychain 的「显示 / 复制私钥」是本轮新增的**用户主动读取**路径，已闭环；
- `getSSHKeyCredentials(id)` 供「用某个密钥连接」使用，但**没有消费方**，因为产品
  里没有「主机引用密钥」这个关系——主机认证方式为 `key` 时，私钥是直接贴在主机上的
  文本框，经 `hosts.credential_ref` 指向 Vault。

这不影响本轮的安全边界（两条路径都经过 Vault、都读版本化引用），但它意味着
「SSH Key 作为可复用资产」这个产品概念尚未实现。不属于凭据安全缺陷，记录在此以免
把 `getSSHKeyCredentials` 的零调用方误读为遗漏。

## 7. NOT_RUN 清单（不得省略）

| 项 | 原因 |
| --- | --- |
| 真实 Vault 创建/解锁/改密/重启 | 需真实 GUI 交互 |
| Vault 密码/私钥真实 SSH 登录 | 需真实 sshd + 真实 Vault 会话 |
| Jump Host 双端凭据 | 同上 |
| SFTP（本轮改动后） | 未重跑 |
| Workspace Restore | 未重跑 |
| 中文 IME、物理键盘 | 无辅助功能权限 |
| macOS / Windows / Linux 真机 | 无环境 |
| 真实用户数据库迁移 | 按规范不做 |
| 历史 WAL / 备份文件明文擦除 | 需用户单独授权 |
| 证据指纹 | **本轮改动落在 `FINGERPRINT_PATHS` 内，旧证据必然失效**。已按官方流程在分支上重采：真实矩阵 run `42670402197` 三平台全 success，指纹 **`0fc777fe…`**（旧 `22087920…`），六份 JSON + manifest + 七个原始日志入库，`check-verification-evidence.mjs` **0 problem**。未手改旧 manifest |

## 7.1 独立审查发现并已修复的缺陷

审查代理（未参与开发）给出 VERDICT: **PARTIAL**，并找出三个我漏掉的真实缺陷。三者
都已修复并补了回归测试——这是本轮最重要的记录，因为它说明「自查通过」不等于正确。

### DEFECT-1（P1）损坏引用在真实连接路径上没有 fail-closed

`withResolvedCredential` 是终端实际调用的函数，它的第一行判断是
`if (ref === null …) return host`。而 mapper 对损坏引用返回的正是
`credentialRef: null` + `credentialRefProblem`，于是它在走到
`resolveSessionCredential` 里的守卫之前就返回了。结果：空密码登录 + IPC 参数错误，
而不是「请重新保存凭据」的提示。

原来的测试直接调用 `resolveSessionCredential`，所以**测试绿而生产路径红**——与
Phase 10 的 P0-1 是同一形状的错误。

修复：守卫移到 `withResolvedCredential`，并在 `resolveSessionCredential` 里重复
`agent` 短路，使两条入口的守卫集合一致。

### DEFECT-2（P1）SSH Key 部分更新会永久丢失未重输的那一半

`persistKeySecrets` 只写入本次提交的 kind，却把旧 kinds 并入新引用，然后删除整个
旧版本。用户只重输私钥 → 新引用声明 `passphrase`，但版本 2 没有它，而版本 1 被删了。

更糟的是：**我自己的测试把这个错误状态断言成了正确结果**。

修复：未重输的 kind 从旧版本**复制**到新版本；若旧版本并不持有它，更新失败而不是
把空洞带过去。新引用只列新版本真实持有的 kinds。

### DEFECT-3（P1）导入迁移硬编码版本 1，会覆盖在用凭据

`migrateSecretToVault` 的 `versionFor` 无生产调用方，因此一律写版本 1。
`vaultService.set` 无条件覆盖，而本地主机若正指向版本 1，它就是一个**在用**的 key。
Merge 模式下该行不会被改写，于是它继续指向版本 1 并解析到导入的值——用户的当前
密码从 Vault 里静默消失。

修复：新增 `localNextVersion()`，读取本机该行现有引用并取下一版本；读不到时回退到
远高于任何本版本写入值的版本号。

### 其他已修

- **DEFECT-6（P2）** `MAX_SUPPORTED_VERSION = Number.MAX_SAFE_INTEGER` 使
  「更新版本写的引用」这条分支不可达。改为 1e9，并补了「超过上限被拒绝 / 等于上限
  可接受」两项测试。

### 记录但本轮不修

- **DEFECT-4（P2）** `team_shared_hosts.host_data` 是第二条明文写入路径：用户显式
  勾选「包含密码/私钥」且未启用加密时写入明文并同步到服务端。属于既有产品功能，
  已在 ADR §9.1 显式声明，`SHARE_HOST_CREDENTIAL_PLAINTEXT` 记为 **PARTIAL**。
- **DEFECT-7（P2）** 无版本字段的引用解析为 `LEGACY_VERSION`，属刻意兼容，
  导入路径已由 `bound_credential_ref` 校验挡住，仅直接改库可达。

## 8. 证据

| 层 | 结果 |
| --- | --- |
| CI | 合并前 run `42759330993`（`81e1bb7`，分支 HEAD）**11/11 success**；此前 run `42739526802`（`b8dc716`）与 run `42742351316`（`7169fe3`，仅文档）同为 11/11。Ubuntu/Windows 曾因 crates.io 下载 `moxcms` 的 `SSL_ERROR_SYSCALL` 首次失败，重跑通过，与代码无关。合并为 squash（源码树不变，证据指纹不受影响） |
| 真实矩阵 | run `42670402197`（`708f3cc`）三平台全 success |
| 前端 | 195 文件 / 1751 项（含审查后新增的 8 项回归） |
| Rust lib | 381 项（`db_import` 39，其中 12 项为 10.1 新增） |
| typecheck | 通过 |
| ESLint | 0 error / 0 warning |
| source-size | 623 个生产文件通过 |
| cargo fmt | 通过 |
