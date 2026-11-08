# Phase 9.8 — 最终报告（数据完整性、同步隔离、真实 SSH 验收）

- 基线：PR #9 `feat/phase9-7-product-acceptance` @ `20efdff`（main `3b23e8c` 未变）
- 所有 Phase 9.8 PR 均为 **Draft、stacked**，base 是 Phase 9.7 分支，不是 main
- 未合并、未打 Tag、未发布 Release

## 1. PR 与 SHA

| PR | 工作包 | 分支 | head |
| --- | --- | --- | --- |
| [#10](https://github.com/baicie/terminal/pull/10) | 9.8-A SFTP staged upload | `feat/phase9-8-a-sftp-safe-upload` | `36d0ebe` |
| [#11](https://github.com/baicie/terminal/pull/11) | 9.8-B1 同步身份隔离 | `feat/phase9-8-b-sync-isolation` | `5b22ac1` |
| [#12](https://github.com/baicie/terminal/pull/12) | 9.8-B2 首同步整窗与协商 | `feat/phase9-8-b2-sync-window` | `e9aaac0` |
| [#13](https://github.com/baicie/terminal/pull/13) | 9.8-C1 SSH writer 超时语义 | `feat/phase9-8-c1-ssh-writer` | `f57daf4` |
| [#14](https://github.com/baicie/terminal/pull/14) | 9.8-C2 `-R` 真实 SSH E2E | `feat/phase9-8-c2-remote-forward` | `2233c4e` |
| [#15](https://github.com/baicie/terminal/pull/15) | 9.8-D 修改时间与本地化门禁 | `feat/phase9-8-d-ui-readiness` | `3c44b2a` |
| [#16](https://github.com/baicie/terminal/pull/16) | 9.8 集成（六者合一 + 证据 + 审查修复） | `feat/phase9-8-integration` | 见证据提交后的 HEAD |

## 2. 根因与改动

### 9.8-A SFTP 上传保护
- 根因：`sftp_upload` 用 `CREATE|TRUNCATE|WRITE` 直接打开目标，失败即截断原文件。
- 改动：`src-tauri/src/sftp_upload.rs`（暂存文件、备份替换、20 s 单操作上限、
  取消命令、陈旧暂存回收）；`sftp.rs` 接线；`scripts/verify-install/sftp-staged-upload-e2e.mjs`。
- 测试：18 项故障注入 + 真实 OpenSSH sftp-server 验收（新建/覆盖/取消/Unicode/
  只读目录/通道中断）。

### 9.8-B1 同步 round 隔离
- 根因：可变 `teamApi` 单例在分页 `await` 之间被 `configure()` 改写，第 2 页可能
  发往另一个服务器/身份；只比较响应 `userId` 发现不了。
- 改动：`forContext()` 不可变副本；`round.isCurrent()` 在每个分页边界校验；
  `SyncRoundStaleError` 时不发后续页、不应用、不推进游标、不修剪。
- 测试：两个真实 `node:http` 服务端；单例改写后仍走原服务器/原 token；
  真实工作区切换后整轮中止。

### 9.8-B2 协议 1 首同步
- 根因：协议 1 首同步无游标 → 服务端按协议 2 分页返回 200 行，旧客户端忽略
  `hasMore`/复合游标，窗口被静默截断。
- 改动：`X-Sync-Protocol` 协商；协议 1 整窗 ≤5000，超限 426；矛盾声明 426；
  协议 2 首同步显式 `2.0.0.0` 且解析为完整快照。
- 测试（真实 PG）：0/1/199/200/201/500 矩阵；201 条协议 1 一次交付；5001 条 426
  且协议 2 翻页拿全；三类矛盾声明 426。

### 9.8-C1 SSH writer 超时
- 根因：出队即过期的命令被丢 reply，调用方当成 worker 死亡而误杀健康会话；
  已开始执行的写超时只报普通错误，重试会重复输入。
- 改动：命令携带 `started`；`TimeoutPolicy` 区分队列超时与已开始超时；
  write/close 已开始超时退役 writer 并说明“可能已部分送达”。
- 测试：14 项 writer 测试（容量 1、丢弃 future、panic、close 超时等）。

### 9.8-C2 `-R` 真实 SSH
- 改动：真实 OpenSSH sshd fixture + 3 个 `#[ignore]` 测试，使用生产 `ClientHandler`
  与 `setup_remote_forward`。
- 覆盖：绑定、`forwarded-tcpip`、5B/32KB 双向、并发、半关闭、cancel、重复绑定、
  断开 SSH 释放端口；`-L` direct-tcpip 回归。

### 9.8-D 修改时间与本地化
- 根因：列列表用 `accessed()`（atime），无时间时写 0（显示 1970）。
- 改动：`modified()`；不可得为 `None`，前端显示 `—`；排序排后。
- 新增 locale parity 测试（cn/fr 与 en 键集完全一致、无空串）。

### 集成审查修复（PR #9）
- 发现：426/同步错误只写入 store 的 `syncError`，无任何视图显示。
- 修复：Teams 视图错误横幅（服务端原文）+ 重试，en/cn/fr 文案。
- 判定：`PR9_REVIEW_VERDICT=REQUEST_CHANGES`（唯一阻断项即该提示缺失，已在集成修复）。
  详见 `docs/phase9-8/pr9-integration-review.md`。

## 3. 集成冲突与处理

- B1 × B2：`team-sync-engine.ts` 同时改 `getChanges` 的调用者与参数 →
  合并为 `round.api.getChanges(cursor ?? INITIAL_SYNC_CURSOR)`，并更新隔离测试的
  首请求断言。
- B2 使 `sync.service.ts` 超过 300 行 → 协商规则移到 `sync-request.ts`（行为不变）。
- 证据缺口：Phase 9.8 改动落在 `FINGERPRINT_PATHS` 内，旧证据按规则失效；在集成
  HEAD 上重采（见 §5）。

## 4. 测试

| 套件 | 结果 |
| --- | --- |
| 前端 Vitest | **1441 passed / 166 files** |
| Rust `cargo test --lib` | **364 passed**（4 ignored：真实服务器验收） |
| Team Server unit | **124 passed / 27 files** |
| Team Server 真实 PostgreSQL | **105 passed / 12 files** |
| `check:source-size` | **586 文件通过** |
| clippy all-features / fmt | 干净 |
| 真实 SFTP 服务端 | `scripts/verify-install/sftp-staged-upload-e2e.mjs` PASS |
| 真实 SSH 转发 | `scripts/verify-install/remote-forward-e2e.mjs` 3 项 PASS |

## 5. 证据与 CI

- 六份证据：官方矩阵 [`42464747336`](https://github.com/baicie/terminal/actions/runs/42464747336)
  （`feat/phase9-8-integration`，运行于 `3c61482`）**3/3 success**，
  指纹 **`df379960…`**（debug `223989bc…`、release `a290c36b…`），
  `check-verification-evidence` **0 problem**；raw log 在
  `docs/verification/raw/42464747336/`。未手工修改 manifest。
- 该矩阵之后只提交了 `packages/team-server` 的 lint 修复（不在
  `FINGERPRINT_PATHS`），因此证据指纹与最终 HEAD 一致，门禁在最终 HEAD 仍是 0 problem。
- 证据内容：SSH 矩阵 11/11、shell 交互 14/14 + SSH 7/7、release SSH 8/8、
  冷启动 7420/4145/3996 ms、prompt rerun 标记就绪。
- 最终 CI：[`42480227136`](https://github.com/baicie/terminal/actions/runs/42480227136)
  （`6a19662`）**11/11 success**，含 `Repository gates`、三平台 Tauri 打包、
  Rust/Frontend/Team Server 与两项依赖审计。
- 期间 `Tauri build (ubuntu-latest)` / `(windows-latest)` 多次失败于
  `tauri-apps/binary-releases` 返回 **502/504**（本机 `curl` 同样复现）。修复不是
  重试到绿为止：`ci.yml` 的 Linux deb+appimage 与 Windows NSIS 步骤加入**有界**重试
  （4 次、20/40/60 s 退避），仍失败则报错退出，不把打包失败伪装成通过。
- 各 WP 分支：证据各自在其 HEAD 重采（A/B1/B2/C1/C2/D 各一次矩阵），
  `Repository gates` 全部转绿；PR #10 仍余 1 个上个 HEAD 的 Tauri ubuntu 失败
  （`42473374209`，504），其后的证据提交未再触发该 job 的通过结果。
- Upgrade E2E：[`42481700333`](https://github.com/baicie/terminal/actions/runs/42481700333)
  （`4f7b83b`，最终 HEAD）**6/6 success**：macOS dev.1→dev.2、macOS 当前版本升级与恢复、
  Linux DEB、Windows 隔离预检、macOS updater runtime、Linux AppImage 替换。
  此前 `42466709309`（`18533d1`）同为 6/6。
- 各 WP 的 Draft PR 上 `Repository gates` 会因证据指纹变化而失败：证据是在集成 HEAD
  上重采的，单分支不各自重采（避免 5 次 25 分钟矩阵）。这属于“证据绑定代码身份”
  的预期行为，不是代码回归。

## 6. UI

- 真实桌面截图 **NOT_RUN**：本机 `screencapture` 只得到壁纸，Screen Recording 权限
  未授予；不声称真实 Tauri GUI 已验收。
- 浏览器级布局检查 **NOT_RUN**：前端无 browser mock 入口（挂载即调用 Tauri）。
- 静态与回归：locale parity、Settings/Hosts 失败态、Host Dialog 焦点/Esc、
  Vault Escape 等既有测试全部通过。

## 7. 未解决风险

| 风险 | 状态 |
| --- | --- |
| `-R` 产品打包实机（macOS/Windows/Linux UI 层） | NOT_RUN（协议级真实 SSH 已 PASS） |
| Windows sshd fixture / Windows 实机 | NOT_RUN |
| 协议 1 整窗上限 5000 行 | 设计上限，超限 426 |
| 跨进程并发上传同一路径 | 仅进程内按路径串行 |
| 替换对读取者非原子 | 已文档化；旧字节不丢 |
| SSH writer 已开始写超时后的字节不确定性 | 退役会话并明确报错，不重试 |
| 证据在非指纹路径（team-server）再变更 | 集成 HEAD 之后仅 team-server lint 提交，指纹不变 |

## 8. 是否建议人工合并 PR #9

**建议：先合并 Phase 9.8 集成 PR #16，或至少先合入 #16 中的 Teams 错误横幅修复，
再合并 PR #9。** PR #9 数据安全面通过审查；唯一 REQUEST_CHANGES 项是同步失败对
用户不可见，该修复不在 PR #9 内。PR #9 本身未合并时，历史客户端被 426 拒绝后
用户不会看到原因（数据仍然安全）。

## 9. Phase 9.8 后续剩余工作

1. `-R` 打包产品实机（三平台）与 Windows sshd fixture。
2. 真实 GUI 截图（具备 Screen Recording/Accessibility 的机器或 runner）。
3. 跨进程上传锁（同一远端路径的多实例写入）。
4. 协议 1 整窗上限的可配置化与用户提示（当前 426 文案已明确）。
5. 将 `sftp-staged-upload` / `remote-forward` 两个真实服务器脚本接入 CI 定时或
   PR 门禁（当前为手动/本地验收）。
