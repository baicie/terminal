# Phase 10 — Daily Driver 验收

## 判定总表

| 项 | 判定 | 依据 |
| --- | --- | --- |
| CREDENTIAL_DEFAULT_SAFE | **PASS**（代码层） | hosts 保存路径 SQL 中 secret 列恒 NULL；负向测试在旧实现上 4 项失败 |
| CREDENTIAL_MIGRATION | **NOT_RUN** | `credential-migration.ts` 与 12 项测试已就绪；执行需用户显式授权（写 Vault、清明文列），本轮未运行 |
| PLAIN_EXPORT_SECRET_EXCLUDED | **PASS** | 导出确实存在两个真实入口（设置面板 `exportDataToFile`、云同步 `collectExportData`）；两处都经过字段白名单，`password`/`private_key`/`passphrase` 不在白名单内，8 项测试断言导出文件不含秘密 |
| HOST_SEARCH_COMPLETE | **PASS** | 1/20/21/100/1000 矩阵，第 1000 台可精确命中 |
| QUICK_CONNECT_COMMON_SYNTAX | **PASS**（解析层） | host、user@host、host:port、ssh、`ssh -p PORT` 均支持，36 项语法矩阵；UI 接线未做真实键入验证 |
| SHORTCUT_PERSISTENCE | **PASS** | 持久化、冲突拒绝、恢复默认、导入导出（11 项测试） |
| SHELL_KEYBOARD_COMPATIBILITY | **NOT_RUN** | 需真实终端 + IME 手工验证 |
| SAFE_PASTE_VERIFIED | **PARTIAL** | 策略、DOM 捕获门（Cmd+V / 原生菜单 / addon 全覆盖）与确认 UI 完成（25 项测试）；未在真实 Vim/less/readline 上验证 |
| TERMINAL_FIRST_STARTUP | **PASS**（结构） | 索引路由指向终端层，测试锁定 |
| TERMINAL_SESSION_LIFECYCLE | **NOT_RUN** | 标签切换/分屏/唤醒需真实 GUI |
| SSH_REAL_E2E | **PASS**（矩阵层） | 冻结 HEAD `fe920f7` 的实机矩阵 run `42578266796`：SSH probe 11/11、release SSH 8/8（key/agent/cert/jump 各含重连）、shell 交互 14/14。**不含 Vault 凭据场景**（见 `VAULT_REAL_E2E`） |
| SFTP_REAL_E2E | **NOT_RUN**（本阶段） | 9.8 的真实 sshd 脚本仍在，本阶段未重跑 |
| WORKSPACE_RESTORE | **NOT_RUN**（本阶段） | 既有 E2E PASS，本阶段未重跑 |
| OPENSSH_CONFIG_IMPORT | **PASS**（解析+计划） | 42 项测试；UI 未接 |
| TABBY_IMPORT_SUPPORTED_SCOPE | **NOT_RUN** | 无稳定格式样本，按任务书不猜 |
| GUI_VISUAL_EVIDENCE | **NOT_RUN** | 本机无 Screen Recording 权限 |
| DAILY_DRIVER_READY | **NO** | 见下 |
| TABBY_REPLACEMENT_READY | **NO** | 需 7 天真实使用数据 |

## Daily Driver Scorecard（待测量）

| 指标 | 目标 | 现状 |
| --- | --- | --- |
| 首个本地 Shell 可输入时间 | < 3 s | 待测 |
| SSH 到可输入 prompt | 视网络 | 待测 |
| 输入响应 | 无感知延迟 | 待测 |
| 标签切换 | 不重建 PTY | 有既有测试，待实测 |
| 分屏 resize | 流畅 | 待测 |
| 大输出内存 | 有上限 | 待测 |
| 100 台主机搜索 | 任意命中 | **已达标**（测试） |
| 凭据迁移可靠性 | 可回滚 | **已实现**（10.1：快照→写入→读回→单语句提交→重读验证；真实 GUI 执行 NOT_RUN） |
| SFTP 完整性 | 暂存上传 | **已达标**（9.8 真实 sshd） |

## 7 天个人日用验收模板

```
日期 | 使用时长 | 阻断次数 | 阻断内容 | 是否回退 Tabby | 备注
-----|---------|---------|---------|--------------|-----
D1   |         |         |         |              |
...
```

**没有实际填写之前，`TABBY_REPLACEMENT_READY` 不得为 PASS。**

## 已知的验收夹具脆弱点

`key-first-connect-outage` 用例在 CI 上出现过一次失败、同提交重跑通过：

