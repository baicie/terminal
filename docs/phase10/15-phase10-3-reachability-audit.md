# Phase 10.3 WP0 — 真实可达性审查

- 基线：`main = 297dc39`
- 方法：五个独立审查 agent 各自追踪一条链路，从 UI 入口走到实际效果，逐跳给 `file:line`；
  结论由「真实运行验证」而非「读代码觉得应该能行」得出
- 目的：检验 Phase 10.2 记录的 PASS 项，是否有真实用户能触发的路径

## 0. 结论总表

| 链路 | 判定 | 触发它的真实用户操作 |
| --- | --- | --- |
| OpenSSH Import → Host Store → SQLite → Resolver → SSH | **NO** → 已修 | 导入 → 连接 |
| Host 编辑 → 换认证方式 → CredentialRef → 立即连接 | **PARTIAL** → 已修 | 编辑卡片 → 改认证方式 → 保存 → 连接 |
| Vault 首次创建 → 保存 → 重启 → 解锁 → 连接 | **PARTIAL** → 部分修，部分记录 | 新建主机填密码 → 保存 → 重启 → 连接 |
| ProxyJump → 两端凭据 → SSH Session | **NO** → 已修 | 导入含 ProxyJump 的配置 → 连接 |
| Team Share → Vault → 序列化 → SQLite / 服务端 | **PARTIAL** → 已修 | 卡片菜单 → 分享 → 勾选「包含密码」 |

**五条链路里有三条在审查前是不可用的。** 这不是「测试不够」，是「测试锁的是旧契约」。

## 1. OpenSSH Import → SSH：NO

### 断点

**1.1 `identityFilePath` 守卫在终端路径上从未执行**

```
terminal-launcher.ts:41   if (ref === null || ref.kinds.length === 0) return host   ← 返回
terminal-launcher.ts:45   const resolved = await resolveSessionCredential(host)     ← 守卫在里面
session-credentials.ts:75 if (host.identityFilePath) { ... }                        ← 永远到不了
```

导入的主机恰好 `credentialRef` 为 null（什么都没绑），于是被原样返回。launcher 继续调用
`session_create_ssh_key` 并传 `privateKey: ''`，Rust 在 `commands.rs:214` 以
`InvalidInput("Private key cannot be empty")` 拒绝 —— 用户看到的是密钥解析失败，
而不是「这台主机还没有绑定密钥」。

**这与 Phase 10.1 的 DEFECT-1 是同一形状**：守卫存在、有单元测试、真实入口在它之前返回。
当时的教训是「测试直接调内层函数，所以测试绿而生产路径红」，这次是「测试直接调守卫所在的
函数，所以测试绿而 launcher 路径红」。

### 修复

守卫移到 early return **之上**（`terminal-launcher.ts`）。三条测试锁定：带路径的主机被拒绝、
真正空配置的主机仍原样返回、有引用的主机走 resolver。

**1.2 重新保存私钥后，陈旧路径仍留在行上**

`host-update-args.ts:68` 无条件重写 `merged.identityFilePath`。用户按提示粘贴私钥保存后，
行上同时有 `credential_ref: {kinds:["privateKey"]}` **和** `identity_file_path` —— 连接仍被
路径守卫拒绝，文档描述的恢复路径无法成功。

修复：`clearIdentityFilePath` 在本次写入携带秘密时置 NULL；`clearCredential` 语句直接写
`identity_file_path = NULL`（并相应减少一个绑定参数）。

**1.3 没有任何 UI 动作能把密钥文件导入 Vault**

提示语让用户「粘贴密钥」，而编辑表单此前完全不显示 `identityFilePath`。用户既不知道
这台主机在等什么，也无从处理。

修复：`IdentityFileNotice` —— 显示路径、说明应用为什么不在连接时读文件、一个按钮跳到
私钥输入框。4 项测试。

## 2. Host 编辑 → 换认证方式 → 连接：PARTIAL

功能链本身不断（编辑 → 切换 → 保存 → 连接四步全部可达，且不需要重启：store 重读 +
`updatedAt` 触发 session 重建）。断在语义与退役两处。

