# T08 — SFTP 产品级写路径验收记录

> 基线 `main@2f682a0`（六个 T01–T07 PR 全部合入之后）。
> 本文只写**已经用证据闭合的**和**明确没闭合的**，不写「应该没问题」。

---

## 一、核对既有实现，先看已经有的是什么

T08 的任务是「复用已有双 sshd Fixture，真实 GUI 执行 mkdir、rename、delete、
upload、download、目录导航，检查远端实际文件、SHA-256、GUI 状态以及正确 Host」。

核对下来，`e2e/gui/specs/e2e-03-sftp-dock.e2e.mjs` 里**已经有**一条完整的写路径
用例：通过产品自己的对话框建目录、用 F2 重命名、用 Delete 删除，三步都走真实的
SFTP 会话，并断言「另一台 host 的列表没被污染」。

所以本轮不是从零开发，而是**核对那条用例是否真的在验证它声称的东西**。

---

## 二、找到的三个真实缺口

### 缺口 1：用例标题说「verified on the server」，而它读的是 DOM

这是本轮最严重的一项，也是**第二个**「用例标题在说一件断言不成立的事」。

那条用例的每一步断言都长这样：

```js
browser.execute(() =>
  Array.from(document.querySelectorAll('[data-testid="file-row"]')).some(row =>
    (row.textContent ?? '').includes(name),
  ),
)
```

`readRows()` 读的是**产品自己渲染出来的行**，而那些行来自产品刚刚拉取的列表。
换句话说：

| 缺陷 | 这份断言会怎么表现 |
| --- | --- |
| mkdir 建到了错误的目录 | 列表刷新后某处出现该名字 → 通过 |
| rename 被服务器拒绝 | 产品乐观更新 → 通过 |
| delete 什么都没删掉 | 乐观移除 → 通过 |

**产品在给自己作证。**

这与 T09 记录的「用例标题与断言不符」是同一类，当时新增的守卫
（`no case title claims the dock follows focus`）没有覆盖到这一条。

### 缺口 2：upload / download 在 GUI 层不可自动化，但声明藏在计数里

它们走 `plugin-dialog` 的原生 `open()` / `save()`，WebDriver 驱动不了。这个结论
本身是对的，但它被写成了 `gaps: [{ covers: 2 }]`，读者很难从 `covers: 2` 读出
「上传和下载在 GUI 层完全没测」。

### 缺口 3：`verifyChecksum` 整条链路都在，没有任何调用方

`grep -rn verifyChecksum packages/frontend/src` 只有一个命中：`sftp-transfer.ts`
里的 re-export。

| 层 | 状态 |
| --- | --- |
| `sftp_local_checksum` / `sftp_remote_checksum`（Rust） | 真实命令，有真实实现 |
| `sftpService.checksumLocal` / `checksumRemote` | 真实 IPC 调用 |
| `sftp-transfer-checksum.ts` `verifyChecksum` | 完整实现：两侧都算、都写回 |
| store 的 `initChecksum` / `setChecksumResult` | 完整实现，含 `matches` 比较 |
| **调用方** | **无** |
| **渲染 `record.checksum` 的 UI** | **无** |

所以每一次上传下载都以 `checksum: undefined` 结束，完整性校验从未运行过。这是本仓
反复出现的「机制存在、没人驱动」形态（参见 `orphanedSecrets` 永远是 0）。

---

## 三、本轮做了什么

### 1. 服务器侧断言：`e2e/gui/fixtures/server-state.mjs`

fixture 的 sshd 就跑在这台机器上、用这个账号，所以**服务器自己的目录**从 Node 里
直接可达。`readdirSync` / `statSync` 得到的是服务器的答案，不是面板的渲染。

| 函数 | 作用 |
| --- | --- |
| `remoteRoot(envName)` | 取 `GUI_E2E_REMOTE_ROOT`（或第二台的 `_2`），并校验路径形态 |
| `serverEntries(relative, env)` | 服务器自己的目录列表 |
| `serverEntry(relative, env)` | 服务器上的存在性 / 是否目录 / 大小 |
| `seedFile` / `readServerFile` | spec 自己写、自己读回，字节比较不经过产品 |
| `selfCheck()` | 先验证读取器本身可信，再拿它做断言 |

`underRoot` 拒绝相对逃逸（`../`）、绝对路径、以及**共享前缀的兄弟目录**
（`/tmp/…/remote-evil` 与 `/tmp/…/remote`）。最后一条是裸 `startsWith(root)` 的
典型漏洞，只差一个分隔符。

### 2. 改写写路径用例

