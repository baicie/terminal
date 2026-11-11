# 01 — 凭据：Keychain / Vault 交互状态机与迁移方案

- 状态：**提案（Draft）**
- 上游：`00-adr-architecture.md` §3.1（签名前置阻断）
- 审查证据：对 `packages/frontend/src/service/` 与 `src-tauri/src/` 的逐文件核实

---

## 1. 现状（审查结论，非设计包自述）

### 1.1 provider 是硬编码的单值

`CredentialRef.provider` 是**字面量类型 `'vault'`**（`credential-boundary.ts:48`），不是 `string`。全仓共 **10 处**硬编码 `provider: 'vault'`，另有 **3 处** provider 判定：

| 位置 | 形式 |
| --- | --- |
| `credential-ref.ts:100` | `if (record.provider !== 'vault')` → `unknown-provider` |
| `src-tauri/src/db_import/secrets.rs:216` | `if provider != Some("vault")` |
| `src-tauri/src/db_import/payload.rs:93` | 同判定，返回 `None` 时**把引用写成 NULL** |

**注意 Rust 侧那两处**：它们不受 TypeScript 类型系统保护。只改前端会留下「前端认为合法、Rust 导入把它当未知 provider 丢掉」的裂缝，而且 `payload.rs:93` 是**静默丢凭据**，不报错。

### 1.2 resolver 不看 ref.provider

`credential-resolver.ts:75-124` 的 `resolve()` 拿到 ref 直接调 `provider.read(...)`。provider 在**构造时**固定：

```ts
// session-credentials.ts:112-114
const resolved = await new SessionCredentialResolver(vaultSecretProvider).resolve(metadata)
```

这是多 provider 改造最核心的缺口。如果只加 parse 不加分派，keychain 主机会**去 Vault 里读、读不到、报「vault holds none，请重新保存凭据」——而密码完好地躺在钥匙串里**。

### 1.3 写入顺序契约假设「同 provider」，代码里无校验

版本化写入的正确性建立在一个**隐含前提**上：新旧版本在同一个 provider。代码里没有任何一处校验这一点。

| 位置 | 现在的行为 | 跨 provider 后果 |
| --- | --- | --- |
| `host-credentials.ts:159` | 从「当前 ref」读未重输的 kind | keychain 主机去 Vault 读 → `undefined` → **保存必然失败** |
| `host-credentials.ts:227` | 无条件 `vaultSecretProvider.removeVersion` | 被替换的 keychain 条目**永不清理** |
| `hosts.ts:79,214` | 失败补偿也硬编码 vault | 回滚删错地方 |

**这与 Phase 10.1.1 的事故同形**：当时「部分更新丢 kind」的修复正是 `host-credentials.ts:156-172` 这段代码。跨 provider 会让它以同样形状复发。

### 1.4 ssh_keys 没有 problem 通道

`ssh-key-credentials.ts:32-37` 的 `readKeyCredentialRef` 把**任何解析失败读成 `null`**。主机侧有三态（`credentialRefProblem`），ssh key 侧没有。

新增 provider 后，`getSSHKeySecret` 会在 provider 不匹配时静默返回 `undefined`，UI 显示「无法读取私钥」，而真因是「这个引用属于另一个 provider」。

---

## 2. 设计

### 2.1 CredentialRef V2

```ts
type CredentialRefV2 =
  | { provider: 'vault'; kinds: CredentialKind[]; version?: number }
  | { provider: 'system-keychain'; kinds: CredentialKind[]; version: number; keyId: string }
```

**注意**：当前解析器只挑 `kinds/provider/version` 三个字段（`credential-ref.ts:88-92`），`keyId` 会被**静默丢弃**。加字段必须同时改解析。

`keyId` 的命名遵循与 `vaultKey` 相同的独立性原则：**独立函数，不复用 `vaultKey`**。理由：`LEGACY_VERSION = 0` 在 vault 语义里表示「无版本历史键」，keychain 没有这个包袱，复用会让 `0` 被误当成合法版本（`credential-boundary.ts:174-196`）。

### 2.2 Provider registry

