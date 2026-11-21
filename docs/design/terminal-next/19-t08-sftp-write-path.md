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

## 六、第一次真实运行时发现的问题

这是本轮最有价值的部分：**断言从未被执行过**，所以它们从未失败过。

### 6.1 Node 22 上，11 项全绿而 10 项 NOT_RUN

第一次跑 `node scripts/run-gui-e2e.mjs --spec specs/e2e-03-sftp-dock.e2e.mjs`（本机
Node **v22.12.0**）的结果：

```
✓ creates, renames and deletes a directory on the bound host — verified on the server
✓ navigates into a directory and reports the destination the filesystem has
11 passing (1m 17.1s)
[gui-e2e] finished with exit 0
```

同一个 run 的证据文件：

```
verdict: PARTIAL    notRunCount: 10    sshFixture: false
write case NOT_RUN: no SSH fixture this run
navigation case NOT_RUN: no SSH fixture this run
```

`node:sqlite` 在 22.x 上要 `--experimental-sqlite`，fixture 因此写不了 host 行、被判
不可用。**每条远端用例开头都有 `return`，所以那两条新断言一行都没跑，而用例照样打了
一个勾。**

修法是把这个前置检查提到 CLI 最前面，`fail()` 退出非 0：

```
[gui-e2e] this Node cannot provide `node:sqlite`, so the SSH fixture cannot seed its
host row and every remote-directory case would record NOT_RUN with the suite still
green.
```

第一次写这个守卫时**它是失效的**：用了 `process.getBuiltinModule`，而那个 API 在
Node 22 上不存在，于是我写了 `if (typeof require !== 'function') return` —— 一个在它
本该拦截的版本上直接放行的守卫。改成 `createRequire`。

### 6.2 fixture 真的起来之后，两条新用例真的失败了

Node 24.16.0 上重跑，fixture 启动，证据变成 `sshFixture: true`、`notRunCount: 1`：

```
✓ ... 9 passing
✖ creates, renames and deletes a directory on the bound host — verified on the server
    element ("[data-testid="sftp-mkdir-input"]") still not displayed after 5000ms
✖ navigates into a directory and reports the destination the filesystem has
    element ("//*[@data-testid="file-row"][.//*[@title="e2e-nav-case"]]") still not existing
```

**这正是需要的信号。** 前一轮它们假装通过，这一轮它们真的失败了。

不过失败点值得看清：证据里 `pane and server agree on the starting listing (1 entries)`
**通过了**，说明服务器侧前置断言真的执行了、面板与服务器确实一致。失败发生在之后。

第一处：`sftp-mkdir` 用的是脚本 `.click()`：

```js
browser.execute(() => {
  const button = document.querySelector('[data-testid="sftp-mkdir"]')
  button.click()
})
```

本仓已经在 `e2e-05` 的 `driveSwitch` 里记录过**两次**「脚本 `.click()` 驱动不了
Radix 控件」。`sftp-mkdir` 本身是普通 `Button`，但打开的是一个 Radix `Dialog`，而
`onClick` 走的是 React 根监听器上的合成事件。改为 WebDriver 自己的点击。

**这一处是测试缺陷，不是产品缺陷。** 产品的 onClick 接线是正常的，脚本点击没有产生
React 能识别的点击。

### 6.3 用例打勾与「断言执行了」是两件事

这一轮最该记住的一条：wdio 的 `✓` 只说明用例**没有抛错**。一条在开头 `return` 的
用例永远不会抛错。所以：

- 「11 passing」不等于「11 条断言执行了」；
- 证据文件里的 `notRunCount` 比用例列表更接近事实；
- **一条一直没有执行过的断言，和一条一直是绿的断言，看起来完全一样。**

这也是为什么缺口 1 能活这么久：它从未运行过，所以从未失败过。

---

### 6.4 继续往下跑，找到三个真实的产品缺陷

`waitForDisplayed` 换掉之后，两条用例都往前推进了。推进出来的东西不是脚手架问题。

### 缺陷 A：远端 Home 按钮把用户带到整个文件系统

