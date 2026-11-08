# Phase 9.8-A — SFTP 上传的原文件保护

分支 `feat/phase9-8-a-sftp-safe-upload`，base `feat/phase9-7-product-acceptance`
（PR #9 的 HEAD `20efdff`）。

## 根因

`src-tauri/src/sftp.rs` 的 `sftp_upload` 直接用

```rust
OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE
```

打开目标路径。本地读失败、远端写入失败、断线或进程崩溃时，已存在的远端文件
已经被截断——用户看到的是 0 字节或半截文件，且没有任何副本。

## 实现

`src-tauri/src/sftp_upload.rs`：

1. 先校验远端路径形态（非空、不是目录、文件名合法）和本地文件（存在且是普通
   文件），**在触碰远端之前**失败。
2. 在目标目录用 `CREATE | EXCLUDE | WRITE` 创建
   `.<name>.terminal-upload-<uuid>` 暂存文件，冲突换名重试（最多 8 次）。
3. 只向暂存文件写；每块 64 KB，写完 `flush` → `sync_all`（服务端支持
   fsync@openssh.com 时）→ `shutdown` 关闭句柄，再用 fstat 报告的字节数
   与本地读取数、文件大小三者比对。
4. 仅当数据完整后替换：
   - 目标不存在：`rename(暂存, 目标)`；若目标在期间出现则失败，不覆盖。
   - 目标存在：`rename(目标, .<name>.terminal-upload-backup)` →
     `rename(暂存, 目标)` → 删除备份。中途失败把备份移回，原字节不变。
5. 单次远端操作 20 s 上限：连接在传输中死亡时，上传以错误结束并释放路径锁，
   而不是永久挂起（russh-sftp 自身的请求超时覆盖不到通道消失后的写入确认）。
6. 失败/取消尽力删除暂存文件；连接已断无法删除时，下一次同路径上传回收超过
   10 分钟的陈旧暂存文件（更年轻的可能属于另一个仍在写的进程）。
7. 新增 `sftp_cancel_transfer(transfer_id)`，在分块之间取消；取消路径同样清理
   暂存文件并保留原文件。

关于原子性：标准 SFTP `rename` 不保证“覆盖已有目标”。因此这里**不依赖**
rename-over-target 语义，而是先把旧文件挪开；对**读者**而言存在一个目标名短暂
不存在的窗口，但旧字节永不截断，失败会还原；进程在窗口内崩溃时旧文件留在
备份名下，下一次上传会先还原它。代码与文档都不声称这是原子替换。

## 测试

确定性故障矩阵（`src-tauri/src/sftp_upload_tests.rs`，18 项，全部通过）：

- 新文件成功、覆盖已有文件成功
- 写入 50% 失败、90% 取消
- flush 失败、close 失败、服务端报告的字节数不符
- 替换阶段 rename 失败 → 原文件移回
- 断线（所有远端操作失败）→ 原文件不动
- 两个并发上传同一路径 → 串行、无残留
- Unicode/空格文件名
- 拒绝 rename 覆盖已有目标的服务端
- 备份恢复：崩溃留下的备份在下次上传前还原；目标已存在时清理陈旧备份
- 只读目录：暂存创建失败 → fail closed
- 陈旧暂存文件回收（>10 分钟移除，新鲜文件保留）

真实服务端验收（`scripts/verify-install/sftp-staged-upload-e2e.mjs`，启动
临时 OpenSSH sshd + `Subsystem sftp internal-sftp`）：

```
node scripts/verify-install/sftp-staged-upload-e2e.mjs
SFTP staged upload: PASS against real OpenSSH sftp-server
```

覆盖：新建、覆盖、取消后原文件逐字节保留、Unicode 名、只读目录拒绝、
SFTP 通道中途关闭（上传在 20 s 内报错，目标保持不变；客户端已无法清理其暂存
文件，测试断言最多残留该文件本身）。

## 验收判定

| 项 | 判定 | 证据 |
| --- | --- | --- |
| `SFTP_FAILED_UPLOAD_PRESERVES_ORIGINAL` | **PASS** | 18 项故障测试 + 真实 sshd 的取消/只读/断链场景 |
| `SFTP_SUCCESSFUL_REPLACE_VERIFIED` | **PASS** | 单元测试 + 真实 sshd 新建/覆盖后读回 |
| `SFTP_CANCEL_CLEANUP_VERIFIED` | **PASS（连接存活时）** | 取消路径删除暂存文件并有测试；连接已断时客户端无法清理，已在真实测试中断言并记录 |

## 已知边界

- 替换对读者不是原子的：旧文件被移开与新文件就位之间有短暂窗口。
- 跨进程并发上传同一路径未加分布式锁；本进程内按路径串行。
- 连接在替换窗口内死亡时，旧文件留在 `.terminal-upload-backup`，需下一次上传
  才会自动还原（不会丢数据）。