```ts
interface SecretProvider {
  readonly providerId: 'vault' | 'system-keychain'
  availabilityState(): Promise<Availability>
  read(resource, version, kind): Promise<string | undefined>
  write(resource, version, kind, value): Promise<void>
  remove(resource, version, kind): Promise<void>
  /** 当前不在接口里，但被 6 个生产模块直接调用，必须上提。 */
  removeVersion(resource, version, kinds): Promise<CredentialKind[]>
}
```

`removeVersion` 目前是 `VaultSecretProvider` 的独有方法（`vault-secret-provider.ts:119`），**不在接口里**。任何「只对 `SecretProvider` 编程」的抽象都会漏掉它。

### 2.3 resolver 按 ref.provider 分派

```ts
class SessionCredentialResolver {
  constructor(private readonly providers: Map<ProviderId, SecretProvider>) {}

  async resolve(host: HostMetadata): Promise<CredentialResolution> {
    const ref = host.credentialRef
    if (ref === null || ref.kinds.length === 0) return { ok: true, credential: {} }
    const provider = this.providers.get(ref.provider)
    if (!provider) return { ok: false, reason: 'unsupported-provider', provider: ref.provider }
    // …以下按 provider 的 availabilityState 分支
  }
}
```

**关键**：`unsupported-provider` 必须是一个**独立的结构化 reason**，不能复用 `vault-unavailable`。前者是「这个构建不认识这个 provider」，后者是「Vault 现在读不了」——两者的下一步完全不同。

### 2.4 写入路径必须显式携带 provider

`PersistedSecrets`（`host-credentials.ts:45-51`）加 `provider` 字段，否则 `retirePreviousVersion` 无法知道删哪儿。搬运旧 kind 时必须用**旧 ref 的 provider** 读，退役时必须用**旧 ref 的 provider** 删。

这是本次改造最容易写错的地方，需要三组负向测试：

1. keychain → keychain 部分更新，未重输的 kind 不丢
2. vault → keychain 切换，旧 vault 版本被正确退役
3. 任一步失败时，两个 provider 都不留下悬空密文

---

## 3. 状态机

| 故障 | UI 操作 | 自动网络重试 | 数据处理 |
| --- | --- | --- | --- |
| 无密钥/密码 | 输入密码 / 选 Agent | 否 | 原记录不变 |
| OS Keychain 请求授权 | 系统授权对话框 | 否 | 取消则不保存、不连接 |
| Vault 未创建 | 内联创建（**仅当用户选择 Vault**） | 否 | 保留当次表单 |
| Vault 锁定 | 内联解锁 | 否 | 解锁后继续原尝试 |
| Secret 读取失败 | 检查存储 / 重新输入 | 否 | 不自动清除已存凭据 |
| 引用损坏 | 编辑认证方式 | 否 | **禁止降级成无密码连接** |
| **provider 不支持** | 提示更新应用 | 否 | 不触碰任何存储 |
| TCP 超时/网络断开 | 现有重试策略 | **是** | 不触碰 SecretProvider |

**必须证明**：连接 / Jump / SFTP 三条入口统一使用同一 resolver；跳板机与目标机分别解析；`clearCredential` 对不同 provider 的引用原子退役；Keychain 不可用与 Vault 锁定是**不同结构化错误**，不用英文文案 `includes` 推断。

最后一条直接对应 10.4.1 修过的问题：`CredentialFailureKind` 目前是 vault 命名的枚举（`credential-failure.ts`），keychain 不可用需要独立 kind。

---

## 4. 迁移

### 4.1 旧 Vault 引用：读方向兼容

只要 `credential-ref.ts:100` 继续接受 `'vault'`，且 resolver 在 `ref.provider === 'vault'` 时选 vault provider，**老引用天然可读，不需要迁移**。`LEGACY_VERSION = 0` 的旧键继续由 `vaultKey` 还原。

验证方法：用真实 fixture 解密，不是只做 parse。

### 4.2 写方向不兼容 —— 这是唯一可能丢数据的路径

如果新构建把某主机改写为 `provider:'system-keychain'`，而用户回退到旧构建：

