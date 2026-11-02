# 依赖安全与许可证检查（P9.0-8）

> 检查时间：Phase 9.0 收尾阶段。结论直接影响 READY_FOR_RELEASE。

## 1. Rust 依赖：cargo audit 报 27 个已知漏洞

**这是本次检查最重要的负面发现。** AGENTS.md 里「生产依赖审计为 0 个已知漏洞」的记录**已不成立**。

按 crate 统计（同一 crate 可能命中多条公告）：

| crate | 命中数 | 备注 |
| --- | --- | --- |
| quinn-proto | 5 | QUIC 实现，本项目未使用 HTTP/3，实际不可达 |
| rustls | 4 | TLS，经 russh 引入 |
| quick-xml | 4 | 两条 high (7.5)，经 updater/打包链引入 |
| zip | 3 | 打包/解包链 |
| rsa | 2 | 经 russh 引入 |
| crypto-bigint | 2 | 常数时间实现问题 |
| russh / russh-cryptovec | 各 1 | **本项目核心 SSH 库** |
| tokio | 1 | 运行时 |
| 其余约 12 个 | 各 1 | zbus/glib/unic/rkyv/proc-macro-error 等 |

其中带明确严重度的：quick-xml 两条 **7.5 (high)**、quinn-proto 两条 **7.5 (high)**。

### 为什么本轮没有修

这 27 条**几乎全是传递依赖**，修复路径是升级上游 crate。风险：

- russh 是本项目核心 SSH 实现，跨大版本升级会改变认证/会话语义，必须有实机矩阵回归
- rustls / rsa 同属该链路
- quinn-proto 的 5 条在本项目中**不可达**（不使用 QUIC）

在收尾阶段做这类升级，会同时打开「协议行为变化」与「凭证处理变化」两个风险面，
而本轮没有余量对它们做完整实机验证。**因此如实记录为阻塞项，不做无验证的升级。**

### 对四个状态的直接影响

- **READY_FOR_RELEASE = 否**：这一条本身已足够构成阻塞（另有签名/公证/商标）
- READY_FOR_RC 不受影响（RC 是「可进入候选」，不是「可发布」）

### 建议的后续动作

1. 单独阶段做依赖升级：先 cargo update 到各 crate 最新 patch，跑完整 Rust + 实机 SSH 矩阵
2. quinn-proto 若确认不可达，在 deny.toml 里加 ignore 并写明理由（而不是沉默）
3. 把 cargo audit 接进 CI 作为 **diagnostic** 门禁（当前完全没有），否则下次仍靠人工偶然发现

## 2. 前端依赖：审计端点不可用

    ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS
    The audit endpoint (at https://registry.npmmirror.com/-/npm/v1/security/audits/quick) does not exist

当前镜像源不实现 npm audit 端点，因此**前端依赖的漏洞状态本轮未取得证据**。
这不是「没有漏洞」，是「没有测量」。属于 **NOT_RUN**。

建议：CI 里用官方 registry 跑一次 pnpm audit --prod，或接入 osv-scanner 之类的离线方案。

## 3. 许可证

pnpm licenses list --prod 在本机镜像下未返回可解析输出，**许可证清单本轮未取得**。
同样属于 **NOT_RUN**，不能写「许可证合规」。

## 4. 结论

| 项 | 结论 | 类别 |
| --- | --- | --- |
| Rust 依赖漏洞 | **27 条已知漏洞**，含 9 条 high (7.5) | 实测（负面） |
| 前端依赖漏洞 | 未取得 | NOT_RUN |
| 许可证 | 未取得 | NOT_RUN |

**不得在任何交付材料中声称「依赖审计为 0 个已知漏洞」。**