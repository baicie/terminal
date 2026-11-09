# ADR: 主机凭据的唯一写入路径与原子性补偿

状态：已接受
取代：`04-architecture-and-credential-policy.md` 中「保存路径已统一」的隐含结论
（该 ADR 描述的 `service/database/hosts.ts` 实现本身正确，但它**不是** UI 实际
调用的路径，见 §1）

## 1. 问题：安全实现被绕过

Phase 10 第一批把 `service/database/hosts.ts` 改成「秘密进 Vault、SQL 列恒 NULL」，
并有负向测试锁定。但真实 UI 走的是另一条路：

```
components/host-list/use-host-dialog-form.ts
  → store/host.ts  addHost() / updateHost()
    → executeQuery('INSERT INTO hosts (… password, private_key …)')
```

`store/host.ts` 自己拼接 SQL，完全没经过 `service/database/hosts.ts`。
结果：**M1 的安全改动在生产路径上不生效**，用户保存主机仍然写入明文。
这是本轮最高优先级的缺陷，也是「测试通过但功能未生效」的典型案例——测试直接
调用 `createHost()`，而 UI 从不调用它。

同时 `Host` 类型没有 `credentialRef` 字段，`host-mappers.ts` 不读
`credential_ref` 列，所以即使写入正确，读取端也拿不到引用。

## 2. 决定：单一写入入口

- `store/host.ts` **不再拼接任何 SQL**。`addHost` / `updateHost` / `deleteHost`
  全部委托 `service/database/hosts.ts` 的 `createHost` / `updateHost` / `deleteHost`。
- 秘密的写入只发生在 `persistHostSecrets()` 一处。
- `Host.password` / `Host.privateKey` 从「持久化字段」降级为「本次表单输入的
  临时载体」：Store 内存里保留是为了让「刚填完、还没保存」的表单能工作，
  但 `getHosts()` 读回来的对象里这两个字段恒为 `undefined`。
- 新增 `Host.credentialRef?: CredentialRef | null`，由 mapper 从
  `credential_ref` 列解析。

### 为什么不是「让 store 调用 service 的私有函数」

因为那仍然允许第二处代码决定「什么算秘密」。单一入口的价值在于：只要 grep
`INSERT INTO hosts` 只有一个命中，就不可能再有旁路。

## 3. 「未修改」与「清除」是两种操作

`updateHost(id, updates)` 的语义：

| 调用方意图 | 传参 | 结果 |
| --- | --- | --- |
| 只改名字 | 不含 password/privateKey | 现有凭据**不动** |
| 换密码 | `password: 'new'` | Vault 覆盖，reference 更新 |
| 清除凭据 | `clearCredential: true` | Vault 删除，reference 置 NULL |

用 `clearCredential` 显式标记而不是「传空字符串表示清除」：空字符串和「没传」
在 JS 里太容易混淆，而这一个字段的混淆会把用户的凭据删掉。

## 4. 原子性：不声称事务，而是可验证的补偿

SQLite 与 Vault 不在同一事务里。因此不写「原子」，而是定义每一步失败后的状态：

| 步骤 | 失败后 | 保证 |
| --- | --- | --- |
| 1. 写 Vault | 旧值未被覆盖（先写新 key 再切换引用则会孤儿） | 直接覆盖同一个 key，失败则旧值仍在 |
| 2. 写 SQLite | Vault 已有新值，SQLite 仍是旧引用 | 重试保存即可收敛；引用指向的 key 未变 |
| 3. 保存成功 | — | — |

关键设计：**凭据的 Vault key 只由 host id 和 kind 决定**（`host:<id>:password`），
不随保存次数变化。因此：

- 「Vault 写成功、SQLite 写失败」不会产生孤儿引用——引用本来就是同一个 key；
- 重复保存是幂等的（同一 key 覆盖同一 key）；
- 不会误删其他主机的凭据（key 含 host id）；
- 修改认证方式时，若用户没有提供新秘密，旧值保留但 `credentialRef.kinds`
  只列出本次实际使用的种类，连接时按 kinds 读取，不会拿旧密码去走 key 认证。

**删除主机**：先删 SQLite 行，再删 Vault key。顺序不能反——反过来若删行失败，
Host 还在但秘密已没了。若删 Vault 失败，留下的是无法被任何 Host 引用的孤立
key（数据不泄露给错误对象，只是占空间），记录 warning 而非报错。

## 5. Vault 不可用时的行为

| 情况 | 保存路径 | 连接路径 |
| --- | --- | --- |
| Vault 未初始化 | 保存失败，提示「先创建 Vault 或改用 Agent/每次询问」 | Agent/询问路径不受影响 |
| Vault 锁定 | 保存失败，提示解锁 | 失败并提示解锁，不退化空密码 |
| 写入失败 | 保存失败，SQLite 不落新引用 | — |

**任何情况下都不退化到 SQLite 明文**。宁可保存失败。

## 6. 导出：白名单而非脱敏

`service/sync-export.ts` 当前 `SELECT * FROM hosts` 且把 `getSSHKeys()` 原样
`JSON.stringify`。改为显式字段白名单：host 只导出元数据与 `credentialRef` 描述，
ssh_keys 完全不导出私钥与 passphrase。用白名单而不是「查出来再删字段」，
因为后者只要有人加一列就会重新泄露。

导出中保留 `credentialRef`，但只作为**说明**：目标设备必须重新绑定秘密
（Vault 与设备绑定，导出文件不含密钥材料）。

## 7. 旧数据迁移：单独交付，不冒充已做

`credential_ref` 列的存在不等于迁移。历史明文仍在 `hosts.password`、
`hosts.private_key`、`ssh_keys.private_key`、`ssh_keys.passphrase` 里。

迁移需要用户显式授权（会写 Vault、需要解密主密码），因此：

- 本轮**不自动执行**迁移；
- 提供迁移的读取与验证逻辑与测试，但执行入口必须由用户确认；
- `CREDENTIAL_MIGRATION` 在真实执行前保持 NOT_RUN。

## 8. 测试策略（防止再次「测试通过但路径没接」）

新增集成测试直接走 **Store 的公开 API**（`addHost` / `updateHost`），断言
最终落在 SQLite 的参数里没有秘密。这是这次遗漏的直接教训：单元测试覆盖了
service，但没有覆盖 UI 真正调用的那一层。
