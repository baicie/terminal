# 产品身份迁移设计（Phase 8.8 Task D2）

> **状态**：设计稿，**未实施**。
> **暂定对外名称**：「Baicie Terminal」（占位决策，可被推翻）。
> **本阶段边界**：不改 bundle identifier、不改 productName、不执行任何破坏性改名、不改 updater 通道。
> 本文只回答「如果要改名，必须按什么顺序做、失败怎么回滚」。

---

## 0. 合规边界（读这一节即可停止误用）

- **本阶段不做商标清查**（trademark clearance）。「Baicie Terminal」只是工程侧占位名，没有做过任何检索、近似判断或法律意见。
- **不得对外宣称新品牌已完成合规审查**。任何 release note、README、商店页面、官网文案都不得出现「已通过商标审查 / 已合规」这类表述。
- 在商标清查与法务确认完成前，此设计**不构成**改名授权；identifier、productName、安装包文件名继续使用现值。

---

## 1. 当前身份面清单（事实基线）

| 项目 | 当前值 | 出处 |
| --- | --- | --- |
| identifier | **com.baicie.termius** | src-tauri/tauri.conf.json:5 |
| productName | **Termius** | src-tauri/tauri.conf.json:3 |
| 主窗口 title | **termius** | src-tauri/tauri.conf.json:17 |
| 打包目标 | bundle.targets = "all"，macOS 最低 10.15 | src-tauri/tauri.conf.json |
| updater 端点 | GitHub Release updater-latest/latest.json | src-tauri/tauri.conf.json:53 |

**关键结论（两条，决定后面所有步骤）**

1. **DB 跟着 identifier 走**。前端通过 tauri-plugin-sql 打开相对路径 sqlite:terminal.db（src-tauri/src/db_import/mod.rs:24），插件把相对路径解析到 app_config_dir()（tauri-plugin-sql-2.4.0/src/wrapper.rs:81），即 <config dir>/<identifier>/terminal.db。改 identifier 就等于换一个数据库目录。
2. **vault.json 不跟着 identifier 走**。它写死在 dirs::config_dir()/terminal/vault.json（src-tauri/src/vault.rs:811-815），路径里既没有 identifier 段也没有 productName 段。**迁移方案必须把它单独算一项**：既不能假设「换了 identifier 数据自然跟着走」，也不能假设「没换就不用管」——两个方向都会错。

---

## 2. 旧配置发现

### 2.1 三平台路径

| 平台 | app_config_dir（DB 所在） | 旧 vault |
| --- | --- | --- |
| macOS | ~/Library/Application Support/com.baicie.termius/terminal.db | ~/Library/Application Support/terminal/vault.json |
| Windows | %APPDATA%\com.baicie.termius\terminal.db | %APPDATA%\terminal\vault.json |
| Linux | ~/.config/com.baicie.termius/terminal.db（尊重 XDG_CONFIG_HOME） | ~/.config/terminal/vault.json |

### 2.2 需要一起清点的身份附加数据

| 数据 | 位置 | 迁移是否必需 | 说明 |
| --- | --- | --- | --- |
| terminal.db | app_config_dir | **必需** | 主机、密钥引用、设置、团队缓存 |
| vault.json | dirs::config_dir()/terminal | **必需（独立处理）** | 与 identifier 正交，见 §3.2 |
| WebView 本地存储 | macOS ~/Library/WebKit/<identifier>、Windows %LOCALAPPDATA%\<identifier>\EBWebView | 建议 | 含 localStorage（如侧栏宽度 terminal.sidebar.width） |
| 缓存 / 日志 | ~/Library/Caches/<identifier>、%LOCALAPPDATA%\<identifier> | 否 | 可直接丢弃 |
| updater 状态 | 各平台 updater 持久化文件 | 否 | 随 identifier 变化重建 |

### 2.3 探测算法（只读、无副作用）

    1. 取 current    = <config dir>/<新 identifier>/
    2. 取 legacy     = <config dir>/com.baicie.termius/
    3. 取 legacyVault = <config dir>/terminal/vault.json
    4. 三者都不存在                 -> 全新安装：不进入迁移，不写任何标记
    5. legacy 存在且 current 不存在 -> 需要迁移
    6. legacy 与 current 同时存在   -> 交由 §5 冲突裁决，禁止自动合并
    7. 只探测存在性与大小 / SHA-256，不读取、不解析 vault 内容

---

## 3. 迁移设计

### 3.1 DB（identifier 相关）

