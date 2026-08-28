# 构建产物与优化指南

> 更新时间：2026-05-02（2 轮优化）

---

## 一、当前构建产物（2026-05-02 r2 基线）

> 通过 `pnpm build:analyze` 生成（vite build + scripts/bundle-stats.mjs）。
> 详细文件级别报告见 `dist-stats.md` / `dist-stats.json`（gitignore）。
>
> **关键指标：首屏 gzip 242 KB**（用户打开应用必须下载的关键路径），
> 其余 187 KB 均为 lazy chunk，按路由 / 按弹窗触发加载。

### 总览（首屏 vs 懒加载）

| | 文件数 | Raw | Gzip | Brotli |
| --- | --- | --- | --- | --- |
| **首屏（Initial）** | 18 | 840 KB | **242 KB** | 210 KB |
| 路由 / 动态（Lazy） | 35 | 710 KB | 187 KB | 155 KB |
| 全部 | 53 | 1.51 MB | 429 KB | 365 KB |

### 主要 chunk（按 raw 大小）

| 文件 | 加载 | Raw | Gzip | 说明 |
| --- | --- | --- | --- | --- |
| `js/xterm-core.*.js` | **Lazy** | 348 KB | 86 KB | `@baicie/xterm` 兼容 core（仅 terminal 路由） |
| `js/react-dom.*.js` | Initial | 178 KB | 56 KB | React DOM |
| `js/index.*.js` | Initial | **159 KB** | **43 KB** | 应用业务代码主入口（**↓ 38%**） |
| `js/@radix-ui.*.js` | Initial | 113 KB | 33 KB | shadcn/ui 底层 |
| `assets/index-*.css` | Initial | 94 KB | 16 KB | Tailwind v4 样式 |
| `js/react-router.*.js` | Initial | 93 KB | 31 KB | 路由 |
| `js/xterm-addons.*.js` | **Lazy** | 75 KB | 25 KB | xterm 官方 addons |
| `js/i18next.*.js` | Initial | 42 KB | 13 KB | 国际化 |
| `js/snippets.*.js` | Lazy | 36 KB | 9 KB | snippets 视图 |
| `js/settings-dialog.*.js` | Lazy | 32 KB | 7 KB | 设置对话框 |
| `js/@floating-ui.*.js` | Initial | 33 KB | 12 KB | 浮动定位 |
| `js/container.*.js` | Lazy | 29 KB | 9 KB | TerminalContainer |
| `js/host-dialog.*.js` | Lazy | 17 KB | 4 KB | 新增主机对话框 |
| `js/command-palette.*.js` | Lazy | 9 KB | 3 KB | 命令面板 |
| `js/serial-dialog.*.js` | Lazy | 6 KB | 2 KB | 串口连接对话框 |
| `js/notification-panel.*.js` | Lazy | 3 KB | 1 KB | 通知面板 |

### 优化历程

| 阶段 | 首屏 gzip | 主入口 raw | 备注 |
| --- | --- | --- | --- |
| r0 原始 | ~290 KB | ~290 KB | manualChunks 强制 vendor、所有 dialog 静态 import |
| r1（2026-05-02 早） | 259 KB | 256 KB | terser、drop_console、tree shaking |
| **r2（2026-05-02 晚）** | **242 KB** | **159 KB** | xterm 真懒加载、5 个 dialog 改 React.lazy、清理死代码 |

**r1 → r2 关键变化**：

1. 移除 `nav-config.tsx` 死代码 case `/terminal` → 消除 `INEFFECTIVE_DYNAMIC_IMPORT` 警告
2. `TerminalContainer` 改为 `React.lazy`，配合 xterm 专用分包边界，让 rolldown 把 `@baicie/xterm`（兼容 core）+ `@xterm/*`（插件）+ container 全部移出首屏
3. `SettingsDialog` / `HostDialog` / `CommandPalette` / `NotificationPanel` / `SerialDialog` 共 5 个全局对话框改为 `React.lazy + open && <Suspense>`，仅在用户主动触发时加载
4. 删除 `service/recording.ts`、`store/terminal.ts`、`features/terminal/stores/`、`view/home/` 等 4 处死代码（共 ~12 KB 源码）

### 优化效果

| 配置项               | 效果                      |
| -------------------- | ------------------------- |
| `minify: 'terser'`   | 移除 console.log/debugger |
| `drop_console: true` | ~20KB 优化                |
| Tree Shaking         | 自动移除未使用代码        |
| **总计优化**         | **~100KB**                |

### 主要模块体积分析

