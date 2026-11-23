# R05 — e2e-03 的 11 项断言真实性复审

> 要求：逐项检查有没有 `browser.execute` 替代真实点击、Node 写文件替代产品上传、
> DOM 替代服务器状态、超时放大、catch-then-PASS。

结论：**11 项里 10 项站得住，1 项如实记为 NOT_RUN。整体判定 PARTIAL，不是 PASS。**
证据文件自己的 verdict 也是 `PARTIAL`，与本文一致。

---

## 一、五类虚假证据的逐项判定

| 检查项 | 结果 | 依据 |
| --- | --- | --- |
| `browser.execute` 替代真实点击 | **部分存在，均属前置状态而非被测动作** | 见 §二 |
| Node 写文件替代产品上传 | **不存在** | 见 §三 |
| DOM 替代服务器状态 | **不存在** | 见 §四 |
| 超时放大 | **不存在** | 见 §五 |
| catch-then-PASS | **不存在** | 见 §六 |

---

## 二、`browser.execute` 里的 `.click()`

全文 40 处 `browser.execute`，其中 16 处内部含 `.click()`。逐个读过之后，它们分成两类：

**A. 建立前置状态（合法）**

```js
const opened = await browser.execute(() => {
  const rail = document.querySelector('[data-testid="rail-sftp"]')
  const pressed = rail.getAttribute('aria-pressed') === 'true'
  if (!pressed) rail.click()
  return { clicked: !pressed, alreadyOpen: pressed }
})
```

「把 dock 打开」不是这个 spec 要验证的东西，而是它观察宽度的前提。而且它读
`aria-pressed` 再决定点不点 —— 盲目点两次会在 dock 本来开着时把它关掉（代码注释里写了
这个历史）。

**B. 绕过导航 UI（需要标注，但不是伪造）**

`window.history.pushState()` + `popstate` 用于从 `/terminal` 走到 `/sftp`。这是
`createBrowserRouter` 下唯一能让 Router 真正响应的方式（hash 改动不会触发导航）。它
**绕过了导航 UI**，所以这个 spec 不证明「点击侧栏能到 /sftp」——那条链路由 e2e-02 与
UX-1b 的导航测试覆盖。这是范围划分，不是把失败藏起来。

**被测动作本身用的是真实 WebDriver 点击**：

```js
const buttons = await browser.$$('[data-testid="pane-switch"] button')
await buttons[0].click()      // local
await buttons[1].click()      // remote
```

local/remote 切换就是这一项要验证的行为，它两次都是真实点击。

---

## 三、Node 写文件替代产品上传

**不存在。** `serverEntries()` 只做 `readdirSync`：

```js
export function serverEntries(relative = '.', envName = PRIMARY_ROOT_ENV) {
  const root = remoteRoot(envName)
  const target = underRoot(root, relative)   // 拒绝越界
  return readdirSync(target).sort()
}
```

全仓 `e2e/gui/` 下没有一处向 `GUI_E2E_REMOTE_ROOT` 写文件。上传字节那条链路由 e2e-06
承担（真实 3 MiB 上传 + 双侧 SHA-256），不在这个 spec。

---

## 四、DOM 替代服务器状态

**不存在，而且是反过来的。** 写路径那 3 项（mkdir / rename / delete）的断言来源是
`serverEntries()` —— 直接读 fixture 的服务器目录，不是读 DOM。

更关键的是它先验证读取器本身：

```js
const guard = selfCheck()
if (!guard.ok) {
  notes.push(`write case NOT_RUN: the server-state reader is not usable — ${guard.reason}`)
  return
}
```

一个坏掉的 `underRoot` 会让每个断言都回答「不在」，而那与「产品没创建它」不可区分 ——
这正是这个守卫存在的理由。

---

## 五、超时

| 超时 | 次数 | 用在哪 | 判定 |
| --- | --- | --- | --- |
| 20 s | 10 | 元素出现 / 目录列举 | 合理 |
| 15 s | 3 | waitForClickable | 合理 |
| 25 s | 2 | 主机卡片出现、marker 目录出现 | 合理（真实 SSH 建连 + 列举） |
| 45 s | 1 | **SSH 主机连接建立** | 合理 |
| 10 s / 5 s | 2 | 短操作 | 合理 |

没有一处是「为了让测试通过而调大」的。45 s 那处是真实的 SSH 握手 + 认证 + 列举，
`timeoutMsg` 写的是 `the SSH host never connected` —— 超时时报出的是原因，不是沉默。

---

## 六、catch-then-PASS

全文只有 **1 处** `catch`，在诊断采集里，不包裹任何断言：

```js
try {
  shape = err === undefined ? 'undefined' : JSON.stringify(err)
} catch {
  shape = `<unserialisable ${typeof err}>`
}
```

另一处 `catch` 在「尝试多个候选元素」的循环里（`lastError = error` 后继续试下一个），
循环结束时若全失败会抛 `lastError`，不是吞掉。

---

## 七、有一项没被测，而它是自己承认的

证据文件 `verdict` 是 **PARTIAL**，`notes` 里写着：

```
NOT_RUN: upload survives closing the dock (this spec starts no upload — the transfer
queue is exercised by the upload/download specs)
```

这符合本仓「绿不等于跑过」的规则：11 个 `it` 全绿，但有一项能力这一轮**没被验证**，
所以整体不是 PASS。上传存活由 e2e-06 覆盖。

---

## 八、结论

| 项 | 判定 |
| --- | --- |
| e2e-03 断言真实性 | **通过**（无五类虚假证据） |
| e2e-03 整体证据 | **PARTIAL**（1 项 NOT_RUN，spec 自己已声明） |
| `browser.execute` 辅助点击 | 需要标注用途；建议后续把 B 类（路由跳转）在 `notes` 里显式记一行 |

### 一条改进建议（未实施）

B 类（`pushState` 路由跳转）目前只写在代码注释里，没有进入证据文件。读证据的人看不到
「这个 case 没有经过导航 UI」。建议在这些 case 的 `notes` 里加一行
`route entered via history.pushState, not via the navigation UI`。本轮不改，因为那会
重新生成全部 GUI 证据，而改动本身不修复任何缺陷。

## 九、本轮新增的交叉验证

R04 的 `r04-focus-hook-regression` 独立测了 e2e-03 依赖的同一条路径：点击耗时
6–33 ms。如果 `switchToWindow` 修复回退，e2e-03 的 11 项也会退化成分钟级 —— 两个 spec
现在互为对照。
