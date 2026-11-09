# ADR: 凭据边界与本地数据完整性

状态：已接受（Phase 10）
影响范围：`service/database/hosts.ts`、`service/credential-boundary.ts`、
`service/vault-secret-provider.ts`、`features/terminal/services/session-credentials.ts`

## 问题

Host 保存路径把 `password` / `private_key` 直接写进 SQLite 明文列（审计 A1）。
Vault 与 `storeHostCredential` 早就存在，但没有任何保存路径调用它们（A2）。
`ssh_keys` 表同样有 `private_key` / `passphrase` 明文列（A3）。

用户可见后果：任何能读取 `terminal.db` 的人（备份、同步盘、取证工具、同机其他进程）
直接拿到凭据。用户以为"存到 Vault 了"，实际没有。

## 决定

### 1. 数据分层

| 类型 | 存在哪 | 例子 |
| --- | --- | --- |
| HostMetadata | `hosts` 表 | 名称、地址、端口、用户名、认证类型、分组、标签 |
| CredentialRef | `hosts.credential_ref`（新列） | `{"kinds":["password"],"provider":"vault"}` |
| Secret | Vault（Argon2id + AES-GCM） | 密码、私钥、passphrase |
| 证书 | `hosts.certificate` | 公开材料，不是秘密 |

`credential_ref` 只是指针，可以安全地出现在日志、导出与同步里。

### 2. 保存路径

`createHost` / `updateHost` 调 `persistHostSecrets()`：

1. 把秘密写入 Vault；
2. **无论写入什么，SQL 里 `password` 与 `private_key` 恒为 `NULL`**；
3. 把引用写入 `credential_ref`。

先写 Vault 再写行：Vault 写入失败则整次保存失败，不会留下指向空处的引用。
`updateHost` 的 `credential_ref = COALESCE(?, credential_ref)` 保证改名之类的普通编辑
不会清空已存凭据。

### 3. 连接路径

`resolveSessionCredential()` 的规则：

- 内存对象带明文（用户刚在表单里填的）→ 直接用；
- 否则看 `credentialRef`：为空 → Agent 或连接时询问，**不是错误**；
- 有引用但 Vault 锁定/读不到 → **失败并说明原因**，绝不退化成"空密码"登录。

第三条是这份 ADR 的关键：把"Vault 锁着"变成"认证失败"会让用户拿不到任何线索。

### 4. 不强制 Vault

Agent 认证与"连接时询问密码"都不需要任何秘密存储，`credentialRef` 为 null 即可。
不创建 Vault 的用户完全不受影响。

### 5. 历史明文残留（明确不假装擦除）

`UPDATE hosts SET password = NULL` **不会**清除：

- SQLite WAL 中的旧页；
- `pre-migration-<epoch>.db` 备份；
- 应用外部的历史导出文件。

因此本阶段：

- 迁移后执行 `VACUUM`（重建数据库文件）+ `wal_checkpoint(TRUNCATE)`；
- 对已有备份**不静默删除**，在文档与迁移报告中列出路径与建议处置；
- 不声称"已安全擦除"，只声称"新写入不再产生明文"。

### 6. 迁移安全

- 保留 Host ID、分组、收藏、Jump Host、Workspace 关联；
- 迁移前生成备份（复用 `db_recovery` 的快照与回滚机制）；
- 验证秘密写入后可读回；
- 失败保留旧数据、不部分清理；
- 密码/私钥不进日志、控制台与诊断报告。

## 测试

| 文件 | 锁定什么 |
| --- | --- |
| `credential-boundary.test.ts` | 解析规则、Vault 锁定时失败而非空密码、错误不泄露秘密 |
| `hosts-secrets.test.ts` | SQL 中秘密列恒为 NULL、秘密进 Vault、agent 主机无引用、证书留在行上、普通编辑不清空引用 |
| `shortcuts-persistence.test.ts` | （相邻）设置持久化与冲突拒绝 |

`hosts-secrets.test.ts` 在旧实现上 4 项失败，新实现 6 项通过——它测的是这次的真实改动。

## 未完成 / 后续

- `ssh_keys` 表的迁移（A3）：本阶段未改，仍是明文列；需与 Keychain UI 一起迁移。
- 历史明文的 WAL/备份清理：需单独的用户授权流程，不在自动执行范围。
- `PLAIN_EXPORT_SECRET_EXCLUDED`：当前无主机导出功能；新导入/导出向导必须从设计上排除秘密。