| 模块           | 体积        | gzip        | 说明                           |
| -------------- | ----------- | ----------- | ------------------------------ |
| @xterm         | 395 KB      | 103 KB      | xterm.js 终端模拟器 (核心依赖) |
| react-dom      | 178 KB      | 57 KB       | React DOM 渲染库               |
| index (主代码) | 179 KB      | 46 KB       | 应用业务代码                   |
| @radix-ui      | 107 KB      | 32 KB       | shadcn/ui 底层组件             |
| react-router   | 88 KB       | 29 KB       | 路由库                         |
| **总计**       | **~1.4 MB** | **~400 KB** | gzip 压缩后约 400KB            |

### Rust 后端 (Tauri)

```
src-tauri/target/release/
├── terminal              # macOS 可执行文件 (~10-15 MB)
└── bundle/
    └── macos/
        └── Terminal.app  # macOS 应用包 (~30-40 MB)
```

### 低磁盘开发流程

Rust 的 `target` 目录是可重建缓存，不包含 SQLite 数据、SSH 密钥或应用配置。当前开发 profile 已关闭增量编译并降低依赖 debuginfo；在本机实测，项目 `src-tauri/target` 约 3.3 GB，反复切换 feature/profile 后旧 hash 产物仍会累积。

需要把构建缓存放到外置盘或专用缓存盘时，只对当前命令设置 `CARGO_TARGET_DIR`，不要未经确认写入全局 Cargo 配置：

```bash
CARGO_TARGET_DIR=/Volumes/DevCache/terminal-target pnpm tauri dev
CARGO_TARGET_DIR=/Volumes/DevCache/terminal-target pnpm tauri build --debug --no-bundle
```

如果没有外置盘，先停止 `tauri dev`、`cargo` 和 `rustc` 进程，再只移走当前项目的 `src-tauri/target`；下一次构建会自动重建。不要用同样的方式删除 `~/.cargo/registry`、`~/.cargo/git` 或 `~/.rustup`，这些是多个项目共用的依赖与工具链缓存；清理工具链前应先用 `rustup toolchain list` 确认保留项目要求的 Rust 版本。

---

## 二、优化建议

### 1. xterm.js 优化 (416 KB → 可优化至 ~300 KB)

**问题**：xterm.js 包含大量 VT 序列解析逻辑，体积较大。

**方案 A - 按需加载插件**：

```typescript
// 只加载需要的插件，而不是全部
import { Terminal } from '@baicie/xterm'
import { FitAddon } from '@xterm/addon-fit'
// 移除不用的插件 (WebGL, Image 等)
```

**方案 B - 控制插件与 renderer**：

精确固定 `@baicie/xterm@0.1.7` 作为带 macOS WKWebView 重叠按键修复的核心实现；官方 addons 按设备能力加载，运行时与 CSS 不得混用上游 core。Vite 将修复版 core 和官方 addons 分成独立懒加载 chunk。

**方案 C - 懒加载 xterm**：

```typescript
// 在需要时才加载 xterm.js
const loadXterm = async () => {
  const { Terminal } = await import('@baicie/xterm')
  return new Terminal()
}
```

---

### 2. 代码分割优化

**当前问题**：主包 `index.js` 有 179KB，可以进一步分割。

**优化 `vite.config.ts`**：

```typescript
import { defineConfig } from 'vite'
import { splitVendorChunkPlugin } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // 分离 React 生态
          'vendor-react': ['react', 'react-dom'],
          // 分离路由
          'vendor-router': ['react-router-dom'],
          // 分离 UI 库
          'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-select', ...],
          // 分离 xterm
          'vendor-xterm': ['@baicie/xterm', '@xterm/addon-fit', ...],
        }
      }
    },
    // 启用 CSS 代码分割
    cssCodeSplit: true,
  },
  plugins: [splitVendorChunkPlugin()]
})
```

---

### 3. Tree Shaking 优化

**确保未使用的代码被移除**：

```typescript
// ❌ 错误：导入整个库
import _ from 'lodash'
_.debounce()

// ✅ 正确：只导入需要的部分
import debounce from 'lodash/debounce'
```

**检查 lucide-react 图标使用**：

```bash
# 统计使用了多少图标
grep -r "from 'lucide-react'" src/ | wc -l
```

---

### 4. 依赖优化

**分析依赖体积**：

> ⚠️ 当前 Vite 8 使用 rolldown 后端，`rollup-plugin-visualizer` **不兼容**（hook 不会被调用，不会输出 stats.html）。
> 已改用自研脚本 `packages/frontend/scripts/bundle-stats.mjs`：

```bash
# 一键 build + 生成基线报告
pnpm --filter @terminal/frontend build:analyze

# 仅基于已有 dist/ 重新生成报告
pnpm --filter @terminal/frontend stats
```