| 环节 | 旧构建的行为 |
| --- | --- |
| `parseCredentialRef` | → `unknown-provider` |
| `host-mappers.ts:21` | `credentialRef: null` + `credentialRefProblem` |
| `terminal-launcher.ts:38` | 抛 `credential-corrupt-reference`，不重连 |
| `hosts.ts:139` | **该主机在旧版里再也无法保存新凭据** |
| `export-sanitize.ts:89` | 导出写成 `null` —— **「这台主机有凭据」这个事实永久丢失** |

最后一行是真实的数据丢失路径：**新构建 → 导出 → 回退旧版 → 导入**，整机凭据状态被抹平成「这些主机没存过凭据」。

**决策**：UX-2b 实施前必须先做一件事 —— **让旧构建至少能安全地拒绝**。方案是给导出加版本标记，或让 `export-sanitize` 在遇到无法解析但非空的 ref 时保留原文而不是写 `null`。

这一条应在 UX-2b 之前单独修复，与 provider 改造解耦。

### 4.3 现有迁移代码不适用

`credential-migration*.ts` 迁移的是**明文 → Vault**，与 provider 无关。它不能处理 provider 间迁移：

- `credential-migration-runner.ts:148` 硬编码 `provider:'vault'`
- `credential-migration-verify.ts:34` 的 `readRef` 吞掉 problem，会对 keychain 主机产生**假失败**
- `import-vault-migration.ts:70-101` 依赖 `parseCredentialRef` 成功；本机一旦有 keychain ref，旧构建会拒绝导入

provider 间迁移需要新增实现，复用 `persistHostSecrets` 的顺序：写目标 → 读回验证 → 原子切换 ref → 清理旧 provider。

---

## 5. 改造影响面

### 必须改（21 项）

类型与解析 3、写入路径 7、连接与 UI 错误映射 5、导出导入同步 4、Rust 2。

完整清单见审查记录，关键几条：

| 文件 | 改动 |
| --- | --- |
| `credential-boundary.ts:48,221` | provider 联合类型；`splitHostSecrets` 加 provider 参数 |
| `credential-ref.ts:100` | provider 白名单；`keyId` 字段解析 |
| `credential-resolver.ts:75` | 按 ref.provider 分派 |
| `host-credentials.ts:159,227` | 搬运与退役按 ref.provider |
| `ssh-key-credentials.ts:32` | `readKeyCredentialRef` 改三态 |
| `export-sanitize.ts:89` | 不把无法解析的 ref 写成 `null`（**独立修复**） |
| `db_import/secrets.rs:216`、`payload.rs:93` | Rust 侧两处白名单 |

### 可以不改

- `src-tauri/src/vault.rs` 全部命令 —— Rust 侧是扁平 KV（`vault_set(key, value)`），不知道「凭据」这个概念。keychain 只需提供等价的 `set/get/delete`，前端映射层复用。
- `store/host-mappers.ts` —— 三态映射逻辑正确，类型扩展后自动跟随。
- `terminal-launcher.ts:29-100` —— 守卫顺序与 provider 无关。

### 会失效的测试（必须改写而非变绿）

- `credential-ref-problems.test.ts:64-69,201-220` —— **断言 `provider:'keychain'` 必须被拒**，还断言错误信息包含 "keychain"。这些测试编码的正是「单 provider 世界」的假设。
- 20 个 `vi.mock('@/service/vault-secret-provider')` 的文件。

---

## 6. 验收

```
LEGACY_VAULT_COMPAT            = 待验证（需真实 fixture 解密，非 parse）
EXPORT_PRESERVES_UNREADABLE_REF = 待修复（4.2 的数据丢失路径）
PROVIDER_DISPATCH_BY_REF       = 待实现
CROSS_PROVIDER_ROLLBACK_SAFE   = 待实现（三组负向测试）
KEYCHAIN_DEFAULT_PATH          = BLOCKED（签名）
```

**任何一条未过，UX-2b 不得合入。** 这个改造的唯一不可接受结果是让用户读不到自己的密码。
