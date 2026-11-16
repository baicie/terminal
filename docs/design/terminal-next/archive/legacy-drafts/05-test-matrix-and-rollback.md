# 05 — 测试矩阵、真机验收与回滚

- 状态：**提案（Draft）**
- 适用：UX-1 ~ UX-4 每阶段的验收口径

---

## 1. 每阶段必须交付

| 项 | 要求 |
| --- | --- |
| 改动与架构说明 | 指向本目录对应文档的章节 |
| 关键交互流程 | 状态图或时序 |
| 新旧 UI 对比 | **同尺寸截图**，不能只给新截图 |
| 可重复测试证据 | 测试名 + 运行命令 |
| CI 与源码指纹 | run URL + fingerprint 前 8 位 |
| 真机 GUI 验收 | 逐项 PASS / PARTIAL / NOT_RUN |
| 剩余 P0/P1 | — |

**没有真机证据的项一律写 NOT_RUN，不得写 PASS。**

---

## 2. 测试矩阵

| 范围 | 正路径 | 负路径 | 真机要求 |
| --- | --- | --- | --- |
| 凭据 | Keychain 存取清；旧 Vault 读取；认证成功后才保存 | OS 拒绝授权、错误密码、中断写、孤儿键、引用损坏、**不支持的 provider** | macOS Keychain 实测；Windows/Linux 标记 NOT_RUN |
| SSH | password / key / agent / cert / Jump | 错误凭据、Vault 锁、网络断开、重连预算 | 真实 sshd，**不用 CLI 代替 Tauri** |
| 布局 | tabs / 分屏 / Dock / Explorer / 搜索 | 快捷键冲突、pane 隐藏、会话丢失、窄窗口 | IME / Vim / tmux / resize |
| 插件 | activate / register / deactivate / reload | 抛异常、重复注册、卸载中回调、权限拒绝 | 主会话保活 |
| Rig | profile CRUD、测试连接、真实 prompt、取消 | 401 / 429 / 超时 / 坏 JSON / 密钥泄露 / 超限输出 | mock + 可选真实 provider |
| 安全 | 无秘密外泄；敏感动作显式授权 | 注入、路径穿越、跨 host 引用、插件越权 | 结构审查 + 负向测试 |
| 交付 | source-size、ESLint、typecheck、全量前端、Rust、bundle | 证据指纹失效、Errors 单独一行 | CI + 正确 HEAD 证据 |

---

## 3. 阶段门禁

### UX-1（Terminal-first Workspace）

```
TERM_LAYER_SINGLE_MOUNT      全局 [data-terminal-workbench] === 1
NO_EXTRA_PTY_ON_NAV          路由切换不新增会话
TERMINAL_ALWAYS_MOUNTED      tabs 清空后终端层仍在（ACK 不断）
PANE_NOT_UNMOUNTED_ON_TAB    切 tab 后 xterm 不 dispose
SHORTCUT_3_LAYERS            三层保护同时存在
NARROW_LAYOUT_REACHABLE      320/480/639/640/900/1280 六档列数 > 0
ERROR_STAYS_IN_PANE          错误覆盖在 pane 内
WORKSPACE_RESTORE            4 个持久化字段全恢复
```

**附加前置**：先给 `Ctrl+P` / `Ctrl+N` / `Ctrl+R` 补保护测试（当前无任何测试）。

### UX-2a（凭据交互，provider 无关）

```
ASK_ON_CONNECT                连接时才询问密码
SAVE_AFTER_SUCCESS            认证成功后才保存，失败不保存
INLINE_VAULT_UNLOCK           连接上下文中解锁，不跳页
NO_VAULT_REQUIRED_GATE        不强制先建 Vault
```

### UX-2b（Keychain provider）

```
KEYCHAIN_DEFAULT_PATH         BLOCKED — 待 KEYCHAIN_STABLE_ACCESS_VERIFIED
LEGACY_VAULT_COMPAT           真实 fixture 解密，非 parse
PROVIDER_DISPATCH_BY_REF      resolver 按 ref.provider 分派
CROSS_PROVIDER_ROLLBACK_SAFE  三组负向测试全过
EXPORT_PRESERVES_UNREADABLE_REF  导出不把无法解析的 ref 写成 null
```