- 该用例在应用启动**之前**把主机断开 6 秒，而首连预算是固定 10 秒，
  留给"启动 + 重连"的只有约 4 秒；本机实测 6041–7037 ms，已经贴着上限。
- 尝试让 deadline 加上断线时长会触发 OpenSSH 的 `srclimit_penalise`
  （重连次数变多后 IP 被封 20 秒），反而更不稳定，因此该改法已回退。
- 结论：这是**夹具设计**的脆弱点，不是产品回归。后续可选做法是缩短该用例的
  断线时长（6s → 2s，测试意图不变），或在夹具 sshd 上放宽 penalty；
  两者都需要单独评估，本次未改。

## 为什么这些是 NOT_RUN 而不是 PASS

CI 与单测能证明"逻辑正确"，不能证明"这个应用在真实桌面上好用"。本阶段所有需要
真实 GUI、真实远端、真实键盘输入的项目一律标 NOT_RUN，不用 jsdom 结果冒充。

---

## Phase 10.1 验收补充（凭据安全收尾）

Phase 10 的验收结论建立在一个不完整的前提上：它验证的是「新建/编辑路径不写明文」，
而真实用户入口还包括 Rust 备份导入、云同步恢复和团队包。10.1 逐个封堵后，状态如下。

### 已闭合（自动化证据）

| 项 | 状态 | 证据 |
| --- | --- | --- |
| Rust 导入不写秘密列 | **PASS** | `db_import/tests.rs` 39 项，其中 12 项为 10.1 新增；秘密列在 SQL 文本中即为 `NULL` |
| 旧版备份含明文默认拒绝 | **PASS** | 拒绝发生在 `BEGIN` 之前，返回各类型计数 |
| `discard` 不伪造引用 | **PASS** | 断言 `credential_ref` 为 NULL 且返回需重绑清单 |
| `migrate` 契约 | **PASS** | 残留明文、缺绑定引用、畸形引用、源设备引用均被拒绝 |
| Merge / Replace 双模式 | **PASS** | replace 的 UPDATE 语句同样无秘密列 |
| 前端 payload 不含明文 | **PASS** | `import-security.test.ts` 15 项，断言序列化文本 |
| 云同步与团队包同一边界 | **PASS** | 两者均走 `importWithSecretPolicy`，默认 `reject` |
| `syncServiceToken` 不导出 | **PASS** | `settings-export-policy.test.ts` 9 项，断言真实导出文件与上传 body |
| 导入不覆盖本机 token | **PASS** | `mergeRestoredAppSettings` + 测试 |
| 普通偏好仍能恢复 | **PASS** | 断言 theme/language/fontSize/endpoint/username |
| 版本化写入与补偿 | **PASS** | `hosts-credential-versions.test.ts` 12 项 |
| 清除顺序（先断引用后删） | **PASS** | 断言执行顺序 `['update','vault']` |
| 迁移生产调用链 | **PASS** | `credential-migration-run.test.ts` 11 项 |
| 计划不含秘密 | **PASS** | 类型上无值字段；断言序列化结果 |
| Store 与数据库一致 | **PASS** | `host-refresh.test.ts` 7 项：新建→保存→立即连接 |
| 损坏引用 fail-closed | **PASS** | `credential-ref-problems.test.ts` 12 项 |
| SSH Key 命名空间隔离 | **PASS** | 同 id 主机与密钥不互通 |
| SSH Key 按需读取 | **PASS** | `ssh-keys-lifecycle.test.ts` 16 项 |

### 未执行（必须标 NOT_RUN）

| 项 | 原因 |
| --- | --- |
| `VAULT_REAL_E2E`（真实 Vault 创建/解锁/改密/重启持久化） | 需要真实 GUI 交互；本轮只做服务层与临时目录演练 |
| `SSH_VAULT_REAL_E2E`（Vault 密码/私钥真实登录） | 需要真实 sshd + 真实 Vault 会话 |
| `JUMP_HOST_VAULT_REAL_E2E` | 同上，且需要双端凭据 |
| `SFTP_REAL_E2E`（10.1 改动后） | 本轮未重跑 |
| `WORKSPACE_RESTORE` | 本轮未重跑 |
| `GUI_IME` / 中文输入 | 无辅助功能权限，无法驱动真实输入法 |
| macOS / Windows / Linux 三平台真机回归 | 无环境 |
| 真实用户数据库上的迁移执行 | 按规范不做；只允许 disposable SQLite + 测试 Vault |
