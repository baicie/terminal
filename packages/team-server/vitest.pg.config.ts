import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/pg/*.pg-spec.ts'],
    globalSetup: ['./src/__tests__/pg/pg-global-setup.ts'],
    setupFiles: ['reflect-metadata'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
