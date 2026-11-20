# Terminal Next 夜间任务进度矩阵（T01–T12）

> 生成于 2026-11-20。基线 `main@486ca6e`。
>
> **这份文件的唯一作用**是把「真的做完了」「只有自动化通过」「人工验收未做」
> 「外部条件阻塞」四件事分开。任何把前三类混为一谈的表述都是错的。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| `DONE` | 代码已合并，有会变红的测试，变异验证成立 |
| `AUTOMATED_ONLY` | 自动化通过，但没有在真实设备/真实使用中验证 |
| `PARTIAL` | 一部分做了，另一部分有明确原因没做 |
| `NOT_RUN` | 该做的没做 |
| `BLOCKED_EXTERNAL` | 缺证书、账号、硬件或未授权资源 |

---

## 一、逐项

| # | 任务 | 状态 | PR | 证据 |
| --- | --- | --- | --- | --- |
| T01 | 合并门禁治理 | `DONE` | #130 | 规则集实测 `deletion`/`non_fast_forward`/`pull_request` 三项拦截；`check-merge-gate.mjs` 9 用例 + 3 变异 |
| T02 | 双 Host GUI E2E | `DONE` | #130 | 三平台 GUI **18/18 PASS**；证据含 `mkdir/rename/delete` 与「另一台 host 未被污染」 |
| T03 | Fixture 安全 | `DONE` | #130 | 5 个孤儿 sshd 实测；reaper 测试变异后真的留下监听进程 |
| T04 | SFTP 写路径 | `DONE` | #130 | 真实 GUI 创建/重命名/删除，断言服务器状态而非按钮 |
| T05 | 凭据泄漏 | `DONE` | #131 | 6/7 分支先红；两处不可修边界写成断言当前行为的测试 |
| T06 | AI 请求 id 多实例 | `DONE` | #131 | 双窗口 realm 前缀；变异 2/2 |
| T07 | AI 协议与安全 | `PARTIAL` | 待开 | redirect 测试 + prompt injection 修复；错误证书 `NOT_RUN` |
| T08 | Daily Driver 评分器 | `DONE` | #132 | 三类状态分离；参数错误退出码 2；变异 3/3 |
| T09 | GUI 证据完整性 | `PARTIAL` | #133 | 窗口截断 + `dirty` + 孤儿测试三处修复；「删断言则 job 红」`NOT_RUN` |
| T10 | Credential Provider 迁移 | `PARTIAL` | #134 | 孤儿计数修复 + 7 项跨 Provider 测试；真实进程崩溃恢复 `NOT_RUN` |
| T11 | Inspector 平台回归 | `DONE` | #131 | host 切换竞态测试，变异精确命中 |
| T12 | 发布质量收口 | `PARTIAL` | 待开 | zip 漏洞已修（13→12 条）+ npm 审计 0；签名/更新器 `BLOCKED_EXTERNAL` |

---

## 二、只有自动化、没有真实设备验证的部分

这一节的每一项都**通过了测试**，但**没有**在真实工作负载里被人用过。

| 项 | 自动化证据 | 缺什么 |
| --- | --- | --- |
| SFTP 写路径 | 三平台 GUI 真实写入 + 服务器状态断言 | 真实大文件、慢链路、断线重连下的写入 |
| 双 Host 切换 | A→B→A + marker 内容断言 | 两台**真实远程**服务器（现在是本机 sshd） |
| 凭据脱敏 | 15 项单测 + 3 变异 | 真实 Tauri IPC 往返中的错误对象 |
| AI 协议 | 本地 OpenAI 兼容 HTTP 服务器 | 真实模型端点（`BLOCKED_EXTERNAL`） |
| Inspector | 单测 + 竞态测试 | 真实 macOS/Linux/Windows 远程主机的并发刷新 |

---

## 三、人工验收未做

| 项 | 为什么只能人工 |
| --- | --- |
| 七天真实使用 | 需要连续一周的真实工作负载；`daily-driver-scorecard.mjs` 只能测量，不能代替 |
| 物理键盘重叠输入 | WebDriver 的 `type` 不产生重叠时序 |
| 中文 IME | 需要真实输入法引擎与候选窗交互 |
| DPI 缩放可读性 | 人眼判断 |

跑法：

```bash
node scripts/daily-driver-scorecard.mjs --days 7
```

退出码 **0** = 数据足够读（`MEASURED`/`PARTIAL`），**1** = 窗口内没有记录，
**2** = 参数或数据库不可用。注意 `MEASURED` **只表示数据够读**，不表示产品就绪。

---

## 四、`BLOCKED_EXTERNAL`

| 项 | 缺少什么 |
| --- | --- |
| Apple 公证 / Windows Authenticode | 证书与分发环境 |
| OS 密钥链 / Credential Manager / Secret Service | 真实平台密钥链与签名构建 |
| Updater 运行时下载/验签/安装/重启 | 签名环境；静态契约已有测试 |
| NSIS 升级、AppImage stock 启动 | 对应平台安装环境 |
| 真实模型端点 | 无授权 key；本机四个常见端口无响应 |

---

## 五、这一轮修掉的真实缺陷（12 个）

每一个都先有会变红的测试，其中 9 个有变异验证。

| # | 缺陷 | 形状 |
| --- | --- | --- |
| 1 | 双 Host 用例在终端页找 Hosts 卡片 | 前置条件假设 |
| 2 | `data-session-id` 全仓不存在 | 断言一半恒真 |
| 3 | 两台 fixture 起始目录相同 | 测试无法区分「动了」与「没动」 |
| 4 | 5 个孤儿 sshd（`ppid=1`） | 清理只在正常路径 |
| 5 | 标签 `aria-label` 被远端 shell 改写 | 拿被测对象输出当主键 |
| 6 | `file-row-actions` 无 test id，hover 才出现 | 产品没留自动化接口 |
| 7 | rename 没有键盘入口 | 真实可用性缺陷 |
| 8 | `describeInvokeError` 6/7 分支泄漏密码与私钥 | 脱敏只按字段名 |
| 9 | 定界符可被形近串伪造 | **旧测试把缺陷断言成了正确行为** |
| 10 | redirect 降级策略零测试 | 守卫存在、删掉没用例会红 |
| 11 | `orphanedSecrets` 从不递增 | 字段声明了、注释了、永不移动 |
| 12 | zip 漏洞被记成「不可修」 | 从没人重试过升级 |

第 9 条值得单独记住：`assert!(user.contains(BASE_DELIMITER))` 曾在一条绿测试里
把「伪造边界留在正文」写成正确行为。**测试通过不等于行为正确。**

---

## 六、判定

```
T01 DONE    T02 DONE    T03 DONE    T04 DONE
T05 DONE    T06 DONE    T07 PARTIAL T08 DONE
T09 PARTIAL T10 PARTIAL T11 DONE    T12 PARTIAL

DAILY_DRIVER_7DAY_ACCEPTANCE = NOT_RUN
SIGNED_RELEASE_READY         = BLOCKED_EXTERNAL
```

`PARTIAL` 的四项都不是「差一点」，而是**各有一块被明确的外部条件或成本挡住**，
并且每一块都在对应 PR 里写明了原因。
