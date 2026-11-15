# B01 — Vault IPC 安全边界

审查对象：`src-tauri/src/vault.rs` 的 `vault_get(key: String)`。
基线：`main@ca8406d8`。

## 结论

| 问题 | 判定 |
| --- | --- |
| `vault_get` 接受任意 key | **事实** |
| 当前可被远程利用 | **否**（见下方威胁模型） |
| 是否会随产品演进变成可利用 | **是**，高风险 |
| 本轮处置 | 审计日志 + 分类器；**未**改为前缀白名单（会破坏功能） |

**不得声称这是已可利用的远程漏洞。** 下面的分析支持"能力面偏宽"，不支持"存在攻击路径"。

## 威胁模型

### 当前 WebView 里跑什么

| 事实 | 来源 | 含义 |
| --- | --- | --- |
| `withGlobalTauri: false` | `tauri.conf.json` | 页面拿不到 `window.__TAURI__`，必须走打包进来的模块 |
| CSP `script-src 'self'` | `tauri.conf.json` | 不能执行远程脚本，也没有 `unsafe-eval` |
| 只有 `main` 一个窗口 | `tauri.conf.json` | 没有第二个 WebView，也没有 webview 嵌入 |
| 无 `dangerousRemoteDomainIpcAccess` | 检查过，不存在 | 远程域没有 IPC 访问权 |

因此「IPC 可达」当前等价于「我们打包的代码可达」，不等价于「任意页面可达」。

### 谁能调到 `vault_get`

前端只有两处真实调用：

| 调用点 | key 来源 | 是否需要任意 key |
| --- | --- | --- |
| `service/vault-secret-provider.ts:75` | `vaultKey()` 构造，`host:<id>[:<v>:<kind>]` / `ssh-key:<id>[:<v>:<kind>]` | 否，受命名约束 |
| `view/vaults/use-vaults-view.ts:47` | **用户自定义的条目名** | **是** |

第二处是产品功能：Vault 管理器让用户自己命名条目。任何前缀白名单都会破坏它。

### 所以问题是什么

`vault_get` 的能力是「读这个 Vault 里的任意一条秘密」。在一个只有可信代码的 WebView 里，这是内部 API 的常规形态。真正的问题是**它无限期保持这个形态**：

- 引入 Extension Platform（Phase D）后，插件代码会进主 WebView；
- 一旦有 `withGlobalTauri: true` 或放开 CSP，注入面立刻变成攻击面；
- 那时 `vault_get('host:<other-host-id>:1:password')` 就是一条直读任意凭据的路径。

## 本轮做了什么

`vault_get` 现在写一条审计日志，记录 key 的**分类**而不是 key 本身：

```
vault_get kind=host-credential
vault_get kind=user-entry
```

`vault_key_kind()` 只返回五个固定字符串之一：`host-credential`、`ssh-key-credential`、
`team-secret`、`diagnostic-probe`、`user-entry`。它不返回 id、不返回条目名。

为什么这是正确的取舍：

- **不破坏功能**：Vaults 视图仍然能用自己的 key 读写；
- **可追溯**：异常读取在日志里留痕，且日志本身可以安全保存；
- **不假装修复**：这不是能力收窄，只是可观测性。

### 测试

| 测试 | 钉住什么 |
| --- | --- |
| `the_vault_key_classifier_separates_namespaces` | 五类各自正确 |
| `the_vault_key_classifier_never_echoes_the_key` | 分类结果既不含 key，也不被 key 含；且只能是五个固定值之一 |
| `an_unknown_namespace_is_not_a_credential` | `hostile:entry`、`ssh-keychain` 不被误判为凭据 |

**变异验证**：把 `vault_key_kind` 改成 `Box::leak(key)` 返回原 key，两条测试立刻失败并打印
`classification "host:1111…" leaks "host:1111…"`。

## 未做的（下一阶段）

### 按资源绑定的读取能力

正确形态是**一个资源一条命令**，而不是一个 key 一条命令：

```rust
// 现在
vault_get(key: String) -> String

// 目标
vault_read_host_credential(host_id: &str, kind: CredentialKind) -> String
vault_read_user_entry(name: &str) -> String
```

前者让调用方说「我要这个字符串」，后者让调用方说「我要这台主机的凭据」——Rust 侧才能判断
这个请求是否与当前会话有关。

代价是前端 `vault-secret-provider.ts` 与 `use-vaults-view.ts` 都要改，且迁移期间两套 API
并存会让"到底谁还能读任意 key"变得不清楚。这需要一个明确的窗口期，不适合与本轮的其他修复
混在一起。

### 在 Rust 层消费凭据

更彻底的做法是连接流程根本不把秘密交给前端：Rust 拿着 `CredentialRef` 自己完成认证。这会
改变 `resolveSessionCredential` 的整条链路（Phase 10.x 的核心设计），属于独立的架构工作。

### 负向测试（在资源化 API 落地后）

- 用 host A 的引用读 host B 的凭据 → 拒绝；
- 用已删除资源的引用 → 拒绝；
- 未持有会话的调用 → 拒绝；
- 未知 kind → 拒绝。

现在无法写这些测试，因为 API 还没有资源概念——写了也只是测试一个不存在的边界。

## 风险分级

**P1**（不是 P0）：当前不可利用，但会在 Extension Platform 落地时变成 P0。建议在 Phase D
开工前完成资源化 API，而不是与本轮一起做。
