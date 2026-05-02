import { defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config'

export default mergeConfig(
  // vite.config 是个 fn，传 mode/command 取得 build 模式的基础配置即可
  // 我们只复用 plugins / resolve / define
  viteConfig({ mode: 'test', command: 'serve' }),
  defineConfig({
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
  }),
)