`file-pane-navigation.tsx` 里是：

```tsx
onClick={() => onNavigate(type === 'remote' ? '/' : '')}
```

实测：在远端面板按 Home，列出的是

```
.nofollow .vol Applications bin cores dev Library opt private
sbin System Users usr Volumes .file .VolumeIcon.icns etc home tmp var
```

macOS 根目录。而面板打开时用的是 `.`（`resolveListingPath` 把它解析成服务器上的用户
主目录）。用户在文件管理器里按 Home 期望的是自己的目录。

已改为 `onNavigate('.' )`，复用面板首次加载的那条解析路径，不引入第二套「home」概念。

### 缺陷 B/C：`sftp.goHome` 与 `sftp.goUp` 两个翻译键没有消费者

```
grep -rn "sftp.goHome\|sftp.goUp" packages/frontend/src --include="*.tsx" --include="*.ts"
（除 locales 外，无输出）
```

翻译做了、功能没做。本仓反复出现的「文案/机制在，没人驱动」形态。

`goHome` 现在的消费者就是修好的 Home 按钮。`goUp` 仍然没有——记录，不假装。

### 缺陷 D：四个图标按钮没有无障碍名称

后退/前进/刷新/Home 都是纯 `<svg>` 子节点的 `<Button>`，没有 `aria-label`、没有文本。
屏幕阅读器读到的是四个未命名按钮。这不是测试需要，是产品缺陷；测试找不到它们只是
症状。

已补 `aria-label`（三语）与 `sftp-{type}-{back,forward,refresh,home}` test id。
per-type 是因为分栏布局下两个面板同时渲染这个组件，刷新「远端面板」不得刷新到本地。

### 仍未解决

`sftp-mkdir-confirm` 有 72×34 的盒子，但 `elementFromPoint` 的落点不是它——对话框里
的按钮被别的东西盖住。错误消息现在会打印落点是谁、对话框的 z-index、视口尺寸。
**这不预设结论**：可能是产品缺陷（对话框层级），也可能是脚手架仍在用错坐标。

---

## 七、判定

```
SERVER_STATE_READER                = PASS（13 项，2 条变异）
PANE_AND_SERVER_AGREE              = PASS（真实 GUI 运行中执行并通过）
SERVER_SIDE_WRITE_ASSERTION        = PARTIAL（断言已改写；GUI 侧曾首次真实失败）
DIRECTORY_NAVIGATION               = PARTIAL（同上）
OTHER_HOST_UNTOUCHED_SERVER_SIDE   = PARTIAL（代码已改，GUI 未跑到该分支）
CHECKSUM_CAPABILITY                = PASS（5 项，2 条变异）
CHECKSUM_WIRED_INTO_TRANSFER       = NOT_RUN（无调用方，已记录，未伪造修复）
GUI_UPLOAD_REAL_BYTES              = NOT_RUN（原生文件选择器不可驱动）
GUI_DOWNLOAD_REAL_BYTES            = NOT_RUN（同上）
```

**为什么是 PARTIAL 而不是 PASS**：

服务器侧读取器本身是 PASS（有变异验证）。但**改过断言的用例还没有一次完整的绿色
GUI 运行**。第一次真实运行（Node 24）里它们**失败了** —— 那是好事，说明断言真的在
执行；失败点是 `sftp-mkdir` 用了脚本 `.click()`，已改为 WebDriver 点击。修正后的
结果必须以一次真实运行为准，本文不预先声称它通过。

**不能声称的部分**：

- 本轮改的是 **spec 的断言来源**，不是产品代码。产品在 mkdir / rename / delete 上
  的行为没有被改变，只是从此**被真正核对了**。
- 上传下载的真实字节往返仍然只在 Rust 命令层被证明
  （`sftp_command_e2e_tests.rs` 的 24 MiB + SHA-256），**不是**经过 GUI。
- 「11 passing」曾经对应 10 项 NOT_RUN。任何一次 GUI 运行的结论都必须读证据文件里
  的 `notRunCount` 与 `sshFixture`，不能只读用例列表。
