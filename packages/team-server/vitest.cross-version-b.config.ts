import path from 'node:path'
import { defineConfig } from 'vitest/config'

// The 'B' side of the cross-version run is today's client, so '@' points at the
// working tree exactly like the regular PostgreSQL suite. It runs in its own
// process so the historical and current module graphs never share a registry.
const FRONTEND_ROOT = path.resolve(__dirname, '../frontend')

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/cross-version/*.b-spec.ts'],
    setupFiles: ['reflect-metadata'],
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 120000,
    execArgv: ['--experimental-sqlite'],
  },
  resolve: {
    alias: {
      '@': path.resolve(FRONTEND_ROOT, './src'),
      '@tauri-apps': path.resolve(FRONTEND_ROOT, './node_modules/@tauri-apps'),
    },
  },
})
