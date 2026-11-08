# Phase 9.8-C2 — `-R` 远端转发的真实 SSH 验收

分支 `feat/phase9-8-c2-remote-forward`，base `feat/phase9-7-product-acceptance`。

接线修复已在 Phase 9.7 完成（共享 listener slot、stop 取消绑定、基础单测）。
本轮补的是**真实 SSH 服务端**上的端到端验证，不重复重构。

## 方法

`scripts/verify-install/remote-forward-e2e.mjs` 启动一次性 OpenSSH sshd
（自生成 host/user key、`AllowTcpForwarding yes`、`PermitOpen any`、
`GatewayPorts no`），导出连接参数；Rust 侧 3 个 `#[ignore]` 测试使用**生产代码**：

- 生产 `ClientHandler`（新增 `#[cfg(test)] for_test_with_expected_key`，固定 fixture
  host key，不写用户 `known_hosts`）；
- 生产 `setup_remote_forward`（`tcpip_forward` + slot 安装）；
- 真实 TCP echo server 作为转发目标。

## 覆盖

`remote_forward_real_ssh_e2e`：

1. SSH 连接 + 公钥认证；
2. `tcpip_forward` 由服务端真实绑定（端口 0 → 服务端分配并回传）；
3. 外部 TCP 连接远端绑定端口；
4. `server_channel_open_forwarded_tcpip` 真实触发（channel 经 receiver 到达）；
5. 双向不同长度 payload（5 字节、32 KB）逐字节回显；
6. 两个并发连接各自独立；
7. 半关闭：client `shutdown` write 后 echo 返回并 EOF；
8. `cancel_tcpip_forward` + 清 slot → 端口不再接受连接。

`local_forward_real_ssh_e2e`：`direct-tcpip`（`-L` 的通道类型）在同一 sshd 上真实
建立并回显，证明共享通道代码改动不会只顾 `-R` 而破坏 `-L`。

`remote_forward_disconnect_and_duplicate_bind_real_ssh_e2e`：

- 同一端口第二次 `tcpip_forward` 被服务端拒绝（`BindFailed`）；
- 不 cancel、直接断开 SSH → 服务端释放在绑定端口（10 s 内探测拒绝）。

## 运行

```
node scripts/verify-install/remote-forward-e2e.mjs
# sshd listening on 127.0.0.1:<port>; running the Rust acceptance test
# test port_forward::tests::local_forward_real_ssh_e2e ... ok
# test port_forward::tests::remote_forward_disconnect_and_duplicate_bind_real_ssh_e2e ... ok
# test port_forward::tests::remote_forward_real_ssh_e2e ... ok
# Remote port forwarding: PASS against a real OpenSSH sshd
```

## 验收判定

| 项 | 判定 | 证据 |
| --- | --- | --- |
| `REMOTE_FORWARD_REAL_SSH_E2E` | **PASS**（协议级，真实 OpenSSH） | 上述 3 个测试实际运行通过 |
| `REMOTE_FORWARD_CANCEL_BINDING` | **PASS** | cancel 后端口拒绝；断开 SSH 后端口释放 |
| `PORT_FORWARD_DUPLEX_REGRESSION` | **PASS** | `-R` 双向/并发/半关闭 + `-L` direct-tcpip + 既有全双工单测 |

## 边界

- 这是协议级真实服务端验证；**macOS/Windows/Linux 打包产品的实机 UI 验证不在本轮**
  （测试直接用生产 Rust 模块，不经过 Tauri 前端）。
- `-D`（SOCKS）是本地监听 + 同一 direct-tcpip 通道实现，未单独跑真实 E2E；
  其通道路径由 `local_forward_real_ssh_e2e` 覆盖。
- Windows 的 sshd fixture 未提供（脚本仅 macOS/Linux）；Windows 实机仍 NOT_RUN。
