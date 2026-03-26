# 构建产物与优化指南

> 更新时间：2026-03-26

---

## 一、当前构建产物

### 前端打包 (Vite) - 已优化

```
dist/                          1.4 MB
├── js/                       1.4 MB
│   ├── @xterm.*.js           395 KB  (xterm.js 终端模拟器)
│   ├── react-dom.*.js        178 KB  (React DOM)
│   ├── index.*.js            179 KB  (应用主代码)
│   ├── @radix-ui.*.js        107 KB  (UI 组件库)
│   ├── react-router.*.js      88 KB   (路由)
│   ├── i18next.*.js           43 KB   (国际化)
│   ├── @floating-ui.*.js      33 KB   (浮动 UI)
│   ├── sonner.*.js            34 KB   (Toast 通知)
│   ├── lucide-react.*.js      21 KB   (图标库)
│   └── [其他组件]             ~200 KB
├── assets/
│   ├── index.*.css           89 KB   (Tailwind + 样式)
│   └── @xterm.*.css           4 KB
└── index.html                4 KB
```

### 优化效果

| 配置项 | 效果 |
|--------|------|
| `minify: 'terser'` | 移除 console.log/debugger |
| `drop_console: true` | ~20KB 优化 |
| Tree Shaking | 自动移除未使用代码 |
| **总计优化** | **~100KB** |

### 主要模块体积分析

| 模块 | 体积 | gzip | 说明 |
|------|------|------|------|
| @xterm | 395 KB | 103 KB | xterm.js 终端模拟器 (核心依赖) |
| react-dom | 178 KB | 57 KB | React DOM 渲染库 |
| index (主代码) | 179 KB | 46 KB | 应用业务代码 |
| @radix-ui | 107 KB | 32 KB | shadcn/ui 底层组件 |
| react-router | 88 KB | 29 KB | 路由库 |
| **总计** | **~1.4 MB** | **~400 KB** | gzip 压缩后约 400KB |

### Rust 后端 (Tauri)

```
src-tauri/target/release/
├── terminal              # macOS 可执行文件 (~10-15 MB)
└── bundle/
    └── macos/
        └── Terminal.app  # macOS 应用包 (~30-40 MB)
```

---

## 二、优化建议

### 1. xterm.js 优化 (416 KB → 可优化至 ~300 KB)

**问题**：xterm.js 包含大量 VT 序列解析逻辑，体积较大。

**方案 A - 按需加载插件**：
```typescript
// 只加载需要的插件，而不是全部
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
// 移除不用的插件 (WebGL, Image 等)
```

**方案 B - 使用 xterm-bytemc**：
```bash
# 安装轻量级替代方案 (如果兼容)
pnpm remove @xterm/xterm
pnpm add xterm-bytemc
```

**方案 C - 懒加载 xterm**：
```typescript
// 在需要时才加载 xterm.js
const loadXterm = async () => {
  const { Terminal } = await import('@xterm/xterm')
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
          'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', ...],
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
```bash
# 安装依赖分析工具
pnpm add -D rollup-plugin-visualizer

# 在 vite.config.ts 中添加
import { visualizer } from 'rollup-plugin-visualizer'

plugins: [
  visualizer({
    open: true,
    gzipSize: true,
    filename: 'stats.html'
  })
]
```

**考虑替换重型依赖**：

| 当前依赖 | 建议替换 | 节省体积 |
|---------|---------|---------|
| dayjs (10KB) | date-fns (5KB) 或原生 Intl | ~5KB |
| i18next (43KB) | 轻量替代如 fbt | - |

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
        drop_console: true,      // 移除 console.log
        drop_debugger: true,     // 移除 debugger
        passes: 2               // 多轮压缩
      }
    }
  }
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
  }
})
```

**CDN 加载大文件**（可选）：
```html
<!-- 在 index.html 中使用 CDN 加载 xterm -->
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.3.0/lib/xterm.min.js"></script>
```

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

| 优化项 | 当前 | 可优化至 | 节省 |
|--------|------|---------|------|
| xterm.js | 395 KB | 300 KB | 95 KB |
| 代码分割 | 179 KB | 120 KB | 59 KB |
| Tree Shaking | 已优化 | - | - |
| Console 移除 | 已优化 | - | ~20 KB |
| **总计** | **~1.4 MB** | **~1.0 MB** | **~400 KB** |

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