### 2.1 切换认证方式时旧凭据被带进新方式

`persistHostSecrets` 把「本次提交的 kinds」与「旧 ref 的全部 kinds」求并集，且不知道
`authType`。

- **password → key**：旧账号密码并入新版本，与 `privateKey` 同一代。连接时
  `terminal-launcher` 把两者一起交给 `session_create_ssh_key`，SSH 层把那个密码当作
  私钥口令 —— 用户从未设置过它。
- **key → agent**：`hasSecrets` 为 false，走 `COALESCE(?, credential_ref)`，旧引用原样保留。
  用户说「不要再用凭据」，Vault 里那份密文却永久留着。

### 2.2 没有清除凭据的 UI 入口

全仓 `clearCredential` 只出现在类型声明、`hosts.ts` 的消费、store 的写入前剥离，其余全在
测试里。主机对话框、`HostFormActions`、卡片菜单都没有入口。所以 key → agent 的密文
**没有任何用户可执行的回收路径**。

### 修复

`persistHostSecrets` 接收 `authType` 与 `previousAuthType`；只有**确实发生了切换**才丢弃
属于旧方式的 kind。不按当前 authType 一刀切 —— `key` 模式下的 `password` 字段是私钥口令，
合法存在（这条约束由「只重输私钥时保留密码」的既存测试守住）。

`updateHost` 在切到 `agent` 时走与 `clearCredential` 相同的顺序：先 UPDATE 置 NULL
与 `identity_file_path`，再 retire 旧版本。

### 未修，需产品决策

`clearCredential` 仍然没有 UI 入口。这不是缺陷的修复而是功能缺失：加一个「清除已存凭据」
按钮是产品决定（放在哪、要不要二次确认、与删除主机的区别）。记录于此，不做。

## 3. Vault 首次创建 → 重启 → 解锁 → 连接：PARTIAL

### 3.1 修好的部分

保存被拒绝时的 `VaultRecovery` 面板（Phase 10.2）在保存路径上工作正常：创建/解锁后就地
重试同一 payload。

### 3.2 未修：移动端无法解锁

重启后 Vault 处于锁定，唯一的解锁入口是 `/vaults` 页面。该页只在桌面侧栏可达
（`app-sidebar/index.tsx:101`、`nav-config.tsx:63`），而移动端底部导航
（`bottom-nav/index.tsx:41-75`）的 primary tabs 与 More 面板都不含 `/vaults`，
且侧栏在移动端不挂载（`layout/index.tsx:88` 的 `sidebarOpen={!isMobile && ...}`）。

主机对话框覆盖了这个场景，但**只覆盖保存**（`use-host-dialog-form.ts:155`），不覆盖连接。

### 3.3 未修：锁定的 Vault 被当作可重试网络错误

`terminal-session-manager-errors.ts:52` 把 `vault-unavailable` 归入可重试桶，
`terminal-session-manager-start.ts:150` 因此花掉 5 次自动重连预算加 30 秒恢复计时器。
面板此时显示「Waiting to retry」，而不是「Vault 已锁定，请解锁」。

这是**误导性的状态**：用户会以为网络有问题并等待，而实际只需要解锁。

### 为什么这两条没有在本轮修

3.2 是导航结构改动（把 Vault 加入移动端入口），3.3 是重试分类改动（把 `vault-unavailable`
移出可重试桶可能影响其他场景的恢复行为）。两者都需要真机验证移动端布局与重连行为，
而本轮没有 GUI 环境来确认改动没有破坏其他状态。**记录而不猜。**

## 4. ProxyJump → 两端凭据 → SSH：NO

### 4.1 导入的跳板机 id 对不上

`materialiseImport` 用 host+port+user 派生确定性 id，`jumpHostId` 指向同源的 id。
但 `addHost` 无条件 `generateId()`：

```
插入的 bastion 行 id = 0082ae8f-25b7-4488-9103-d27dee489333
目标的 jump_host_id  = import-bastion-example-test-22-ops
```

