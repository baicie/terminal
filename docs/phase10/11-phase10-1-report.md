# Phase 10.1 — 凭据安全收尾报告

- 基线：`main = 7c1524ed38daac4dab69b92babcac9102e87ce22`
- 分支：`feat/phase10-1-credential-security-closure`
- Draft PR：[#23](https://github.com/baicie/terminal/pull/23)
- ADR：`docs/phase10/10-credential-boundary-adr.md`
- 未合并、未打 Tag、未发布 Release、未修改真实用户数据库

## 1. 一句话结论

Phase 10 的安全结论成立于「新建/编辑」这一条路径。本轮把其余四条真实入口
（普通文件导入、云同步恢复、团队包导入、旧版备份）接到同一个边界上，并使该边界
在 Rust 侧**结构性**成立——秘密列不在 SQL 文本中，而不只是绑定为 NULL。

## 2. 逐项状态

```
BASE_SHA=7c1524ed38daac4dab69b92babcac9102e87ce22
FINAL_SHA=<见 PR #23 最新提交>
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

VAULT_REAL_E2E=NOT_RUN
SSH_VAULT_REAL_E2E=NOT_RUN
JUMP_HOST_VAULT_REAL_E2E=NOT_RUN
SFTP_REAL_E2E=NOT_RUN
WORKSPACE_RESTORE=NOT_RUN
GUI_IME=NOT_RUN

RUSTSEC_2026_0459=UNRESOLVED_BASELINED
CI=<见 PR #23>
EVIDENCE_FINGERPRINT_VALID=NO

PHASE10_1_SECURITY_VERDICT=PARTIAL
DAILY_DRIVER_READY=NO
TABBY_REPLACEMENT_READY=NO
```

### 为什么 `PHASE10_1_SECURITY_VERDICT=PARTIAL`

12 个可自动化的门禁全部 PASS，但以下三类没有执行，且它们不是「可以推断」的：

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
| 证据指纹 | 本轮未重采 `docs/verification/` |

## 8. 证据

| 层 | 结果 |
| --- | --- |
| 前端 | 195 文件 / 1743 项 |
| Rust lib | 381 项（`db_import` 39，其中 12 项为 10.1 新增） |
| typecheck | 通过 |
| ESLint | 0 error / 0 warning |
| source-size | 621 个生产文件通过 |