**UX-2b 不得先于签名与导出修复合入**（见 00 号 §3.1、01 号 §4.2）。

### UX-3（Extension v0）

```
BUILTIN_PLUGIN_LIFECYCLE      启用→停用→重启用不残留
PLUGIN_FAILURE_ISOLATED       插件抛异常不影响终端
NO_PTY_OWNERSHIP              插件不拥有 PTY 生命周期
```

### UX-4（Rig MVP）

```
MSRV_UPGRADE_ADR              必需，未写
RIG_MODEL_PROFILE             CRUD + 测试连接
RIG_READONLY_ACTIONS          四个只读 action
AI_SECRET_ISOLATION           key 不进 DB/日志/错误对象
MOCK_VS_REAL_SEPARATED        本地假服务与真实 provider 分开报告
```

---

## 4. 真机验收方式

### 4.1 截图要求

| 尺寸 | 用途 |
| --- | --- |
| 1440×900 | 桌面默认态、展开态 |
| 1024×768 | 中等窗口 |
| 390×844 | 移动/窄窗口 |

**改前与改后必须同尺寸**，否则无法判断是否退化。

### 4.2 录屏要求

3–5 个关键交互：

1. 切 tab → 终端不重建、滚动历史保留
2. 分屏 → 拖拽 → 内容不重叠
3. Explorer 展开/折叠 → 终端列数变化
4. Dock 开关 → 传输不中断
5. 连接失败 → 错误停在 pane 内 → 点击恢复动作

### 4.3 人工项（无法自动化）

- 中文输入法组合输入（拼音未上屏时不发送）
- Vim：Esc / Ctrl / Alt 组合
- tmux：方向键、状态栏
- 物理键盘重叠按键

---

## 5. 回滚方案

### 5.1 每个 PR 必须可独立回滚

- UX-1 ~ UX-4 各自独立 PR，**不互相依赖合并顺序以外的代码**
- 数据库变更必须是加法（新列/新表），不得删除旧列
- 旧路由保留为深链，回滚后仍可访问

### 5.2 凭据特有回滚

**三种"丢失"要分开处理**（定义见 `01-credential-keychain-vault.md` §4.2）：

| 类型 | 回滚手段 |
| --- | --- |
| 秘密数据丢失 | 只能从 `vault.json` 备份恢复；本轮的修复不涉及这一类 |
| 引用关联丢失 | Vault 文件里密文仍在，可手工重建引用；本轮已修复三条产生它的路径 |
| 导入后需重新绑定 | 无损失，重输一次；本轮确保它被报告 |

**这是唯一可能丢数据的部分。**

| 场景 | 回滚动作 |
| --- | --- |
| UX-2b 合入后发现问题 | 旧构建下 keychain 主机会显示「无法读取」但**不丢数据**（密文仍在系统钥匙串） |
| 用户从新构建回退 | **必须先导出并保留原始 ref**，否则 `export-sanitize` 会把 ref 写成 null |
| Vault 用户 | 新旧构建都能读，无需动作 |

**在 `export-sanitize` 修复前，UX-2b 不得发布给真实用户。**

### 5.3 证据回滚

`packages/frontend/src`、`src-tauri/src`、`Cargo.toml/lock` 任何改动都会让六份验收证据失效。必须按 AGENTS.md 官方流程重采 —— **不得手改旧 manifest**。

---

## 6. 当前判定

```
UX_DESIGN_APPROVED            = PENDING
KEYCHAIN_DEFAULT_PATH         = BLOCKED（签名）
LEGACY_VAULT_COMPAT           = 待真实验证
TERMINAL_CANVAS_DEFAULT       = NOT_IMPLEMENTED
SINGLE_PTY_LIFECYCLE          = PASS（现有，16 条不变量为门禁）
BUILTIN_PLUGIN_LIFECYCLE      = NOT_IMPLEMENTED
RIG_MODEL_PROFILE             = NOT_IMPLEMENTED
RIG_READONLY_ACTIONS          = NOT_IMPLEMENTED

TABBY_REPLACEMENT_READY       = NO
```

最后一行不变：**代码完成不是产品完成。** 真机与 7 天验收未过，就不改。
