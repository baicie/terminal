# 12 · Final Design Review、冲突收口与开放决策

## 1. 复审方法

本轮对当前 `main=5f24863`、用户提供 v2.0 全文、10 张桌面参考图、仓库 UX-1/Phase 9/10/CI/GUI/SFTP 文档进行了分域审查，并用独立视角复核：

- 产品边界：是否重复建设、是否把设计图当产品、是否把 Core 变成后台/IDE/监控平台。
- 生命周期/安全：是否出现 UI owner、SFTP 截断、Session 重建、Secret 泄漏、Provider 静默降级、AI/Extension 越权。
- 工程/发布：是否把旧 SHA、旧 PR、Mock、CI build、旧 GUI run 当成当前完成证据。

审查结论已写回 canonical 文档，而不是只把问题留在本文件。

## 2. 已收口的冲突

### 冲突 A：v2.0 的基线和当前 main 不一致

- v2.0 写 `main=1a24eed`；实际当前 main 是 `5f24863`。
- v2.0 声称 14 张图已在 `assets/reference/`；当前执行环境只有 10 张桌面图。
- 处理：所有当前状态以 `01-current-state-and-gap.md` 为准；README 记录外部 v2 provenance；10 张图复制入仓库；4 张 Windows 图明确缺失，不补造。

### 冲突 B：UX-1 应该从零重做还是继续现有代码

- 当前 UX-1a/b/c、F0、SFTP lifecycle、GUI harness 和 E2E 已经合入。
- 处理：`04-ux1-terminal-workspace.md` 只安排当前 SHA 原生验收、occupant 契约和未验证平台项，不重复安排 Shell/Explorer/SFTP 从零开发。

### 冲突 C：SFTP Dock 是否拥有 Session

- 旧实现曾有卸载 cleanup 关闭 SFTP Session 的风险；当前主线已引入 binding、Queue、Lease、Registry lifecycle 和 E2E。
- 处理：`02`/`04` 把 Transfer Queue/Lease/Registry 的 owner 从 Dock 移出；未来任何 Dock 组件不能把 unmount 当 transport close。

### 冲突 D：系统 Keychain 是否立即成为默认

- 设计图暗示 Vault/Keychain 已可用；当前代码只有 Vault Provider，且签名身份/升级读取尚未形成全平台稳定证据。
- 处理：UX-2 拆成 provider 无关 UX-2a 和系统 Provider UX-2b；默认继续 Vault，只有稳定门禁通过后再由产品负责人决定。

### 冲突 E：Rig 是否是 AI MVP 的必要依赖

- Rig 0.46.0 需要 Rust 1.97.1，当前项目是 1.96；当前没有 AI runtime。
- 处理：`07` 推荐最小 ModelDriver + 现有 reqwest，Rig 变成独立 MSRV/依赖/审计/体积 Spike；不引入常驻 Node sidecar。

### 冲突 F：第一个内置扩展选 AI 还是已有能力

- 旧草案建议 command-explainer，但它把 Extension v0 与尚未实现的 AI Runtime 绑定。
- 处理：第一个扩展推荐 `snippet-dock`，验证命令/菜单/Dock/Disposable/权限而不引入 AI；AI 后续再作为第二个内置扩展。

### 冲突 G：replace 导入的凭据确认框

- “确认替换”如果清空仍可用凭据会有数据风险；如果继续 COALESCE 又没有实际作用。
- 处理：保持当前安全默认并把 `secretPolicy` 交给 UX-2a 定义；不加语义未定义的确认对话框。

## 3. 设计中被拒绝的不可行方案

| 方案 | 拒绝原因 | 采用的替代 |
| --- | --- | --- |
| 删除旧路由、只保留新 Shell | 破坏深链、团队/高级功能和回滚 | 保留 route，改变导航呈现 |
| 用 `hosts.updated_at` 冒充 Recent | 编辑主机不等于连接主机 | `connection_logs` 作为唯一来源 |
| Dock cleanup 直接 close SFTP | 会截断后台传输 | Queue/Lease/Registry owner |
| 主 WebView `eval/import` 社区插件 | 没有安全隔离 | 内置编译扩展；未来独立进程/WASM |
| AI 自动执行模型命令 | Prompt injection/误 Host/重复审批 | 只读动作和文本草稿；未来 typed Approval |
| 默认开启后台 Inspector | 变成监控平台并拖慢启动 | 用户 Refresh 的短时 read-only probe |
| 用 CI build/浏览器截图证明 GUI | 无法证明真实窗口、键盘、IME、焦点 | Level 3 Native Desktop |
| 直接改 `productName/identifier` | 影响 DB/Vault/cache/Keychain/Updater | 独立 Identifier Migration PR |