输出：

- `dist-stats.md` — markdown 格式的人类可读报告
- `dist-stats.json` — 机器可解析格式，便于 CI 跟踪基线

报告字段：raw / gzip / brotli 三种压缩尺寸，按文件、按类别（Vendor / App / CSS / HTML）。

**考虑替换重型依赖**：

| 当前依赖       | 建议替换                   | 节省体积 |
| -------------- | -------------------------- | -------- |
| dayjs (10KB)   | date-fns (5KB) 或原生 Intl | ~5KB     |
| i18next (43KB) | 轻量替代如 fbt             | -        |

---

### 5. Gzip/Brotli 压缩

**当前 Vite 已启用 gzipSize**，但可以进一步优化：

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // 移除 console.log
        drop_debugger: true, // 移除 debugger
        passes: 2, // 多轮压缩
      },
    },
  },
})
```

**配置服务器压缩**：

```typescript
// 在 Tauri 服务端添加 Brotli 支持
// src-tauri/src/main.rs
use tauri::Manager;

#[cfg(not(debug_assertions))]
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            // 启用 gzip/brotli 压缩
            Ok(())
        })
}
```

---

### 6. 资源内联与 Base64

**小文件内联**：

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    assetsInlineLimit: 4096, // 4KB 以下的资源转为 base64
  },
})
```

**CDN 加载核心包不适用**：桌面应用必须使用 lockfile 中精确固定的 `@baicie/xterm@0.1.7`，保证 WKWebView 键盘补丁、离线启动和构建可重复；不得为了减小 bundle 改从 CDN 加载官方 core。

---

### 7. 懒加载路由

**当前使用 `React.lazy`**，可以进一步优化：

```typescript
// src/router/index.tsx
const routes = [
  {
    path: '/hosts',
    component: lazy(() => import('@/view/hosts')),
  },
  {
    path: '/terminal',
    component: lazy(() => import('@/view/terminal')),
  },
  // ... 更多路由懒加载
]
```

---

## 三、预期优化效果

| 优化项       | 当前        | 可优化至    | 节省        |
| ------------ | ----------- | ----------- | ----------- |
| xterm.js     | 395 KB      | 300 KB      | 95 KB       |
| 代码分割     | 179 KB      | 120 KB      | 59 KB       |
| Tree Shaking | 已优化      | -           | -           |
| Console 移除 | 已优化      | -           | ~20 KB      |
| **总计**     | **~1.4 MB** | **~1.0 MB** | **~400 KB** |

**最终预期体积**：

- 生产构建：~1.0 MB
- gzip 压缩后：~350 KB

---

## 四、建议优先实施的优化

### ✅ 已实施 (2026-03-26)

1. **Terser 压缩配置** - 移除 console.log

   ```typescript
   // vite.config.ts
   build: {
     minify: 'terser',
     terserOptions: {
       compress: { drop_console: true }
     }
   }
   ```

   - 已在 `vite.config.ts` 中配置

2. **splitVendorChunkPlugin** - 更好的缓存策略
   - Vite 内置的 manualChunks 已实现

### 🔄 待实施

3. xterm.js 懒加载
4. 路由预加载配置

### 📋 可选

5. CDN 外部化 xterm.js
6. 自定义 xterm.js 构建

---

## 五、验证优化效果

```bash
# 1. 构建
pnpm vite build

# 2. 检查体积
du -sh dist/
ls -lh dist/js/

# 3. 预览 gzip 大小
pnpm add -D serve
serve -s dist -p 3000
# 然后在浏览器 Network 面板查看 gzip 大小
```

---

## 六、相关文件

- `vite.config.ts` - Vite 构建配置
- `package.json` - npm 依赖配置
- `src-tauri/tauri.conf.json` - Tauri 应用配置

---

## 七、Rust 磁盘占用审计（2026-08-21）

当前工作区实测占用约为：`src-tauri/target` 2.8 GiB、Cargo registry 3.3 GiB、Rust toolchains 5.2 GiB。没有证据表明本项目每次构建都会稳定新增 40 GiB；`target/debug/deps` 中主要是旧 profile/依赖变体残留。

本轮已移除未使用的 `ssh-rs` 与 `russh-keys` 直接依赖，并为 `ssh-key` 显式声明实际需要的 features。`cargo check --locked --all-targets --all-features` 与 `cargo test --locked --lib` 通过；未执行 `cargo clean`，避免删除仍可复用的构建产物。后续优先把 `CARGO_BUILD_BUILD_DIR` 指向外置盘或专用缓存目录，再按工具链使用情况选择性清理，不要在未确认目标的情况下递归删除 Cargo/Rust 目录。