1. **备份**：terminal.db 复制为 terminal.db.bak-<UTC 时间戳>，校验 size 与 SHA-256 后写入迁移日志。
2. **一致性**：迁移必须在启动最早阶段执行，早于任何 SSH/DB 写入，保证「无连接、无写入」；并用 SQLite integrity_check 对备份文件做结构校验。
3. **迁移**：复制而非移动，目标为 <新 identifier>/terminal.db。
4. **校验**：源与目标的 size + SHA-256 必须一致；再用只读连接打开目标，抽样比对 user_version 与若干表计数。
5. **切换**：校验通过后标记 active，此后启动走新路径。
6. **回滚**：任一步失败即「源不动 + 删除目标」，标记 rolled-back，本次启动以只读提示告知用户；**不静默降级到旧库**，避免出现双库双写。

### 3.2 Vault（与 identifier 正交，必须单独算）

vault.json 位于 dirs::config_dir()/terminal/vault.json，**不在 identifier 目录下**，因此：

- **单纯改 identifier 不会让 vault「丢失」**：新旧版本读的仍是同一个 terminal/vault.json。这条行为必须在发布说明里写清楚，否则会被误判为「加密数据迁移成功 / 失败」。
- **真正的风险是「同时存在两份 vault」**：如果未来把 vault 也对齐到品牌目录（<config dir>/<新 identifier>/vault.json），就会出现旧文件与新文件并存。设计上**禁止**自动新建第二份 vault：后端语义是「创建永不覆盖」（vault_create 走独占 claim，已存在即 already_exists），一旦用户在错误路径创建成功，等于用一份空 vault 顶替了真实数据的使用位置。
- 如确需改变 vault 路径，步骤必须是：**字节级复制 -> SHA-256 比对 -> 用原主密码做一次解锁探针（成功后立即 lock，不落任何明文）-> 才切路径**。任何一步失败：保留原文件、删除目标文件、旧路径继续可用。
- **禁止**：删除、截断、重写旧 vault.json；对 corrupt 或 uninitialized 状态的文件做任何自动化处理——前者的字节是人工恢复的唯一依靠，后者只能由用户重新创建。

### 3.3 失败即回滚的硬约束

- 迁移全程不得执行 unlink / rm 旧数据；清理旧目录是一次**独立、显式、人工触发**的操作。
- 任一断言失败（大小、哈希、SQLite 结构、vault 解锁探针）-> 立即回滚，并把原因写入迁移日志与启动提示。

---

## 4. 重复启动的幂等性

使用带状态的迁移标记（JSON，位于新 app_config_dir；字段：schemaVersion、state、sourceSha256、targetSha256、updatedAt、attempts）：

| state | 再次启动时的行为 |
| --- | --- |
| 无标记 | 走 §2.3 探测；不需要迁移则什么都不做 |
| backed-up | 目标已存在且哈希一致 -> 直接进 verified；不一致 -> 失败并回滚（**不覆盖**） |
| copied | 重新校验目标哈希；一致 -> verified；不一致 -> 删除目标、重做一次复制（attempts 上限 1 次，仍失败则 rolled-back） |
| verified | 直接进 active |
| active | 完全跳过迁移分支，零额外 IO |
| rolled-back | 只读提示 + 指向备份位置；**不自动重试**，需用户显式确认后才允许再跑一次 |

要点：

- **迁移中断（进程被杀 / 断电）后再次启动必须仍能收敛**：每一步的唯一判据是「目标文件是否已完整且哈希一致」，绝不依赖「是否执行过复制」这类内存状态。
- 目标已存在且哈希与源一致 -> 视为已迁移，**不重复复制**（幂等）。
- 目标已存在但哈希不一致 -> **不覆盖**，判为冲突，交 §5。
- 迁移只允许发生在启动早期、任何业务写入之前；否则需要第二套并发保护，本期不设计。

---

## 5. 冲突裁决（legacy 与 current 同时存在）

1. 两边 DB 的 size + SHA-256 相同 -> 视为同源，标记 active，不动数据。
2. 不同 -> **不自动合并**。允许启动，但持续显示「检测到两份配置」提示，并提供人工导出 / 导入入口。
3. 两边都有 vault.json（未来路径变更场景）-> 只允许其中一份被「选用」，另一份原样保留并在 UI 明确标注路径，禁止自动删除。

---

## 6. 跨平台安装身份兼容

### 6.1 macOS（CFBundleIdentifier）