每一步的断言来源都换成了服务器：

| 步骤 | 改前 | 改后 |
| --- | --- | --- |
| 前置 | 只读 DOM | **面板与服务器必须先一致**，否则直接报错（说明测的不是同一个目录） |
| mkdir | DOM 出现该行 | `serverEntry(name).isDirectory === true` |
| rename | DOM 出现新名、旧名消失 | 服务器上**新名存在且旧名不存在**，两者都断言（只查一半会把「复制」当成「重命名」） |
| delete | DOM 里没有了 | `serverEntry(name) === null` |
| 另一台 host | 读另一台面板的 DOM | 读**第二台服务器自己的目录**，并断言两台目录不相同（相同则这个检查无意义） |

### 3. 新增目录导航用例

T08 要求里有「目录导航」，此前没有。新用例：

1. 在服务器上建一个有已知内容的目录（`seedFile`）；
2. 让 pane 用**产品自己的 Enter 键打开路径**进入它（`file-pane-row.tsx` 里 Enter
   走的就是 `onDoubleClick(file)`，是产品自己的打开动作，不是绕过）；
3. 断言 pane 的行**恰好等于服务器该目录的内容**；
4. 用面包屑的 Home 控件返回，断言回到含该目录的列表。

### 4. `verifyChecksum` 的能力测试

`packages/frontend/src/service/sftp-transfer-integrity.test.ts`，5 项：
两侧都算、一致时 `matches: true`、不一致时 `matches: false`、任一侧失败时
**`matches` 保持未定义而不是 false**、本地失败原因被带出。

最后一条是有意义的：把「算不出来」和「不一样」合并成 `false`，会把服务器错误
报成文件损坏。

---

## 四、变异验证

| 变异 | 结果 |
| --- | --- |
| `underRoot` 改成裸 `startsWith(root)` | 1 项红（前缀兄弟目录逃逸） |
| `serverEntries` 对缺失目录返回 `[]` 而不是抛错 | 1 项红（缺失目录被读成空） |
| `matches` 恒为 `true` | 1 项红（不一致用例） |
| 去掉「两侧都 done」的守卫，直接比较 | 2 项红（失败侧被误判） |

四条变异各自精确命中了它对应的用例；恢复后全绿。

---

## 五、`verifyChecksum` 没有接线，这是**记录**而不是隐藏

第一版测试里写了一条 `expect(checksumLocal).not.toHaveBeenCalled()`，断言「传输完成
后没有校验」。它通过了，但那是**把缺陷断言成正确行为的测试** —— 本仓已经吃过这个
亏：`orphanedSecrets` 被声明、被按唯一用例注释、被初始化为 0 且永不递增；还有一条
绿测试曾把「伪造定界符留在正文」断言成正确行为。两者都是因为有一条通过的测试替它们
背书而存活。

所以那条测试被删除，缺口写在测试文件头部的注释里，而不是写成一个通过的断言。

**接线本身是一个独立改动**，理由：让校验在每次传输后运行，会改变「done」的含义；
而且如果 mismatch 用户看不到，那不算修好。这需要一次产品决策（不匹配时给用户看
什么），超出本轮。

---

## 六、判定

```
SERVER_SIDE_WRITE_ASSERTION        = PASS（本轮新增，有变异验证）
DIRECTORY_NAVIGATION               = PASS（本轮新增用例；真实 GUI 运行待 CI）
OTHER_HOST_UNTOUCHED_SERVER_SIDE   = PASS（读第二台服务器自己的目录）
CHECKSUM_CAPABILITY                = PASS（5 项，2 条变异）
CHECKSUM_WIRED_INTO_TRANSFER       = NOT_RUN（无调用方，已记录，未伪造修复）
GUI_UPLOAD_REAL_BYTES              = NOT_RUN（原生文件选择器不可驱动）
GUI_DOWNLOAD_REAL_BYTES            = NOT_RUN（同上）
```

**不能声称的部分**：

- 本轮改的是 **spec 的断言来源**，不是产品代码。产品在 mkdir / rename / delete 上
  的行为没有被改变，只是从此**被真正核对了**。
- 新的服务器侧断言需要一次真实的 GUI E2E 运行才能闭合。本轮没有跑，
  所以 `SERVER_SIDE_WRITE_ASSERTION` 的证据是「代码 + 变异」，不是「一次绿色的
  GUI 运行」。这一点不能含糊。
- 上传下载的真实字节往返仍然只在 Rust 命令层被证明
  （`sftp_command_e2e_tests.rs` 的 24 MiB + SHA-256），**不是**经过 GUI。
