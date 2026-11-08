# Overnight review findings — 2026-11-08

两个只读子审查覆盖 Rust 会话/转发/恢复与前端同步/服务端协议。以下按状态记录，
每条给出证据位置与处理结果。

## 已修复

| # | 风险 | 位置 | 修复 | 测试 |
| --- | --- | --- | --- | --- |
| 1 | 云端同步会删除 local 模式团队与其他 endpoint 的共享（数据丢失） | `service/database/teams.ts` | 只删除同一 endpoint、`mode='cloud'`、`version IS NOT NULL AND dirty=0` 的行 | `teams.test.ts`、`team-actions-sync.test.ts` |
| 2 | 冲突 LOCAL 决议在敏感态不一致时空写/丢编辑 | `sync-conflicts.ts` | 返回 `SENSITIVE_STATE_MISMATCH`，不写库 | `sync-conflicts.test.ts` |
| 3 | 推送 `operation=DELETE` 被当作更新/创建 | `sync.service.ts` | 明确 `DELETE_OPERATION_NOT_SUPPORTED` | `sync.service.test.ts` |
| 4 | resync 页 `hasMore=true` 但 cursor 不可用时清理本地行 | `team-sync-engine.ts` | 仅 `hasMore!==true` 才结束轮次 | `team-actions-sync.test.ts` |
| 5 | SFTP 会话并发创建泄漏；卸载后 resolve 的会话无人关闭 | `use-sftp-remote.ts` | 在途 Promise 复用、卸载/host 变更后 close | `use-sftp-remote.test.tsx` |
| 6 | `-L/-D` 转发读写共用一把锁，全双工死锁 | `port_forward.rs` | `tokio::io::split` 拆分读写半 | `socket_reader_does_not_block_the_write_direction` |
| 7 | 远端 `-R` 的 listener 从未接入 SSH handler，`cancel_tcpip_forward` 未调用 | `state.rs`、`session/ssh.rs`、`port_forward.rs` | `ClientHandler` 的 slot 改为共享 `Arc<RwLock<..>>`，建连时存入会话；setup 写入、stop/shutdown 清空并取消绑定 | `the_connection_owner_and_the_handler_share_the_forward_slot`；真实 SSH E2E 仍 NOT_RUN |
| 7b | 并发 `create` 时，赢得 `create_new` 的线程若在取锁前被抢占，另一个把同一零长 placeholder 当“中断残留”回收并写盘，前者随后取锁、不复查就覆盖，两个调用都返回成功（CI 实测 `created = 2`，后写的 vault 静默替换先写的） | `vault.rs` `create_exclusive` | `Fresh` 分支在取锁后同样复查 `is_unfilled_placeholder(path)`（用 path 而非陈旧 handle），先到者赢、后者 `AlreadyExists` | `a_fresh_claim_loses_to_a_reclaimer_that_filled_the_placeholder_first`（未修复时失败） |

## 已确认但本轮未修复（记录风险）

| # | 风险 | 位置 | 建议 |
| --- | --- | --- | --- |
| 8 | SSH writer 超时竞态：过期命令丢弃 reply 后被当成 fatal completion，健康会话被拆 | `ssh_writer.rs:179-186/287-311`、`ssh.rs:1227/1317` | 超时分支显式回超时错误；`Ok(Err(_))` 在 deadline 后不 retire |
| 9 | 协议 1 客户端无 cursor 首次同步 >200 行会静默只拿前 200 | `sync-delivery.ts:180-205`、dev.2 `getChanges(undefined)` | 服务端对无 cursor 走整窗或拒绝；当前客户端显式发送 `2.0.0.0` 初始游标 |
| 10 | `teamApi` 可变单例可在一次分页同步中被切换 endpoint | `team-api-base.ts`、`team-actions-sync.ts:46` | 每轮快照不可变 client 或凭据作为请求参数 |
| 11 | 上传失败先 TRUNCATE 远端原文件 | `sftp.rs:245-250` | 临时名上传 + rename |
| 12 | `sftp_list` 用 atime 冒充 mtime | `sftp.rs:153-159` | 改用 `modified()` |

## 已排除

`updater_probe` 仅 `smoke-updater` 编译，生产二进制无该字符串（`strings` 实测 0 次）；
Vault 未见明文日志；SQL 参数化；BigInt 序列化已有映射；cursor/scope 数学未发现漏洞。
