import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Cross-version acceptance: the 'A' side runs the client sources of a released
// tag (`v0.0.1-dev.2`, prepared into .tmp/team-sync-a), not the working tree.
// The alias is what pins it: every '@/' import inside the historical tree
// resolves inside that tree, so no current client module can leak into A.
const FRONTEND_ROOT = path.resolve(__dirname, '../frontend')
const HISTORICAL_CLIENT_ROOT = path.resolve(__dirname, '.tmp/team-sync-a')

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/cross-version/*.a-spec.ts'],
    setupFiles: ['reflect-metadata'],
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 120000,
    execArgv: ['--experimental-sqlite'],
  },
  resolve: {
    alias: {
      '@': HISTORICAL_CLIENT_ROOT,
      '@tauri-apps': path.resolve(FRONTEND_ROOT, './node_modules/@tauri-apps'),
    },
  },
})
