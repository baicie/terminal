# Phase 9.3.2 — Final Merge Review

> 日期：2026-11-03
> 源码基线：`44ae449`
> 证据提交：`5da2085`
> PR：https://github.com/baicie/terminal/pull/6

## 1. 本轮范围

Phase 9.3.2 只做合并收口与两个新增审查项：

1. 复核 `terminal-mounted` 阶段语义与冷启动时间线。
2. 复核 Share REST 的乐观并发契约，补真实 Nest HTTP 集成测试。
3. 在冻结源码上重采六份真实 runner 证据。
4. 给出四个独立判定；PR 保持 Draft。

## 2. A1：terminal-mounted 复核

结论：

- 阶段在 xterm `open()` 与 viewport attach 之后发出，早于
  `session-create-requested`；只表示终端视图挂载，不表示 PTY/SSH 已建立。
- `open()` 抛错时不会发出；重复挂载会重复发出，分析脚本使用**首次**
  `terminal-mounted`。
- detail 已补 `tabId@workspaceId`，跨工作区可关联。
- 新增 `ready → terminal-mounted` 3 秒预算。

发现并修复的缺陷：

1. trace 是 fire-and-forget，真实 run `41596246878` 中
   `ssh-connect-start@3421ms` 早于 `session-create-requested@3443ms`。
   修复为串行 trace 队列，关键路径使用可等待写入。
2. 冷 WebView 首次 IPC 约 1.8s，1 秒 probe 配置预算导致五个 gate 全部超时
   （run `41600744475`、`41602816075`）。instrumented 构建改为 3 秒，
   产品构建保持 1 秒。

验证：前端 151 文件 / 1365 项、定向 31 项、typecheck、ESLint 通过。

## 3. A2：Share REST 乐观并发

契约：

- `PUT /teams/:teamId/shares/:shareId` 必须带 `baseVersion`。
- 服务端用 `Share.version` 原子 CAS；旧版本晚提交返回 409。
- 缺失版本返回 428；非法版本返回 400；权限检查仍先执行，403 不变。
- 非创建者 READWRITE 仍不能改变 permission / sensitivity。
- 前端 `updateShare()` 必须显式传 `baseVersion`，`ApiShare` 暴露 version。

验证：

- 新增 `shares-nest-http.pg-spec.ts`：真实 Nest Express adapter +
  ValidationPipe + ApiKeyGuard + DTO + 真实 PostgreSQL + 实际 HTTP，9/9。
- 完整真实 PG：11 文件 / 94 项全绿。
- 旧 PG 用例补齐 `baseVersion`，未放宽断言。

## 4. 本地全量门禁

| 门禁 | 结果 |
| --- | --- |
| 前端 | 151 文件 / 1365 项 |
| Team Server 单测 | 25 文件 / 119 项 |
| Team Server 真实 PG | 11 文件 / 94 项 |
| Rust | 302 单测 + 3 集成 |
| 脚本 | 371 项 |
| 源码规模 | 563 生产文件 |
| Bundle budget | initial gzip 130.28 KB / total 572.71 KB |
| npm 生产审计 | 公共 registry：No known vulnerabilities found |
| cargo audit | CI job success；本机 yanked 查询受网络阻塞 |

## 5. 真实 runner 证据

| 项 | 值 |
| --- | --- |
| 最终 run | `41605898002` |
| commit | `44ae449` |
| 指纹 | `6d7536e7dd1e4edbf3abcd0bb7fd34ed3cb5ec9b1054277c93c623bf2508d5fd` |
| debug SHA256 | `2bf151cb6b617a4b2a30d30427c1b6abc5f7622e706e1d584e22e6420cc81b91` |
| release SHA256 | `88ba47141a90081fafe4c39e5359cec75e59b7e8ba30917977e743db42fd390c` |
| 平台 | macOS / Linux / Windows 3/3 success |
| 证据门禁 | 0 problem |
| 远程冷启动 | requestToReady 6268 ms，阶段顺序正确 |

失败尝试已保留并分类，不当作 PASS：

- `41600744475`：`nano-edit` 五个 gate 1006ms 超时，probe 未渲染。
- `41602816075`：physical keyboard probe 五个 gate 1000ms 超时。
- 两次均归因为 probe 配置预算短于冷首 IPC，已由 `44ae449` 修复；
  最终 run `41605898002` 在同一 HEAD 上通过。

## 6. 最终 CI

run `41609555766`（sha `5da2085`，证据提交）：

**11/11 success**，包括：

- `Repository gates (source size, evidence, script tests)`
- `cargo audit (blocking)`
- `Dependency audit (npm)`
- Frontend / Rust / Team Server quality
- macOS / Windows / Linux Tauri build

本文件自身是 docs-only 提交，不改变源码指纹；合并前以远端 HEAD 的 CI 为准。

## 7. 残余风险

- `RUSTSEC-2023-0071`（rsa 0.10.0-rc.18）仍真实存在，阻塞发布，不阻塞合并。
- 300 次冷启动压力样本为 289/300（3.7%），高于高可靠 RC 目标；
  且该批样本使用 probe 预算修复前的二进制，修复后需复测。
- Windows / Pageant / 串口硬件仍 NOT_RUN。
- 跨版本安装、升级、回滚仍 NOT_RUN。
- notarization / Authenticode / updater 真实签名 BLOCKED_EXTERNAL。

## 8. 四个判定

### READY_FOR_REVIEW = **是**

A1/A2 均有复现、修复与回归；证据与最终源码绑定。

### READY_FOR_MERGE = **是**，附条件

条件：

1. 最终 CI 11/11：run `41609555766` 已满足。
2. 合并后任何 `FINGERPRINT_PATHS` 改动必须重采证据。
3. rsa advisory 阻塞发布，不阻塞合并。
4. 冷启动 3.7% 失败率仍是 RC 风险，不因本 PR 合并而消失。

### READY_FOR_RC = **否**

冷启动失败率、跨版本升级、硬件矩阵均未闭合。

### READY_FOR_RELEASE = **否**

同 RC，另加签名、公证、updater 与安装升级链路。
