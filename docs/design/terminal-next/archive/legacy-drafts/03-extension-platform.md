# 03 — Extension Platform：SDK、Manifest、生命周期与权限

- 状态：**提案（Draft）**，UX-3 才实施
- 审查结论：**全仓目前没有任何插件抽象**，这是从零开始的能力

---

## 1. 核心约束

Tauri WebView 中的脚本**没有安全意义上的模块隔离**。因此：

> **社区插件不能直接 `import()` 或 `eval()` 运行在主 UI 环境。**

这条不是保守，是事实：主 WebView 里的任意 JS 都继承 Tauri 的 command 权限、SQL 访问、文件系统访问。设计包 §4.1 的表述准确。

## 2. 三层结构

```text
Tauri Host / Rust Capability Gateway
   ├─ Stable Terminal Core (PTY / SSH / SFTP / Vault / DB)
   ├─ Extension Registry (manifest, lifecycle, permissions)
   │    ├─ Trusted built-in extensions (编译进应用)
   │    └─ Community extensions（以后：独立进程 / WASM / 协议）
   └─ Optional AI extension (Rust Rig)
```

## 3. 最小 SDK（v0）

```ts
interface Disposable { dispose(): void }

interface TerminalExtensionContext {
  pluginId: string
  subscriptions: Disposable[]
  commands: {
    register(def: { id: string; title: string; run(): Promise<void> }): Disposable
  }
  menus: {
    register(def: {
      location: 'terminal.context' | 'connections.context'
      commandId: string
    }): Disposable
  }
  views: {
    register(def: {
      id: string
      title: string
      slot: 'right-dock'
      /** v0 只接受编译进应用的内置组件。 */
      builtIn: BuiltInViewId
    }): Disposable
  }
  terminal: {
    /** 用户明确选中后才有值；受 consent 守卫。 */
    selectedText(): Promise<string | null>
    /** 必须经用户确认才真正发送。 */
    requestSendText(sessionId: string, text: string): Promise<ApprovalResult>
    // 不暴露 raw PTY handle、SSH 凭据
  }
  events: {
    on(event: 'session.connected' | 'session.disconnected' | 'workspace.changed',
       cb: (e: SafeEvent) => void): Disposable
  }
}
```

**`views.register` 用 `builtIn: BuiltInViewId` 而不是 `component: React.ComponentType`** —— 这是与设计包的差异。设计包写的是 `component: TrustedBuiltInComponent`，但把一个 React 组件类型暴露给插件 API 会让「第三方不能用」这个约束只存在于文档里，而不在类型系统里。用 ID 查找内置组件表，第三方插件在类型层面就无法提供组件。

## 4. Manifest

```json
{
  "id": "org.example.command-helper",
  "name": "Command Helper",
  "version": "0.1.0",
  "apiVersion": 1,
  "entry": "built-in:command-helper",
  "capabilities": [
    "commands.register",
    "terminal.read-selected-output",
    "ui.right-dock"
  ],
  "platforms": ["macos", "windows", "linux"]
}
```

## 5. 生命周期

```ts
activate(context): Disposable[] | Promise<Disposable[]>
deactivate(): void | Promise<void>
```

**硬要求**：

1. 启用 / 禁用 / 异常时，**每项注册都能撤销**
2. 插件抛异常**不得中断主 UI 渲染**
3. 事件回调可取消
4. 禁用插件不重启、不杀死 PTY

第 4 条对应 INV-1~4：插件系统损坏时，终端必须照常工作。

## 6. 权限

| 能力 | v0 | 说明 |
| --- | --- | --- |
| `commands.register` | 允许 | |
| `menus.register` | 允许 | |
| `ui.right-dock` | 允许（仅内置） | |
| `terminal.read-selected-output` | 允许，**需用户当次选中** | 不读 scrollback |
| `terminal.send-text` | 允许，**需用户确认** | 从不自动执行 |
| 文件系统 | **拒绝** | |
| 网络 | **拒绝** | |
| SQL / 凭据 | **拒绝** | |

权限按 **插件 ID + 会话 ID + 用户操作** 三重绑定，危险能力默认拒绝。

## 7. 交付顺序

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| v0 | Command Palette / Context Menu / Right Dock / 只读事件 | 启用→停用→重启用**不残留**命令、监听器、菜单项 |
| v1 | 版本化 manifest、插件配置、权限显示、诊断 | 兼容性检查生效；不兼容插件被拒绝而不是半加载 |
| Community | 第三方包 + 独立进程/WASM 隔离 | **确认沙箱真实隔离前不宣称沙箱** |

## 8. 第一个内置插件

建议 `command-explainer`（AI 解释），因为：
- 它同时验证 UX-3 与 UX-4 的接口
- 它只读、只产生文本，风险最低
- 它天然需要 `terminal.read-selected-output` + `ui.right-dock` 两个能力

**不迁移**复杂插件（如 SFTP）作为第一个验证对象 —— 那会让 UX-3 和 UX-1 互相阻塞。

## 9. 判定

```
PLUGIN_SDK_V0               = NOT_IMPLEMENTED
BUILTIN_PLUGIN_LIFECYCLE    = NOT_IMPLEMENTED
COMMUNITY_RUNTIME           = 明确非目标（v1 之外）
```
