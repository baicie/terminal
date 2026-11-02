# Shell 与 PTY（P9.0）

## 1. 两个问题必须分开归因

任务书明确要求「分成两个独立问题，不要互相归因」。本轮遵守了这一点。

## 2. #65 macOS 远程 SSH 冷启动

### 分段实测（5 次远程 + 3 次本地，同一套阶段）

| 运行 | requestToReadyMs |
| --- | --- |
| remote 冷 webview 首跑 | 4544 |
| remote 后续 4 次 | 2601 / 2485 / 2497 / 2495 |
| local 3 次 | 1137 / 1145 / 1140 |

远程分段（相对前端第一段）：SSH 握手 +32ms、认证 +20ms、PTY +18ms、shell 首字节 +141ms、
**ssh-startup-settle → ssh-startup-write-begin +1003ms**。

### 结论

- **SSH 三段协议合计 70ms，只占总耗时 2.8%** ——SSH 不是瓶颈
- 远程比本地多出的 1358ms 中，**1003ms 是产品写死的 SSH_STARTUP_SETTLE_DELAY = 1s**
- **Phase 8.9 的 PTY 插桩不是原因**：pty_diagnostics 只被 session/local.rs 调用，ssh.rs 完全不经过

### 旧失败信息本身是诊断缺陷（已修）

远程模式固定 axProbe=none，所以 readiness 恒 null、windowReady 恒 false ——
这两个字段在远程运行里从来不是证据。现在失败信息自动带 axProbe 与首个阶段到达时刻。

### 关键实测：失败与 SSH 无关

本机 10 次远程测量 8 次通过，**2 次失败时 stages 为 none recorded** ——
把失败定死在「前端一行业务代码都没跑」，属 WebView 主框架加载失败（抓到 didFailProvisionalLoadForFrame code=-1004），
与 #59 的「runner 上窗口从不真正显示」同类。

### 未调大 10 秒预算

改为 9 条分段回归阈值（实测值 1.5–10 倍余量，违反只记录不致命），
其中 ssh-startup-settle → ssh-startup-write-begin <= 1500ms 专门盯「有人再加大 settle 秒数」。

## 3. #60 Linux zsh 三条用例

### 诊断矩阵（真实 Linux runner）

    zsh | app   | readline-history | PASS
    zsh | app   | readline-tab     | PASS
    zsh | app   | pty-resize       | PASS
    zsh | app   | ctrl-c-interrupt | PASS
    zsh | plain | readline-history | TIMEOUT  ready marker never printed
    zsh | plain | readline-tab     | TIMEOUT  no verdict before the deadline
    zsh | plain | pty-resize       | TIMEOUT  ready marker never printed
    zsh | plain | ctrl-c-interrupt | PASS
    bash | 全部 8 条                | PASS

### 根因：plain 变体缺启动文件（诊断缺陷，不是产品缺陷）

旧脚本 plain 分支是 zsh -i + 空 HOME，**一个启动文件都不写**。
Debian 上缺 .zshenv 就等于缺 skip_global_compinit=1 → 系统 /etc/zsh/zshrc 跑 compinit →
遇 insecure directories 停下提问 → 吞掉注入字节。

三条超时用例正是**必须由 ZLE 解释字节**的（ESC[A / TAB / resize 重绘），
而 ctrl-c-interrupt 只需 stty echo 所以能过。

脚本自己的注释就写着这条规则，plain 分支没遵守。

### 修复

改为 app / plain / bare 三模型：app = 产品 wrapper（门禁测的那个）、plain = 补最小启动文件、
bare = 无启动文件的负面对照。

输出新增 expected | observed | class 三列，严格区分 EXPECTED_FAILURE / DIAGNOSTIC_FAILURE / PRODUCT_FAILURE；
退出码只对后两类非零。**产品门禁 smoke:shell-probe:matrix 一行未改。**

本机（macOS zsh 5.9）：app 4/4、plain 4/4（补文件后）、bare 4/4（本机不阻塞，已显式标注）。

## 4. 判据的演进（踩过的坑）

| 判据 | 结论 |
| --- | --- |
| [[ -o zle ]] | **不可用**——命令执行期间恒为 OFF |
| DECCKM（ESC[?1h/?1l） | **不可用**——部分环境不出现 |
| bracketed paste（ESC[?2004h/l） | **可用**——zle 每次行编辑开、执行前关，且必须在通过的用例上验证过 |

## 5. BLOCKED_EXTERNAL

1. runner 上 >10s 的具体段位：最小复现 pnpm smoke:remote-cold-start --app-path <binary>，
   失败信息已自动附 stages 与 axProbe
2. plain 在真实 Linux 上补文件后是否转 PASS：python3 scripts/diagnose-zsh-rc.py --shells zsh --launch plain