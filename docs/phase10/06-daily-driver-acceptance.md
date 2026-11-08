# Phase 10 — Daily Driver 验收

## 判定总表

| 项 | 判定 | 依据 |
| --- | --- | --- |
| CREDENTIAL_DEFAULT_SAFE | **PASS**（代码层） | hosts 保存路径 SQL 中 secret 列恒 NULL；负向测试在旧实现上 4 项失败 |
| CREDENTIAL_MIGRATION | **NOT_RUN** | 迁移代码未写；已有 `credential_ref` 列与回滚前提 |
| PLAIN_EXPORT_SECRET_EXCLUDED | **PASS**（结构上成立） | 不存在主机导出功能；导入器断言不写私钥内容 |
| HOST_SEARCH_COMPLETE | **PASS** | 1/20/21/100/1000 矩阵，第 1000 台可精确命中 |
| QUICK_CONNECT_COMMON_SYNTAX | **PARTIAL** | 解析器已支持 host、user@host、host:port、ssh、ssh -p；缺系统矩阵测试 |
| SHORTCUT_PERSISTENCE | **PASS** | 持久化、冲突拒绝、恢复默认、导入导出（11 项测试） |
| SHELL_KEYBOARD_COMPATIBILITY | **NOT_RUN** | 需真实终端 + IME 手工验证 |
| SAFE_PASTE_VERIFIED | **PARTIAL** | 策略与 UI 接线完成（14 项测试）；未在真实 Vim/less/readline 上验证 |
| TERMINAL_FIRST_STARTUP | **PASS**（结构） | 索引路由指向终端层，测试锁定 |
| TERMINAL_SESSION_LIFECYCLE | **NOT_RUN** | 标签切换/分屏/唤醒需真实 GUI |
| SSH_REAL_E2E | **NOT_RUN**（本阶段） | 既有 Phase 9 实机矩阵 PASS，但本阶段改动后未重跑 |
| SFTP_REAL_E2E | **NOT_RUN**（本阶段） | 同上；9.8 的真实 sshd 脚本仍在 |
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
| 凭据迁移可靠性 | 可回滚 | 迁移未实现 |
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