**每一条导入的 ProxyJump 都指向不存在的 id。** 现有测试没抓到：`import-plan-references.test.ts`
比较的是 `materialiseImport` 返回数组内部的 `jumpHostId` 与 `bastion.id` —— 在任何数据库
写入之前，两者当然相等。

修复：`addHost` 传入 id 则保留，未传（手动新建）才生成。

### 4.2 跳板机已存在时仍指向未插入的候选

`import-proxy-jump.ts` 的 fallback 会返回**任意候选**的 id，包括 `duplicate`。
但 `materialiseImport` 只输出 `create` 行 —— duplicate 永远不会被插入。

修复需要两处（只改一处不够）：`byNameOrHost` 拆成 `byNewCandidate`（仅 create）与
`bySavedHost`（真实已保存行的真实 id）；`byAlias` 也要跳过 duplicate，否则别名路径仍然
返回未插入的候选 id。

## 5. Team Share：PARTIAL

### 5.1 「包含密码」共享了零个秘密

`handleShare` 用 `host.password` / `host.privateKey` 判断共享什么。Phase 10.1 之后这两个
字段在已保存主机上**恒为 undefined**，两个 `if` 永远为假：

```ts
if (includePassword && host.password) { /* 永不执行 */ }
```

用户勾选「包含密码」并确认后，分享的是零个秘密，`toast.success` 照常弹出。

**这比明文共享更糟**：需要凭据的同事以为已经拿到，收到的主机却没有凭据，
也没有任何提示说明本应有。

修复：新增 `share-host-secrets.ts`，通过行上的 `credentialRef` 从 Vault 按需读取；
引用缺失、kind 未列出、Vault 锁定、读回 undefined 一律失败并给出可操作提示。
同时移除「未加密则带警告共享明文」的分支 —— 一条警告不能让服务端上一份明文密码
变得可接受。

### 5.2 记录：passphrase 产生了但没人消费

对话框会产出 `hostData.passphrase_encrypted`，但 `handleDecryptAndImport` 只处理
`password_encrypted` 与 `private_key_encrypted`。接收方拿到的是一个含 passphrase
却不会用它解密的记录。

未修：需要改导入侧的解密与落库逻辑，且要确认接收端的 host 行能表达「私钥 + 口令」
这组关系（当前 hosts 表没有 passphrase 列，只有 ssh_keys 有）。这是设计缺口而非笔误，
记录待决策。

## 6. 本轮修复清单

| 提交 | 内容 |
| --- | --- |
| `92d9946` | WP5：共享凭据从 Vault 读取，且只允许加密 |
| `3c828ce` | WP1/WP2：真实 sshd 验证 IdentityFile 与 ProxyJump |
| 本分支 | 守卫可达性、导入 id、ProxyJump fallback、认证方式切换 |
| 本分支 | IdentityFileNotice + identity 绑定清理 |

## 7. 未修并记录的事项

| 项 | 为什么 |
| --- | --- |
| `clearCredential` 无 UI 入口 | 产品决策（入口位置、二次确认、与删除的区别） |
| 移动端无法解锁 Vault | 导航结构改动，需真机确认 |
| Vault 锁定被当作可重试网络错误 | 重试分类改动，需真机确认不破坏其他恢复路径 |
| `passphrase_encrypted` 无消费方 | 设计缺口，需先决定 hosts 行如何表达「私钥 + 口令」 |

## 8. 这次审查说明的方法问题

Phase 10.2 的两项 PASS（`HOST_EDIT_UI_WIRED`、`OPENSSH_IMPORT_UI_READY`）在**入口**层面
成立，但入口之下的**效果**有三条断链。原因是测试锁的是函数契约，不是用户路径：

- `import-plan-references.test.ts` 在数组层面比较 id —— 数据库写入之后才能发现不一致；
- `identityFilePath` 的守卫测试直接调 `resolveSessionCredential` —— launcher 在其之前返回；
- share 的测试如果只断言「调用了 onShare」，就无法区分「共享了元数据」与「共享了零个秘密」。

**判定改成以「用户能否走完」为准**：本轮所有新测试都从真实组件或真实入口驱动，
不再只调用内层函数。
