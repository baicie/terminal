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
      // Keep jsdom workers bounded. The terminal/bootstrap tests intentionally
      // use short async deadlines; an unbounded worker count can starve one
      // worker long enough for a 1s Testing Library query to time out even
      // though the same test passes in isolation.
      maxWorkers: 4,
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