- CFBundleIdentifier = identifier。改它，macOS 会把新包当成**另一个应用**：LaunchServices 出现两个条目、TCC 权限（文件 / 辅助功能 / 自动化）重新申请、~/Library/WebKit/<id> 与 ~/Library/Caches/<id> 换目录、Spotlight 与 Dock 固定项失效。
- 旧包**不会**通过 updater 升级到新包（updater 按 bundle id 判定同源），所以必须发一个「过渡版本」：旧 id 的最后一个版本负责提示用户下载新品牌安装包，并在首次启动时完成 §3 的数据接管。
- 最低系统版本 10.15 不变；签名与公证证书不受 identifier 影响，但需为新 id 重新验证 Gatekeeper 行为。

### 6.2 Windows（NSIS 安装身份）

- Tauri NSIS 以 productName 决定安装目录、以 identifier 决定卸载注册表项（…\\Uninstall\\<identifier>）。两者一起改，用户在「应用和功能」里会看到**两条**记录、磁盘上留下**两份**安装。
- 迁移要求：新安装器启动时检测旧卸载键与旧安装目录，提示「将替换旧版本并接管配置」；接管完成后引导用户手动卸载旧条目，**不静默删除**旧安装目录。
- %LOCALAPPDATA%\<identifier>\EBWebView 是 WebView2 用户数据目录，随 identifier 变化 -> localStorage 需按 §2.2 迁移。
- 未配置 Authenticode 签名，过渡期安装包必须在 Release 说明中标注「未签名」。

### 6.3 Linux（.desktop）

- AppImage / deb 通过 .desktop 暴露应用身份，文件名与 Name / StartupWMClass 来自 productName 与 identifier。改名会留下**旧的 orphan .desktop**（残留菜单项、图标指向已删路径）。
- 迁移要求：安装脚本检测旧 .desktop 与旧图标路径，明确提示「旧条目需手动移除」；同时更新 StartupWMClass，否则任务栏图标关联与窗口分组失效。
- 用户自建 autostart 条目（~/.config/autostart/*.desktop）不会自动跟随，需在迁移提示中列出。

### 6.4 跨平台共同项

- updater 的 latest.json 按平台键分发、本身不含 identifier；但客户端只在 bundle id 匹配时接受更新，因此**过渡版本必须保留旧 id**，直至新品牌接管完成。
- 卸载器 / 安装器的 installed 判定、单实例锁、深链接注册（若有）都按 identifier 区分，改名后需一并复核。

---

## 7. 失败模式与回滚矩阵

| 失败点 | 检测方式 | 处理 | 用户可见结果 |
| --- | --- | --- | --- |
| 备份失败（磁盘满 / 权限） | IO 错误 | 立即中止，不写标记 | 仍以旧路径正常启动 |
| 复制后哈希不一致 | SHA-256 比较 | 删除目标，rolled-back | 旧数据可用，提示备份位置 |
| 目标库打不开 / 结构损坏 | SQLite integrity_check | 删除目标，rolled-back | 旧数据可用 |
| vault 解锁探针失败 | 用原密码解锁 | 保留原文件，保持旧路径 | 旧路径继续可用 |
| 目标已存在且内容不同 | 哈希比较 | 判为冲突，进入 §5 | 启动但显示冲突提示 |
| 迁移中途被杀 | 重启后按 state 续跑 | 幂等收敛 | 无感或一次提示 |

---

## 8. 实施顺序（供后续阶段排期，本阶段不执行）

1. 先落地「只读探测 + 迁移标记 + 无行为变更」的骨架（视作无副作用 dry-run）。
2. 再落地 DB 备份 / 校验 / 切换 + 回滚，保持 identifier 不变，用环境变量模拟新 id 验证。
3. 单独评审 vault 路径策略：维持现状（不迁移）或字节级迁移，二选一写死结论。
4. 最后才改 identifier / productName，并发布旧 id 的过渡版本。
5. 商标清查与法务确认是**前置门禁**，不是收尾动作。

---

## 9. 未决问题

- 新 identifier 的具体取值未定（占位候选 com.baicie.baicie-terminal），**未写入任何配置**。
- 是否把 vault.json 也迁到品牌目录：建议**不迁**（见 §3.2），待产品决策。
- Linux 旧 .desktop 的清理由安装脚本负责还是仅文档说明，未定。
- Windows 旧卸载键检测是否需要覆盖「用户手动改过安装路径」的情况，未定。
