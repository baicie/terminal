import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const FE_DIR = path.resolve(__dirname, '.')

const host = process.env.TAURI_DEV_HOST

// 已知警告（无害）：build 时 rolldown 会输出
//   "Warning: Invalid input options - For the "exclude". Invalid key: ..."
// 这是 vite 8 + rolldown 后端某个内部插件（疑似 @vitejs/plugin-react 的
// babel/swc transform）传入了 rolldown 不识别的 `exclude` 字段。
// 已确认不影响构建产物，等待上游修复后即可消失。
export default defineConfig(() => ({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(FE_DIR, 'src'),
    },
  },
  define: {
    IS_TAURI: JSON.stringify(true),
    IS_DEV: JSON.stringify(process.env.NODE_ENV === 'development'),
    IS_MACOS: JSON.stringify(
      process.env.TAURI_ENV_PLATFORM?.includes('darwin') ?? false,
    ),
    IS_WINDOWS: JSON.stringify(
      process.env.TAURI_ENV_PLATFORM?.includes('windows') ?? false,
    ),
    IS_LINUX: JSON.stringify(
      process.env.TAURI_ENV_PLATFORM?.includes('linux') ?? false,
    ),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        chunkFileNames: 'js/[name].[hash].js',
        entryFileNames: 'js/[name].[hash].js',
        manualChunks(id) {
          // Keep these boundaries narrow. A catch-all vendor chunk would pull
          // terminal-only dependencies into the initial route graph.
          if (id.includes('/node_modules/@baicie/xterm/')) return 'xterm-core'
          if (id.includes('/node_modules/@xterm/')) return 'xterm-addons'
          if (id.includes('/node_modules/lucide-react/')) return 'icons'
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/react-router/') ||
            id.includes('/node_modules/react-router-dom/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'react-runtime'
          }
        },
      },
    },
  },
}))
