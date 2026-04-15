import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig as defineVitestConfig } from 'vitest/config'

const FE_DIR = path.resolve(__dirname, '.')

const host = process.env.TAURI_DEV_HOST

const sharedConfig = {
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
}

const devTestPage = path.resolve(FE_DIR, 'src/dev-test-page.tsx')

export default defineVitestConfig(({ mode }) => {
  if (mode === 'test') {
    return {
      ...sharedConfig,
      test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: [],
        include: ['src/**/*.test.{ts,tsx}'],
        coverage: {
          provider: 'v8',
          include: ['src/**/*.{ts,tsx}'],
          exclude: [
            'src/**/*.d.ts',
            'src/**/index.ts',
            'src/main.tsx',
            'src/App.tsx',
          ],
        },
      },
    }
  }

  return {
    ...sharedConfig,
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
        exclude: [devTestPage],
        output: {
          chunkFileNames: 'js/[name].[hash].js',
          entryFileNames: 'js/[name].[hash].js',
          manualChunks(id) {
            if (id.includes('node_modules')) {
              const directories = id.toString().split('node_modules/')
              if (directories.length > 2) {
                return directories[2].split('/')[0].toString()
              }
              return directories[1].split('/')[0].toString()
            }
          },
        },
      },
    },
  }
})