## 4. 仍然可能阻止发布的风险

### 数据与凭据

- 系统 Provider 迁移或 Identifier 变化时引用/密文不可读。
- 旧版本看到新 Provider 后导出/导入静默丢失未知 ref。
- Vault/SQL/FS capability 在未来扩展/AI 进入后扩大到任意 Secret。
- 历史 WAL/backup 的明文清理、迁移 crash point 和跨平台回滚未完整证明。

### 终端与传输

- Native GUI 当前最终 SHA 的真实输入/IME/窗口焦点、Windows OpenSSH Agent/Pageant、Linux stock WebKit、串口硬件仍有边界。
- 资源 owner 被新 Dock/Extension/Inspector 改坏，重新出现重复 Session、幽灵 listener、SFTP 截断或错误 Host 操作。

### 发布链

- Apple notarization、Windows Authenticode、正式 Updater key/公钥、Identifier migration 若未完成，只能是开发/QA 发布。
- Linux AppImage stock 启动和 Windows 完整升级/安装实机不能由 payload/preflight 成功代替。
- 依赖 audit 的已记录 advisory 不得写成“无已知漏洞”。

### 产品范围

- 如果同时推进 Core、系统 Provider、Extension、AI、Inspector 和发布身份，资源会分散且无法在同一版本完成 Level 3/4。
- 设计已将 AI/Inspector 设为可选，并将系统 Provider/Identifier/签名拆成独立门禁；仍需要产品负责人确认发布顺序。

## 5. 需要产品负责人批准的决策

以下问题不会阻塞本文档落地或 UX-1/UX-2a，但会改变后续 PR 顺序和发布范围：

1. **最终品牌名与 Identifier**：是否继续 `Termius/com.baicie.termius`，还是在一次独立迁移中改名？在批准前不改。
2. **Core 与 AI 的版本边界**：推荐先发布 Core Daily Driver，AI 作为可选 feature；是否接受 AI 不进入第一版正式 RC？
3. **默认 Credential Provider**：推荐先 Vault；系统 Keychain/Windows Credential Manager 通过稳定门禁后再决定是否默认。是否接受不承诺“系统钥匙串默认”？
4. **Linux RC 资格**：Windows/macOS 有真实 GUI/签名资源时是否先作为优先平台，Linux 仅在 stock WebKit/安装器运行证据满足后加入？
5. **团队/云同步范围**：保留现有入口和兼容，暂不为 Terminal Next 重做完整团队平台，是否确认？
6. **AI 数据发送策略**：第一版只允许用户选中的文本/错误片段，禁止全量 scrollback/命令历史/环境变量，是否确认？
7. **Extension 第一对象**：推荐 `snippet-dock`，而不是依赖 AI 的 `command-explainer`，是否确认？

## 6. 设计冻结条件

在用户批准上面产品决策前，可以实施：

- 文档治理、UX-1 当前 HEAD 验收、Native GUI/IME 证据。
- UX-2a 连接时凭据交互、Provider 无关状态和现有 Vault 保持。
- Provider Registry 的内部抽象和负向测试，但不切换默认存储。
- Trusted built-in Extension Registry 的生命周期和 `snippet-dock`。

必须等待批准或外部证据后才能实施：

- 修改 Product Identifier/品牌/数据目录。
- 把系统 Provider 设为默认或批量迁移既有 Vault。
- 正式启用 Updater、签名、公证、Authenticode。
- 开放第三方扩展、AI Tool approval 或任何自动远程执行。

## 7. 最终结论

这套规格把 Terminal Next 收敛为“终端核心 + 可控上下文工具”的产品，而不是把已有终端改造成后台仪表盘。当前代码已经完成了 UX-1 的主要结构和许多可靠性修复，下一步应优先完成当前 SHA 的桌面证据、UX-2a 和 Gateway，再以独立门禁推进内置扩展、系统 Provider、Inspector、AI 和正式发布。

任何后续 PR 如果需要通过删除证据、改写状态、增加假数据、扩大全局权限、占用终端快捷键或把 Dock/AI/Extension 变成 Session owner，均与本设计冲突，应该在 Draft review 阶段停止。
